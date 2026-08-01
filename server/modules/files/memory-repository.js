'use strict';

const { FileError } = require('./errors');
const { FILE_SCAN_STATUS, FILE_STATE, FILE_VISIBILITY } = require('./contracts');

function createMemoryFileRepository() {
  const records = new Map();
  const outbox = [];

  function clone(value) {
    return value ? structuredClone(value) : null;
  }

  function requireRecord(id) {
    const record = records.get(id);
    if (!record) throw new FileError('file_not_found', 404);
    return record;
  }

  function appendEvent(record, eventType, createdAt) {
    outbox.push(
      Object.freeze({
        aggregateId: record.id,
        aggregateType: 'file',
        createdAt,
        eventType,
        payload: Object.freeze({ fileId: record.id, purpose: record.purpose }),
      }),
    );
  }

  return Object.freeze({
    async create(record) {
      if (records.has(record.id)) throw new FileError('duplicate_file_id', 409);
      records.set(record.id, clone(record));
      return clone(record);
    },
    async events() {
      return clone(outbox);
    },
    async getById(id) {
      return clone(records.get(id));
    },
    async listCleanupCandidates({ pendingBefore, quarantineBefore }) {
      return [...records.values()]
        .filter(
          (record) =>
            (record.state === FILE_STATE.UPLOAD_PENDING && record.createdAt < pendingBefore) ||
            (record.state === FILE_STATE.QUARANTINED && record.scannedAt < quarantineBefore),
        )
        .map(clone);
    },
    async markDeleted({ deletedAt, id }) {
      const record = requireRecord(id);
      if (record.state === FILE_STATE.DELETED) return clone(record);
      record.state = FILE_STATE.DELETED;
      record.deletedAt = deletedAt;
      record.visibility = FILE_VISIBILITY.PRIVATE;
      record.updatedAt = deletedAt;
      appendEvent(record, 'file.object.delete_requested', deletedAt);
      return clone(record);
    },
    async markRejectedUpload({ detectedMime, etag, id, quarantineReason, rejectedAt }) {
      const record = requireRecord(id);
      if (record.state !== FILE_STATE.UPLOAD_PENDING) {
        throw new FileError('file_state_conflict', 409);
      }
      record.detectedMime = detectedMime;
      record.etag = etag;
      record.quarantineReason = quarantineReason;
      record.scannedAt = rejectedAt;
      record.scanStatus = FILE_SCAN_STATUS.FAILED;
      record.state = FILE_STATE.QUARANTINED;
      record.updatedAt = rejectedAt;
      record.uploadedAt = rejectedAt;
      appendEvent(record, 'file.quarantined', rejectedAt);
      return clone(record);
    },
    async markScanResult({ detectedMime, id, quarantineReason, scannedAt, scanStatus, sha256 }) {
      const record = requireRecord(id);
      if (record.state === FILE_STATE.DELETED) throw new FileError('file_state_conflict', 409);
      if (!record.uploadedAt) throw new FileError('file_upload_incomplete', 409);
      if (record.scanStatus === FILE_SCAN_STATUS.CLEAN && record.state === FILE_STATE.READY) {
        return clone(record);
      }
      record.detectedMime = detectedMime;
      record.quarantineReason = quarantineReason;
      record.scannedAt = scannedAt;
      record.scanStatus = scanStatus;
      record.sha256 = sha256;
      record.state =
        scanStatus === FILE_SCAN_STATUS.CLEAN ? FILE_STATE.READY : FILE_STATE.QUARANTINED;
      record.updatedAt = scannedAt;
      appendEvent(
        record,
        scanStatus === FILE_SCAN_STATUS.CLEAN ? 'file.ready' : 'file.quarantined',
        scannedAt,
      );
      return clone(record);
    },
    async markUploaded({ etag, id, uploadedAt }) {
      const record = requireRecord(id);
      if (record.state !== FILE_STATE.UPLOAD_PENDING) {
        throw new FileError('file_state_conflict', 409);
      }
      if (record.uploadedAt) return clone(record);
      record.etag = etag;
      record.uploadedAt = uploadedAt;
      record.updatedAt = uploadedAt;
      appendEvent(record, 'file.scan.requested', uploadedAt);
      return clone(record);
    },
    async setVisibility({ id, updatedAt, visibility }) {
      const record = requireRecord(id);
      if (record.state !== FILE_STATE.READY || record.scanStatus !== FILE_SCAN_STATUS.CLEAN) {
        throw new FileError('file_not_ready', 409);
      }
      record.visibility = visibility;
      record.updatedAt = updatedAt;
      appendEvent(record, 'file.visibility.changed', updatedAt);
      return clone(record);
    },
  });
}

module.exports = { createMemoryFileRepository };
