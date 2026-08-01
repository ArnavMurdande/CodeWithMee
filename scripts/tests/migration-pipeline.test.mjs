import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COLLECTION_NAMES,
  COLLECTIONS,
} from '../migrate-mongo-to-postgres/collection-registry.mjs';
import {
  fingerprint,
  stableStringify,
  uuidV5,
} from '../migrate-mongo-to-postgres/canonical-json.mjs';
import { main as migrationMain } from '../migrate-mongo-to-postgres/cli.mjs';
import { buildDryRunPlan } from '../migrate-mongo-to-postgres/dry-run-planner.mjs';
import {
  exportEncryptedSnapshot,
  openEncryptedSnapshot,
} from '../migrate-mongo-to-postgres/encrypted-snapshot.mjs';
import { createFixtureSource } from '../migrate-mongo-to-postgres/fixture-source.mjs';
import { buildInventory } from '../migrate-mongo-to-postgres/inventory.mjs';
import {
  assertMongoSourceSafety,
  assertReadOnlyRoles,
  parseSecretKey,
} from '../migrate-mongo-to-postgres/source-safety.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const fixturePath = path.join(root, 'scripts', 'tests', 'fixtures', 'migration-source.json');
const fixedClock = () => new Date('2026-08-01T00:00:00.000Z');
const encryptionKey = Buffer.alloc(32, 7);
const otherEncryptionKey = Buffer.alloc(32, 8);
const fingerprintKey = Buffer.alloc(32, 9);
const fingerprintKeyBase64 = fingerprintKey.toString('base64');

test('registry covers every legacy Mongoose model exactly once', async () => {
  const modelDirectory = path.join(root, 'server', 'models');
  const modelFiles = (await readdir(modelDirectory)).filter((name) => name.endsWith('.js')).sort();
  assert.deepEqual([...COLLECTIONS.map((definition) => definition.modelFile)].sort(), modelFiles);
  assert.equal(COLLECTION_NAMES.length, 18);
  assert.equal(new Set(COLLECTION_NAMES).size, COLLECTION_NAMES.length);
});

test('canonical fingerprints and migration target UUIDs are deterministic', () => {
  const one = { z: 1, nested: { b: true, a: 'value' }, a: [3, 2, 1] };
  const two = { a: [3, 2, 1], nested: { a: 'value', b: true }, z: 1 };
  assert.equal(stableStringify(one), stableStringify(two));
  assert.equal(fingerprint('source-id', fingerprintKey), fingerprint('source-id', fingerprintKey));
  assert.equal(
    uuidV5('8f5ed0d7-4f62-5d0d-91bc-8af3ce4fac17', 'users:u1:user'),
    '0bde113f-cbf3-515e-bffa-78b6f15f3df1',
  );
});

test('live Mongo access fails closed unless URI, approval, mode and roles are read-only', () => {
  assert.throws(() => assertMongoSourceSafety({ MONGO_URI: 'mongodb://ignored/app' }), /required/);
  assert.throws(
    () =>
      assertMongoSourceSafety({
        MIGRATION_SOURCE_MONGO_URI: 'mongodb://reader:secret@localhost/codewithmee',
        MIGRATION_SOURCE_MODE: 'read_only',
      }),
    /APPROVAL/,
  );
  assert.deepEqual(
    assertMongoSourceSafety({
      MIGRATION_SOURCE_APPROVAL: 'read-only:codewithmee',
      MIGRATION_SOURCE_MODE: 'read_only',
      MIGRATION_SOURCE_MONGO_URI: 'mongodb://reader:secret@localhost/codewithmee',
    }),
    {
      database: 'codewithmee',
      mongoUri: 'mongodb://reader:secret@localhost/codewithmee',
    },
  );
  assert.equal(
    assertMongoSourceSafety({
      MIGRATION_SOURCE_APPROVAL: 'read-only:codewithmee',
      MIGRATION_SOURCE_MODE: 'read_only',
      MIGRATION_SOURCE_MONGO_URI:
        'mongodb://reader:secret@mongo-a:27017,mongo-b:27017/codewithmee?replicaSet=rs0',
    }).database,
    'codewithmee',
  );
  assert.throws(
    () =>
      assertReadOnlyRoles({
        authInfo: { authenticatedUserRoles: [{ db: 'codewithmee', role: 'readWrite' }] },
      }),
    /not allowlisted/,
  );
  assert.deepEqual(
    assertReadOnlyRoles({
      authInfo: {
        authenticatedUserRoles: [
          { db: 'admin', role: 'clusterMonitor' },
          { db: 'codewithmee', role: 'read' },
        ],
      },
    }),
    [
      { database: 'admin', role: 'clusterMonitor' },
      { database: 'codewithmee', role: 'read' },
    ],
  );
  assert.throws(() => parseSecretKey('not-a-key', 'KEY'), /32-byte/);
});

