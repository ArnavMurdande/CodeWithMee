'use strict';

const { randomUUID } = require('node:crypto');

const MAX_CLAIM_BATCH_SIZE = 100;
const POSTGRES_OUTBOX_JOB_TYPE = 'outbox_dispatch';
const OUTBOX_ERROR_CODE = Object.freeze({
  DUPLICATE_EVENT_ID: 'outbox_duplicate_event_id',
  EVENT_NOT_FOUND: 'outbox_event_not_found',
  HANDLER_FAILED: 'outbox_handler_failed',
  INVALID_CONFIGURATION: 'outbox_invalid_configuration',
  INVALID_EVENT: 'outbox_invalid_event',
  LEASE_EXPIRED: 'outbox_lease_expired',
  LEASE_LOST: 'outbox_lease_lost',
});

class OutboxError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = 'OutboxError';
  }
}

function configurationError() {
  return new OutboxError(OUTBOX_ERROR_CODE.INVALID_CONFIGURATION);
}

function assertDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw configurationError();
}

function assertPositiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw configurationError();
}

function assertWorkerId(workerId) {
  if (typeof workerId !== 'string' || !workerId.trim() || workerId.length > 160) {
    throw configurationError();
  }
}

function assertErrorCode(errorCode) {
  if (typeof errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,119}$/.test(errorCode)) {
    throw configurationError();
  }
}

