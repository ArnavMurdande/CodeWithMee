'use strict';

const { randomUUID } = require('node:crypto');

const { requirePostgresPool } = require('../persistence/postgres-helpers');

const AUDIT_DEFAULT_LIST_LIMIT = 50;
const AUDIT_MAX_LIST_LIMIT = 100;
const AUDIT_MAX_MEMORY_EVENTS = 50_000;
const AUDIT_MAX_STATE_FIELDS = 32;
const AUDIT_MAX_STATE_ARRAY_ITEMS = 32;
const AUDIT_MAX_STATE_BYTES = 16 * 1024;
const AUDIT_MAX_STATE_STRING_LENGTH = 500;
const AUDIT_ENVELOPE = Symbol('codewithmee.audit-envelope');

const ENVELOPE_KEYS = new Set([
  'action',
  'actorSessionId',
  'actorUserId',
  'afterState',
  'beforeState',
  'correlationId',
  'id',
  'occurredAt',
  'operationKey',
  'operatorReference',
  'organizationId',
  'reason',
  'requestId',
  'source',
  'targetId',
  'targetType',
]);

const FORBIDDEN_STATE_FIELD_PARTS = Object.freeze([
  'accesstoken',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'hash',
  'password',
  'passcode',
  'privatekey',
  'quarantine',
  'refreshtoken',
  'secret',
  'signingkey',
  'storage',
  'token',
]);

const AUDIT_ROW_COLUMNS = `id, actor_user_id, actor_session_id, organization_id, action,
  target_type, target_id, correlation_id, request_id, reason, source, operator_ref,
  before_state, after_state, operation_key, occurred_at, created_at`;

function auditError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw auditError(
      'audit_unknown_field',
      `${label} contains unsupported fields: ${unknown.sort().join(', ')}.`,
      400,
    );
  }
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

function boundedText(value, label, maximum, { optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return null;
    throw new TypeError(`${label} is required.`);
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
  assertUnicodeScalarString(value, label);
  const normalized = value.trim().normalize('NFKC').replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maximum) {
    throw new TypeError(`${label} must contain between 1 and ${maximum} characters.`);
  }
  return normalized;
}

function normalizeOccurredAt(value) {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('occurredAt must be a valid date.');
  return date.toISOString();
}

function normalizedStateFieldName(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function stateAllowlist(value) {
  if (!Array.isArray(value)) throw new TypeError('stateAllowlist must be an array.');
  if (value.length > AUDIT_MAX_STATE_FIELDS) {
    throw new TypeError(
      `stateAllowlist cannot contain more than ${AUDIT_MAX_STATE_FIELDS} fields.`,
    );
  }
  const fields = [];
  const seen = new Set();
  for (const field of value) {
    if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(field)) {
      throw new TypeError(
        'Audit state field names must be simple identifiers of 80 characters or less.',
      );
    }
    const normalized = normalizedStateFieldName(field);
    if (FORBIDDEN_STATE_FIELD_PARTS.some((part) => normalized.includes(part))) {
      throw auditError(
        'audit_forbidden_state_field',
        `Audit state field ${field} is security-sensitive and cannot be persisted.`,
        400,
      );
    }
    if (seen.has(field)) throw new TypeError(`Duplicate audit state field: ${field}.`);
    seen.add(field);
    fields.push(field);
  }
  return Object.freeze(fields);
}

