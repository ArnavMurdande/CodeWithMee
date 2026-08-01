'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_OUTCOME,
  canonicalRequestSha256,
  canonicalizeJson,
  createIdempotencyService,
  createMemoryIdempotencyRepository,
  createPostgresIdempotencyRepository,
  idempotencyScopeSha256,
} = require('../modules/operations/idempotency');

const INPUT = Object.freeze({
  actorId: 'user-1',
  key: 'request-key-0001',
  operationId: 'createCourse',
  request: { body: { name: 'Safe course' }, method: 'POST', path: '/courses', query: {} },
});

const POSTGRES_INPUT = Object.freeze({
  actorId: '11111111-1111-4111-8111-111111111111',
  key: 'postgres-key-0001',
  operationId: 'createCourse',
  request: { body: { name: 'Durable course' }, method: 'POST', path: '/courses', query: {} },
});

function databaseScope(values) {
  return values.slice(0, 3).join(':');
}

class DeterministicPostgresPool {
  constructor() {
    this.calls = [];
    this.releaseCount = 0;
    this.rows = new Map();
  }

  async connect() {
    return {
      query: async (text, values = []) => this.query(text, values),
      release: () => {
        this.releaseCount += 1;
      },
    };
  }

  async query(text, values) {
    this.calls.push({ text, values });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rowCount: null, rows: [] };
    }
    if (text.includes('idempotency.begin.delete_expired')) {
      const scope = databaseScope(values);
      const row = this.rows.get(scope);
      if (row && row.expiresAt <= values[3].getTime()) {
        this.rows.delete(scope);
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (text.includes('idempotency.begin.insert')) {
      const scope = databaseScope(values);
      if (this.rows.has(scope)) return { rowCount: 0, rows: [] };
      this.rows.set(scope, {
        actorId: values[0],
        action: values[1],
        expiresAt: values[4].getTime(),
        key: values[2],
        leaseExpiresAt: values[7].getTime(),
        leaseId: values[6],
        requestHash: values[3],
        responseBody: null,
        responseStatus: null,
      });
      return { rowCount: 1, rows: [{ leaseId: values[6] }] };
    }
    if (text.includes('idempotency.begin.select')) {
      const row = this.rows.get(databaseScope(values));
      return row
        ? {
            rowCount: 1,
            rows: [
              {
                leaseExpiresAt: new Date(row.leaseExpiresAt),
                leaseId: row.leaseId,
                requestHash: row.requestHash,
                responseBody: row.responseBody,
                responseStatus: row.responseStatus,
              },
            ],
          }
        : { rowCount: 0, rows: [] };
    }
    if (text.includes('idempotency.begin.recover_lease')) {
      const scope = databaseScope(values.slice(3, 6));
      const row = this.rows.get(scope);
      const now = values[2].getTime();
      if (
        !row ||
        row.requestHash !== values[6] ||
        row.responseStatus !== null ||
        row.expiresAt <= now ||
        row.leaseExpiresAt > now
      ) {
        return { rowCount: 0, rows: [] };
      }
      row.leaseId = values[0];
      row.leaseExpiresAt = values[1].getTime();
      return { rowCount: 1, rows: [{ leaseId: values[0] }] };
    }
    if (text.includes('idempotency.complete')) {
      const scope = databaseScope(values);
      const row = this.rows.get(scope);
      if (
        !row ||
        row.requestHash !== values[3] ||
        row.leaseId !== values[4] ||
        row.responseStatus !== null ||
        row.expiresAt <= values[7].getTime()
      ) {
        return { rowCount: 0, rows: [] };
      }
      row.responseStatus = values[5];
      row.responseBody = JSON.parse(values[6]);
      row.leaseId = null;
      row.leaseExpiresAt = null;
      return { rowCount: 1, rows: [{ id: 'stored' }] };
    }
    if (text.includes('idempotency.abandon')) {
      const scope = databaseScope(values);
      const row = this.rows.get(scope);
      if (
        !row ||
        row.requestHash !== values[3] ||
        row.leaseId !== values[4] ||
        row.responseStatus !== null
      ) {
        return { rowCount: 0, rows: [] };
      }
      this.rows.delete(scope);
      return { rowCount: 1, rows: [{ id: 'deleted' }] };
    }
    throw new Error(`Unexpected SQL in fake pool: ${text}`);
  }
}

