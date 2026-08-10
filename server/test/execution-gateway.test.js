'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  signJobPayload,
  verifyResultSignature,
  createExecutionGateway,
  CIRCUIT_STATE,
} = require('../modules/execution/runner-gateway');

test('P1B-S1: signJobPayload and verifyResultSignature produce valid signed protocol tokens with nonce', () => {
  const payload = { language: 'python', code: 'print(42)', stdin: '' };
  const secret = 'test_secret_key_32_bytes_minimum_len!';
  const jobId = 'test-job-1';

  const { signature, timestamp, nonce } = signJobPayload(payload, secret, { jobId });
  assert.ok(signature);
  assert.ok(timestamp);
  assert.ok(nonce);

  const isValid = verifyResultSignature(payload, signature, timestamp, nonce, secret, { jobId });
  assert.equal(isValid, true);
});

test('P1B-S1: verifyResultSignature rejects expired timestamps (replay defense)', () => {
  const payload = { language: 'python', code: 'print(42)' };
  const secret = 'test_secret_key_32_bytes_minimum_len!';
  const nonce = 'test-nonce-1';
  const oldTimestamp = Date.now() - 400000; // 400s ago

  const { signature } = signJobPayload(payload, secret, { nonce });
  const isValid = verifyResultSignature(payload, signature, oldTimestamp, nonce, secret);

  assert.equal(isValid, false);
});

test('P1B-S1: execution gateway fails closed with 503 runner_unavailable when runner is unconfigured', async () => {
  const gateway = createExecutionGateway({ runnerUrl: null, failureThreshold: 1 });

  await assert.rejects(
    gateway.executeJob('python', 'print(1)'),
    (err) => err.code === 'runner_unavailable' && err.status === 503
  );

  assert.equal(gateway.isCircuitOpen(), true);
  assert.equal(gateway.getCircuitState(), CIRCUIT_STATE.OPEN);
});

test('P1B-S1: production mode rejects weak or missing HMAC secret', () => {
  assert.throws(
    () => createExecutionGateway({ isProduction: true, hmacSecret: 'short_key' }),
    /RUNNER_HMAC_SECRET must be configured with at least 32 random characters/
  );
});
