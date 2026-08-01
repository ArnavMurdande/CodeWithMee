'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createApp } = require('../app');
const {
  MAX_METRIC_KEYS,
  createTelemetry,
  traceContext,
} = require('../modules/observability/telemetry');
const {
  normalizeSyntheticBaseUrl,
  runSyntheticHealth,
} = require('../modules/observability/synthetic-health');

test('trace context accepts a valid parent and emits one consistent child span', () => {
  const parentTrace = 'a'.repeat(32);
  const context = traceContext(`00-${parentTrace}-${'c'.repeat(16)}-01`, (bytes) =>
    bytes === 16 ? 'd'.repeat(32) : 'b'.repeat(16),
  );
  assert.equal(context.traceId, parentTrace);
  assert.equal(context.spanId, 'b'.repeat(16));
  assert.equal(context.traceparent, `00-${parentTrace}-${'b'.repeat(16)}-01`);
});

test('telemetry keeps bounded low-cardinality request, error and job counters', () => {
  const telemetry = createTelemetry({ clock: () => new Date('2026-08-01T00:00:00.000Z') });
  telemetry.recordRequest({ durationMs: 12.5, method: 'GET', status: 200 });
  telemetry.recordError({ code: 'internal_error', status: 500 });
  telemetry.recordJob({ claimed: 2, completed: 1, failed: 0, retried: 1 });
  for (let index = 0; index < MAX_METRIC_KEYS + 5; index += 1) {
    telemetry.recordError({ code: `code-${index}`, status: 500 });
  }
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.service, 'codewithmee-api');
  assert.ok(Object.keys(snapshot.counters).length <= MAX_METRIC_KEYS + 1);
  assert.ok(snapshot.counters['telemetry_dropped_metric_keys_total{}'] > 0);
  assert.equal(snapshot.counters['jobs_claimed_total{}'], 2);
});

test('HTTP instrumentation returns trace context, records failures and reports metadata only', async () => {
  const captures = [];
  const telemetry = createTelemetry();
  const app = createApp({
    errorReporter: { capture: (event) => captures.push(event), configured: true },
    legacyApiEnabled: false,
    logger: { error() {}, info() {}, warn() {} },
    telemetry,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/missing?secret=discarded`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('traceparent'), /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    const body = await response.json();
    assert.equal(body.instance, '/missing');
    assert.equal(captures.length, 1);
    assert.deepEqual(Object.keys(captures[0]).sort(), [
      'code',
      'errorName',
      'requestId',
      'route',
      'status',
      'traceId',
    ]);
    const counters = telemetry.snapshot().counters;
    assert.equal(counters['http_errors_total{code=route_not_found,status=404}'], 1);
    assert.equal(counters['http_requests_total{method=get,status=404}'], 1);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('synthetic health allows HTTPS or loopback and validates live plus ready responses', async () => {
  assert.equal(normalizeSyntheticBaseUrl('http://127.0.0.1:5001/').origin, 'http://127.0.0.1:5001');
  assert.throws(() => normalizeSyntheticBaseUrl('http://example.com'), /must use HTTPS/);
  assert.throws(() => normalizeSyntheticBaseUrl('https://user:secret@example.com'), /credentials/);
  const visited = [];
  const results = await runSyntheticHealth({
    baseUrl: 'https://app.example.test',
    fetchImpl: async (url) => {
      visited.push(url.pathname);
      const ready = url.pathname.endsWith('/ready');
      return { json: async () => ({ status: ready ? 'ready' : 'ok' }), status: 200 };
    },
  });
  assert.equal(results.length, 2);
  assert.deepEqual(visited, ['/api/v1/health/live', '/api/v1/health/ready']);
});
