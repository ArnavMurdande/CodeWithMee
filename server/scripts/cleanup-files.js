'use strict';

require('dotenv').config();

const { Pool } = require('pg');

const { assertFileCleanupSafety } = require('../modules/files/cleanup-safety');
const { createS3ObjectStore } = require('../modules/files/object-store');
const { createPostgresFileRepository } = require('../modules/files/postgres-repository');
const { loadFileStorageConfig } = require('../modules/files/runtime');
const { createFileService } = require('../modules/files/service');

async function main(environment = process.env) {
  const nodeEnv = environment.NODE_ENV?.trim() || 'development';
  const storageConfig = loadFileStorageConfig(environment, { nodeEnv });
  if (!storageConfig.enabled)
    throw new Error('Private file storage must be configured for cleanup.');
  const retention = assertFileCleanupSafety(environment, storageConfig);
  const pool = new Pool({
    application_name: 'codewithmee-file-cleanup',
    connectionString: environment.DATABASE_URL.trim(),
    max: 2,
  });
  const objectStore = createS3ObjectStore(storageConfig);
  try {
    const service = createFileService({
      objectStore,
      repository: createPostgresFileRepository(pool),
    });
    const now = new Date();
    const result = await service.cleanupExpired({
      pendingBefore: new Date(now.getTime() - retention.pendingHours * 60 * 60 * 1000),
      quarantineBefore: new Date(now.getTime() - retention.quarantineHours * 60 * 60 * 1000),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await Promise.all([objectStore.close(), pool.end()]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`File cleanup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
