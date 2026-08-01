'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { createApp } = require('../app');
const {
  LEGACY_ROUTE_LIFECYCLE,
  LEGACY_ROUTE_STATE,
} = require('../modules/api/legacy-route-lifecycle');

const EXPECTED_MOUNTS = Object.freeze([
  '/api/admin',
  '/api/ai',
  '/api/auth',
  '/api/challenges',
  '/api/code',
  '/api/courses',
  '/api/roadmap',
  '/api/space',
  '/api/user',
  '/api/youtube',
]);

test('every unversioned mount has one explicit lifecycle owner and replacement', () => {
  assert.deepEqual(LEGACY_ROUTE_LIFECYCLE.map((entry) => entry.mount).sort(), EXPECTED_MOUNTS);
  assert.equal(new Set(LEGACY_ROUTE_LIFECYCLE.map((entry) => entry.mount)).size, 10);
  for (const entry of LEGACY_ROUTE_LIFECYCLE) {
    assert.match(entry.finalOwner, /^P(?:0[BD]|[1-4])[A-Z]?(?:-S\d+)?$/);
    assert.match(entry.modulePath, /^\.\/routes\/[a-z]+$/);
    assert.match(entry.replacement, /^\/api\/v1\//);
    assert.ok(Object.values(LEGACY_ROUTE_STATE).includes(entry.state));
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.equal(
    LEGACY_ROUTE_LIFECYCLE.find((entry) => entry.mount === '/api/auth').state,
    LEGACY_ROUTE_STATE.TOMBSTONE,
  );
  assert.equal(
    LEGACY_ROUTE_LIFECYCLE.find((entry) => entry.mount === '/api/admin').state,
    LEGACY_ROUTE_STATE.TOMBSTONE,
  );
});

test('the atomic legacy cutover switch retires every inventoried mount', async () => {
  const app = createApp({ legacyApiEnabled: false });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    for (const mount of EXPECTED_MOUNTS) {
      const response = await fetch(`http://127.0.0.1:${address.port}${mount}`);
      assert.equal(response.status, 410, mount);
      assert.equal((await response.json()).code, 'legacy_api_disabled_for_cutover', mount);
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
