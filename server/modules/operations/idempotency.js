'use strict';

const { createHash, randomUUID } = require('node:crypto');

const IDEMPOTENCY_OUTCOME = Object.freeze({
  ACQUIRED: 'acquired',
  CONFLICT: 'conflict',
  IN_PROGRESS: 'in_progress',
  REPLAY: 'replay',
});

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_ENTRIES = 50_000;
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_LEASE_TTL_MS = 1000;
const MAX_LEASE_TTL_MS = 15 * 60 * 1000;
const MAX_JSON_DEPTH = 32;
const MAX_CONFIGURED_BYTES = 1024 * 1024;
const HANDLE_BRAND = Symbol('codewithmee.idempotency-handle');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FORBIDDEN_RESPONSE_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'csrftoken',
  'password',
  'passwordhash',
  'privatekey',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
  'tokenhash',
]);

function idempotencyError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function integerOption(value, { defaultValue, maximum, minimum, name }) {
  const resolved = value === undefined ? defaultValue : value;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function assertUnicodeScalarString(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} must contain valid Unicode.`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} must contain valid Unicode.`);
    }
  }
}

function serializeCanonicalJson(value, state, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new TypeError('JSON exceeds the maximum nesting depth.');
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite.');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'string':
      assertUnicodeScalarString(value, 'JSON strings');
      return JSON.stringify(value);
    case 'object': {
      if (state.seen.has(value)) throw new TypeError('JSON must not contain cycles.');
      state.seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map((item) => serializeCanonicalJson(item, state, depth + 1)).join(',')}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError('JSON objects must be plain objects.');
        }
        const keys = Object.keys(value).sort();
        const fields = keys.map((key) => {
          assertUnicodeScalarString(key, 'JSON object keys');
          return `${JSON.stringify(key)}:${serializeCanonicalJson(value[key], state, depth + 1)}`;
        });
        return `{${fields.join(',')}}`;
      } finally {
        state.seen.delete(value);
      }
    }
    default:
      throw new TypeError('Values must be JSON-compatible.');
  }
}

function canonicalizeJson(value, { maxBytes = DEFAULT_MAX_REQUEST_BYTES } = {}) {
  const byteLimit = integerOption(maxBytes, {
    defaultValue: DEFAULT_MAX_REQUEST_BYTES,
    maximum: MAX_CONFIGURED_BYTES,
    minimum: 1024,
    name: 'maxBytes',
  });
  const serialized = serializeCanonicalJson(value, { seen: new Set() });
  if (Buffer.byteLength(serialized, 'utf8') > byteLimit) {
    throw idempotencyError(
      'idempotency_payload_too_large',
      'Canonical JSON exceeds the limit.',
      413,
    );
  }
  return serialized;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalRequestSha256(request, options) {
  return sha256(canonicalizeJson(request, options));
}

function assertScopedString(value, { label, maxLength, minLength = 1, pattern }) {
  if (
    typeof value !== 'string' ||
    value.length < minLength ||
    value.length > maxLength ||
    value.trim() !== value ||
    (pattern && !pattern.test(value))
  ) {
    throw idempotencyError('invalid_idempotency_scope', `${label} is invalid.`, 400);
  }
}

function idempotencyScopeSha256({ actorId, key, operationId }) {
  assertScopedString(actorId, { label: 'actorId', maxLength: 200 });
  assertScopedString(operationId, {
    label: 'operationId',
    maxLength: 128,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  });
  assertScopedString(key, {
    label: 'key',
    maxLength: 128,
    minLength: 16,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  });
  return sha256(canonicalizeJson({ actorId, key, operationId }, { maxBytes: 4096 }));
}

function normalizedSecretKey(key) {
  return key.replace(/[-_]/g, '').toLowerCase();
}

function assertResponseContainsNoSecrets(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertResponseContainsNoSecrets(item, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RESPONSE_KEYS.has(normalizedSecretKey(key))) {
      throw idempotencyError(
        'unsafe_idempotency_response',
        'Idempotency responses must not contain secrets.',
        500,
      );
    }
    assertResponseContainsNoSecrets(child, seen);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sanitizeResponse(response, maxResponseBytes) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw idempotencyError(
      'invalid_idempotency_response',
      'Response must contain only status and body.',
      500,
    );
  }
  const keys = Object.keys(response).sort();
  if (keys.length !== 2 || keys[0] !== 'body' || keys[1] !== 'status') {
    throw idempotencyError(
      'invalid_idempotency_response',
      'Response must contain only status and body.',
      500,
    );
  }
  if (!Number.isInteger(response.status) || response.status < 200 || response.status > 499) {
    throw idempotencyError(
      'invalid_idempotency_response',
      'Response status must be between 200 and 499.',
      500,
    );
  }
  assertResponseContainsNoSecrets(response.body);
  const canonicalBody = canonicalizeJson(response.body, { maxBytes: maxResponseBytes });
  return deepFreeze({ body: JSON.parse(canonicalBody), status: response.status });
}

