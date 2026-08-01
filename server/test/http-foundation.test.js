'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const express = require('express');

const { createApp } = require('../app');
const { createReadinessProbe } = require('../modules/health/readiness');
const { createStructuredLogger } = require('../modules/http/structured-logger');

function captureLogger() {
  const records = [];
  const destination = {
    error: (value) => records.push(JSON.parse(value)),
    info: (value) => records.push(JSON.parse(value)),
    warn: (value) => records.push(JSON.parse(value)),
  };
  return { logger: createStructuredLogger({ destination, environment: 'test' }), records };
}

async function withApp(options, operation) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('structured logging redacts sensitive keys, bounds values, and tolerates cycles', () => {
  const { logger, records } = captureLogger();
  const cycle = { safe: 'visible' };
  cycle.self = cycle;
  logger.warn('redaction_probe', {
    authorization: 'Bearer never-log-me',
    nested: { passwordHash: 'hash-never-log-me', safeCode: 'allowed_code' },
    payload: cycle,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].authorization, '[REDACTED]');
  assert.equal(records[0].nested.passwordHash, '[REDACTED]');
  assert.equal(records[0].nested.safeCode, 'allowed_code');
  assert.equal(records[0].payload.self, '[CIRCULAR]');
  assert.equal(JSON.stringify(records[0]).includes('never-log-me'), false);
});

test('legacy route sources cannot bypass the structured redacted logger', () => {
  const sources = [
    '../routes/ai.js',
    '../routes/challenges.js',
    '../routes/code.js',
    '../routes/courses.js',
    '../routes/roadmap.js',
    '../routes/space.js',
    '../routes/user.js',
    '../routes/youtube.js',
    '../utils/geminiHelper.js',
  ];
  for (const source of sources) {
    const contents = readFileSync(path.resolve(__dirname, source), 'utf8');
    assert.doesNotMatch(contents, /console\.(?:error|info|log|warn)\s*\(/);
    assert.doesNotMatch(contents, /json\s*\([^)]*(?:err|error)\.message/);
  }
});

test('async failures use one redacted problem handler and preserve valid request IDs', async () => {
  const { logger, records } = captureLogger();
  const identityRouter = express.Router();
  identityRouter.get('/explode', async () => {
    throw new Error('password=never-reflect token=never-reflect');
  });

  await withApp({ identityRouter, logger, nodeEnv: 'test' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/explode?secret=never-reflect`, {
      headers: { 'x-request-id': 'client-trace-20260801' },
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-type').startsWith('application/problem+json'), true);
    assert.equal(response.headers.get('x-request-id'), 'client-trace-20260801');
    const problem = await response.json();
    assert.equal(problem.code, 'internal_error');
    assert.equal(problem.requestId, 'client-trace-20260801');
    assert.equal(problem.instance, '/api/v1/explode');
    assert.equal(JSON.stringify(problem).includes('never-reflect'), false);

    const invalidTrace = await fetch(`${baseUrl}/not-found`, {
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    assert.equal(invalidTrace.status, 404);
    assert.notEqual(invalidTrace.headers.get('x-request-id'), 'bad id with spaces');
    assert.match(invalidTrace.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  });

  assert.ok(records.some((record) => record.event === 'http_request_failed'));
  assert.ok(records.some((record) => record.event === 'http_request_completed'));
  assert.equal(JSON.stringify(records).includes('never-reflect'), false);
});

test('malformed JSON is normalized without parser details or submitted values', async () => {
  const { logger, records } = captureLogger();
  const identityRouter = express.Router();
  identityRouter.post('/parse', (_request, response) => response.status(204).end());
  await withApp({ identityRouter, logger, nodeEnv: 'test' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/parse`, {
      body: '{"password":"never-reflect"',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 400);
    const problem = await response.json();
    assert.equal(problem.code, 'invalid_json');
    assert.equal(JSON.stringify(problem).includes('never-reflect'), false);
  });
  assert.equal(JSON.stringify(records).includes('never-reflect'), false);
});

test('liveness is minimal, public readiness is aggregate, and details are superadmin-only', async () => {
  const { logger } = captureLogger();
  const readinessProbe = createReadinessProbe({
    checks: [
      { name: 'postgres', probe: async () => false },
      { name: 'optional_mail', probe: async () => false, required: false },
      { name: 'identity', probe: async () => true },
    ],
    timeoutMs: 20,
  });
  const identityAuthenticate = async (token) => ({
    principal: {
      platformRole: token === 'super-token' ? 'superadmin' : 'learner',
      sessionId: 'session-health',
      status: 'active',
      userId: 'user-health',
    },
  });
  const identityRouter = express.Router();

  await withApp(
    { identityAuthenticate, identityRouter, logger, nodeEnv: 'test', readinessProbe },
    async (baseUrl) => {
      const live = await fetch(`${baseUrl}/api/v1/health/live`);
      assert.equal(live.status, 200);
      assert.deepEqual(await live.json(), { status: 'ok' });

      const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
      assert.equal(ready.status, 503);
      assert.deepEqual(await ready.json(), { status: 'not_ready' });

      const anonymous = await fetch(`${baseUrl}/api/v1/health/dependencies`);
      assert.equal(anonymous.status, 401);
      assert.equal((await anonymous.json()).code, 'authentication_required');

      const learner = await fetch(`${baseUrl}/api/v1/health/dependencies`, {
        headers: { authorization: 'Bearer learner-token' },
      });
      assert.equal(learner.status, 403);
      assert.equal((await learner.json()).code, 'deny_by_default');

      const detailed = await fetch(`${baseUrl}/api/v1/health/dependencies`, {
        headers: { authorization: 'Bearer super-token' },
      });
      assert.equal(detailed.status, 503);
      assert.deepEqual(await detailed.json(), {
        checks: [
          { name: 'postgres', status: 'unavailable' },
          { name: 'optional_mail', status: 'optional_unavailable' },
          { name: 'identity', status: 'ok' },
        ],
        status: 'not_ready',
      });
    },
  );
});

test('readiness probes are bounded when a dependency never resolves', async () => {
  const probe = createReadinessProbe({
    checks: [{ name: 'stuck', probe: () => new Promise(() => undefined) }],
    timeoutMs: 5,
  });
  const before = Date.now();
  assert.deepEqual(await probe(), {
    checks: [{ name: 'stuck', status: 'unavailable' }],
    ready: false,
  });
  assert.ok(Date.now() - before < 250);
});
