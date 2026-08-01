'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createOperationRuntime } = require('../modules/operations/runtime');

test('operation runtime is durable only with a PostgreSQL pool', () => {
  const pool = {
    async connect() {
      return { async query() {}, release() {} };
    },
    async query() {
      return { rows: [] };
    },
  };
  const runtime = createOperationRuntime({ nodeEnv: 'production', postgresPool: pool });
  assert.equal(runtime.enabled, true);
  assert.equal(runtime.durable, true);
  assert.equal(runtime.reason, null);
  assert.equal(typeof runtime.auditRepository.append, 'function');
  assert.equal(typeof runtime.idempotencyService.execute, 'function');
  assert.equal(typeof runtime.outboxRepository.claimBatch, 'function');
  assert.equal(Object.isFrozen(runtime), true);
});

test('production fails closed and development is explicit memory-only without PostgreSQL', () => {
  const production = createOperationRuntime({ nodeEnv: 'production' });
  assert.deepEqual(production, {
    auditRepository: null,
    durable: false,
    enabled: false,
    idempotencyService: null,
    outboxRepository: null,
    reason: 'postgres_operations_required',
  });

  const development = createOperationRuntime({ nodeEnv: 'development' });
  assert.equal(development.enabled, true);
  assert.equal(development.durable, false);
  assert.equal(development.reason, 'memory_development_only');
  assert.equal(typeof development.auditRepository.append, 'function');
  assert.equal(typeof development.idempotencyService.begin, 'function');
  assert.equal(typeof development.outboxRepository.append, 'function');
  assert.throws(() => createOperationRuntime({ nodeEnv: 'staging' }), /nodeEnv/);
});
