'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const test = require('node:test');

const { createMemoryObjectStore } = require('../modules/files/object-store');
const {
  reconcileFiles,
  signReconciliationReport,
  verifyReconciliationReport,
} = require('../modules/files/reconciliation');
const { assertFileReconciliationSafety } = require('../scripts/file-reconciliation-safety');

function record({ body = 'verified', id = randomUUID(), key = null, state = 'ready' } = {}) {
  const bytes = Buffer.from(body);
  return Object.freeze({
    byteSize: bytes.length,
    declaredMime: 'text/plain',
    id,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    state,
    storageBucket: 'private-test-bucket',
    storageKey: key || `codewithmee/test/note_attachment/2026/08/${id}`,
    storageProvider: 'memory',
    uploadedAt: state === 'upload_pending' ? null : new Date('2026-08-01T00:00:00.000Z'),
  });
}

test('file reconciliation proves matching database, object, and mapped legacy content', async () => {
  const key = randomBytes(32);
  const current = record();
  const objectStore = createMemoryObjectStore();
  await objectStore.putUncheckedForTest(current, 'verified');
  const report = await reconcileFiles({
    bucket: objectStore.bucket,
    fingerprintKey: key,
    legacyInventory: {
      available: true,
      exceptions: [],
      files: [{ pathFingerprint: 'legacy-one', sha256: current.sha256 }],
      totals: { bytes: current.byteSize, files: 1 },
    },
    legacyMappings: [{ fileId: current.id, pathFingerprint: 'legacy-one' }],
    objectStore,
    prefix: objectStore.basePrefix,
    repository: {
      async listForReconciliation() {
        return [current];
      },
    },
  });
  assert.equal(report.readyForLegacyRetirement, true);
  assert.deepEqual(report.summary.issueCounts, {});
  assert.doesNotMatch(JSON.stringify(report), new RegExp(current.id));
  const envelope = signReconciliationReport(report, key);
  assert.equal(verifyReconciliationReport(envelope, key), report);
  assert.throws(
    () => verifyReconciliationReport({ ...envelope, reportSha256: '0'.repeat(64) }, key),
    /authentication/,
  );
});

test('file reconciliation reports missing, orphaned, metadata, and legacy blockers without raw keys', async () => {
  const key = randomBytes(32);
  const missing = record({ body: 'missing' });
  const mismatched = record({ body: 'expected' });
  const orphan = record({ body: 'orphan' });
  const objectStore = createMemoryObjectStore();
  await objectStore.putUncheckedForTest(mismatched, 'wrong bytes', { byteSize: 11 });
  await objectStore.putUncheckedForTest(orphan, 'orphan');
  const report = await reconcileFiles({
    bucket: objectStore.bucket,
    fingerprintKey: key,
    legacyInventory: {
      available: true,
      exceptions: [],
      files: [{ pathFingerprint: 'unmapped', sha256: 'f'.repeat(64) }],
      totals: { bytes: 1, files: 1 },
    },
    objectStore,
    prefix: objectStore.basePrefix,
    repository: {
      async listForReconciliation() {
        return [missing, mismatched];
      },
    },
  });
  assert.equal(report.readyForLegacyRetirement, false);
  assert.equal(report.summary.issueCounts.database_object_missing, 1);
  assert.equal(report.summary.issueCounts.object_metadata_mismatch, 1);
  assert.equal(report.summary.issueCounts.storage_object_orphaned, 1);
  assert.equal(report.summary.issueCounts.legacy_file_unmapped, 1);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(missing.storageKey));
  assert.doesNotMatch(serialized, new RegExp(orphan.id));
});

test('file reconciliation requires a read-only exact target approval', () => {
  const config = { bucket: 'private-test-bucket', prefix: 'codewithmee/test' };
  const environment = {
    DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/codewithmee_test',
    FILE_RECONCILIATION_APPROVAL: 'reconcile:codewithmee_test:private-test-bucket:codewithmee/test',
    FILE_RECONCILIATION_MODE: 'read_only',
    FILE_RECONCILIATION_SCOPE: 'disposable',
  };
  assert.equal(assertFileReconciliationSafety(environment, config).database, 'codewithmee_test');
  assert.throws(() =>
    assertFileReconciliationSafety({ ...environment, FILE_RECONCILIATION_MODE: 'apply' }, config),
  );
});