function cloneResponse(response, maxResponseBytes) {
  return sanitizeResponse(response, maxResponseBytes);
}

function numericNow(now) {
  const value = now();
  const timestamp = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(timestamp))
    throw new TypeError('now() must return a Date or epoch milliseconds.');
  return Math.trunc(timestamp);
}

function assertRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('An idempotency repository is required.');
  }
  for (const method of ['abandon', 'begin', 'complete']) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`Idempotency repository must implement ${method}().`);
    }
  }
  return repository;
}

class MemoryIdempotencyRepository {
  #entries = new Map();

  #maxEntries;

  constructor({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    this.#maxEntries = integerOption(maxEntries, {
      defaultValue: DEFAULT_MAX_ENTRIES,
      maximum: 100_000,
      minimum: 1,
      name: 'maxEntries',
    });
  }

  get size() {
    return this.#entries.size;
  }

  #removeExpired(now) {
    for (const [scopeHash, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(scopeHash);
    }
  }

  async begin(input) {
    const current = this.#entries.get(input.scopeHash);
    if (current && current.expiresAt <= input.now) this.#entries.delete(input.scopeHash);
    const entry = this.#entries.get(input.scopeHash);

    if (entry) {
      if (entry.requestHash !== input.requestHash) {
        return Object.freeze({ outcome: IDEMPOTENCY_OUTCOME.CONFLICT });
      }
      if (entry.state === 'complete') {
        return Object.freeze({ outcome: IDEMPOTENCY_OUTCOME.REPLAY, response: entry.response });
      }
      if (entry.leaseExpiresAt > input.now) {
        return Object.freeze({
          outcome: IDEMPOTENCY_OUTCOME.IN_PROGRESS,
          retryAfterMs: entry.leaseExpiresAt - input.now,
        });
      }
      entry.leaseExpiresAt = input.leaseExpiresAt;
      entry.leaseId = input.leaseId;
      return Object.freeze({ leaseId: entry.leaseId, outcome: IDEMPOTENCY_OUTCOME.ACQUIRED });
    }

    if (this.#entries.size >= this.#maxEntries) this.#removeExpired(input.now);
    if (this.#entries.size >= this.#maxEntries) {
      throw idempotencyError(
        'idempotency_capacity_exhausted',
        'Idempotency storage is temporarily unavailable.',
        503,
      );
    }
    this.#entries.set(input.scopeHash, {
      expiresAt: input.expiresAt,
      leaseExpiresAt: input.leaseExpiresAt,
      leaseId: input.leaseId,
      requestHash: input.requestHash,
      response: null,
      state: 'pending',
    });
    return Object.freeze({ leaseId: input.leaseId, outcome: IDEMPOTENCY_OUTCOME.ACQUIRED });
  }

  async complete(input) {
    const entry = this.#entries.get(input.scopeHash);
    if (entry && entry.expiresAt <= input.now) this.#entries.delete(input.scopeHash);
    if (
      !this.#entries.has(input.scopeHash) ||
      entry.state !== 'pending' ||
      entry.requestHash !== input.requestHash ||
      entry.leaseId !== input.leaseId
    ) {
      return Object.freeze({ completed: false });
    }
    entry.leaseExpiresAt = null;
    entry.leaseId = null;
    entry.response = input.response;
    entry.state = 'complete';
    return Object.freeze({ completed: true });
  }

  async abandon(input) {
    const entry = this.#entries.get(input.scopeHash);
    if (
      !entry ||
      entry.state !== 'pending' ||
      entry.requestHash !== input.requestHash ||
      entry.leaseId !== input.leaseId
    ) {
      return Object.freeze({ abandoned: false });
    }
    this.#entries.delete(input.scopeHash);
    return Object.freeze({ abandoned: true });
  }
}

function createMemoryIdempotencyRepository(options) {
  return new MemoryIdempotencyRepository(options);
}

