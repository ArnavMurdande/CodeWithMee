'use strict';

const { randomUUID } = require('node:crypto');

const {
  FILE_OWNER_TYPE,
  FILE_SCAN_STATUS,
  FILE_STATE,
  FILE_VISIBILITY,
  checksumBase64,
  mimeAllowedForPurpose,
  normalizeMime,
  normalizeSha256,
  purposePolicy,
  validateUploadIntent,
} = require('./contracts');
const { FileError } = require('./errors');

const SCAN_FAILURE_REASON = Object.freeze({
  [FILE_SCAN_STATUS.FAILED]: 'scanner_failed',
  [FILE_SCAN_STATUS.INFECTED]: 'malware_detected',
  [FILE_SCAN_STATUS.UNSCANNABLE]: 'content_unscannable',
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicFileDto(record) {
  return Object.freeze({
    byteSize: String(record.byteSize),
    createdAt: record.createdAt.toISOString(),
    declaredMime: record.declaredMime,
    detectedMime: record.detectedMime || null,
    id: record.id,
    originalName: record.originalName,
    purpose: record.purpose,
    scanStatus: record.scanStatus,
    state: record.state,
    updatedAt: record.updatedAt.toISOString(),
    uploadedAt: record.uploadedAt?.toISOString() || null,
    visibility: record.visibility,
  });
}

function normalizeEtag(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().replace(/^"|"$/g, '').slice(0, 255);
}

function createFileService({
  authorizeOrganization = async () => false,
  authorizeRelated = async () => false,
  clock = () => new Date(),
  idFactory = randomUUID,
  objectStore,
  repository,
}) {
  if (!repository || !objectStore) throw new Error('File repository and object store are required');

  async function getRecord(fileId) {
    if (typeof fileId !== 'string' || !fileId) throw new FileError('file_not_found', 404);
    const record = await repository.getById(fileId);
    if (!record || record.state === FILE_STATE.DELETED) throw new FileError('file_not_found', 404);
    return record;
  }

  function principalOf(authentication) {
    const principal = authentication?.principal;
    if (!principal?.userId) throw new FileError('authentication_required', 401);
    if (!UUID_PATTERN.test(principal.userId)) {
      throw new FileError('file_identity_not_migrated', 503);
    }
    return principal;
  }

  async function canUseOrganization(principal, organizationId, action, recordOrPurpose) {
    if (typeof organizationId !== 'string' || !UUID_PATTERN.test(organizationId)) return false;
    return Boolean(
      await authorizeOrganization({
        action,
        organizationId,
        principal,
        record: typeof recordOrPurpose === 'object' ? recordOrPurpose : null,
        purpose: typeof recordOrPurpose === 'string' ? recordOrPurpose : recordOrPurpose.purpose,
      }),
    );
  }

  async function assertOwnerWrite(principal, record) {
    if (record.ownerUserId === principal.userId) return;
    if (
      record.ownerOrganizationId &&
      (await canUseOrganization(principal, record.ownerOrganizationId, 'write', record))
    ) {
      return;
    }
    throw new FileError('file_not_found', 404);
  }

  async function assertReadable(principal, record) {
    if (record.ownerUserId === principal.userId) return;
    if (record.visibility === FILE_VISIBILITY.PUBLIC) return;
    if (
      record.ownerOrganizationId &&
      (await canUseOrganization(principal, record.ownerOrganizationId, 'read', record))
    ) {
      return;
    }
    if (await authorizeRelated({ action: 'read', principal, record })) return;
    throw new FileError('file_not_found', 404);
  }

  function storageKeyFor({ id, purpose }, timestamp) {
    const year = String(timestamp.getUTCFullYear());
    const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
    return `${objectStore.basePrefix}/${purpose}/${year}/${month}/${id}`;
  }

  async function quarantineUpload(record, object, reason, detectedMime = null) {
    return repository.markRejectedUpload({
      detectedMime,
      etag: normalizeEtag(object.etag),
      id: record.id,
      quarantineReason: reason,
      rejectedAt: clock(),
    });
  }

  async function applyScanResult(input = {}) {
    const record = await getRecord(input.fileId);
    if (!record.uploadedAt) throw new FileError('file_upload_incomplete', 409);
    if (record.state !== FILE_STATE.UPLOAD_PENDING) {
      if (record.state === FILE_STATE.READY && record.scanStatus === FILE_SCAN_STATUS.CLEAN) {
        return publicFileDto(record);
      }
      throw new FileError('file_state_conflict', 409);
    }

    const scanStatus = input.scanStatus;
    if (![FILE_SCAN_STATUS.CLEAN, ...Object.keys(SCAN_FAILURE_REASON)].includes(scanStatus)) {
      throw new FileError('invalid_scan_result', 400);
    }
    const actualSha256 = normalizeSha256(input.sha256);
    const detectedMime = normalizeMime(input.detectedMime);
    const byteSize = Number(input.byteSize);
    const contentMatches =
      Number.isSafeInteger(byteSize) &&
      byteSize === record.byteSize &&
      actualSha256 === record.sha256 &&
      mimeAllowedForPurpose(record.purpose, detectedMime);
    const effectiveStatus =
      scanStatus === FILE_SCAN_STATUS.CLEAN && contentMatches
        ? FILE_SCAN_STATUS.CLEAN
        : scanStatus === FILE_SCAN_STATUS.CLEAN
          ? FILE_SCAN_STATUS.FAILED
          : scanStatus;
    const quarantineReason =
      effectiveStatus === FILE_SCAN_STATUS.CLEAN
        ? null
        : scanStatus === FILE_SCAN_STATUS.CLEAN
          ? 'content_verification_failed'
          : SCAN_FAILURE_REASON[scanStatus];
    const updated = await repository.markScanResult({
      detectedMime,
      id: record.id,
      quarantineReason,
      scannedAt: clock(),
      scanStatus: effectiveStatus,
      sha256: actualSha256,
    });
    return publicFileDto(updated);
  }

  return Object.freeze({
    applyTrustedScanResult: applyScanResult,

    async cleanupExpired({ pendingBefore, quarantineBefore }) {
      if (!(pendingBefore instanceof Date) || !(quarantineBefore instanceof Date)) {
        throw new Error('Cleanup cutoffs must be dates');
      }
      const candidates = await repository.listCleanupCandidates({
        pendingBefore,
        quarantineBefore,
      });
      let deleted = 0;
      let objectDeleteFailures = 0;
      for (const candidate of candidates) {
        const record = await repository.markDeleted({ deletedAt: clock(), id: candidate.id });
        try {
          await objectStore.deleteObject(record);
          deleted += 1;
        } catch {
          objectDeleteFailures += 1;
        }
      }
      return Object.freeze({ candidates: candidates.length, deleted, objectDeleteFailures });
    },

    async completeUpload(authentication, fileId) {
      const principal = principalOf(authentication);
      const record = await getRecord(fileId);
      await assertOwnerWrite(principal, record);
      if (record.state !== FILE_STATE.UPLOAD_PENDING) {
        throw new FileError('file_state_conflict', 409);
      }
      if (record.uploadedAt) return publicFileDto(record);

      const object = await objectStore.headObject(record);
      if (!object) throw new FileError('file_upload_incomplete', 409);
      let contentType = null;
      try {
        contentType = normalizeMime(object.contentType);
      } catch {
        // A malformed provider value is handled by the generic verification failure below.
      }
      const metadataMatches =
        object.byteSize === record.byteSize &&
        contentType === record.declaredMime &&
        object.metadata?.['file-id'] === record.id &&
        object.metadata?.sha256 === record.sha256 &&
        (!object.checksumBase64 || object.checksumBase64 === checksumBase64(record.sha256));
      if (!metadataMatches) {
        await quarantineUpload(record, object, 'upload_metadata_mismatch', contentType);
        throw new FileError('file_upload_verification_failed', 422);
      }
      const updated = await repository.markUploaded({
        etag: normalizeEtag(object.etag),
        id: record.id,
        uploadedAt: clock(),
      });
      if (typeof objectStore.scanObject === 'function') {
        return applyScanResult(await objectStore.scanObject(updated));
      }
      return publicFileDto(updated);
    },

    async createDownload(authentication, fileId) {
      const principal = principalOf(authentication);
      const record = await getRecord(fileId);
      await assertReadable(principal, record);
      if (record.state !== FILE_STATE.READY || record.scanStatus !== FILE_SCAN_STATUS.CLEAN) {
        throw new FileError('file_not_ready', 409);
      }
      return objectStore.createDownloadUrl(record);
    },

    async createUploadIntent(authentication, input = {}) {
      const principal = principalOf(authentication);
      const validated = validateUploadIntent(input);
      let ownerUserId = null;
      let ownerOrganizationId = null;
      if (validated.ownerType === FILE_OWNER_TYPE.USER) {
        ownerUserId = principal.userId;
      } else {
        ownerOrganizationId = input.ownerOrganizationId;
        if (
          !(await canUseOrganization(principal, ownerOrganizationId, 'write', validated.purpose))
        ) {
          throw new FileError('organization_file_access_denied', 403);
        }
      }

      const timestamp = clock();
      const id = idFactory();
      const record = await repository.create({
        byteSize: validated.byteSize,
        createdAt: timestamp,
        declaredMime: validated.declaredMime,
        deletedAt: null,
        detectedMime: null,
        etag: null,
        id,
        originalName: validated.originalName,
        ownerOrganizationId,
        ownerUserId,
        purpose: validated.purpose,
        quarantineReason: null,
        scanStatus: FILE_SCAN_STATUS.PENDING,
        scannedAt: null,
        sha256: validated.sha256,
        state: FILE_STATE.UPLOAD_PENDING,
        storageBucket: objectStore.bucket,
        storageKey: storageKeyFor({ id, purpose: validated.purpose }, timestamp),
        storageProvider: objectStore.provider,
        updatedAt: timestamp,
        uploadedAt: null,
        uploadedByUserId: principal.userId,
        visibility: FILE_VISIBILITY.PRIVATE,
      });
      try {
        const upload = await objectStore.createUploadUrl(record);
        return Object.freeze({ file: publicFileDto(record), upload });
      } catch (error) {
        await repository.markDeleted({ deletedAt: clock(), id: record.id });
        throw error;
      }
    },

    async deleteFile(authentication, fileId) {
      const principal = principalOf(authentication);
      const record = await getRecord(fileId);
      await assertOwnerWrite(principal, record);
      const deleted = await repository.markDeleted({ deletedAt: clock(), id: record.id });
      try {
        await objectStore.deleteObject(deleted);
      } catch {
        // The durable delete-request event owns retries; access is already revoked.
      }
    },

    async getMetadata(authentication, fileId) {
      const principal = principalOf(authentication);
      const record = await getRecord(fileId);
      await assertReadable(principal, record);
      return publicFileDto(record);
    },

    async setVisibility(authentication, fileId, visibility) {
      const principal = principalOf(authentication);
      const record = await getRecord(fileId);
      await assertOwnerWrite(principal, record);
      const policy = purposePolicy(record.purpose);
      if (!policy.allowedVisibilities.includes(visibility)) {
        throw new FileError('file_visibility_not_allowed', 400);
      }
      const updated = await repository.setVisibility({
        id: record.id,
        updatedAt: clock(),
        visibility,
      });
      return publicFileDto(updated);
    },

    publicFileDto,
  });
}

module.exports = { createFileService, publicFileDto };
