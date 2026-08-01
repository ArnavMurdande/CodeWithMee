'use strict';

require('dotenv').config();

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Pool } = require('pg');

const { assertDatabaseSafety } = require('./database-safety');
const { assertMigrationImportSafety } = require('./migration-import-safety');

function parseArguments(argumentsList) {
  const options = { apply: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--apply') {
      options.apply = true;
      continue;
    }
    if (argument === '--snapshot') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--snapshot requires a value.');
      options.snapshot = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown migration import option: ${argument}`);
  }
  if (!options.snapshot) throw new Error('--snapshot is required.');
  return options;
}

async function loadMigrationModule(fileName) {
  const absolute = path.resolve(
    __dirname,
    '..',
    '..',
    'scripts',
    'migrate-mongo-to-postgres',
    fileName,
  );
  return import(pathToFileURL(absolute).href);
}

async function main(argumentsList = process.argv.slice(2), environment = process.env) {
  const options = parseArguments(argumentsList);
  const database = assertDatabaseSafety('migration-import', environment);
  const [{ openEncryptedSnapshot }, { importSnapshotToPostgres }, { parseSecretKey }] =
    await Promise.all([
      loadMigrationModule('encrypted-snapshot.mjs'),
      loadMigrationModule('postgres-importer.mjs'),
      loadMigrationModule('source-safety.mjs'),
    ]);
  const encryptionKey = parseSecretKey(environment.MIGRATION_EXPORT_KEY, 'MIGRATION_EXPORT_KEY');
  const fingerprintKey = parseSecretKey(
    environment.MIGRATION_FINGERPRINT_KEY,
    'MIGRATION_FINGERPRINT_KEY',
  );
  const snapshotPath = path.resolve(options.snapshot);
  const source = await openEncryptedSnapshot({
    encryptionKey,
    snapshotDirectory: snapshotPath,
  });
  const safety = assertMigrationImportSafety({
    apply: options.apply,
    database: database.database,
    datasetChecksum: source.manifest.datasetSha256,
    environment,
    scope: database.scope,
  });
  const pool = new Pool({
    application_name: 'codewithmee-migration-import',
    connectionString: environment.DATABASE_URL,
    max: 4,
  });
  try {
    return await importSnapshotToPostgres({
      fingerprintKey,
      maximumRecords: safety.maximumRecords,
      pool,
      snapshotLabel: snapshotPath,
      source,
    });
  } finally {
    await Promise.all([source.close(), pool.end()]);
  }
}

if (require.main === module) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`Migration import failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { main, parseArguments };