const POSTGRES_SQL = Object.freeze({
  abandon: `
    /* idempotency.abandon */
    DELETE FROM "idempotency_keys"
    WHERE "actor_user_id" = $1
      AND "action" = $2
      AND "key" = $3
      AND "request_hash" = $4
      AND "lease_id" = $5
      AND "response_status" IS NULL
    RETURNING "id"
  `,
  beginDeleteExpired: `
    /* idempotency.begin.delete_expired */
    DELETE FROM "idempotency_keys"
    WHERE "actor_user_id" = $1
      AND "action" = $2
      AND "key" = $3
      AND "expires_at" <= $4
  `,
  beginInsert: `
    /* idempotency.begin.insert */
    INSERT INTO "idempotency_keys" (
      "actor_user_id",
      "action",
      "key",
      "request_hash",
      "expires_at",
      "updated_at",
      "lease_id",
      "lease_expires_at"
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT ("actor_user_id", "action", "key") DO NOTHING
    RETURNING "lease_id" AS "leaseId"
  `,
  beginRecoverLease: `
    /* idempotency.begin.recover_lease */
    UPDATE "idempotency_keys"
    SET "lease_id" = $1,
        "lease_expires_at" = $2,
        "updated_at" = $3
    WHERE "actor_user_id" = $4
      AND "action" = $5
      AND "key" = $6
      AND "request_hash" = $7
      AND "response_status" IS NULL
      AND "expires_at" > $3
      AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= $3)
    RETURNING "lease_id" AS "leaseId"
  `,
  beginSelect: `
    /* idempotency.begin.select */
    SELECT "request_hash" AS "requestHash",
           "response_status" AS "responseStatus",
           "response_body" AS "responseBody",
           "lease_id" AS "leaseId",
           "lease_expires_at" AS "leaseExpiresAt"
    FROM "idempotency_keys"
    WHERE "actor_user_id" = $1
      AND "action" = $2
      AND "key" = $3
    FOR UPDATE
  `,
  complete: `
    /* idempotency.complete */
    UPDATE "idempotency_keys"
    SET "response_status" = $6,
        "response_body" = $7::jsonb,
        "lease_id" = NULL,
        "lease_expires_at" = NULL,
        "updated_at" = $8
    WHERE "actor_user_id" = $1
      AND "action" = $2
      AND "key" = $3
      AND "request_hash" = $4
      AND "lease_id" = $5
      AND "response_status" IS NULL
      AND "expires_at" > $8
    RETURNING "id"
  `,
});

function assertPostgresPool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('PostgreSQL idempotency pool must implement connect().');
  }
}

function assertPostgresDigest(value, name) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
  }
}

function assertPostgresScope(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Repository input is required.');
  if (typeof input.actorId !== 'string' || !UUID_PATTERN.test(input.actorId)) {
    throw new TypeError('actorId must be a UUID for PostgreSQL persistence.');
  }
  assertScopedString(input.operationId, {
    label: 'operationId',
    maxLength: 160,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  });
  assertPostgresDigest(input.scopeHash, 'scopeHash');
  assertPostgresDigest(input.requestHash, 'requestHash');
  if (typeof input.leaseId !== 'string' || !UUID_PATTERN.test(input.leaseId)) {
    throw new TypeError('leaseId must be a UUID.');
  }
}

function postgresDate(timestamp, name) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError(`${name} must be non-negative epoch milliseconds.`);
  }
  return new Date(timestamp);
}

function rowTimestamp(value, name) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw idempotencyError(
      'invalid_idempotency_repository_record',
      `PostgreSQL idempotency ${name} is invalid.`,
      500,
    );
  }
  return timestamp;
}

async function connectedClient(pool) {
  const client = await pool.connect();
  if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
    if (client && typeof client.release === 'function') client.release();
    throw new TypeError('PostgreSQL idempotency client must implement query() and release().');
  }
  return client;
}

async function withPostgresClient(pool, work) {
  const client = await connectedClient(pool);
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

async function withPostgresTransaction(pool, work) {
  return withPostgresClient(pool, async (client) => {
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const result = await work(client);
      await client.query('COMMIT');
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the actionable query failure while release discards the broken client.
        }
      }
      throw error;
    }
  });
}