function boundedExponentialBackoffMs({ attempt, baseMs, maximumMs }) {
  assertPositiveInteger(attempt);
  assertPositiveInteger(baseMs);
  assertPositiveInteger(maximumMs);
  if (baseMs > maximumMs) throw configurationError();
  const multiplier = 2 ** Math.min(attempt - 1, 52);
  return Math.min(maximumMs, baseMs * multiplier);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function toDate(value) {
  if (value == null) return null;
  return value instanceof Date ? new Date(value) : new Date(String(value));
}

function toPostgresRecord(row) {
  if (!row) return null;
  return Object.freeze({
    aggregateId: row.aggregate_id,
    aggregateType: row.aggregate_type,
    attemptCount: Number(row.attempt_count),
    availableAt: toDate(row.available_at),
    createdAt: toDate(row.created_at),
    eventType: row.event_type,
    eventVersion: Number(row.event_version),
    failedAt: null,
    id: row.id,
    jobRunId: row.job_run_id || null,
    lastErrorCode: row.last_error_code,
    leasedUntil: toDate(row.leased_until),
    payload: clone(row.payload),
    processedAt: toDate(row.processed_at),
    workerId: row.worker_id || null,
  });
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function createMemoryOutboxRepository({
  clock = () => new Date(),
  events = [],
  idFactory = randomUUID,
} = {}) {
  const records = new Map();

  function requireRecord(eventId) {
    const record = records.get(eventId);
    if (!record) throw new OutboxError(OUTBOX_ERROR_CODE.EVENT_NOT_FOUND);
    return record;
  }

  function activeLease(record, workerId, timestamp) {
    if (
      record.workerId !== workerId ||
      !(record.leasedUntil instanceof Date) ||
      record.leasedUntil.getTime() <= timestamp.getTime()
    ) {
      throw new OutboxError(OUTBOX_ERROR_CODE.LEASE_LOST);
    }
  }

  function insert(input = {}) {
    const timestamp = input.createdAt || clock();
    const availableAt = input.availableAt || timestamp;
    assertDate(timestamp);
    assertDate(availableAt);
    const id = input.id || idFactory();
    if (
      typeof id !== 'string' ||
      !id ||
      typeof input.aggregateType !== 'string' ||
      !input.aggregateType ||
      typeof input.aggregateId !== 'string' ||
      !input.aggregateId ||
      typeof input.eventType !== 'string' ||
      !input.eventType
    ) {
      throw new OutboxError(OUTBOX_ERROR_CODE.INVALID_EVENT);
    }
    if (records.has(id)) throw new OutboxError(OUTBOX_ERROR_CODE.DUPLICATE_EVENT_ID);
    const eventVersion = input.eventVersion ?? 1;
    if (!Number.isSafeInteger(eventVersion) || eventVersion < 1) {
      throw new OutboxError(OUTBOX_ERROR_CODE.INVALID_EVENT);
    }
    let payload;
    try {
      payload = clone(input.payload ?? {});
    } catch {
      throw new OutboxError(OUTBOX_ERROR_CODE.INVALID_EVENT);
    }
    const record = {
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      attemptCount: 0,
      availableAt: new Date(availableAt),
      createdAt: new Date(timestamp),
      eventType: input.eventType,
      eventVersion,
      failedAt: null,
      id,
      lastErrorCode: null,
      leasedUntil: null,
      payload,
      processedAt: null,
      workerId: null,
    };
    records.set(id, record);
    return clone(record);
  }

  for (const event of events) insert(event);

  return Object.freeze({
    async append(event) {
      return insert(event);
    },

    async claimBatch({ leaseUntil, limit, now, workerId }) {
      assertWorkerId(workerId);
      assertPositiveInteger(limit, MAX_CLAIM_BATCH_SIZE);
      assertDate(now);
      assertDate(leaseUntil);
      if (leaseUntil.getTime() <= now.getTime()) throw configurationError();
      const eligible = [...records.values()]
        .filter(
          (record) =>
            !record.processedAt &&
            record.availableAt.getTime() <= now.getTime() &&
            (!record.leasedUntil || record.leasedUntil.getTime() <= now.getTime()),
        )
        .sort(
          (left, right) =>
            left.availableAt - right.availableAt ||
            left.createdAt - right.createdAt ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit);
      for (const record of eligible) {
        record.attemptCount += 1;
        record.leasedUntil = new Date(leaseUntil);
        record.workerId = workerId;
      }
      return clone(eligible);
    },

    async complete({ completedAt, eventId, workerId }) {
      assertWorkerId(workerId);
      assertDate(completedAt);
      const record = requireRecord(eventId);
      if (record.processedAt) return clone(record);
      activeLease(record, workerId, completedAt);
      record.processedAt = new Date(completedAt);
      record.lastErrorCode = null;
      record.leasedUntil = null;
      record.workerId = null;
      return clone(record);
    },

    async fail({ errorCode, eventId, failedAt, workerId }) {
      assertWorkerId(workerId);
      assertErrorCode(errorCode);
      assertDate(failedAt);
      const record = requireRecord(eventId);
      if (record.processedAt) return clone(record);
      activeLease(record, workerId, failedAt);
      record.failedAt = new Date(failedAt);
      record.lastErrorCode = errorCode;
      record.leasedUntil = null;
      record.processedAt = new Date(failedAt);
      record.workerId = null;
      return clone(record);
    },

    async getById(eventId) {
      return clone(records.get(eventId));
    },

    async list() {
      return clone([...records.values()]);
    },

    async retry({ availableAt, errorCode, eventId, failedAt, workerId }) {
      assertWorkerId(workerId);
      assertErrorCode(errorCode);
      assertDate(failedAt);
      assertDate(availableAt);
      if (availableAt.getTime() <= failedAt.getTime()) throw configurationError();
      const record = requireRecord(eventId);
      if (record.processedAt) return clone(record);
      activeLease(record, workerId, failedAt);
      record.availableAt = new Date(availableAt);
      record.lastErrorCode = errorCode;
      record.leasedUntil = null;
      record.workerId = null;
      return clone(record);
    },
  });
}

function createPostgresOutboxRepository(pool) {
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') {
    throw configurationError();
  }

  async function lockCurrentAttempt(client, { eventId, timestamp, workerId }) {
    const eventResult = await client.query(
      `SELECT *
       FROM outbox_events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );
    const event = eventResult.rows[0];
    if (!event) throw new OutboxError(OUTBOX_ERROR_CODE.EVENT_NOT_FOUND);
    if (event.processed_at) return Object.freeze({ event, jobRun: null, processed: true });
    const jobResult = await client.query(
      `SELECT *
       FROM job_runs
       WHERE outbox_event_id = $1
         AND job_type = $2
         AND attempt = $3
       ORDER BY created_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [eventId, POSTGRES_OUTBOX_JOB_TYPE, Number(event.attempt_count)],
    );
    const jobRun = jobResult.rows[0];
    const leasedUntil = toDate(jobRun?.leased_until);
    if (
      !jobRun ||
      jobRun.state !== 'running' ||
      jobRun.worker_id !== workerId ||
      !leasedUntil ||
      Number.isNaN(leasedUntil.getTime()) ||
      leasedUntil.getTime() <= timestamp.getTime()
    ) {
      throw new OutboxError(OUTBOX_ERROR_CODE.LEASE_LOST);
    }
    return Object.freeze({ event, jobRun, processed: false });
  }

  async function transition({
    availableAt = null,
    errorCode = null,
    eventId,
    jobState,
    timestamp,
    workerId,
  }) {
    assertWorkerId(workerId);
    assertDate(timestamp);
    if (errorCode) assertErrorCode(errorCode);
    if (availableAt) {
      assertDate(availableAt);
      if (availableAt.getTime() <= timestamp.getTime()) throw configurationError();
    }
    return withTransaction(pool, async (client) => {
      const locked = await lockCurrentAttempt(client, { eventId, timestamp, workerId });
      if (locked.processed) return toPostgresRecord(locked.event);
      const jobResult = await client.query(
        `UPDATE job_runs
         SET state = $2::job_state,
             leased_until = NULL,
             error_code = $3,
             error_summary = NULL,
             finished_at = $4,
             updated_at = $4
         WHERE id = $1
           AND state = $5::job_state
           AND worker_id = $6
           AND leased_until > $4
         RETURNING id`,
        [locked.jobRun.id, jobState, errorCode, timestamp, 'running', workerId],
      );
      if (jobResult.rows.length !== 1) throw new OutboxError(OUTBOX_ERROR_CODE.LEASE_LOST);

      let eventResult;
      if (jobState === 'succeeded') {
        eventResult = await client.query(
          `UPDATE outbox_events
           SET processed_at = $2,
               last_error_code = NULL
           WHERE id = $1
             AND processed_at IS NULL
             AND attempt_count = $3
           RETURNING *`,
          [eventId, timestamp, Number(locked.event.attempt_count)],
        );
      } else if (jobState === 'failed') {
        eventResult = await client.query(
          `UPDATE outbox_events
           SET available_at = $2,
               last_error_code = $3
           WHERE id = $1
             AND processed_at IS NULL
             AND attempt_count = $4
           RETURNING *`,
          [eventId, availableAt, errorCode, Number(locked.event.attempt_count)],
        );
      } else {
        eventResult = await client.query(
          `UPDATE outbox_events
           SET processed_at = $2,
               last_error_code = $3
           WHERE id = $1
             AND processed_at IS NULL
             AND attempt_count = $4
           RETURNING *`,
          [eventId, timestamp, errorCode, Number(locked.event.attempt_count)],
        );
      }
      if (eventResult.rows.length !== 1) throw new OutboxError(OUTBOX_ERROR_CODE.LEASE_LOST);
      return toPostgresRecord(eventResult.rows[0]);
    });
  }

  return Object.freeze({
    async append(input = {}) {
      const createdAt = input.createdAt || new Date();
      const availableAt = input.availableAt || createdAt;
      assertDate(createdAt);
      assertDate(availableAt);
      const eventVersion = input.eventVersion ?? 1;
      if (
        typeof input.aggregateType !== 'string' ||
        !input.aggregateType ||
        typeof input.aggregateId !== 'string' ||
        !input.aggregateId ||
        typeof input.eventType !== 'string' ||
        !input.eventType ||
        !Number.isSafeInteger(eventVersion) ||
        eventVersion < 1 ||
        !input.payload ||
        typeof input.payload !== 'object' ||
        Array.isArray(input.payload)
      ) {
        throw new OutboxError(OUTBOX_ERROR_CODE.INVALID_EVENT);
      }
      let serializedPayload;
      try {
        serializedPayload = JSON.stringify(input.payload);
      } catch {
        throw new OutboxError(OUTBOX_ERROR_CODE.INVALID_EVENT);
      }
      const hasId = typeof input.id === 'string' && Boolean(input.id);
      const result = hasId
        ? await pool.query(
            `INSERT INTO outbox_events
               (id, aggregate_type, aggregate_id, event_type, event_version, payload,
                available_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
             RETURNING *`,
            [
              input.id,
              input.aggregateType,
              input.aggregateId,
              input.eventType,
              eventVersion,
              serializedPayload,
              availableAt,
              createdAt,
            ],
          )
        : await pool.query(
            `INSERT INTO outbox_events
               (aggregate_type, aggregate_id, event_type, event_version, payload,
                available_at, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
             RETURNING *`,
            [
              input.aggregateType,
              input.aggregateId,
              input.eventType,
              eventVersion,
              serializedPayload,
              availableAt,
              createdAt,
            ],
          );
      return toPostgresRecord(result.rows[0]);
    },

    async claimBatch({ leaseUntil, limit, now, workerId }) {
      assertWorkerId(workerId);
      assertPositiveInteger(limit, MAX_CLAIM_BATCH_SIZE);
      assertDate(now);
      assertDate(leaseUntil);
      if (leaseUntil.getTime() <= now.getTime()) throw configurationError();
      return withTransaction(pool, async (client) => {
        const result = await client.query(
          `WITH candidates AS (
             SELECT oe.id
             FROM outbox_events AS oe
             WHERE oe.processed_at IS NULL
               AND oe.available_at <= $1
               AND NOT EXISTS (
                 SELECT 1
                 FROM job_runs AS active_job
                 WHERE active_job.outbox_event_id = oe.id
                   AND active_job.state = $7::job_state
                   AND active_job.leased_until > $1
               )
             ORDER BY oe.available_at, oe.created_at, oe.id
             LIMIT $2
             FOR UPDATE OF oe SKIP LOCKED
           ), expired AS (
             UPDATE job_runs AS expired_job
             SET state = $8::job_state,
                 leased_until = NULL,
                 error_code = $6,
                 error_summary = NULL,
                 finished_at = $1,
                 updated_at = $1
             WHERE expired_job.outbox_event_id IN (SELECT id FROM candidates)
               AND expired_job.state = $7::job_state
               AND expired_job.leased_until <= $1
             RETURNING expired_job.id
           ), claimed AS (
             UPDATE outbox_events AS oe
             SET attempt_count = oe.attempt_count + 1
             FROM candidates
             WHERE oe.id = candidates.id
             RETURNING oe.*
           ), runs AS (
             INSERT INTO job_runs
               (outbox_event_id, job_type, source_key, state, attempt, leased_until,
                worker_id, started_at, created_at, updated_at)
             SELECT claimed.id, $5, claimed.id::text, $7::job_state,
                    claimed.attempt_count, $3, $4, $1, $1, $1
             FROM claimed
             CROSS JOIN (SELECT COUNT(*) AS recovered_count FROM expired) AS recovery
             RETURNING id, outbox_event_id, leased_until, worker_id
           )
           SELECT claimed.*, runs.id AS job_run_id, runs.leased_until, runs.worker_id
           FROM claimed
           INNER JOIN runs ON runs.outbox_event_id = claimed.id
           ORDER BY claimed.available_at, claimed.created_at, claimed.id`,
          [
            now,
            limit,
            leaseUntil,
            workerId,
            POSTGRES_OUTBOX_JOB_TYPE,
            OUTBOX_ERROR_CODE.LEASE_EXPIRED,
            'running',
            'failed',
          ],
        );
        return result.rows.map(toPostgresRecord);
      });
    },

    async complete({ completedAt, eventId, workerId }) {
      return transition({ eventId, jobState: 'succeeded', timestamp: completedAt, workerId });
    },

    async fail({ errorCode, eventId, failedAt, workerId }) {
      return transition({
        errorCode,
        eventId,
        jobState: 'dead',
        timestamp: failedAt,
        workerId,
      });
    },

    async retry({ availableAt, errorCode, eventId, failedAt, workerId }) {
      return transition({
        availableAt,
        errorCode,
        eventId,
        jobState: 'failed',
        timestamp: failedAt,
        workerId,
      });
    },
  });
}

function createOutboxWorker({
  backoffBaseMs = 1_000,
  backoffMaximumMs = 300_000,
  batchSize = 25,
  clock = () => new Date(),
  handle,
  leaseMs = 30_000,
  logger = Object.freeze({ info() {}, warn() {} }),
  maximumAttempts = 5,
  repository,
  telemetry,
  workerId,
}) {
  assertWorkerId(workerId);
  assertPositiveInteger(batchSize, MAX_CLAIM_BATCH_SIZE);
  assertPositiveInteger(leaseMs);
  assertPositiveInteger(maximumAttempts);
  assertPositiveInteger(backoffBaseMs);
  assertPositiveInteger(backoffMaximumMs);
  if (
    backoffBaseMs > backoffMaximumMs ||
    typeof handle !== 'function' ||
    !repository ||
    !['claimBatch', 'complete', 'retry', 'fail'].every(
      (method) => typeof repository[method] === 'function',
    )
  ) {
    throw configurationError();
  }

  function log(level, event, fields) {
    if (typeof logger[level] === 'function') logger[level](event, Object.freeze(fields));
  }

  return Object.freeze({
    async processBatch() {
      const claimTime = clock();
      assertDate(claimTime);
      const claimed = await repository.claimBatch({
        leaseUntil: new Date(claimTime.getTime() + leaseMs),
        limit: batchSize,
        now: claimTime,
        workerId,
      });
      const summary = { claimed: claimed.length, completed: 0, failed: 0, retried: 0 };
      for (const event of claimed) {
        try {
          await handle(event);
        } catch {
          const failedAt = clock();
          const errorCode = OUTBOX_ERROR_CODE.HANDLER_FAILED;
          if (event.attemptCount >= maximumAttempts) {
            await repository.fail({ errorCode, eventId: event.id, failedAt, workerId });
            summary.failed += 1;
            log('warn', 'outbox_event_failed', {
              attempt: event.attemptCount,
              code: errorCode,
              eventId: event.id,
              eventType: event.eventType,
            });
          } else {
            const delayMs = boundedExponentialBackoffMs({
              attempt: event.attemptCount,
              baseMs: backoffBaseMs,
              maximumMs: backoffMaximumMs,
            });
            await repository.retry({
              availableAt: new Date(failedAt.getTime() + delayMs),
              errorCode,
              eventId: event.id,
              failedAt,
              workerId,
            });
            summary.retried += 1;
            log('warn', 'outbox_event_retry_scheduled', {
              attempt: event.attemptCount,
              code: errorCode,
              delayMs,
              eventId: event.id,
              eventType: event.eventType,
            });
          }
          continue;
        }
        const completedAt = clock();
        await repository.complete({ completedAt, eventId: event.id, workerId });
        summary.completed += 1;
        log('info', 'outbox_event_completed', {
          attempt: event.attemptCount,
          eventId: event.id,
          eventType: event.eventType,
        });
      }
      telemetry?.recordJob?.(summary);
      return Object.freeze(summary);
    },
  });
}

module.exports = {
  MAX_CLAIM_BATCH_SIZE,
  OUTBOX_ERROR_CODE,
  OutboxError,
  boundedExponentialBackoffMs,
  createMemoryOutboxRepository,
  createOutboxWorker,
  createPostgresOutboxRepository,
};
