'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const express = require('express');

const { createApp } = require('../app');
const { createAuthMiddleware } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/policyMiddleware');
const { PLATFORM_ROLE, USER_STATUS } = require('../modules/identity/contracts');
const { PERMISSION } = require('../modules/policies/permissions');

function authentication({ authenticatedAt = new Date(), role = PLATFORM_ROLE.LEARNER } = {}) {
  const account = {
    avatarUrl: null,
    displayName: 'Current User',
    email: 'current@example.test',
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    id: 'current-user',
    platformRole: role,
    status: USER_STATUS.ACTIVE,
    username: 'current',
  };
  return Object.freeze({
    principal: Object.freeze({
      emailVerified: true,
      platformRole: role,
      sessionId: 'current-session',
      status: USER_STATUS.ACTIVE,
      userId: account.id,
    }),
    session: Object.freeze({ authenticatedAt, id: 'current-session' }),
    user: Object.freeze(account),
  });
}

async function startMiniApp({ identityAuthenticate, routes }) {
  const app = express();
  app.locals.identityAuthenticate = identityAuthenticate;
  app.locals.recentAuthenticationMs = 10 * 60 * 1_000;
  routes(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async stop() {
      server.close();
      await once(server, 'close');
    },
  };
}

test('legacy protected routes accept only a current access-token principal by default', async () => {
  const middleware = createAuthMiddleware();
  const harness = await startMiniApp({
    async identityAuthenticate(token) {
      if (token !== 'valid-current-token') throw new Error('invalid');
      return authentication();
    },
    routes(app) {
      app.get('/protected', middleware, (request, response) => {
        response.json({
          principal: request.authorization.principal,
          source: request.authenticationSource,
          user: request.user,
        });
      });
    },
  });
  try {
    const missing = await fetch(`${harness.baseUrl}/protected`);
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, 'authentication_required');

    const retiredHeader = await fetch(`${harness.baseUrl}/protected`, {
      headers: { 'x-auth-token': 'old-token' },
    });
    assert.equal(retiredHeader.status, 401);
    assert.equal((await retiredHeader.json()).error.code, 'authentication_required');

    const invalid = await fetch(`${harness.baseUrl}/protected`, {
      headers: { authorization: 'Bearer invalid' },
    });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error.code, 'invalid_access_token');

    const valid = await fetch(`${harness.baseUrl}/protected`, {
      headers: { authorization: 'Bearer valid-current-token' },
    });
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.deepEqual(payload.user, { id: 'current-user' });
    assert.equal(payload.source, 'access_token');
    assert.equal(payload.principal.platformRole, 'learner');
    assert.equal('accountType' in payload.user, false);
  } finally {
    await harness.stop();
  }
});

test('centralized policy middleware uses current platform role and recent authentication', async () => {
  const middleware = createAuthMiddleware();
  const harness = await startMiniApp({
    async identityAuthenticate(token) {
      if (token === 'learner') return authentication();
      if (token === 'superadmin') return authentication({ role: PLATFORM_ROLE.SUPERADMIN });
      if (token === 'stale-superadmin') {
        return authentication({
          authenticatedAt: new Date(Date.now() - 60 * 60 * 1_000),
          role: PLATFORM_ROLE.SUPERADMIN,
        });
      }
      throw new Error('invalid');
    },
    routes(app) {
      app.get(
        '/users',
        middleware,
        authorize(PERMISSION.PLATFORM_USERS_READ),
        (_request, response) => response.json({ allowed: true }),
      );
      app.put(
        '/roles',
        middleware,
        authorize(PERMISSION.PLATFORM_ROLE_MANAGE),
        (_request, response) => response.json({ allowed: true }),
      );
    },
  });
  try {
    const learner = await fetch(`${harness.baseUrl}/users`, {
      headers: { authorization: 'Bearer learner' },
    });
    assert.equal(learner.status, 403);
    assert.equal((await learner.json()).error.code, 'deny_by_default');

    const superadmin = await fetch(`${harness.baseUrl}/users`, {
      headers: { authorization: 'Bearer superadmin' },
    });
    assert.equal(superadmin.status, 200);

    const stale = await fetch(`${harness.baseUrl}/roles`, {
      headers: { authorization: 'Bearer stale-superadmin' },
      method: 'PUT',
    });
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).error.code, 'recent_authentication_required');
  } finally {
    await harness.stop();
  }
});

test('credential-bearing legacy auth and provider-course handlers are retired', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST' });
    assert.equal(login.status, 410);
    assert.equal((await login.json()).error.replacement, '/api/v1/auth');
    const companyLogin = await fetch(`${baseUrl}/api/auth/company/login`, { method: 'POST' });
    assert.equal(companyLogin.status, 410);
    const providerCourse = await fetch(`${baseUrl}/api/courses/company/mine`);
    assert.equal(providerCourse.status, 410);
    assert.match((await providerCourse.json()).error.replacement, /^\/api\/v1\/organizations/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('legacy route sources contain no account-type authorization or token minting', async () => {
  const routeDirectory = path.join(__dirname, '..', 'routes');
  const files = ['admin.js', 'auth.js', 'challenges.js', 'courses.js', 'space.js', 'user.js'];
  const source = (
    await Promise.all(files.map((file) => readFile(path.join(routeDirectory, file), 'utf8')))
  ).join('\n');
  assert.doesNotMatch(source, /(?:req|request)\.user\.accountType/);
  assert.doesNotMatch(source, /jwt\.sign\s*\(/);
  assert.doesNotMatch(source, /roleCheck\s*\(/);
  assert.doesNotMatch(
    await readFile(path.join(routeDirectory, 'admin.js'), 'utf8'),
    /User\.(?:find|update|delete)/,
  );
  assert.match(source, /authorize\(PERMISSION\.PLATFORM_USERS_READ\)/);
  assert.match(source, /legacy_user_api_retired/);

  const authSource = await readFile(
    path.join(__dirname, '..', 'middleware', 'authMiddleware.js'),
    'utf8',
  );
  assert.doesNotMatch(
    authSource,
    /x-auth-token|legacyAuthCompatibility|legacyJwtSecret|legacy_local|jsonwebtoken|models\/User/,
  );
});
