'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseParityKey,
  signParityReport,
  verifyParityEnvelope,
} = require('../modules/persistence/parity-report');
const {
  loadPersistenceRuntimeConfig,
  verifyPersistenceActivation,
} = require('../modules/persistence/runtime');
const {
  createShadowReadRepository,
  fingerprint,
} = require('../modules/persistence/shadow-repository');
const { createMemoryAuthorityRepository } = require('../modules/authority/memory-repository');
const { createPostgresAuthorityRepository } = require('../modules/authority/postgres-repository');
const { createMemoryIdentityRepository } = require('../modules/identity/memory-repository');
const { createPostgresIdentityRepository } = require('../modules/identity/postgres-repository');
const {
  createMemoryOrganizationRepository,
} = require('../modules/organizations/memory-repository');
const {
  createPostgresOrganizationRepository,
} = require('../modules/organizations/postgres-repository');
const {
  assertActivationSafety,
  assertRollbackSafety,
} = require('../scripts/persistence-cutover-safety');
const { assertParitySafety } = require('../scripts/persistence-parity-safety');

const DATASET = 'a'.repeat(64);
const REPORT = 'b'.repeat(64);
const SNAPSHOT = 'c'.repeat(64);
const DATABASE_URL = 'postgresql://app:secret@127.0.0.1:5432/codewithmee_test';
const DOMAINS = 'authority,challenges,courses,ideas,identity,integrations,learning,organizations,social';
const FUTURE = '2035-01-01T00:00:00.000Z';

function cutoverEnvironment(overrides = {}) {
  return {
    DATABASE_URL,
    PERSISTENCE_AUTHORITY_STORE: 'postgres',
    PERSISTENCE_CHALLENGES_STORE: 'postgres',
    PERSISTENCE_COURSES_STORE: 'postgres',
    PERSISTENCE_CUTOVER_APPROVAL: `cutover:test:codewithmee_test:generation-001:${REPORT}:${DOMAINS}`,
    PERSISTENCE_CUTOVER_GENERATION: 'generation-001',
    PERSISTENCE_ENVIRONMENT: 'test',
    PERSISTENCE_IDEAS_STORE: 'postgres',
    PERSISTENCE_IDENTITY_STORE: 'postgres',
    PERSISTENCE_INTEGRATIONS_STORE: 'postgres',
    PERSISTENCE_LEARNING_STORE: 'postgres',
    PERSISTENCE_LEGACY_API_MODE: 'disabled',
    PERSISTENCE_MIGRATION_DATASET_SHA256: DATASET,
    PERSISTENCE_ORGANIZATIONS_STORE: 'postgres',
    PERSISTENCE_PARITY_REPORT_SHA256: REPORT,
    PERSISTENCE_ROLLBACK_REHEARSED: 'true',
    PERSISTENCE_ROLLBACK_SNAPSHOT_SHA256: SNAPSHOT,
    PERSISTENCE_ROLLBACK_UNTIL: FUTURE,
    PERSISTENCE_SOCIAL_STORE: 'postgres',
    PERSISTENCE_WRITE_FREEZE_CONFIRMED: 'true',
    ...overrides,
  };
}

test('PostgreSQL repositories implement every stable service repository operation', () => {
  const fakePool = { connect() {}, query() {} };
  for (const [memory, postgres] of [
    [createMemoryIdentityRepository(), createPostgresIdentityRepository(fakePool)],
    [createMemoryOrganizationRepository(), createPostgresOrganizationRepository(fakePool)],
    [createMemoryAuthorityRepository(), createPostgresAuthorityRepository(fakePool)],
  ]) {
    const expected = Object.keys(memory)
      .filter((key) => key !== 'snapshot')
      .sort();
    assert.deepEqual(Object.keys(postgres).sort(), expected);
  }
});

test('persistence defaults to PostgreSQL', () => {
  const defaults = loadPersistenceRuntimeConfig({}, { nodeEnv: 'test' });
  assert.equal(defaults.legacyApiEnabled, true);
  assert.equal(defaults.needsPostgres, true);

  assert.throws(
    () =>
      loadPersistenceRuntimeConfig({ PERSISTENCE_IDENTITY_STORE: 'invalid' }, { nodeEnv: 'test' }),
    /must be postgres/,
  );
  assert.throws(
    () =>
      loadPersistenceRuntimeConfig(cutoverEnvironment({ PERSISTENCE_LEGACY_API_MODE: 'enabled' }), {
        nodeEnv: 'production',
      }),
    /must be disabled/,
  );
});

test('approved atomic PostgreSQL runtime config is exact and database activation must match', async () => {
  const env = cutoverEnvironment({
    PERSISTENCE_ENVIRONMENT: 'production',
    PERSISTENCE_CUTOVER_APPROVAL: `cutover:production:codewithmee_test:generation-001:${REPORT}:${DOMAINS}`,
  });
  const config = loadPersistenceRuntimeConfig(env, {
    nodeEnv: 'production',
    now: () => new Date('2030-01-01T00:00:00.000Z'),
  });
  assert.deepEqual(config.postgresDomains, DOMAINS.split(','));
  assert.equal(config.cutover.targetDatabase, 'codewithmee_test');
  assert.equal(config.needsPostgres, true);

  const values = config.cutover.domains.map((domain) => ({
    key: `persistence.${domain}.store`,
    value: {
      datasetSha256: DATASET,
      generation: 'generation-001',
      parityReportSha256: REPORT,
      rollbackSnapshotSha256: SNAPSHOT,
      rollbackUntil: FUTURE,
      state: 'active',
      store: 'postgres',
    },
  }));
  await assert.doesNotReject(() =>
    verifyPersistenceActivation({ query: async () => ({ rows: values }) }, config),
  );
  values[0].value = { ...values[0].value, generation: 'wrong' };
  await assert.rejects(
    verifyPersistenceActivation({ query: async () => ({ rows: values }) }, config),
    /does not match/,
  );
});

