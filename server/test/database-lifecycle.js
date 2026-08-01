'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { Client } = require('pg');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SAFE_PREFIX = /^[a-z][a-z0-9_]{0,23}$/;

function databaseName(url) {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function assertLifecycleSafety(environment = process.env) {
  if (environment.DATABASE_SAFETY_SCOPE !== 'disposable') {
    throw new Error('Database lifecycle requires DATABASE_SAFETY_SCOPE=disposable.');
  }
  if (!environment.DATABASE_ADMIN_URL?.trim()) {
    throw new Error('DATABASE_ADMIN_URL is required for the isolated database lifecycle.');
  }

  let adminUrl;
  try {
    adminUrl = new URL(environment.DATABASE_ADMIN_URL.trim());
  } catch {
    throw new Error('DATABASE_ADMIN_URL must be an absolute PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol)) {
    throw new Error('DATABASE_ADMIN_URL must use PostgreSQL.');
  }
  if (!LOOPBACK_HOSTS.has(adminUrl.hostname.toLowerCase())) {
    throw new Error('Disposable database lifecycle is restricted to a loopback host.');
  }
  if (databaseName(adminUrl) !== 'postgres') {
    throw new Error('DATABASE_ADMIN_URL must target the PostgreSQL maintenance database.');
  }
  if (!adminUrl.username) throw new Error('DATABASE_ADMIN_URL must contain an explicit user.');

  const prefix = (environment.DATABASE_TEST_PREFIX || 'codewithmee_p0f').trim().toLowerCase();
  if (
    !SAFE_PREFIX.test(prefix) ||
    /(?:^|_)(?:prod|production|stage|staging|live)(?:_|$)/.test(prefix)
  ) {
    throw new Error('DATABASE_TEST_PREFIX is not a safe disposable prefix.');
  }
  return Object.freeze({ adminUrl, prefix });
}

function createLifecycleNames(prefix, entropy = randomBytes(6).toString('hex')) {
  if (!SAFE_PREFIX.test(prefix) || !/^[a-f0-9]{12}$/.test(entropy)) {
    throw new Error('Database lifecycle names require a safe prefix and 12 hex characters.');
  }
  const source = `${prefix}_${entropy}_ci`;
  const restore = `${prefix}_${entropy}_restore_ci`;
  assert.ok(source.length <= 63 && restore.length <= 63);
  return Object.freeze({ restore, source });
}

function targetUrl(adminUrl, name) {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(name)) throw new Error('Unsafe database identifier.');
  const target = new URL(adminUrl);
  target.pathname = `/${name}`;
  return target.toString();
}

function quoteIdentifier(name) {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(name)) throw new Error('Unsafe database identifier.');
  return `"${name}"`;
}

function runNodeScript(relativePath, arguments_, environment) {
  const result = spawnSync(process.execPath, [relativePath, ...arguments_], {
    cwd: path.resolve(__dirname, '..'),
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${relativePath} failed with exit ${result.status ?? 'unknown'}.`);
  }
}

async function runLifecycle(environment = process.env) {
  const safety = assertLifecycleSafety(environment);
  const names = createLifecycleNames(safety.prefix);
  const sourceUrl = targetUrl(safety.adminUrl, names.source);
  const restoreUrl = targetUrl(safety.adminUrl, names.restore);
  const childEnvironment = Object.fromEntries(
    Object.entries({
      ...environment,
      DATABASE_ADMIN_URL: undefined,
      DATABASE_SAFETY_SCOPE: 'disposable',
      DATABASE_URL: sourceUrl,
      RESTORE_DATABASE_URL: restoreUrl,
    }).filter(([, value]) => value !== undefined),
  );
  const admin = new Client({ connectionString: safety.adminUrl.toString() });
  let connected = false;
  let sourceCreated = false;
  try {
    await admin.connect();
    connected = true;
    await admin.query(`CREATE DATABASE ${quoteIdentifier(names.source)}`);
    sourceCreated = true;

    runNodeScript('scripts/run-database-command.js', ['migrate-deploy'], childEnvironment);
    runNodeScript('scripts/run-database-command.js', ['seed'], childEnvironment);
    runNodeScript('scripts/run-database-command.js', ['seed'], childEnvironment);
    runNodeScript('test/database-integration.js', [], childEnvironment);
    runNodeScript('test/portable-backup-integration.js', [], childEnvironment);
  } finally {
    if (connected && sourceCreated) {
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdentifier(names.restore)} WITH (FORCE)`)
        .catch(() => undefined);
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdentifier(names.source)} WITH (FORCE)`)
        .catch(() => undefined);
      const remaining = await admin.query(
        'SELECT datname FROM pg_database WHERE datname = ANY($1)',
        [[names.source, names.restore]],
      );
      assert.equal(remaining.rowCount, 0, 'Disposable database cleanup did not complete.');
    }
    if (connected) await admin.end();
  }

  const result = Object.freeze({ cleaned: true, completed: true, names });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  runLifecycle().catch((error) => {
    process.stderr.write(`Database lifecycle failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertLifecycleSafety,
  createLifecycleNames,
  quoteIdentifier,
  runLifecycle,
  targetUrl,
};
