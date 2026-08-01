'use strict';

function maximumRecords(value) {
  if (value === undefined || value === '') return 250_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5_000_000) {
    throw new Error('MIGRATION_IMPORT_MAX_RECORDS must be an integer between 1 and 5000000.');
  }
  return parsed;
}

function assertMigrationImportSafety({ apply, database, datasetChecksum, environment, scope }) {
  if (apply !== true) throw new Error('Migration import requires the explicit --apply flag.');
  if (environment.MIGRATION_IMPORT_MODE !== 'write') {
    throw new Error('MIGRATION_IMPORT_MODE must equal write.');
  }
  if (!/^[0-9a-f]{64}$/.test(datasetChecksum)) {
    throw new Error('Authenticated snapshot dataset checksum is invalid.');
  }
  const expectedApproval = `import:${database}:${datasetChecksum}`;
  if (environment.MIGRATION_IMPORT_APPROVAL !== expectedApproval) {
    throw new Error(`MIGRATION_IMPORT_APPROVAL must equal ${expectedApproval}.`);
  }
  if (
    ['staging', 'production'].includes(scope) &&
    environment.MIGRATION_WRITE_FREEZE_CONFIRMED !== 'true'
  ) {
    throw new Error('MIGRATION_WRITE_FREEZE_CONFIRMED must equal true outside disposable targets.');
  }
  return Object.freeze({
    maximumRecords: maximumRecords(environment.MIGRATION_IMPORT_MAX_RECORDS),
  });
}

module.exports = { assertMigrationImportSafety };