function createPostgresIdempotencyRepository(pool) {
  assertPostgresPool(pool);

  async function begin(input) {
    assertPostgresScope(input);
    const now = postgresDate(input.now, 'now');
    const expiresAt = postgresDate(input.expiresAt, 'expiresAt');
    const leaseExpiresAt = postgresDate(input.leaseExpiresAt, 'leaseExpiresAt');
    if (expiresAt <= now || leaseExpiresAt <= now || leaseExpiresAt > expiresAt) {
      throw new TypeError('PostgreSQL idempotency expiration timestamps are invalid.');
    }

    return withPostgresTransaction(pool, async (client) => {
      const scope = [input.actorId, input.operationId, input.scopeHash];
      await client.query(POSTGRES_SQL.beginDeleteExpired, [...scope, now]);
      const inserted = await client.query(POSTGRES_SQL.beginInsert, [
        ...scope,
        input.requestHash,
        expiresAt,
        now,
        input.leaseId,
        leaseExpiresAt,
      ]);
      if (inserted.rowCount === 1) {
        return Object.freeze({
          leaseId: input.leaseId,
          outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
        });
      }

      const selected = await client.query(POSTGRES_SQL.beginSelect, scope);
      if (selected.rowCount !== 1) {
        throw idempotencyError(
          'invalid_idempotency_repository_record',
          'PostgreSQL idempotency record disappeared during acquisition.',
          500,
        );
      }
      const row = selected.rows[0];
      if (row.requestHash !== input.requestHash) {
        return Object.freeze({ outcome: IDEMPOTENCY_OUTCOME.CONFLICT });
      }
      if (row.responseStatus !== null && row.responseStatus !== undefined) {
        return Object.freeze({
          outcome: IDEMPOTENCY_OUTCOME.REPLAY,
          response: Object.freeze({ body: row.responseBody, status: row.responseStatus }),
        });
      }
      if (row.leaseExpiresAt && rowTimestamp(row.leaseExpiresAt, 'lease expiry') > input.now) {
        return Object.freeze({
          outcome: IDEMPOTENCY_OUTCOME.IN_PROGRESS,
          retryAfterMs: rowTimestamp(row.leaseExpiresAt, 'lease expiry') - input.now,
        });
      }

      const recovered = await client.query(POSTGRES_SQL.beginRecoverLease, [
        input.leaseId,
        leaseExpiresAt,
        now,
        ...scope,
        input.requestHash,
      ]);
      if (recovered.rowCount !== 1) {
        throw idempotencyError(
          'stale_idempotency_lease',
          'PostgreSQL idempotency lease could not be recovered.',
          409,
        );
      }
      return Object.freeze({
        leaseId: input.leaseId,
        outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
      });
    });
  }

  async function complete(input) {
    assertPostgresScope(input);
    const now = postgresDate(input.now, 'now');
    if (
      !input.response ||
      !Number.isInteger(input.response.status) ||
      input.response.status < 200 ||
      input.response.status > 499
    ) {
      throw new TypeError('A sanitized idempotency response is required.');
    }
    const result = await withPostgresClient(pool, (client) =>
      client.query(POSTGRES_SQL.complete, [
        input.actorId,
        input.operationId,
        input.scopeHash,
        input.requestHash,
        input.leaseId,
        input.response.status,
        JSON.stringify(input.response.body),
        now,
      ]),
    );
    return Object.freeze({ completed: result.rowCount === 1 });
  }

  async function abandon(input) {
    assertPostgresScope(input);
    const result = await withPostgresClient(pool, (client) =>
      client.query(POSTGRES_SQL.abandon, [
        input.actorId,
        input.operationId,
        input.scopeHash,
        input.requestHash,
        input.leaseId,
      ]),
    );
    return Object.freeze({ abandoned: result.rowCount === 1 });
  }

  return Object.freeze({ abandon, begin, complete });
}

