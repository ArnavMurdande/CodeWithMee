'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { assertMigrationImportSafety } = require('../scripts/migration-import-safety');

const checksum = 'ab'.repeat(32);

test('snapshot import requires apply, write mode, and the exact database plus dataset approval', () => {
  const base = {
    apply: true,
    database: 'codewithmee_import_dev',
    datasetChecksum: checksum,
    environment: {
      MIGRATION_IMPORT_APPROVAL: `import:codewithmee_import_dev:${checksum}`,
      MIGRATION_IMPORT_MODE: 'write',
    },
    scope: 'disposable',
  };
  assert.throws(() => assertMigrationImportSafety({ ...base, apply: false }), /--apply/);
  assert.throws(
    () =>
      assertMigrationImportSafety({
        ...base,
        environment: { ...base.environment, MIGRATION_IMPORT_MODE: 'read_only' },
      }),
    /must equal write/,
  );
  assert.throws(
    () =>
      assertMigrationImportSafety({
        ...base,
        environment: { ...base.environment, MIGRATION_IMPORT_APPROVAL: 'import:other:hash' },
      }),
    /MIGRATION_IMPORT_APPROVAL/,
  );
  assert.deepEqual(assertMigrationImportSafety(base), { maximumRecords: 250000 });
});

test('snapshot import bounds records and requires a write freeze outside disposable targets', () => {
  const environment = {
    MIGRATION_IMPORT_APPROVAL: `import:codewithmee_stage:${checksum}`,
    MIGRATION_IMPORT_MAX_RECORDS: '500',
    MIGRATION_IMPORT_MODE: 'write',
  };
  assert.throws(
    () =>
      assertMigrationImportSafety({
        apply: true,
        database: 'codewithmee_stage',
        datasetChecksum: checksum,
        environment,
        scope: 'staging',
      }),
    /WRITE_FREEZE_CONFIRMED/,
  );
  assert.deepEqual(
    assertMigrationImportSafety({
      apply: true,
      database: 'codewithmee_stage',
      datasetChecksum: checksum,
      environment: { ...environment, MIGRATION_WRITE_FREEZE_CONFIRMED: 'true' },
      scope: 'staging',
    }),
    { maximumRecords: 500 },
  );
  assert.throws(
    () =>
      assertMigrationImportSafety({
        apply: true,
        database: 'codewithmee_import_dev',
        datasetChecksum: checksum,
        environment: {
          MIGRATION_IMPORT_APPROVAL: `import:codewithmee_import_dev:${checksum}`,
          MIGRATION_IMPORT_MAX_RECORDS: '5000001',
          MIGRATION_IMPORT_MODE: 'write',
        },
        scope: 'disposable',
      }),
    /between 1 and 5000000/,
  );
});
