'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');

const {
  createPortableArchive,
  openPortableArchive,
  parseBackupKey,
  restoreOrder,
} = require('../modules/persistence/portable-backup');
const { assertBackupSafety, assertRestoreSafety } = require('../scripts/portable-backup-safety');

const schemaSha256 = 'a'.repeat(64);
const key = randomBytes(32);
const payload = Object.freeze({
  format: 'codewithmee.portable-data.v1',
  migrations: Object.freeze(['migration-one']),
  rowCount: 1,
  schemaSha256,
  tableCount: 1,
  tables: Object.freeze([
    Object.freeze({
      columns: Object.freeze([
        Object.freeze({ dataType: 'uuid', name: 'id', nullable: false, udtName: 'uuid' }),
      ]),
      foreignKeys: Object.freeze([]),
      name: 'users',
      primaryKey: Object.freeze(['id']),
      rows: Object.freeze([Object.freeze(['00000000-0000-4000-8000-000000000001'])]),
    }),
  ]),
});

test('portable backups authenticate encrypted content and reject tampering', () => {
  const archive = createPortableArchive(payload, {
    clock: () => new Date('2026-08-01T00:00:00.000Z'),
    key,
    sourceDatabase: 'codewithmee_test',
  });
  const opened = openPortableArchive(archive.archive, { key });
  assert.deepEqual(opened.payload, payload);
  assert.equal(opened.archiveSha256, archive.archiveSha256);
  assert.doesNotMatch(archive.archive.toString('utf8'), /00000000-0000-4000/);
  const tampered = Buffer.from(archive.archive);
  tampered[tampered.length - 20] ^= 1;
  assert.throws(() => openPortableArchive(tampered, { key }), /backup/);
  assert.throws(() => openPortableArchive(archive.archive, { key: randomBytes(32) }), /key/);
});

test('backup keys and exact source and restore approvals fail closed', () => {
  const encoded = key.toString('base64');
  assert.deepEqual(parseBackupKey(encoded), key);
  assert.throws(() => parseBackupKey('not-a-key'), /canonical base64/);
  const source = {
    DATABASE_BACKUP_APPROVAL: `backup:codewithmee_test:${schemaSha256}`,
    DATABASE_BACKUP_MODE: 'read_only',
    DATABASE_BACKUP_SCOPE: 'disposable',
    DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/codewithmee_test',
  };
  assert.equal(assertBackupSafety(source, schemaSha256).database, 'codewithmee_test');
  assert.throws(() =>
    assertBackupSafety({ ...source, DATABASE_BACKUP_MODE: 'write' }, schemaSha256),
  );
  const restore = {
    DATABASE_RESTORE_APPROVAL: `restore:codewithmee_restore_test:${'b'.repeat(64)}`,
    DATABASE_RESTORE_MODE: 'apply',
    DATABASE_SAFETY_SCOPE: 'disposable',
    DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/codewithmee_restore_test',
  };
  assert.equal(
    assertRestoreSafety(restore, {
      archiveSha256: 'b'.repeat(64),
      sourceDatabase: 'codewithmee_test',
    }).database,
    'codewithmee_restore_test',
  );
  assert.throws(() =>
    assertRestoreSafety(
      { ...restore, DATABASE_URL: source.DATABASE_URL },
      { archiveSha256: 'b'.repeat(64), sourceDatabase: 'codewithmee_test' },
    ),
  );
});

test('restore ordering defers only nullable cycle edges', () => {
  const tables = [
    {
      name: 'users',
      foreignKeys: [
        { column: 'avatar_file_id', nullable: true, parentColumn: 'id', parentTable: 'files' },
      ],
    },
    {
      name: 'files',
      foreignKeys: [
        { column: 'owner_user_id', nullable: false, parentColumn: 'id', parentTable: 'users' },
      ],
    },
  ];
  const plan = restoreOrder(tables);
  assert.deepEqual(plan.ordered, ['users', 'files']);
  assert.deepEqual([...plan.deferredColumns.get('users')], ['avatar_file_id']);
  assert.throws(() =>
    restoreOrder([
      { name: 'a', foreignKeys: [{ column: 'b', nullable: false, parentTable: 'b' }] },
      { name: 'b', foreignKeys: [{ column: 'a', nullable: false, parentTable: 'a' }] },
    ]),
  );
});
