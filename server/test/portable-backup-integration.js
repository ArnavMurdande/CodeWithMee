'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client, Pool } = require('pg');

const manifest = require('../../prisma/migration-manifest.json');
const {
  createPortableArchive,
  exportPortableSnapshot,
  openPortableArchive,
  restorePortableSnapshot,
} = require('../modules/persistence/portable-backup');
const { assertDatabaseSafety } = require('../scripts/database-safety');

function administrativeUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  parsed.pathname = '/postgres';
  parsed.search = '';
  return parsed.toString();
}

function runMigrations(targetUrl) {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-database-command.js', 'migrate-deploy'],
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, DATABASE_SAFETY_SCOPE: 'disposable', DATABASE_URL: targetUrl },
    },
  );
  if (result.status !== 0) {
    throw new Error(`Restore-target migration failed: ${result.stderr || result.stdout}`);
  }
}

async function main(environment = process.env) {
  if (!environment.RESTORE_DATABASE_URL?.trim()) {
    throw new Error('RESTORE_DATABASE_URL is required for backup integration.');
  }
  const sourceUrl = environment.DATABASE_URL;
  const targetUrl = environment.RESTORE_DATABASE_URL.trim();
  const source = assertDatabaseSafety('backup-integration-source', {
    ...environment,
    DATABASE_SAFETY_SCOPE: 'disposable',
    DATABASE_URL: sourceUrl,
  });
  const target = assertDatabaseSafety('backup-integration-target', {
    ...environment,
    DATABASE_SAFETY_SCOPE: 'disposable',
    DATABASE_URL: targetUrl,
  });
  assert.notEqual(source.database, target.database);
  assert.equal(source.host, target.host);
  if (
    !/^[a-z0-9_]+$/i.test(target.database) ||
    !/(?:restore|backup)_(?:ci|test)$/i.test(target.database)
  ) {
    throw new Error(
      'Restore integration target must end in restore_ci, restore_test, backup_ci, or backup_test.',
    );
  }

  const sourcePool = new Pool({ connectionString: sourceUrl, max: 1 });
  const targetPool = new Pool({ connectionString: targetUrl, max: 1 });
  const admin = new Client({ connectionString: administrativeUrl(sourceUrl) });
  let adminConnected = false;
  try {
    await admin.connect();
    adminConnected = true;
    await admin.query(`DROP DATABASE IF EXISTS "${target.database}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${target.database}"`);
    runMigrations(targetUrl);

    const key = randomBytes(32);
    const snapshot = await exportPortableSnapshot(sourcePool, manifest);
    const archive = createPortableArchive(snapshot, { key, sourceDatabase: source.database });
    const opened = openPortableArchive(archive.archive, { key });
    const restored = await restorePortableSnapshot(targetPool, opened.payload, manifest);
    assert.equal(restored.contentSha256, opened.contentSha256);
    assert.equal(restored.rowCount, snapshot.rowCount);
    await assert.rejects(
      restorePortableSnapshot(targetPool, opened.payload, manifest),
      /Restore target table is not empty/,
    );
    process.stdout.write(
      `${JSON.stringify({
        archiveAuthenticated: true,
        contentSha256: restored.contentSha256,
        nonEmptyRestoreRejected: true,
        rowCount: restored.rowCount,
        tableCount: restored.tableCount,
      })}\n`,
    );
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
    if (adminConnected) {
      await admin
        .query(`DROP DATABASE IF EXISTS "${target.database}" WITH (FORCE)`)
        .catch(() => undefined);
      await admin.end();
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Portable backup integration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
