'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CLAIM_BATCH_SIZE,
  OUTBOX_ERROR_CODE,
  boundedExponentialBackoffMs,
  createMemoryOutboxRepository,
  createOutboxWorker,
  createPostgresOutboxRepository,
} = require('../modules/operations/outbox');

const START = new Date('2026-08-01T00:00:00.000Z');

function event(number, overrides = {}) {
  return {
    aggregateId: `aggregate-${number}`,
    aggregateType: 'test',
    availableAt: new Date(START),
    createdAt: new Date(START),
    eventType: 'test.requested',
    id: `event-${number}`,
    payload: { number },
    ...overrides,
  };
}

function claim(repository, workerId, now = START, limit = 10, leaseMs = 1_000) {
  return repository.claimBatch({
    leaseUntil: new Date(now.getTime() + leaseMs),
    limit,
    now,
    workerId,
  });
}

function databaseEventRow(overrides = {}) {
  return {
    aggregate_id: 'aggregate-1',
    aggregate_type: 'test',
    attempt_count: 1,
    available_at: new Date(START),
    created_at: new Date(START),
    event_type: 'test.requested',
    event_version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    last_error_code: null,
    payload: { secret: 'database-payload' },
    processed_at: null,
    ...overrides,
  };
}

function databaseJobRow(overrides = {}) {
  return {
    attempt: 1,
    created_at: new Date(START),
    id: '00000000-0000-4000-8000-000000000101',
    leased_until: new Date(START.getTime() + 10_000),
    state: 'running',
    worker_id: 'worker-a',
    ...overrides,
  };
}

function createFakePool(steps = []) {
  let stepIndex = 0;
  const state = { calls: [], releases: 0 };

  async function execute(source, text, params = []) {
    state.calls.push({ params, source, text });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [] };
    const step = steps[stepIndex];
    stepIndex += 1;
    assert.ok(step, `Unexpected database query: ${text}`);
    if (step.match) assert.match(text, step.match);
    if (step.error) throw step.error;
    return { rows: step.rows || [] };
  }

  const client = {
    query: (text, params) => execute('client', text, params),
    release: () => {
      state.releases += 1;
    },
  };
  const pool = {
    connect: async () => client,
    query: (text, params) => execute('pool', text, params),
  };
  state.assertConsumed = () => assert.equal(stepIndex, steps.length);
  return { pool, state };
}

test('concurrent claims never lease one event to two workers', async () => {
  const repository = createMemoryOutboxRepository({ events: [event(1), event(2), event(3)] });
  const [first, second] = await Promise.all([
    claim(repository, 'worker-a', START, 2),
    claim(repository, 'worker-b', START, 2),
  ]);
  const firstIds = new Set(first.map((record) => record.id));
  assert.equal(first.length + second.length, 3);
  assert.equal(
    second.some((record) => firstIds.has(record.id)),
    false,
  );
  assert.equal(new Set([...first, ...second].map((record) => record.id)).size, 3);
});

test('an expired lease is recovered and the stale worker cannot acknowledge it', async () => {
  const repository = createMemoryOutboxRepository({ events: [event(1)] });
  const [initial] = await claim(repository, 'worker-a', START, 1, 1_000);
  assert.equal(initial.attemptCount, 1);
  assert.equal((await claim(repository, 'worker-b', new Date(START.getTime() + 999), 1)).length, 0);

  const recoveredAt = new Date(START.getTime() + 1_000);
  const [recovered] = await claim(repository, 'worker-b', recoveredAt, 1);
  assert.equal(recovered.id, initial.id);
  assert.equal(recovered.attemptCount, 2);
  await assert.rejects(
    repository.complete({
      completedAt: recoveredAt,
      eventId: initial.id,
      workerId: 'worker-a',
    }),
    (error) => error.code === OUTBOX_ERROR_CODE.LEASE_LOST,
  );

  const completedAt = new Date(recoveredAt.getTime() + 1);
  const completed = await repository.complete({
    completedAt,
    eventId: recovered.id,
    workerId: 'worker-b',
  });
  assert.equal(completed.processedAt.toISOString(), completedAt.toISOString());
  assert.equal(
    (await claim(repository, 'worker-c', new Date(START.getTime() + 5_000), 1)).length,
    0,
  );
});