test('shadow reads never alter the primary response and logs contain metadata only', async () => {
  const logs = [];
  let releaseSecondary;
  const secondaryGate = new Promise((resolve) => {
    releaseSecondary = resolve;
  });
  const repository = createShadowReadRepository({
    domain: 'identity',
    logger: {
      info: (...values) => logs.push(values),
      warn: (...values) => logs.push(values),
    },
    methods: ['findUserByEmail'],
    primary: {
      async findUserByEmail() {
        return { email: 'learner@example.test', id: 'mongo-id', passwordHash: 'secret' };
      },
    },
    secondary: {
      async findUserByEmail() {
        await secondaryGate;
        return { email: 'learner@example.test', id: 'postgres-id', passwordHash: 'different' };
      },
    },
  });
  const primary = await repository.findUserByEmail('learner@example.test');
  assert.equal(primary.id, 'mongo-id');
  assert.equal(logs.length, 0);
  releaseSecondary();
  await repository.$drainShadowReads();
  assert.equal(logs[0][1].code, 'shadow_match');
  assert.doesNotMatch(JSON.stringify(logs), /learner@example|secret|mongo-id|postgres-id/);
  assert.equal(
    fingerprint({ id: 'one', passwordHash: 'x', value: 1 }),
    fingerprint({ id: 'two', passwordHash: 'y', value: 1 }),
  );
});

test('parity reports are checksum-pinned, authenticated, and tamper evident', () => {
  const rawKey = randomBytes(32).toString('base64');
  const key = parseParityKey(rawKey);
  const envelope = signParityReport(
    { datasetSha256: DATASET, domains: { identity: { readyForCutover: true } } },
    key,
  );
  assert.equal(verifyParityEnvelope(envelope, key), envelope);
  assert.throws(
    () =>
      verifyParityEnvelope(
        { ...envelope, report: { ...envelope.report, datasetSha256: SNAPSHOT } },
        key,
      ),
    /checksum is invalid/,
  );
  assert.throws(() => parseParityKey(Buffer.alloc(12).toString('base64')), /exactly 32 bytes/);
});

test('cutover and rollback approvals bind target, generation, report, domains, and freeze', () => {
  const reportDomains = Object.fromEntries(
    DOMAINS.split(',').map((domain) => [domain, { readyForCutover: true }]),
  );
  const envelope = {
    report: { datasetSha256: DATASET, domains: reportDomains },
    reportSha256: REPORT,
  };
  const activation = assertActivationSafety({
    args: ['activate', '--apply', '--domains', DOMAINS],
    envelope,
    environment: cutoverEnvironment({
      PERSISTENCE_CUTOVER_MODE: 'activate',
      PERSISTENCE_CUTOVER_OPERATOR: 'change-record-1234',
    }),
    now: () => new Date('2030-01-01T00:00:00.000Z'),
  });
  assert.deepEqual(activation.domains, DOMAINS.split(','));

  const rollback = assertRollbackSafety({
    args: ['rollback', '--apply', '--domains', DOMAINS],
    environment: cutoverEnvironment({
      PERSISTENCE_CUTOVER_MODE: 'rollback',
      PERSISTENCE_CUTOVER_OPERATOR: 'change-record-1234',
      PERSISTENCE_ROLLBACK_APPROVAL: `rollback:test:codewithmee_test:generation-001:${DOMAINS}`,
    }),
    now: () => new Date('2030-01-01T00:00:00.000Z'),
  });
  assert.equal(rollback.generation, 'generation-001');

  assert.throws(
    () =>
      assertActivationSafety({
        args: ['activate', '--apply', '--domains', DOMAINS],
        envelope,
        environment: cutoverEnvironment({
          PERSISTENCE_CUTOVER_MODE: 'activate',
          PERSISTENCE_CUTOVER_OPERATOR: 'change-record-1234',
          PERSISTENCE_WRITE_FREEZE_CONFIRMED: 'false',
        }),
      }),
    /WRITE_FREEZE_CONFIRMED/,
  );
});

test('parity output safety requires exact read-only target approval and exclusive file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codewithmee-parity-safety-'));
  try {
    const output = path.join(directory, 'report.json');
    const safety = assertParitySafety({
      datasetSha256: DATASET,
      environment: {
        DATABASE_URL,
        PERSISTENCE_PARITY_APPROVAL: `parity:codewithmee_test:${DATASET}`,
        PERSISTENCE_PARITY_MODE: 'read_only',
      },
      output,
    });
    assert.equal(safety.outputPath, output);
    assert.throws(
      () =>
        assertParitySafety({
          datasetSha256: DATASET,
          environment: { DATABASE_URL, PERSISTENCE_PARITY_MODE: 'read_only' },
          output,
        }),
      /PARITY_APPROVAL/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
