'use strict';

const { createMemoryAuditRepository, createPostgresAuditRepository } = require('./audit');
const {
  createIdempotencyService,
  createMemoryIdempotencyRepository,
  createPostgresIdempotencyRepository,
} = require('./idempotency');
const { createMemoryOutboxRepository, createPostgresOutboxRepository } = require('./outbox');

function disabledRuntime(reason) {
  return Object.freeze({
    auditRepository: null,
    durable: false,
    enabled: false,
    idempotencyService: null,
    outboxRepository: null,
    reason,
  });
}

function createOperationRuntime({ nodeEnv = 'development', postgresPool = null } = {}) {
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new TypeError('nodeEnv must be development, test, or production.');
  }
  if (postgresPool) {
    const idempotencyRepository = createPostgresIdempotencyRepository(postgresPool);
    return Object.freeze({
      auditRepository: createPostgresAuditRepository(postgresPool),
      durable: true,
      enabled: true,
      idempotencyService: createIdempotencyService({ repository: idempotencyRepository }),
      outboxRepository: createPostgresOutboxRepository(postgresPool),
      reason: null,
    });
  }
  if (nodeEnv === 'production') return disabledRuntime('postgres_operations_required');

  const idempotencyRepository = createMemoryIdempotencyRepository();
  return Object.freeze({
    auditRepository: createMemoryAuditRepository(),
    durable: false,
    enabled: true,
    idempotencyService: createIdempotencyService({ repository: idempotencyRepository }),
    outboxRepository: createMemoryOutboxRepository(),
    reason: 'memory_development_only',
  });
}

module.exports = { createOperationRuntime };