test('the worker retries with bounded deterministic backoff and eventually completes', async () => {
  let now = new Date(START);
  let calls = 0;
  const logs = [];
  const repository = createMemoryOutboxRepository({
    events: [event(1, { payload: { secret: 'must-not-appear-in-logs' } })],
  });
  const worker = createOutboxWorker({
    backoffBaseMs: 100,
    backoffMaximumMs: 250,
    clock: () => new Date(now),
    handle: async () => {
      calls += 1;
      if (calls < 3) throw new Error('provider details must not be logged');
    },
    leaseMs: 1_000,
    logger: {
      info: (name, fields) => logs.push({ fields, name }),
      warn: (name, fields) => logs.push({ fields, name }),
    },
    maximumAttempts: 4,
    repository,
    workerId: 'worker-a',
  });

  assert.deepEqual(await worker.processBatch(), {
    claimed: 1,
    completed: 0,
    failed: 0,
    retried: 1,
  });
  assert.equal((await repository.getById('event-1')).availableAt.getTime(), START.getTime() + 100);
  assert.deepEqual(await worker.processBatch(), {
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
  });
  now = new Date(START.getTime() + 100);
  assert.deepEqual(await worker.processBatch(), {
    claimed: 1,
    completed: 0,
    failed: 0,
    retried: 1,
  });
  assert.equal((await repository.getById('event-1')).availableAt.getTime(), START.getTime() + 300);
  now = new Date(START.getTime() + 300);
  assert.deepEqual(await worker.processBatch(), {
    claimed: 1,
    completed: 1,
    failed: 0,
    retried: 0,
  });
  assert.equal((await repository.getById('event-1')).attemptCount, 3);
  assert.equal(JSON.stringify(logs).includes('must-not-appear-in-logs'), false);
  assert.equal(JSON.stringify(logs).includes('provider details'), false);
  assert.equal(boundedExponentialBackoffMs({ attempt: 20, baseMs: 100, maximumMs: 250 }), 250);
});

test('the worker records a stable terminal failure after the maximum attempts', async () => {
  let now = new Date(START);
  const repository = createMemoryOutboxRepository({ events: [event(1)] });
  const worker = createOutboxWorker({
    backoffBaseMs: 100,
    clock: () => new Date(now),
    handle: async () => {
      throw new Error('changing upstream failure text');
    },
    leaseMs: 1_000,
    maximumAttempts: 2,
    repository,
    workerId: 'worker-a',
  });

  assert.equal((await worker.processBatch()).retried, 1);
  now = new Date(START.getTime() + 100);
  assert.deepEqual(await worker.processBatch(), {
    claimed: 1,
    completed: 0,
    failed: 1,
    retried: 0,
  });
  const failed = await repository.getById('event-1');
  assert.equal(failed.lastErrorCode, OUTBOX_ERROR_CODE.HANDLER_FAILED);
  assert.equal(failed.failedAt.toISOString(), now.toISOString());
  now = new Date(START.getTime() + 10_000);
  assert.equal((await worker.processBatch()).claimed, 0);
});

test('completion is idempotent and claimed batches are strictly bounded', async () => {
  const repository = createMemoryOutboxRepository({
    events: Array.from({ length: MAX_CLAIM_BATCH_SIZE + 1 }, (_, index) => event(index + 1)),
  });
  const claimed = await claim(repository, 'worker-a', START, MAX_CLAIM_BATCH_SIZE);
  assert.equal(claimed.length, MAX_CLAIM_BATCH_SIZE);
  await assert.rejects(
    claim(repository, 'worker-b', START, MAX_CLAIM_BATCH_SIZE + 1),
    (error) => error.code === OUTBOX_ERROR_CODE.INVALID_CONFIGURATION,
  );

  const completedAt = new Date(START.getTime() + 1);
  const first = await repository.complete({
    completedAt,
    eventId: claimed[0].id,
    workerId: 'worker-a',
  });
  const second = await repository.complete({
    completedAt: new Date(START.getTime() + 2),
    eventId: claimed[0].id,
    workerId: 'another-worker',
  });
  assert.equal(first.processedAt.toISOString(), second.processedAt.toISOString());
});