function auditStateScalar(value, label) {
  if (value === null || typeof value === 'boolean') return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${label} must be a valid date.`);
    return value.toISOString();
  }
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, label);
    if (value.length > AUDIT_MAX_STATE_STRING_LENGTH) {
      throw new TypeError(`${label} cannot exceed ${AUDIT_MAX_STATE_STRING_LENGTH} characters.`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new TypeError(`${label} must be a bounded finite number.`);
    }
    return value;
  }
  throw new TypeError(`${label} must be a JSON scalar or a bounded array of JSON scalars.`);
}

function auditStateValue(value, label) {
  if (!Array.isArray(value)) return auditStateScalar(value, label);
  if (value.length > AUDIT_MAX_STATE_ARRAY_ITEMS) {
    throw new TypeError(
      `${label} cannot contain more than ${AUDIT_MAX_STATE_ARRAY_ITEMS} array items.`,
    );
  }
  return Object.freeze(value.map((item, index) => auditStateScalar(item, `${label}[${index}]`)));
}

function projectAuditState(value, allowlist, label) {
  if (value == null) return null;
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object or null.`);
  const projected = {};
  for (const field of allowlist) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      projected[field] = auditStateValue(value[field], `${label}.${field}`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > AUDIT_MAX_STATE_BYTES) {
    throw auditError(
      'audit_state_too_large',
      `${label} exceeds the ${AUDIT_MAX_STATE_BYTES}-byte audit boundary.`,
      413,
    );
  }
  return Object.freeze(projected);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function createAuditEnvelope(input, options = {}) {
  assertExactKeys(input, ENVELOPE_KEYS, 'audit envelope');
  assertExactKeys(options, new Set(['stateAllowlist']), 'audit envelope options');
  if (!Object.prototype.hasOwnProperty.call(options, 'stateAllowlist')) {
    throw new TypeError('An explicit stateAllowlist is required.');
  }
  const allowlist = stateAllowlist(options.stateAllowlist);
  const source = boundedText(input.source, 'source', 80);
  const actorUserId = boundedText(input.actorUserId, 'actorUserId', 255, { optional: true });
  const suppliedOperator = boundedText(input.operatorReference, 'operatorReference', 255, {
    optional: true,
  });
  const envelope = {
    action: boundedText(input.action, 'action', 160),
    actorSessionId: boundedText(input.actorSessionId, 'actorSessionId', 255, { optional: true }),
    actorUserId,
    afterState: projectAuditState(input.afterState, allowlist, 'afterState'),
    beforeState: projectAuditState(input.beforeState, allowlist, 'beforeState'),
    correlationId: boundedText(input.correlationId, 'correlationId', 255, { optional: true }),
    id: boundedText(input.id || randomUUID(), 'id', 255),
    occurredAt: normalizeOccurredAt(input.occurredAt),
    operationKey: boundedText(input.operationKey, 'operationKey', 160, { optional: true }),
    operatorReference: suppliedOperator || (actorUserId ? null : 'system'),
    organizationId: boundedText(input.organizationId, 'organizationId', 255, { optional: true }),
    reason: boundedText(input.reason, 'reason', 500, { optional: true }),
    requestId: boundedText(input.requestId, 'requestId', 100, { optional: true }),
    source,
    targetId: boundedText(input.targetId, 'targetId', 255),
    targetType: boundedText(input.targetType, 'targetType', 80),
  };
  Object.defineProperty(envelope, AUDIT_ENVELOPE, { value: allowlist });
  return deepFreeze(envelope);
}

function assertAuditEnvelope(value) {
  if (!value || value[AUDIT_ENVELOPE] === undefined || !Object.isFrozen(value)) {
    throw new TypeError('A bounded audit envelope created by createAuditEnvelope is required.');
  }
}

function isoDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid date.`);
  return date.toISOString();
}

function publicAuditRecord(value, allowlist, createdAt = value.createdAt ?? value.created_at) {
  return deepFreeze({
    action: value.action,
    actorSessionId: value.actorSessionId ?? value.actor_session_id ?? null,
    actorUserId: value.actorUserId ?? value.actor_user_id ?? null,
    afterState: projectAuditState(value.afterState ?? value.after_state, allowlist, 'afterState'),
    beforeState: projectAuditState(
      value.beforeState ?? value.before_state,
      allowlist,
      'beforeState',
    ),
    correlationId: value.correlationId ?? value.correlation_id ?? null,
    createdAt: isoDate(createdAt, 'createdAt'),
    id: value.id,
    occurredAt: isoDate(value.occurredAt ?? value.occurred_at, 'occurredAt'),
    operatorReference: value.operatorReference ?? value.operator_ref ?? null,
    organizationId: value.organizationId ?? value.organization_id ?? null,
    reason: value.reason ?? null,
    requestId: value.requestId ?? value.request_id ?? null,
    source: value.source,
    targetId: value.targetId ?? value.target_id,
    targetType: value.targetType ?? value.target_type,
  });
}

function operationFingerprint(value) {
  return JSON.stringify({
    action: value.action,
    actorUserId: value.actorUserId,
    afterState: value.afterState,
    beforeState: value.beforeState,
    operatorReference: value.operatorReference,
    organizationId: value.organizationId,
    reason: value.reason,
    source: value.source,
    targetId: value.targetId,
    targetType: value.targetType,
  });
}

function assertOperationReplayMatches(envelope, record) {
  if (operationFingerprint(envelope) !== operationFingerprint(record)) {
    throw auditError(
      'audit_operation_key_conflict',
      'The audit operation key is already associated with a different operation.',
      409,
    );
  }
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function createMemoryAuditRepository({
  clock = () => new Date(),
  maxEvents = AUDIT_MAX_MEMORY_EVENTS,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function.');
  positiveInteger(maxEvents, 'maxEvents', AUDIT_MAX_MEMORY_EVENTS);
  const entries = [];
  const byId = new Map();
  const byOperationKey = new Map();

  return Object.freeze({
    async append(envelope) {
      assertAuditEnvelope(envelope);
      if (envelope.operationKey) {
        const replay = byOperationKey.get(envelope.operationKey);
        if (replay) {
          assertOperationReplayMatches(envelope, replay);
          return replay;
        }
      }
      if (byId.has(envelope.id)) {
        throw auditError('audit_duplicate_id', 'The audit event id already exists.', 409);
      }
      if (entries.length >= maxEvents) {
        throw auditError(
          'audit_memory_capacity_exceeded',
          'The bounded in-memory audit repository is full.',
          503,
        );
      }
      const allowlist = envelope[AUDIT_ENVELOPE];
      const record = publicAuditRecord(envelope, allowlist, clock());
      entries.push(record);
      byId.set(record.id, record);
      if (envelope.operationKey) byOperationKey.set(envelope.operationKey, record);
      return record;
    },

    async list({ beforeId = null, limit = AUDIT_DEFAULT_LIST_LIMIT } = {}) {
      positiveInteger(limit, 'limit', AUDIT_MAX_LIST_LIMIT);
      if (beforeId != null && typeof beforeId !== 'string') {
        throw new TypeError('beforeId must be a string or null.');
      }
      const newestFirst = entries.slice().reverse();
      const start = beforeId ? newestFirst.findIndex((entry) => entry.id === beforeId) + 1 : 0;
      if (beforeId && start === 0) return Object.freeze([]);
      return Object.freeze(newestFirst.slice(start, start + limit));
    },
  });
}

function createPostgresAuditRepository(pool) {
  requirePostgresPool(pool);
  return Object.freeze({
    async append(envelope) {
      assertAuditEnvelope(envelope);
      const result = await pool.query(
        `INSERT INTO audit_events
          (id, actor_user_id, actor_session_id, organization_id, action, target_type,
           target_id, correlation_id, request_id, reason, source, operator_ref, before_state,
           after_state, operation_key, occurred_at, created_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
           $14::jsonb, $15, $16, CURRENT_TIMESTAMP)
         ON CONFLICT (operation_key) DO NOTHING
         RETURNING ${AUDIT_ROW_COLUMNS}`,
        [
          envelope.id,
          envelope.actorUserId,
          envelope.actorSessionId,
          envelope.organizationId,
          envelope.action,
          envelope.targetType,
          envelope.targetId,
          envelope.correlationId,
          envelope.requestId,
          envelope.reason,
          envelope.source,
          envelope.operatorReference,
          envelope.beforeState === null ? null : JSON.stringify(envelope.beforeState),
          envelope.afterState === null ? null : JSON.stringify(envelope.afterState),
          envelope.operationKey,
          envelope.occurredAt,
        ],
      );
      let row = result.rows[0];
      if (!row) {
        if (!envelope.operationKey) {
          throw auditError('audit_insert_failed', 'The audit event could not be appended.');
        }
        const replay = await pool.query(
          `SELECT ${AUDIT_ROW_COLUMNS}
             FROM audit_events
            WHERE operation_key = $1`,
          [envelope.operationKey],
        );
        row = replay.rows[0];
        if (!row) {
          throw auditError(
            'audit_replay_unavailable',
            'The existing audit operation could not be retrieved.',
            503,
          );
        }
      }
      const record = publicAuditRecord(row, envelope[AUDIT_ENVELOPE]);
      assertOperationReplayMatches(envelope, record);
      return record;
    },
  });
}

module.exports = {
  AUDIT_DEFAULT_LIST_LIMIT,
  AUDIT_MAX_LIST_LIMIT,
  AUDIT_MAX_MEMORY_EVENTS,
  AUDIT_MAX_STATE_BYTES,
  createAuditEnvelope,
  createMemoryAuditRepository,
  createPostgresAuditRepository,
};
