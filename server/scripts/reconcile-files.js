'use strict';

require('dotenv').config();

const { lstat, open, readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Pool } = require('pg');

const { createS3ObjectStore } = require('../modules/files/object-store');
const { createPostgresFileRepository } = require('../modules/files/postgres-repository');
const {
  parseReconciliationKey,
  reconcileFiles,
  signReconciliationReport,
} = require('../modules/files/reconciliation');
const { loadFileStorageConfig } = require('../modules/files/runtime');
const { assertFileReconciliationSafety } = require('./file-reconciliation-safety');

async function readMappings(rawPath) {
  if (!rawPath?.trim()) return [];
  const mappingPath = path.resolve(rawPath.trim());
  const metadata = await lstat(mappingPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) {
    throw new Error('Legacy mapping must be a regular non-symlink JSON file under 16 MiB.');
  }
  const parsed = JSON.parse(await readFile(mappingPath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Legacy mapping JSON must be an array.');
  return parsed;
}

async function outputHandle(rawPath) {
  if (!rawPath || path.extname(rawPath).toLowerCase() !== '.json') {
    throw new Error('Usage: node scripts/reconcile-files.js <new-report.json>');
  }
  const outputPath = path.resolve(rawPath);
  const parent = await lstat(path.dirname(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error('Reconciliation output parent must be a real directory.');
  }
  return open(outputPath, 'wx', 0o600);
}

async function main(environment = process.env, args = process.argv.slice(2)) {
  const nodeEnv = environment.NODE_ENV?.trim() || 'development';
  const storageConfig = loadFileStorageConfig(environment, { nodeEnv });
  if (!storageConfig.enabled) throw new Error('Private object storage must be configured.');
  const target = assertFileReconciliationSafety(environment, storageConfig);
  const key = parseReconciliationKey(environment.FILE_RECONCILIATION_KEY);
  const uploadInventoryModule = await import(
    pathToFileURL(
      path.resolve(__dirname, '../../scripts/migrate-mongo-to-postgres/upload-inventory.mjs'),
    ).href
  );
  const legacyInventory = await uploadInventoryModule.inventoryUploads({
    fingerprintKey: key,
    uploadRoot: environment.LEGACY_UPLOAD_ROOT?.trim() || undefined,
  });
  const legacyMappings = await readMappings(environment.LEGACY_FILE_MAPPING_PATH);
  const pool = new Pool({
    application_name: 'codewithmee-file-reconciliation',
    connectionString: environment.DATABASE_URL.trim(),
    max: 1,
  });
  const objectStore = createS3ObjectStore(storageConfig);
  const client = await pool.connect();
  let file;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const repository = createPostgresFileRepository({
      connect: pool.connect.bind(pool),
      query: client.query.bind(client),
    });
    const report = await reconcileFiles({
      bucket: storageConfig.bucket,
      fingerprintKey: key,
      legacyInventory,
      legacyMappings,
      objectStore,
      prefix: storageConfig.prefix,
      repository,
    });
    await client.query('COMMIT');
    const envelope = signReconciliationReport(report, key);
    file = await outputHandle(args[0]);
    await file.writeFile(`${JSON.stringify(envelope, null, 2)}\n`);
    await file.sync();
    process.stdout.write(
      `${JSON.stringify({
        database: target.database,
        issueCounts: report.summary.issueCounts,
        readyForLegacyRetirement: report.readyForLegacyRetirement,
        reportSha256: envelope.reportSha256,
        scope: target.scope,
      })}\n`,
    );
    return envelope;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await file?.close();
    client.release();
    await Promise.all([objectStore.close(), pool.end()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`File reconciliation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, outputHandle, readMappings };