test('PostgreSQL claims are transactional, bounded, leased, and parameterized', async () => {
  const leasedUntil = new Date(START.getTime() + 30_000);
  const row = databaseEventRow({
    attempt_count: 2,
    job_run_id: '00000000-0000-4000-8000-000000000102',
    leased_until: leasedUntil,
    worker_id: "worker-a'; SELECT pg_sleep(10); --",
  });
  const { pool, state } = createFakePool([{ match: /WITH candidates AS/, rows: [row] }]);
  const repository = createPostgresOutboxRepository(pool);
  const workerId = row.worker_id;
  const claimed = await repository.claimBatch({
    leaseUntil: leasedUntil,
    limit: 7,
    now: START,
    workerId,
  });

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].attemptCount, 2);
  assert.equal(claimed[0].jobRunId, row.job_run_id);
  assert.deepEqual(
    state.calls.map((call) =>
      call.text === 'BEGIN' || call.text === 'COMMIT' ? call.text : 'CLAIM',
    ),
    ['BEGIN', 'CLAIM', 'COMMIT'],
  );
  const query = state.calls[1];
  assert.match(query.text, /FOR UPDATE OF oe SKIP LOCKED/);
  assert.match(query.text, /SET state = \$8::job_state/);
  assert.match(query.text, /attempt_count = oe\.attempt_count \+ 1/);
  assert.match(query.text, /INSERT INTO job_runs/);
  assert.equal(query.text.includes(workerId), false);
  assert.deepEqual(query.params, [
    START,
    7,
    leasedUntil,
    workerId,
    'outbox_dispatch',
    OUTBOX_ERROR_CODE.LEASE_EXPIRED,
    'running',
    'failed',
  ]);
  assert.equal(state.releases, 1);
  state.assertConsumed();
});

test('PostgreSQL completion locks the current attempt and is idempotent once processed', async () => {
  const completedAt = new Date(START.getTime() + 100);
  const eventRow = databaseEventRow();
  const processedRow = databaseEventRow({ processed_at: completedAt });
  const firstFake = createFakePool([
    { match: /FROM outbox_events[\s\S]*FOR UPDATE/, rows: [eventRow] },
    { match: /FROM job_runs[\s\S]*FOR UPDATE/, rows: [databaseJobRow()] },
    { match: /UPDATE job_runs/, rows: [{ id: databaseJobRow().id }] },
    { match: /SET processed_at = \$2/, rows: [processedRow] },
  ]);
  const repository = createPostgresOutboxRepository(firstFake.pool);
  const completed = await repository.complete({
    completedAt,
    eventId: eventRow.id,
    workerId: 'worker-a',
  });
  assert.equal(completed.processedAt.toISOString(), completedAt.toISOString());
  assert.deepEqual(firstFake.state.calls[2].params, [eventRow.id, 'outbox_dispatch', 1]);
  assert.equal(firstFake.state.calls[3].params[1], 'succeeded');
  assert.equal(firstFake.state.calls[3].params[4], 'running');
  assert.equal(firstFake.state.calls[3].text.includes('worker-a'), false);
  assert.equal(firstFake.state.calls[4].params[2], 1);
  firstFake.state.assertConsumed();

  const secondFake = createFakePool([
    { match: /FROM outbox_events[\s\S]*FOR UPDATE/, rows: [processedRow] },
  ]);
  const idempotentRepository = createPostgresOutboxRepository(secondFake.pool);
  const repeated = await idempotentRepository.complete({
    completedAt: new Date(completedAt.getTime() + 1),
    eventId: eventRow.id,
    workerId: 'another-worker',
  });
  assert.equal(repeated.processedAt.toISOString(), completedAt.toISOString());
  assert.deepEqual(
    secondFake.state.calls.map((call) => call.text),
    ['BEGIN', secondFake.state.calls[1].text, 'COMMIT'],
  );
  secondFake.state.assertConsumed();
});