test('inventory, encrypted export and dry-run planning are repeatable and redact source data', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'codewithmee-migration-'));
  try {
    const uploadRoot = path.join(temporaryRoot, 'uploads');
    await mkdir(path.join(uploadRoot, 'notes'), { recursive: true });
    await writeFile(
      path.join(uploadRoot, 'avatar-user-u3.png'),
      Buffer.from('89504e470d0a1a0a', 'hex'),
    );
    await writeFile(path.join(uploadRoot, 'notes', 'one.txt'), 'duplicate');
    await writeFile(path.join(uploadRoot, 'notes', 'two.txt'), 'duplicate');

    const inventorySourceOne = await createFixtureSource(fixturePath);
    const inventoryOne = await buildInventory({
      clock: fixedClock,
      fingerprintKey,
      source: inventorySourceOne,
      uploadRoot,
    });
    const inventorySourceTwo = await createFixtureSource(fixturePath);
    const inventoryTwo = await buildInventory({
      clock: fixedClock,
      fingerprintKey,
      source: inventorySourceTwo,
      uploadRoot,
    });
    assert.equal(inventoryOne.source.datasetSha256, inventoryTwo.source.datasetSha256);
    assert.equal(inventoryOne.uploads.totals.files, 3);
    assert.equal(inventoryOne.uploads.totals.uniqueContent, 2);
    assert.equal(inventoryOne.uploads.duplicates.length, 1);
    assert.equal(inventoryOne.uploads.files[0].path, undefined);
    assert.ok(
      inventoryOne.uploads.files.some(
        (/** @type {import('../migrate-mongo-to-postgres/types.mjs').LegacyDocument} */ entry) =>
          entry.detectedMime === 'image/png',
      ),
    );
    assert.doesNotMatch(JSON.stringify(inventoryOne), /private-index@example\.test/);

    const exportOnePath = path.join(temporaryRoot, 'snapshot-one');
    const exportTwoPath = path.join(temporaryRoot, 'snapshot-two');
    const exportSourceOne = await createFixtureSource(fixturePath);
    const exportOne = await exportEncryptedSnapshot({
      clock: fixedClock,
      encryptionKey,
      fingerprintKey,
      outputDirectory: exportOnePath,
      source: exportSourceOne,
    });
    const exportSourceTwo = await createFixtureSource(fixturePath);
    const exportTwo = await exportEncryptedSnapshot({
      clock: fixedClock,
      encryptionKey,
      fingerprintKey,
      outputDirectory: exportTwoPath,
      source: exportSourceTwo,
    });
    assert.equal(exportOne.manifest.datasetSha256, exportTwo.manifest.datasetSha256);
    assert.notEqual(
      exportOne.manifest.collections[0].ciphertextSha256,
      exportTwo.manifest.collections[0].ciphertextSha256,
    );

    const snapshotOne = await openEncryptedSnapshot({
      encryptionKey,
      snapshotDirectory: exportOnePath,
    });
    const resultOne = await buildDryRunPlan({
      clock: fixedClock,
      fingerprintKey,
      source: snapshotOne,
    });
    const snapshotTwo = await openEncryptedSnapshot({
      encryptionKey,
      snapshotDirectory: exportOnePath,
    });
    const resultTwo = await buildDryRunPlan({
      clock: fixedClock,
      fingerprintKey,
      source: snapshotTwo,
    });
    assert.equal(resultOne.report.planSha256, resultTwo.report.planSha256);
    assert.equal(resultOne.report.writesPerformed, false);
    assert.ok(resultOne.report.countsByState.planned > 0);
    assert.ok(resultOne.report.countsByState.quarantined > 0);

    const exceptionCodes = new Set(
      resultOne.report.exceptions.map(
        (
          /** @type {import('../migrate-mongo-to-postgres/types.mjs').MigrationException} */ entry,
        ) => entry.code,
      ),
    );
    for (const code of [
      'company_admin_claim_required',
      'dangling_polymorphic_author',
      'dangling_reference',
      'duplicate_normalized_email',
      'legacy_reset_token_discarded',
      'legacy_tests_forced_visible',
      'paid_course_currency_missing',
      'progress_imported_as_snapshot',
      'unsupported_password_hash',
    ]) {
      assert.ok(exceptionCodes.has(code), `missing expected exception ${code}`);
    }
    const challengePlan = resultOne.plan.find(
      (entry) => entry.sourceCollection === 'challenges' && entry.targetType === 'challenge',
    );
    assert.equal(challengePlan?.metadata.legacyTestVisibility, 'visible');

    const operatorOutput = JSON.stringify({ plan: resultOne.plan, report: resultOne.report });
    for (const secret of [
      'Owner@Example.test',
      'raw-reset-secret',
      'token-secret-hash',
      'hidden-reference-solution',
      'hidden-answer',
      'private-content',
      'private post body',
      'u1',
    ]) {
      assert.doesNotMatch(operatorOutput, new RegExp(secret, 'i'));
    }

    await assert.rejects(
      () =>
        openEncryptedSnapshot({
          encryptionKey: otherEncryptionKey,
          snapshotDirectory: exportOnePath,
        }),
      /manifest authentication failed/,
    );

    const unexpectedFixturePath = path.join(temporaryRoot, 'unexpected-source.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    fixture.collections.unregistered = [{ _id: 'unexpected-1' }];
    await writeFile(unexpectedFixturePath, `${JSON.stringify(fixture)}\n`);
    const unexpectedSource = await createFixtureSource(unexpectedFixturePath);
    const refusedOutput = path.join(temporaryRoot, 'refused-snapshot');
    await assert.rejects(
      () =>
        exportEncryptedSnapshot({
          encryptionKey,
          fingerprintKey,
          outputDirectory: refusedOutput,
          source: unexpectedSource,
        }),
      /unregistered source collection/,
    );
    await assert.rejects(() => access(refusedOutput), { code: 'ENOENT' });

    const unavailableOutput = path.join(temporaryRoot, 'unavailable-inventory');
    const unavailableResult = await migrationMain(
      ['inventory', '--source', 'auto', '--output', unavailableOutput],
      {
        MIGRATION_FINGERPRINT_KEY: fingerprintKeyBase64,
        MONGO_URI: 'mongodb://application-secret@forbidden/application',
      },
    );
    assert.ok('sourceStatus' in unavailableResult);
    assert.equal(unavailableResult.sourceStatus, 'unavailable');
    const unavailableReport = JSON.parse(
      await readFile(path.join(unavailableOutput, 'inventory.json'), 'utf8'),
    );
    assert.equal(unavailableReport.source.kind, 'unavailable');
    assert.doesNotMatch(JSON.stringify(unavailableReport), /application-secret|forbidden/);

    await assert.rejects(
      () => migrationMain(['import', '--snapshot', exportOnePath], {}),
      /Live import is intentionally unavailable/,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