test('canonical request hashes are deterministic, bounded, and JSON-only', () => {
  const left = {
    body: { enabled: true, labels: ['a', 'b'], nested: { a: null, z: 1 } },
    method: 'POST',
  };
  const right = {
    method: 'POST',
    body: { nested: { z: 1, a: null }, labels: ['a', 'b'], enabled: true },
  };
  assert.equal(canonicalizeJson(left), canonicalizeJson(right));
  assert.equal(canonicalRequestSha256(left), canonicalRequestSha256(right));
  assert.notEqual(
    canonicalRequestSha256(left),
    canonicalRequestSha256({ ...right, method: 'PATCH' }),
  );
  assert.match(canonicalRequestSha256(left), /^[0-9a-f]{64}$/);
  assert.throws(() => canonicalizeJson({ missing: undefined }), /JSON-compatible/);
  assert.throws(() => canonicalizeJson({ value: Number.NaN }), /finite/);
  assert.throws(
    () => canonicalizeJson({ text: 'x'.repeat(2000) }, { maxBytes: 1024 }),
    (error) => {
      return error.code === 'idempotency_payload_too_large' && error.status === 413;
    },
  );
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic), /cycles/);
});

test('actor, operation, and key scope records replay, mismatch, and in-progress outcomes', async () => {
  const repository = createMemoryIdempotencyRepository();
  const service = createIdempotencyService({ repository });
  const acquired = await service.begin(INPUT);
  assert.equal(acquired.outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  assert.equal((await service.begin(INPUT)).outcome, IDEMPOTENCY_OUTCOME.IN_PROGRESS);
  assert.equal(
    (await service.begin({ ...INPUT, request: { ...INPUT.request, method: 'PATCH' } })).outcome,
    IDEMPOTENCY_OUTCOME.CONFLICT,
  );

  const otherActor = await service.begin({ ...INPUT, actorId: 'user-2' });
  const otherOperation = await service.begin({ ...INPUT, operationId: 'updateCourse' });
  assert.equal(otherActor.outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  assert.equal(otherOperation.outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  assert.notEqual(
    idempotencyScopeSha256(INPUT),
    idempotencyScopeSha256({ ...INPUT, actorId: 'user-2' }),
  );

  await service.complete(acquired.handle, { body: { course: { id: 'course-1' } }, status: 201 });
  const replay = await service.begin(INPUT);
  assert.deepEqual(replay, {
    outcome: IDEMPOTENCY_OUTCOME.REPLAY,
    response: { body: { course: { id: 'course-1' } }, status: 201 },
  });
  assert.equal(Object.isFrozen(replay.response), true);
  assert.equal(Object.isFrozen(replay.response.body), true);
});

test('concurrent duplicate begins atomically acquire one lease', async () => {
  const service = createIdempotencyService({ repository: createMemoryIdempotencyRepository() });
  const results = await Promise.all(Array.from({ length: 50 }, () => service.begin(INPUT)));
  assert.equal(
    results.filter((result) => result.outcome === IDEMPOTENCY_OUTCOME.ACQUIRED).length,
    1,
  );
  assert.equal(
    results.filter((result) => result.outcome === IDEMPOTENCY_OUTCOME.IN_PROGRESS).length,
    49,
  );
});

test('execute stores bounded safe JSON and abandons leases when work or validation fails', async () => {
  const repository = createMemoryIdempotencyRepository();
  const service = createIdempotencyService({ maxResponseBytes: 1024, repository });
  let executions = 0;
  const completed = await service.execute(INPUT, async () => {
    executions += 1;
    return { body: { id: 'course-1' }, status: 201 };
  });
  assert.equal(completed.outcome, 'completed');
  const replay = await service.execute(INPUT, async () => {
    executions += 1;
    return { body: { id: 'should-not-run' }, status: 201 };
  });
  assert.equal(replay.outcome, IDEMPOTENCY_OUTCOME.REPLAY);
  assert.equal(executions, 1);

  const failedInput = { ...INPUT, key: 'request-key-0002' };
  await assert.rejects(
    service.execute(failedInput, async () => {
      throw new Error('operation failed');
    }),
    /operation failed/,
  );
  assert.equal((await service.begin(failedInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);

  const secretInput = { ...INPUT, key: 'request-key-0003' };
  await assert.rejects(
    service.execute(secretInput, async () => ({
      body: { accessToken: 'never-store' },
      status: 200,
    })),
    (error) => error.code === 'unsafe_idempotency_response',
  );
  assert.equal((await service.begin(secretInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);

  const headersInput = { ...INPUT, key: 'request-key-0004' };
  await assert.rejects(
    service.execute(headersInput, async () => ({
      body: { ok: true },
      headers: { 'set-cookie': 'never-store' },
      status: 200,
    })),
    (error) => error.code === 'invalid_idempotency_response',
  );
  assert.equal((await service.begin(headersInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);

  const largeInput = { ...INPUT, key: 'request-key-0005' };
  await assert.rejects(
    service.execute(largeInput, async () => ({ body: { value: 'x'.repeat(2000) }, status: 200 })),
    (error) => error.code === 'idempotency_payload_too_large',
  );
  assert.equal((await service.begin(largeInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
});

test('expired leases can be recovered and completed records expire after the bounded TTL', async () => {
  let timestamp = Date.parse('2026-08-01T00:00:00.000Z');
  const now = () => timestamp;
  const repository = createMemoryIdempotencyRepository();
  const service = createIdempotencyService({ leaseTtlMs: 1000, now, repository });
  const first = await service.begin(INPUT);
  timestamp += 1001;
  const recovered = await service.begin(INPUT);
  assert.equal(recovered.outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  await assert.rejects(
    service.complete(first.handle, { body: { id: 'stale' }, status: 201 }),
    (error) => error.code === 'stale_idempotency_lease' && error.status === 409,
  );
  await service.complete(recovered.handle, { body: { id: 'current' }, status: 201 });
  assert.equal((await service.begin(INPUT)).outcome, IDEMPOTENCY_OUTCOME.REPLAY);

  timestamp += DEFAULT_IDEMPOTENCY_TTL_MS;
  assert.equal((await service.begin(INPUT)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
});

test('repository injection receives exact actor/action and digests but never raw keys or requests', async () => {
  const calls = [];
  const repository = {
    async abandon(input) {
      calls.push(['abandon', input]);
      return { abandoned: true };
    },
    async begin(input) {
      calls.push(['begin', input]);
      return { leaseId: input.leaseId, outcome: IDEMPOTENCY_OUTCOME.ACQUIRED };
    },
    async complete(input) {
      calls.push(['complete', input]);
      return { completed: true };
    },
  };
  const service = createIdempotencyService({ repository });
  await service.execute(
    {
      ...INPUT,
      key: 'raw-key-must-not-reach-repository',
      request: { authorization: 'raw-token-must-not-reach-repository', body: { value: 1 } },
    },
    async () => ({ body: { ok: true }, status: 200 }),
  );
  const serialized = JSON.stringify(calls);
  assert.equal(calls[0][1].actorId, INPUT.actorId);
  assert.equal(calls[0][1].operationId, INPUT.operationId);
  assert.equal(serialized.includes('raw-key-must-not-reach-repository'), false);
  assert.equal(serialized.includes('raw-token-must-not-reach-repository'), false);
  assert.match(calls[0][1].scopeHash, /^[0-9a-f]{64}$/);
  assert.match(calls[0][1].requestHash, /^[0-9a-f]{64}$/);

  const source = readFileSync(require.resolve('../modules/operations/idempotency'), 'utf8');
  assert.equal(source.includes('console.'), false);
  assert.equal(source.includes('logger.'), false);
});

test('PostgreSQL adapter uses transactional parameterized exact-scope transitions', async () => {
  let timestamp = Date.parse('2026-08-01T00:00:00.000Z');
  const pool = new DeterministicPostgresPool();
  const repository = createPostgresIdempotencyRepository(pool);
  const service = createIdempotencyService({ leaseTtlMs: 1000, now: () => timestamp, repository });

  const first = await service.begin(POSTGRES_INPUT);
  assert.equal(first.outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  assert.equal((await service.begin(POSTGRES_INPUT)).outcome, IDEMPOTENCY_OUTCOME.IN_PROGRESS);
  assert.equal(
    (
      await service.begin({
        ...POSTGRES_INPUT,
        request: { ...POSTGRES_INPUT.request, method: 'PATCH' },
      })
    ).outcome,
    IDEMPOTENCY_OUTCOME.CONFLICT,
  );

  await service.complete(first.handle, { body: { course: { id: 'course-pg' } }, status: 201 });
  assert.deepEqual(await service.begin(POSTGRES_INPUT), {
    outcome: IDEMPOTENCY_OUTCOME.REPLAY,
    response: { body: { course: { id: 'course-pg' } }, status: 201 },
  });

  const otherActorInput = {
    ...POSTGRES_INPUT,
    actorId: '22222222-2222-4222-8222-222222222222',
  };
  const otherOperationInput = { ...POSTGRES_INPUT, operationId: 'updateCourse' };
  assert.equal((await service.begin(otherActorInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  assert.equal((await service.begin(otherOperationInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);

  const recoverInput = { ...POSTGRES_INPUT, key: 'postgres-key-0002' };
  const stale = await service.begin(recoverInput);
  timestamp += 1001;
  const recovered = await service.begin(recoverInput);
  assert.equal(recovered.outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);
  await assert.rejects(
    service.complete(stale.handle, { body: { id: 'stale' }, status: 201 }),
    (error) => error.code === 'stale_idempotency_lease',
  );
  await service.complete(recovered.handle, { body: { id: 'current' }, status: 201 });

  const failedInput = { ...POSTGRES_INPUT, key: 'postgres-key-0003' };
  await assert.rejects(
    service.execute(failedInput, async () => {
      throw new Error('durable operation failed');
    }),
    /durable operation failed/,
  );
  assert.equal((await service.begin(failedInput)).outcome, IDEMPOTENCY_OUTCOME.ACQUIRED);

  const insertCall = pool.calls.find((call) => call.text.includes('idempotency.begin.insert'));
  assert.ok(insertCall.text.includes('ON CONFLICT ("actor_user_id", "action", "key")'));
  assert.ok(pool.calls.some((call) => call.text.includes('FOR UPDATE')));
  assert.ok(pool.calls.some((call) => call.text === 'BEGIN'));
  assert.ok(pool.calls.some((call) => call.text === 'COMMIT'));
  assert.ok(pool.calls.some((call) => call.text.includes('idempotency.begin.recover_lease')));
  assert.ok(pool.calls.some((call) => call.text.includes('idempotency.complete')));
  assert.ok(pool.calls.some((call) => call.text.includes('idempotency.abandon')));
  assert.equal(insertCall.values[0], POSTGRES_INPUT.actorId);
  assert.equal(insertCall.values[1], POSTGRES_INPUT.operationId);
  assert.equal(insertCall.values[2], idempotencyScopeSha256(POSTGRES_INPUT));
  assert.notEqual(insertCall.values[2], POSTGRES_INPUT.key);
  for (const call of pool.calls) {
    assert.equal(call.text.includes(POSTGRES_INPUT.key), false);
    assert.equal(call.text.includes(POSTGRES_INPUT.actorId), false);
    assert.equal(call.text.includes('Durable course'), false);
  }
  assert.ok(pool.releaseCount > 0);
});

test('PostgreSQL adapter validates pool, durable identifiers, and transaction failures', async () => {
  assert.throws(() => createPostgresIdempotencyRepository({}), /must implement connect/);
  const invalidClientRepository = createPostgresIdempotencyRepository({
    async connect() {
      return {};
    },
  });
  await assert.rejects(
    createIdempotencyService({ repository: invalidClientRepository }).begin(POSTGRES_INPUT),
    /client must implement query.*release/,
  );

  const calls = [];
  const failingPool = {
    async connect() {
      return {
        async query(text) {
          calls.push(text);
          if (text.includes('idempotency.begin.insert')) throw new Error('database unavailable');
          return { rowCount: 0, rows: [] };
        },
        release() {
          calls.push('RELEASE');
        },
      };
    },
  };
  const service = createIdempotencyService({
    repository: createPostgresIdempotencyRepository(failingPool),
  });
  await assert.rejects(service.begin(POSTGRES_INPUT), /database unavailable/);
  assert.deepEqual(
    calls.filter((entry) => ['BEGIN', 'ROLLBACK', 'RELEASE'].includes(entry)),
    ['BEGIN', 'ROLLBACK', 'RELEASE'],
  );
});

test('configuration and memory capacity are bounded and fail closed', async () => {
  assert.throws(
    () => createIdempotencyService({ repository: createMemoryIdempotencyRepository(), ttlMs: 999 }),
    /ttlMs must be an integer/,
  );
  assert.throws(
    () =>
      createIdempotencyService({
        leaseTtlMs: 999,
        repository: createMemoryIdempotencyRepository(),
      }),
    /leaseTtlMs must be an integer/,
  );
  const repository = createMemoryIdempotencyRepository({ maxEntries: 1 });
  const service = createIdempotencyService({ repository });
  await service.begin(INPUT);
  await assert.rejects(
    service.begin({ ...INPUT, key: 'request-key-0006' }),
    (error) => error.code === 'idempotency_capacity_exhausted' && error.status === 503,
  );
});