test('PostgreSQL retry and terminal failure persist matching job and event states', async () => {
  const failedAt = new Date(START.getTime() + 100);
  const availableAt = new Date(START.getTime() + 500);
  const retryRow = databaseEventRow({
    available_at: availableAt,
    last_error_code: OUTBOX_ERROR_CODE.HANDLER_FAILED,
  });
  const retryFake = createFakePool([
    { match: /FROM outbox_events[\s\S]*FOR UPDATE/, rows: [databaseEventRow()] },
    { match: /FROM job_runs[\s\S]*FOR UPDATE/, rows: [databaseJobRow()] },
    { match: /UPDATE job_runs/, rows: [{ id: databaseJobRow().id }] },
    { match: /SET available_at = \$2/, rows: [retryRow] },
  ]);
  const retryRepository = createPostgresOutboxRepository(retryFake.pool);
  const retried = await retryRepository.retry({
    availableAt,
    errorCode: OUTBOX_ERROR_CODE.HANDLER_FAILED,
    eventId: retryRow.id,
    failedAt,
    workerId: 'worker-a',
  });
  assert.equal(retried.availableAt.toISOString(), availableAt.toISOString());
  assert.equal(retryFake.state.calls[3].params[1], 'failed');
  assert.equal(retryFake.state.calls[4].params[2], OUTBOX_ERROR_CODE.HANDLER_FAILED);
  assert.equal(retryFake.state.calls[4].params[3], 1);
  retryFake.state.assertConsumed();

  const terminalRow = databaseEventRow({
    last_error_code: OUTBOX_ERROR_CODE.HANDLER_FAILED,
    processed_at: failedAt,
  });
  const failFake = createFakePool([
    { match: /FROM outbox_events[\s\S]*FOR UPDATE/, rows: [databaseEventRow()] },
    { match: /FROM job_runs[\s\S]*FOR UPDATE/, rows: [databaseJobRow()] },
    { match: /UPDATE job_runs/, rows: [{ id: databaseJobRow().id }] },
    { match: /SET processed_at = \$2/, rows: [terminalRow] },
  ]);
  const failRepository = createPostgresOutboxRepository(failFake.pool);
  const failed = await failRepository.fail({
    errorCode: OUTBOX_ERROR_CODE.HANDLER_FAILED,
    eventId: terminalRow.id,
    failedAt,
    workerId: 'worker-a',
  });
  assert.equal(failed.processedAt.toISOString(), failedAt.toISOString());
  assert.equal(failFake.state.calls[3].params[1], 'dead');
  assert.equal(failFake.state.calls[4].params[2], OUTBOX_ERROR_CODE.HANDLER_FAILED);
  failFake.state.assertConsumed();
});

test('PostgreSQL rejects a stale lease and rolls the transition back', async () => {
  const failedAt = new Date(START.getTime() + 100);
  const { pool, state } = createFakePool([
    { match: /FROM outbox_events[\s\S]*FOR UPDATE/, rows: [databaseEventRow()] },
    {
      match: /FROM job_runs[\s\S]*FOR UPDATE/,
      rows: [databaseJobRow({ leased_until: failedAt })],
    },
  ]);
  const repository = createPostgresOutboxRepository(pool);
  await assert.rejects(
    repository.fail({
      errorCode: OUTBOX_ERROR_CODE.HANDLER_FAILED,
      eventId: databaseEventRow().id,
      failedAt,
      workerId: 'worker-a',
    }),
    (error) => error.code === OUTBOX_ERROR_CODE.LEASE_LOST,
  );
  assert.equal(state.calls.at(-1).text, 'ROLLBACK');
  assert.equal(
    state.calls.some((call) => call.text === 'COMMIT'),
    false,
  );
  assert.equal(state.releases, 1);
  state.assertConsumed();
});

test('PostgreSQL append parameterizes event data and JSON payloads', async () => {
  const eventType = "test.requested'; DROP TABLE outbox_events; --";
  const payload = { privateValue: 'never interpolate me' };
  const row = databaseEventRow({ event_type: eventType, payload });
  const { pool, state } = createFakePool([{ match: /INSERT INTO outbox_events/, rows: [row] }]);
  const repository = createPostgresOutboxRepository(pool);
  const appended = await repository.append({
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    availableAt: START,
    createdAt: START,
    eventType,
    id: row.id,
    payload,
  });
  assert.equal(appended.eventType, eventType);
  assert.equal(state.calls[0].source, 'pool');
  assert.equal(state.calls[0].text.includes(eventType), false);
  assert.equal(state.calls[0].text.includes(payload.privateValue), false);
  assert.equal(state.calls[0].params[3], eventType);
  assert.equal(state.calls[0].params[5], JSON.stringify(payload));
  state.assertConsumed();
});
