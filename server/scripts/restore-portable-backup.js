'use strict';

require('dotenv').config();

const { lstat, readFile } = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const manifest = require('../../prisma/migration-manifest.json');
const {
  openPortableArchive,
  parseBackupKey,
  restorePortableSnapshot,
} = require('../modules/persistence/portable-backup');
const { assertRestoreSafety } = require('./portable-backup-safety');

const MAX_ARCHIVE_BYTES = 384 * 1024 * 1024;

async function readSafeArchive(rawPath) {
  if (!rawPath || path.extname(rawPath).toLowerCase() !== '.cwmbackup') {
    throw new Error('Usage: node scripts/restore-portable-backup.js <file.cwmbackup> --apply');
  }
  const archivePath = path.resolve(rawPath);
  const metadata = await lstat(archivePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Backup archive must be a regular non-symlink file.');
  }
  if (metadata.size <= 0 || metadata.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Backup archive size is outside the supported bound.');
  }
  return readFile(archivePath);
}

async function main(environment = process.env, args = process.argv.slice(2)) {
  if (args[1] !== '--apply') throw new Error('Portable restore requires the --apply flag.');
  const archiveBytes = await readSafeArchive(args[0]);
  const key = parseBackupKey(environment.DATABASE_BACKUP_KEY);
  const opened = openPortableArchive(archiveBytes, { key });
  const target = assertRestoreSafety(environment, {
    archiveSha256: opened.archiveSha256,
    sourceDatabase: opened.header.sourceDatabase,
  });
  const pool = new Pool({
    application_name: 'codewithmee-portable-restore',
    connectionString: environment.DATABASE_URL.trim(),
    max: 1,
  });
  try {
    const restored = await restorePortableSnapshot(pool, opened.payload, manifest);
    const result = Object.freeze({
      archiveSha256: opened.archiveSha256,
      contentSha256: restored.contentSha256,
      rowCount: restored.rowCount,
      scope: target.scope,
      tableCount: restored.tableCount,
      targetDatabase: target.database,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Portable restore failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, readSafeArchive };
