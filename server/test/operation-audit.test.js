'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const {
  createAuditEnvelope,
  createMemoryAuditRepository,
  createPostgresAuditRepository,
} = require('../modules/operations/audit');

const EVENT_ID = '00000000-0000-4000-8000-000000000101';
const ACTOR_ID = '00000000-0000-4000-8000-000000000102';
const SESSION_ID = '00000000-0000-4000-8000-000000000103';
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000104';
const OCCURRED_AT = new Date('2026-08-01T00:00:00.000Z');

function envelope(overrides = {}) {
  return createAuditEnvelope(
    {
      action: 'courses.publish',
      actorSessionId: SESSION_ID,
      actorUserId: ACTOR_ID,
      afterState: {
        passwordHash: 'must-not-project',
        revision: 2,
        status: 'published',
        storageKey: 'must-not-project',
      },
      beforeState: { revision: 1, status: 'draft', tokenHash: 'must-not-project' },
      id: EVENT_ID,
      occurredAt: OCCURRED_AT,
      operationKey: 'publish-course-0001',
      organizationId: ORGANIZATION_ID,
      reason: 'Approved by the course owner.',
      requestId: 'request-0001',
      source: 'api',
      targetId: 'course-1',
      targetType: 'course',
      ...overrides,
    },
    { stateAllowlist: ['revision', 'status'] },
  );
}

function databaseRow(overrides = {}) {
  return {
    action: 'courses.publish',
    actor_session_id: SESSION_ID,
    actor_user_id: ACTOR_ID,
    after_state: { revision: 2, status: 'published' },
    before_state: { revision: 1, status: 'draft' },
    correlation_id: null,
    created_at: OCCURRED_AT,
    id: EVENT_ID,
    occurred_at: OCCURRED_AT,
    operation_key: 'publish-course-0001',
    operator_ref: null,
    organization_id: ORGANIZATION_ID,
    reason: 'Approved by the course owner.',
    request_id: 'request-0001',
    source: 'api',
    target_id: 'course-1',
    target_type: 'course',
    ...overrides,
  };
}

test('audit envelopes project explicit state fields and remain deeply immutable', () => {
  const record = envelope();
  assert.deepEqual(record.beforeState, { revision: 1, status: 'draft' });
  assert.deepEqual(record.afterState, { revision: 2, status: 'published' });
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.afterState), true);
  assert.equal(JSON.stringify(record).includes('must-not-project'), false);

  assert.throws(
    () =>
      createAuditEnvelope(
        {
          action: 'unsafe',
          source: 'api',
          targetId: 'target',
          targetType: 'test',
        },
        { stateAllowlist: ['accessToken'] },
      ),
    (error) => error.code === 'audit_forbidden_state_field',
  );
  assert.throws(
    () => createAuditEnvelope({ extra: true }, { stateAllowlist: [] }),
    (error) => {
      return error.code === 'audit_unknown_field';
    },
  );
  assert.throws(() =>
    createAuditEnvelope(
      {
        action: 'oversized',
        afterState: { summary: 'x'.repeat(501) },
        source: 'api',
        targetId: 'target',
        targetType: 'test',
      },
      { stateAllowlist: ['summary'] },
    ),
  );
});

test('memory audit storage is append-only, bounded, listed, and operation-key idempotent', async () => {
  const repository = createMemoryAuditRepository({
    clock: () => new Date('2026-08-01T00:00:01.000Z'),
    maxEvents: 2,
  });
  assert.equal('update' in repository, false);
  assert.equal('delete' in repository, false);
  const first = await repository.append(envelope());
  assert.strictEqual(await repository.append(envelope()), first);
  await assert.rejects(
    repository.append(envelope({ afterState: { revision: 3, status: 'published' } })),
    (error) => error.code === 'audit_operation_key_conflict' && error.status === 409,
  );
  await repository.append(
    envelope({ id: '00000000-0000-4000-8000-000000000105', operationKey: 'publish-course-0002' }),
  );
  assert.equal((await repository.list({ limit: 2 })).length, 2);
  await assert.rejects(
    repository.append(
      envelope({ id: '00000000-0000-4000-8000-000000000106', operationKey: 'publish-course-0003' }),
    ),
    (error) => error.code === 'audit_memory_capacity_exceeded' && error.status === 503,
  );
});

test('PostgreSQL audit append is parameterized and replays an exact operation key', async () => {
  const calls = [];
  const rows = [[databaseRow()], [], [databaseRow()]];
  const pool = {
    async connect() {
      return { query: pool.query, release() {} };
    },
    async query(text, params) {
      calls.push({ params, text });
      return { rows: rows.shift() };
    },
  };
  const repository = createPostgresAuditRepository(pool);
  const inserted = await repository.append(envelope());
  const replayed = await repository.append(envelope());
  assert.deepEqual(replayed, inserted);
  assert.equal(calls.length, 3);
  assert.match(calls[0].text, /INSERT INTO audit_events/);
  assert.match(calls[0].text, /ON CONFLICT \(operation_key\) DO NOTHING/);
  assert.match(calls[2].text, /WHERE operation_key = \$1/);
  assert.equal(calls[0].text.includes('Approved by the course owner.'), false);
  assert.equal(calls[0].text.includes('publish-course-0001'), false);
  assert.equal(calls[0].params[9], 'Approved by the course owner.');
  assert.equal(calls[0].params[14], 'publish-course-0001');
});

test('audit primitive source has no mutation or logging escape hatch', () => {
  const source = readFileSync(require.resolve('../modules/operations/audit'), 'utf8');
  assert.doesNotMatch(source, /console\.|logger\./);
  assert.doesNotMatch(source, /UPDATE\s+audit_events|DELETE\s+FROM\s+audit_events/i);
  assert.match(source, /stateAllowlist/);
  assert.match(source, /FORBIDDEN_STATE_FIELD_PARTS/);
});
