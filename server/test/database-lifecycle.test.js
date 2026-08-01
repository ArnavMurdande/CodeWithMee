'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  assertLifecycleSafety,
  createLifecycleNames,
  quoteIdentifier,
  targetUrl,
} = require('./database-lifecycle');

const baseEnvironment = Object.freeze({
  DATABASE_ADMIN_URL: 'postgresql://cwm_test:secret@127.0.0.1:5432/postgres',
  DATABASE_SAFETY_SCOPE: 'disposable',
  DATABASE_TEST_PREFIX: 'codewithmee_p0f',
});

test('database lifecycle accepts only an explicit loopback maintenance target', () => {
  const safety = assertLifecycleSafety(baseEnvironment);
  assert.equal(safety.adminUrl.hostname, '127.0.0.1');
  assert.equal(safety.adminUrl.pathname, '/postgres');
  assert.equal(safety.prefix, 'codewithmee_p0f');

  for (const environment of [
    { ...baseEnvironment, DATABASE_SAFETY_SCOPE: 'production' },
    { ...baseEnvironment, DATABASE_ADMIN_URL: 'postgresql://cwm:secret@db.example.com/postgres' },
    { ...baseEnvironment, DATABASE_ADMIN_URL: 'postgresql://cwm:secret@127.0.0.1/codewithmee' },
    { ...baseEnvironment, DATABASE_ADMIN_URL: 'https://127.0.0.1/postgres' },
    { ...baseEnvironment, DATABASE_ADMIN_URL: 'postgresql://127.0.0.1/postgres' },
  ]) {
    assert.throws(() => assertLifecycleSafety(environment));
  }
});

test('database lifecycle rejects production-like or injectable prefixes', () => {
  for (const prefix of ['prod', 'codewithmee_production', 'stage_ci', 'bad-name', 'A'.repeat(25)]) {
    assert.throws(() =>
      assertLifecycleSafety({ ...baseEnvironment, DATABASE_TEST_PREFIX: prefix }),
    );
  }
});

test('per-run source and restore names are bounded, unique, and disposable', () => {
  const names = createLifecycleNames('codewithmee_p0f', '0123456789ab');
  assert.deepEqual(names, {
    restore: 'codewithmee_p0f_0123456789ab_restore_ci',
    source: 'codewithmee_p0f_0123456789ab_ci',
  });
  assert.ok(names.source.length <= 63);
  assert.ok(names.restore.length <= 63);
  assert.notEqual(
    createLifecycleNames('codewithmee_p0f', '111111111111').source,
    createLifecycleNames('codewithmee_p0f', '222222222222').source,
  );
});

test('target URLs preserve connection settings while identifiers reject SQL syntax', () => {
  const admin = new URL(`${baseEnvironment.DATABASE_ADMIN_URL}?sslmode=disable`);
  const target = new URL(targetUrl(admin, 'codewithmee_p0f_0123456789ab_ci'));
  assert.equal(target.pathname, '/codewithmee_p0f_0123456789ab_ci');
  assert.equal(target.searchParams.get('sslmode'), 'disable');
  assert.equal(
    quoteIdentifier('codewithmee_p0f_0123456789ab_ci'),
    '"codewithmee_p0f_0123456789ab_ci"',
  );
  assert.throws(() => quoteIdentifier('safe_ci"; DROP DATABASE postgres;--'));
});

test('lifecycle source creates once and always drops both exact databases', () => {
  const source = readFileSync(path.join(__dirname, 'database-lifecycle.js'), 'utf8');
  assert.equal((source.match(/CREATE DATABASE/g) || []).length, 1);
  assert.equal((source.match(/DROP DATABASE IF EXISTS/g) || []).length, 2);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /SELECT datname FROM pg_database WHERE datname = ANY\(\$1\)/);
  for (const script of [
    'migrate-deploy',
    "['seed']",
    'test/database-integration.js',
    'test/portable-backup-integration.js',
  ]) {
    assert.match(source, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
