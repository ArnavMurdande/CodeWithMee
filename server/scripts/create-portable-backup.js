'use strict';

require('dotenv').config();

const { lstat, open } = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const manifest = require('../../prisma/migration-manifest.json');
const {
  createPortableArchive,
  exportPortableSnapshot,
  parseBackupKey,
} = require('../modules/persistence/portable-backup');
const { assertBackupSafety } = require('./portable-backup-safety');

async function safeOutputPath(rawPath) {
  if (!rawPath || path.extname(rawPath).toLowerCase() !== '.cwmbackup') {
    throw new Error('Usage: node scripts/create-portable-backup.js <new-file.cwmbackup>');
  }
  const outputPath = path.resolve(rawPath);
  const parent = await lstat(path.dirname(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error('Backup output parent must be a real directory.');
  }
  return outputPath;
}

async function main(environment = process.env, args = process.argv.slice(2)) {
  const target = assertBackupSafety(environment, manifest.schema.sha256);
  const key = parseBackupKey(environment.DATABASE_BACKUP_KEY);
  const outputPath = await safeOutputPath(args[0]);
  const pool = new Pool({
    application_name: 'codewithmee-portable-backup',
    connectionString: environment.DATABASE_URL.trim(),
    max: 1,
  });
  let file;
  try {
    const snapshot = await exportPortableSnapshot(pool, manifest);
    const archive = createPortableArchive(snapshot, { key, sourceDatabase: target.database });
    file = await open(outputPath, 'wx', 0o600);
    await file.writeFile(archive.archive);
    await file.sync();
    process.stdout.write(
      `${JSON.stringify({
        archiveSha256: archive.archiveSha256,
        contentSha256: archive.contentSha256,
        database: target.database,
        rowCount: archive.rowCount,
        scope: target.scope,
        tableCount: archive.tableCount,
      })}\n`,
    );
    return archive;
  } finally {
    await file?.close();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Portable backup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, safeOutputPath };
