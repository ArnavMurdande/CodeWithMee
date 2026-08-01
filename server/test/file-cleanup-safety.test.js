'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { assertFileCleanupSafety } = require('../modules/files/cleanup-safety');

const storageConfig = Object.freeze({ bucket: 'private-codewithmee-files' });

test('file cleanup requires a database URL and exact bucket-scoped approval', () => {
  assert.throws(() => assertFileCleanupSafety({}, storageConfig), /DATABASE_URL is required/);
  assert.throws(
    () =>
      assertFileCleanupSafety(
        { DATABASE_URL: 'postgresql://localhost/codewithmee' },
        storageConfig,
      ),
    /cleanup:private-codewithmee-files/,
  );
  assert.throws(
    () =>
      assertFileCleanupSafety(
        {
          DATABASE_URL: 'postgresql://localhost/codewithmee',
          FILE_CLEANUP_APPROVAL: 'cleanup:another-bucket',
        },
        storageConfig,
      ),
    /cleanup:private-codewithmee-files/,
  );
});

test('file cleanup retention defaults are bounded and explicit values are parsed', () => {
  assert.deepEqual(
    assertFileCleanupSafety(
      {
        DATABASE_URL: 'postgresql://localhost/codewithmee',
        FILE_CLEANUP_APPROVAL: 'cleanup:private-codewithmee-files',
      },
      storageConfig,
    ),
    { pendingHours: 24, quarantineHours: 168 },
  );
  assert.deepEqual(
    assertFileCleanupSafety(
      {
        DATABASE_URL: 'postgresql://localhost/codewithmee',
        FILE_CLEANUP_APPROVAL: 'cleanup:private-codewithmee-files',
        FILE_PENDING_RETENTION_HOURS: '48',
        FILE_QUARANTINE_RETENTION_HOURS: '336',
      },
      storageConfig,
    ),
    { pendingHours: 48, quarantineHours: 336 },
  );
  assert.throws(
    () =>
      assertFileCleanupSafety(
        {
          DATABASE_URL: 'postgresql://localhost/codewithmee',
          FILE_CLEANUP_APPROVAL: 'cleanup:private-codewithmee-files',
          FILE_PENDING_RETENTION_HOURS: '0',
        },
        storageConfig,
      ),
    /between 1 and 720/,
  );
  assert.throws(
    () =>
      assertFileCleanupSafety(
        {
          DATABASE_URL: 'postgresql://localhost/codewithmee',
          FILE_CLEANUP_APPROVAL: 'cleanup:private-codewithmee-files',
          FILE_QUARANTINE_RETENTION_HOURS: '8761',
        },
        storageConfig,
      ),
    /between 1 and 8760/,
  );
});
