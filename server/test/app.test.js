const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const mongoose = require('mongoose');

const { createApp } = require('../app');
const { loadRuntimeConfig } = require('../config/runtime');
const { startServer } = require('../start');

test('runtime configuration validates ports, origins, and execution URLs', () => {
  const config = loadRuntimeConfig({
    CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://127.0.0.1:3000',
    DNS_SERVERS: '',
    HOST: '127.0.0.1',
    MONGO_URI: 'mongodb://127.0.0.1:27017/codewithmee-test',
    NODE_ENV: 'test',
    PISTON_API_URL: 'http://127.0.0.1:2000/api/v2/execute',
    PORT: '5100',
    TRUSTED_PROXY_CIDRS: '127.0.0.1,10.0.0.0/8',
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5100);
  assert.deepEqual(config.corsAllowedOrigins, ['https://app.example.com', 'http://127.0.0.1:3000']);
  assert.deepEqual(config.dnsServers, []);
  assert.equal(config.pistonApiUrl, 'http://127.0.0.1:2000/api/v2/execute');
  assert.equal(config.localUploadServing, true);
  assert.deepEqual(config.trustedProxies, ['127.0.0.1', '10.0.0.0/8']);

  assert.throws(() => loadRuntimeConfig({ PORT: '70000' }), /between 1 and 65535/);
  assert.throws(() => loadRuntimeConfig({ PISTON_API_URL: 'file:///tmp/runner' }), /HTTP or HTTPS/);
  assert.throws(
    () => loadRuntimeConfig({ CORS_ALLOWED_ORIGINS: 'https://app.example.com/path' }),
    /without paths/,
  );
  assert.throws(
    () => loadRuntimeConfig({ TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }),
    /wildcard or invalid prefix/,
  );
  assert.throws(
    () => loadRuntimeConfig({ TRUSTED_PROXY_CIDRS: 'not-an-ip' }),
    /IP addresses or CIDRs/,
  );
  assert.equal(loadRuntimeConfig({ NODE_ENV: 'production' }).localUploadServing, false);
  assert.throws(
    () => loadRuntimeConfig({ LOCAL_UPLOAD_SERVING: 'true', NODE_ENV: 'production' }),
    /LOCAL_UPLOAD_SERVING cannot be enabled in production/,
  );
});

test('creating the Express app does not connect to MongoDB or open a listener', () => {
  assert.equal(mongoose.connection.readyState, 0);
  const app = createApp();
  assert.equal(typeof app.listen, 'function');
  assert.equal(mongoose.connection.readyState, 0);
});

test('the constructed app serves its smoke route on an ephemeral listener', async () => {
  const app = createApp({ allowedOrigins: ['https://app.example.com'] });
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/test`, {
      headers: { Origin: 'https://app.example.com' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.deepEqual(await response.json(), { message: 'Hello from the server!' });
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('legacy APIs can be retired atomically while versioned APIs and health remain mounted', async () => {
  const app = createApp({ legacyApiEnabled: false });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    const legacy = await fetch(`http://127.0.0.1:${address.port}/api/challenges`);
    assert.equal(legacy.status, 410);
    const problem = await legacy.json();
    assert.equal(problem.code, 'legacy_api_disabled_for_cutover');
    assert.equal(problem.status, 410);
    assert.match(problem.requestId, /^[a-f0-9-]{36}$/);
    const health = await fetch(`http://127.0.0.1:${address.port}/api/test`);
    assert.equal(health.status, 200);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('startup accepts injected test configuration and closes cleanly', async () => {
  const messages = [];
  const logger = {
    error: (...values) => messages.push(['error', ...values]),
    info: (...values) => messages.push(['info', ...values]),
    warn: (...values) => messages.push(['warn', ...values]),
  };
  const runtime = await startServer({
    environment: {
      DNS_SERVERS: '',
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      PORT: '0',
    },
    logger,
  });

  try {
    const address = runtime.server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    assert.equal(runtime.database.connected, false);
    assert.equal(runtime.database.reason, 'not_configured');

    const response = await fetch(`http://127.0.0.1:${address.port}/api/test`);
    assert.equal(response.status, 200);
    assert.ok(
      messages.some(
        ([level, message]) => level === 'info' && JSON.parse(message).event === 'server_listening',
      ),
    );
  } finally {
    await runtime.close();
  }

  assert.equal(mongoose.connection.readyState, 0);
});