function createIdempotencyService({
  leaseTtlMs,
  maxRequestBytes,
  maxResponseBytes,
  now = Date.now,
  repository,
  ttlMs,
} = {}) {
  assertRepository(repository);
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  const resolvedTtlMs = integerOption(ttlMs, {
    defaultValue: DEFAULT_IDEMPOTENCY_TTL_MS,
    maximum: MAX_TTL_MS,
    minimum: MIN_TTL_MS,
    name: 'ttlMs',
  });
  const resolvedLeaseTtlMs = integerOption(leaseTtlMs, {
    defaultValue: DEFAULT_LEASE_TTL_MS,
    maximum: Math.min(MAX_LEASE_TTL_MS, resolvedTtlMs),
    minimum: MIN_LEASE_TTL_MS,
    name: 'leaseTtlMs',
  });
  const resolvedMaxRequestBytes = integerOption(maxRequestBytes, {
    defaultValue: DEFAULT_MAX_REQUEST_BYTES,
    maximum: MAX_CONFIGURED_BYTES,
    minimum: 1024,
    name: 'maxRequestBytes',
  });
  const resolvedMaxResponseBytes = integerOption(maxResponseBytes, {
    defaultValue: DEFAULT_MAX_RESPONSE_BYTES,
    maximum: MAX_CONFIGURED_BYTES,
    minimum: 1024,
    name: 'maxResponseBytes',
  });
  const handleState = new WeakMap();

  function assertHandle(handle) {
    if (!handle || handle[HANDLE_BRAND] !== true || !handleState.has(handle)) {
      throw idempotencyError('invalid_idempotency_handle', 'Idempotency handle is invalid.', 500);
    }
    return handleState.get(handle);
  }

  async function abandon(handle) {
    const state = assertHandle(handle);
    return repository.abandon({
      actorId: state.actorId,
      leaseId: state.leaseId,
      operationId: state.operationId,
      requestHash: state.requestHash,
      scopeHash: state.scopeHash,
    });
  }

  async function begin({ actorId, key, operationId, request }) {
    const scopeHash = idempotencyScopeSha256({ actorId, key, operationId });
    const requestHash = canonicalRequestSha256(request, { maxBytes: resolvedMaxRequestBytes });
    const timestamp = numericNow(now);
    const leaseId = randomUUID();
    const result = await repository.begin({
      actorId,
      expiresAt: timestamp + resolvedTtlMs,
      leaseExpiresAt: timestamp + resolvedLeaseTtlMs,
      leaseId,
      now: timestamp,
      operationId,
      requestHash,
      scopeHash,
    });

    if (!result || !Object.values(IDEMPOTENCY_OUTCOME).includes(result.outcome)) {
      throw idempotencyError(
        'invalid_idempotency_repository_result',
        'Idempotency repository returned an invalid outcome.',
        500,
      );
    }
    if (result.outcome === IDEMPOTENCY_OUTCOME.ACQUIRED) {
      if (typeof result.leaseId !== 'string' || result.leaseId.length < 1) {
        throw idempotencyError(
          'invalid_idempotency_repository_result',
          'Idempotency repository returned an invalid lease.',
          500,
        );
      }
      const handle = Object.freeze({ [HANDLE_BRAND]: true });
      handleState.set(handle, {
        actorId,
        leaseId: result.leaseId,
        operationId,
        requestHash,
        scopeHash,
      });
      return Object.freeze({
        expiresAt: timestamp + resolvedTtlMs,
        handle,
        outcome: IDEMPOTENCY_OUTCOME.ACQUIRED,
      });
    }
    if (result.outcome === IDEMPOTENCY_OUTCOME.REPLAY) {
      return Object.freeze({
        outcome: IDEMPOTENCY_OUTCOME.REPLAY,
        response: cloneResponse(result.response, resolvedMaxResponseBytes),
      });
    }
    if (result.outcome === IDEMPOTENCY_OUTCOME.IN_PROGRESS) {
      const retryAfterMs = Number.isSafeInteger(result.retryAfterMs)
        ? Math.max(0, Math.min(result.retryAfterMs, resolvedLeaseTtlMs))
        : resolvedLeaseTtlMs;
      return Object.freeze({ outcome: IDEMPOTENCY_OUTCOME.IN_PROGRESS, retryAfterMs });
    }
    return Object.freeze({ outcome: IDEMPOTENCY_OUTCOME.CONFLICT });
  }

  async function complete(handle, response) {
    const state = assertHandle(handle);
    let sanitized;
    try {
      sanitized = sanitizeResponse(response, resolvedMaxResponseBytes);
    } catch (error) {
      await abandon(handle);
      throw error;
    }
    const result = await repository.complete({
      actorId: state.actorId,
      leaseId: state.leaseId,
      now: numericNow(now),
      operationId: state.operationId,
      requestHash: state.requestHash,
      response: sanitized,
      scopeHash: state.scopeHash,
    });
    if (!result || result.completed !== true) {
      throw idempotencyError(
        'stale_idempotency_lease',
        'Idempotency operation no longer owns the lease.',
        409,
      );
    }
    return sanitized;
  }

  async function execute(input, work) {
    if (typeof work !== 'function') throw new TypeError('work must be a function.');
    const result = await begin(input);
    if (result.outcome !== IDEMPOTENCY_OUTCOME.ACQUIRED) return result;

    let response;
    try {
      response = await work();
    } catch (error) {
      await abandon(result.handle);
      throw error;
    }
    const completedResponse = await complete(result.handle, response);
    return Object.freeze({ outcome: 'completed', response: completedResponse });
  }

  return Object.freeze({ abandon, begin, complete, execute });
}

module.exports = {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  IDEMPOTENCY_OUTCOME,
  MemoryIdempotencyRepository,
  canonicalRequestSha256,
  canonicalizeJson,
  createIdempotencyService,
  createMemoryIdempotencyRepository,
  createPostgresIdempotencyRepository,
  idempotencyScopeSha256,
};
