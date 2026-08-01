'use strict';

const { createHash, createHmac } = require('node:crypto');

const REPORT_FORMAT = 'codewithmee.file-reconciliation.v1';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseReconciliationKey(rawValue) {
  if (!rawValue?.trim()) throw new Error('FILE_RECONCILIATION_KEY is required.');
  const encoded = rawValue.trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('FILE_RECONCILIATION_KEY must be canonical base64 for exactly 32 bytes.');
  }
  return key;
}

function reference(key, kind, value) {
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex');
}

function issue(key, code, severity, values = {}) {
  const output = { code, severity };
  if (values.fileId) output.fileRef = reference(key, 'file', values.fileId);
  if (values.storageKey) output.objectRef = reference(key, 'object', values.storageKey);
  if (values.pathFingerprint) {
    output.legacyRef = reference(key, 'legacy', values.pathFingerprint);
  }
  return Object.freeze(output);
}

function expectedObject(record) {
  return Boolean(record.uploadedAt) || ['ready', 'quarantined'].includes(record.state);
}

async function reconcileFiles({
  bucket,
  fingerprintKey,
  legacyInventory = { available: false, exceptions: [], files: [], totals: {} },
  legacyMappings = [],
  limit = 100_000,
  objectStore,
  prefix,
  repository,
}) {
  if (!fingerprintKey || fingerprintKey.length !== 32) {
    throw new Error('A 32-byte file reconciliation key is required.');
  }
  if (!repository?.listForReconciliation || !objectStore?.listObjects) {
    throw new Error('Reconciliation requires listable file and object repositories.');
  }
  const [records, objects] = await Promise.all([
    repository.listForReconciliation({ limit }),
    objectStore.listObjects({ maxObjects: limit }),
  ]);
  const issues = [];
  const recordsByKey = new Map(records.map((record) => [record.storageKey, record]));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const objectsByKey = new Map(objects.map((object) => [object.key, object]));

  for (const record of records) {
    const object = objectsByKey.get(record.storageKey);
    if (
      record.storageProvider !== objectStore.provider ||
      record.storageBucket !== bucket ||
      !record.storageKey.startsWith(`${prefix}/`)
    ) {
      issues.push(
        issue(fingerprintKey, 'database_storage_boundary_mismatch', 'error', {
          fileId: record.id,
          storageKey: record.storageKey,
        }),
      );
      continue;
    }
    if (record.state === 'deleted') {
      if (object) {
        issues.push(
          issue(fingerprintKey, 'deleted_record_object_present', 'error', {
            fileId: record.id,
            storageKey: record.storageKey,
          }),
        );
      }
      continue;
    }
    if (!object && expectedObject(record)) {
      issues.push(
        issue(fingerprintKey, 'database_object_missing', 'error', {
          fileId: record.id,
          storageKey: record.storageKey,
        }),
      );
      continue;
    }
    if (object && record.state === 'upload_pending' && !record.uploadedAt) {
      issues.push(
        issue(fingerprintKey, 'unfinalized_upload_object_present', 'error', {
          fileId: record.id,
          storageKey: record.storageKey,
        }),
      );
    }
    if (object) {
      const metadata = await objectStore.headObject(record);
      if (
        !metadata ||
        metadata.byteSize !== Number(record.byteSize) ||
        metadata.metadata?.['file-id'] !== record.id ||
        metadata.metadata?.sha256 !== record.sha256
      ) {
        issues.push(
          issue(fingerprintKey, 'object_metadata_mismatch', 'error', {
            fileId: record.id,
            storageKey: record.storageKey,
          }),
        );
      }
    }
  }
  for (const object of objects) {
    if (!object.key.startsWith(`${prefix}/`)) {
      issues.push(
        issue(fingerprintKey, 'object_prefix_escape', 'error', { storageKey: object.key }),
      );
    } else if (!recordsByKey.has(object.key)) {
      issues.push(
        issue(fingerprintKey, 'storage_object_orphaned', 'error', { storageKey: object.key }),
      );
    }
  }

  const mappings = new Map();
  for (const mapping of legacyMappings) {
    if (!mapping?.pathFingerprint || !mapping?.fileId || mappings.has(mapping.pathFingerprint)) {
      throw new Error('Legacy mapping entries require unique pathFingerprint and fileId values.');
    }
    mappings.set(mapping.pathFingerprint, mapping);
  }
  for (const legacyFile of legacyInventory.files || []) {
    const mapping = mappings.get(legacyFile.pathFingerprint);
    const record = mapping ? recordsById.get(mapping.fileId) : null;
    if (!mapping || !record) {
      issues.push(
        issue(fingerprintKey, 'legacy_file_unmapped', 'error', {
          pathFingerprint: legacyFile.pathFingerprint,
        }),
      );
    } else if (record.sha256 !== legacyFile.sha256) {
      issues.push(
        issue(fingerprintKey, 'legacy_file_checksum_mismatch', 'error', {
          fileId: record.id,
          pathFingerprint: legacyFile.pathFingerprint,
        }),
      );
    }
  }
  for (const legacyException of legacyInventory.exceptions || []) {
    issues.push(
      issue(fingerprintKey, `legacy_inventory_${legacyException.code}`, 'error', {
        pathFingerprint: legacyException.pathFingerprint || legacyException.code,
      }),
    );
  }
  if (!legacyInventory.available) {
    issues.push(issue(fingerprintKey, 'legacy_inventory_unavailable', 'error'));
  }

  issues.sort((left, right) =>
    `${left.code}:${left.fileRef || ''}:${left.objectRef || ''}:${left.legacyRef || ''}`.localeCompare(
      `${right.code}:${right.fileRef || ''}:${right.objectRef || ''}:${right.legacyRef || ''}`,
    ),
  );
  const countsByCode = {};
  for (const current of issues) countsByCode[current.code] = (countsByCode[current.code] || 0) + 1;
  const report = Object.freeze({
    format: REPORT_FORMAT,
    issues: Object.freeze(issues),
    readyForLegacyRetirement: issues.length === 0,
    scope: Object.freeze({
      bucketFingerprint: reference(fingerprintKey, 'bucket', bucket),
      prefixFingerprint: reference(fingerprintKey, 'prefix', prefix),
    }),
    summary: Object.freeze({
      databaseRecords: records.length,
      issueCounts: Object.freeze(countsByCode),
      legacyBytes: Number(legacyInventory.totals?.bytes || 0),
      legacyFiles: Number(legacyInventory.totals?.files || 0),
      objectRecords: objects.length,
    }),
  });
  return report;
}

function signReconciliationReport(report, key) {
  const reportJson = JSON.stringify(report);
  return Object.freeze({
    algorithm: 'HMAC-SHA-256',
    format: REPORT_FORMAT,
    report,
    reportSha256: digest(reportJson),
    signature: createHmac('sha256', key).update(reportJson).digest('hex'),
  });
}

function verifyReconciliationReport(envelope, key) {
  if (envelope?.format !== REPORT_FORMAT || envelope.algorithm !== 'HMAC-SHA-256') {
    throw new Error('File reconciliation report format is invalid.');
  }
  const reportJson = JSON.stringify(envelope.report);
  const expectedSha = digest(reportJson);
  const expectedSignature = createHmac('sha256', key).update(reportJson).digest('hex');
  if (envelope.reportSha256 !== expectedSha || envelope.signature !== expectedSignature) {
    throw new Error('File reconciliation report authentication failed.');
  }
  return envelope.report;
}

module.exports = {
  REPORT_FORMAT,
  parseReconciliationKey,
  reconcileFiles,
  signReconciliationReport,
  verifyReconciliationReport,
};
