'use strict';

const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { once } = require('node:events');
const test = require('node:test');

const express = require('express');

const { createApp } = require('../app');
const {
  DEFAULT_RATE_LIMITS,
  MemoryRateLimitStore,
  clientRateKey,
} = require('../modules/http/rate-limit');
const {
  BODY_LIMIT,
  operationProfile,
  requestSecurityProfile,
} = require('../modules/http/route-security');

const ORIGIN = 'https://app.example.test';
const silentLogger = Object.freeze({ error() {}, info() {}, warn() {} });

async function withApp(options, operation) {
  const server = createApp({ logger: silentLogger, nodeEnv: 'test', ...options }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  try {
    const address = server.address();
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('security headers are restrictive and production adds HSTS without framework disclosure', async () => {
  await withApp({ nodeEnv: 'production' }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/test`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(
      response.headers.get('strict-transport-security'),
      'max-age=31536000; includeSubDomains',
    );
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('CORS preflight is exact and fetch metadata blocks only untrusted cross-site writes', async () => {
  const identityRouter = express.Router();
  identityRouter.post('/unsafe', (_request, response) => response.json({ accepted: true }));
  await withApp({ allowedOrigins: [ORIGIN], identityRouter }, async (baseUrl) => {
    const preflight = await fetch(`${baseUrl}/api/v1/unsafe`, {
      headers: {
        'access-control-request-headers': 'authorization,content-type,x-csrf-token',
        'access-control-request-method': 'POST',
        origin: ORIGIN,
      },
      method: 'OPTIONS',
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /X-CSRF-Token/i);
    assert.equal(preflight.headers.get('access-control-max-age'), '600');

    const untrusted = await fetch(`${baseUrl}/api/v1/unsafe`, {
      body: '{}',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      method: 'POST',
    });
    assert.equal(untrusted.status, 403);
    assert.equal((await untrusted.json()).code, 'origin_not_allowed');
    assert.equal(untrusted.headers.get('access-control-allow-origin'), null);

    const metadataBlocked = await fetch(`${baseUrl}/api/v1/unsafe`, {
      body: '{}',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      method: 'POST',
    });
    assert.equal(metadataBlocked.status, 403);
    assert.equal((await metadataBlocked.json()).code, 'cross_site_request_blocked');

    const allowedCrossSite = await fetch(`${baseUrl}/api/v1/unsafe`, {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        'sec-fetch-site': 'cross-site',
      },
      method: 'POST',
    });
    assert.equal(allowedCrossSite.status, 200);
  });
});

test('route body parsers enforce small v1 bounds and reject compressed JSON', async () => {
  await withApp({ allowedOrigins: [ORIGIN] }, async (baseUrl) => {
    const oversized = await fetch(`${baseUrl}/api/v1/auth/register`, {
      body: JSON.stringify({ padding: 'x'.repeat(BODY_LIMIT.V1_JSON) }),
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      method: 'POST',
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'request_body_too_large');

    const compressed = await fetch(`${baseUrl}/api/v1/auth/register`, {
      body: gzipSync(Buffer.from('{"email":"private@example.test"}')),
      headers: {
        'content-encoding': 'gzip',
        'content-type': 'application/json',
        origin: ORIGIN,
      },
      method: 'POST',
    });
    assert.equal(compressed.status, 415);
    const problem = await compressed.json();
    assert.equal(problem.code, 'unsupported_content_encoding');
    assert.equal(JSON.stringify(problem).includes('private@example.test'), false);
  });

  assert.equal(operationProfile('POST', '/auth/register').bodyLimitBytes, BODY_LIMIT.V1_JSON);
  assert.equal(operationProfile('GET', '/health/live').bodyLimitBytes, BODY_LIMIT.NO_BODY);
  assert.equal(
    requestSecurityProfile('POST', '/api/ai/chat').bodyLimitBytes,
    BODY_LIMIT.EXPENSIVE_LEGACY,
  );
  assert.equal(
    requestSecurityProfile('POST', '/api/v1/not-yet-implemented').bodyLimitBytes,
    BODY_LIMIT.V1_JSON,
  );
});

test('named rate classes emit bounded headers, skip preflight, and fail closed', async () => {
  const limits = {
    ...DEFAULT_RATE_LIMITS,
    authentication: { limit: 2, windowMs: 60_000 },
  };
  const identityRouter = express.Router();
  await withApp(
    { allowedOrigins: [ORIGIN], identityRouter, rateLimits: limits },
    async (baseUrl) => {
      for (let index = 0; index < 3; index += 1) {
        const preflight = await fetch(`${baseUrl}/api/v1/auth/login`, {
          headers: {
            'access-control-request-method': 'POST',
            origin: ORIGIN,
          },
          method: 'OPTIONS',
        });
        assert.equal(preflight.status, 204);
      }
      const first = await fetch(`${baseUrl}/api/v1/auth/login`, {
        body: '{}',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        method: 'POST',
      });
      assert.equal(first.status, 404);
      assert.equal(first.headers.get('ratelimit-limit'), '2');
      assert.equal(first.headers.get('ratelimit-remaining'), '1');

      const second = await fetch(`${baseUrl}/api/v1/auth/login`, {
        body: '{}',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        method: 'POST',
      });
      assert.equal(second.status, 404);
      assert.equal(second.headers.get('ratelimit-remaining'), '0');

      const limited = await fetch(`${baseUrl}/api/v1/auth/login`, {
        body: '{}',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        method: 'POST',
      });
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).code, 'rate_limit_exceeded');
      assert.match(limited.headers.get('retry-after'), /^\d+$/);
    },
  );

  const store = new MemoryRateLimitStore({ maxKeys: 1 });
  await store.consume({ key: 'one', limit: 1, now: 1, windowMs: 1000 });
  await assert.rejects(
    () => store.consume({ key: 'two', limit: 1, now: 1, windowMs: 1000 }),
    (error) => error.code === 'rate_limit_store_unavailable',
  );
  const key = clientRateKey({ ip: '203.0.113.9' }, 'read', Buffer.alloc(32, 4));
  assert.equal(key.includes('203.0.113.9'), false);
});

test('forwarding headers are ignored unless the exact proxy address is trusted', () => {
  const defaultApp = createApp({ logger: silentLogger, nodeEnv: 'test' });
  assert.equal(defaultApp.get('trust proxy'), false);

  const trustedApp = createApp({
    logger: silentLogger,
    nodeEnv: 'test',
    trustedProxies: ['127.0.0.1', '10.0.0.0/8'],
  });
  const trust = trustedApp.get('trust proxy fn');
  assert.equal(trust('127.0.0.1', 0), true);
  assert.equal(trust('10.20.30.40', 0), true);
  assert.equal(trust('203.0.113.9', 0), false);
});
