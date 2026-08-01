'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { createApp } = require('../app');
const { createCaptureIdentityMailer } = require('../modules/identity/mailer');
const { createMemoryIdentityRepository } = require('../modules/identity/memory-repository');
const { createPasswordRiskChecker } = require('../modules/identity/password-risk');
const { createIdentityRouter } = require('../modules/identity/router');
const { loadIdentityRuntimeConfig } = require('../modules/identity/runtime');
const { createIdentityService } = require('../modules/identity/service');
const { createAccessTokenService } = require('../modules/identity/token-crypto');

const ORIGIN = 'https://app.example.test';
const ACCESS_SECRET = 'router-access-secret-'.padEnd(40, 'a');
const REFRESH_PEPPER = 'router-refresh-pepper-'.padEnd(40, 'b');

function fakePasswordHasher() {
  return Object.freeze({
    async hash(password) {
      return `test:${Buffer.from(password).toString('base64url')}`;
    },
    async verify(hash, password) {
      return Object.freeze({
        matches: hash === `test:${Buffer.from(String(password)).toString('base64url')}`,
        needsRehash: false,
      });
    },
  });
}

async function startIdentityApp() {
  const config = loadIdentityRuntimeConfig(
    {
      ACCESS_TOKEN_SECRET: ACCESS_SECRET,
      REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
      WEB_APP_ORIGIN: ORIGIN,
    },
    { allowedOrigins: [ORIGIN], nodeEnv: 'test' },
  );
  const repository = createMemoryIdentityRepository();
  const mailer = createCaptureIdentityMailer();
  const accessTokens = createAccessTokenService(config.accessToken);
  const service = createIdentityService({
    accessTokens,
    mailer,
    passwordHasher: fakePasswordHasher(),
    passwordRiskChecker: createPasswordRiskChecker({ mode: 'local' }),
    refreshTokenPepper: config.refreshTokenPepper,
    repository,
    sessionConfig: config.session,
  });
  const logger = { error() {}, warn() {} };
  const identityRouter = createIdentityRouter({
    config,
    googleClient: { enabled: false },
    logger,
    service,
  });
  const app = createApp({ allowedOrigins: [ORIGIN], identityRouter });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    mailer,
    repository,
    async stop() {
      server.close();
      await once(server, 'close');
    },
  };
}

function cookieValues(response) {
  const values = new Map();
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const separator = pair.indexOf('=');
    values.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return values;
}

function cookieHeader(cookies) {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

test('unconfigured identity routes fail closed without affecting app construction', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/me`);
    assert.equal(response.status, 503);
    const problem = await response.json();
    assert.equal(problem.code, 'identity_not_configured');
    assert.equal(problem.status, 503);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('registration requires trusted origin and sets only cookie-bound refresh/CSRF secrets', async () => {
  const harness = await startIdentityApp();
  try {
    const payload = {
      displayName: 'Grace Hopper',
      email: 'grace@example.test',
      password: 'another correct horse battery staple',
    };
    const withoutOrigin = await fetch(`${harness.baseUrl}/api/v1/auth/register`, {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(withoutOrigin.status, 403);
    assert.equal((await withoutOrigin.json()).code, 'origin_not_allowed');

    const response = await fetch(`${harness.baseUrl}/api/v1/auth/register`, {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      method: 'POST',
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.ok(body.accessToken);
    assert.equal('refreshToken' in body, false);
    assert.equal('csrfToken' in body, false);
    assert.equal(body.user.email, 'grace@example.test');
    const setCookies = response.headers.getSetCookie();
    const refresh = setCookies.find((value) => value.startsWith('cwm_refresh='));
    const csrf = setCookies.find((value) => value.startsWith('cwm_csrf='));
    assert.match(refresh, /HttpOnly/i);
    assert.match(refresh, /SameSite=Lax/i);
    assert.match(refresh, /Path=\/api\/v1\/auth/i);
    assert.doesNotMatch(csrf, /HttpOnly/i);
    assert.match(csrf, /SameSite=Strict/i);
    assert.equal(harness.mailer.messages.length, 1);
  } finally {
    await harness.stop();
  }
});

test('HTTP refresh rotates cookies, requires CSRF, and rejects replayed families', async () => {
  const harness = await startIdentityApp();
  try {
    const registration = await fetch(`${harness.baseUrl}/api/v1/auth/register`, {
      body: JSON.stringify({
        displayName: 'Linus Torvalds',
        email: 'linus@example.test',
        password: 'a sufficiently long unique passphrase',
      }),
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      method: 'POST',
    });
    const oldCookies = cookieValues(registration);
    const oldCsrf = oldCookies.get('cwm_csrf');

    const missingCsrf = await fetch(`${harness.baseUrl}/api/v1/auth/refresh`, {
      headers: { cookie: cookieHeader(oldCookies), origin: ORIGIN },
      method: 'POST',
    });
    assert.equal(missingCsrf.status, 403);

    const refresh = await fetch(`${harness.baseUrl}/api/v1/auth/refresh`, {
      headers: {
        cookie: cookieHeader(oldCookies),
        origin: ORIGIN,
        'x-csrf-token': oldCsrf,
      },
      method: 'POST',
    });
    assert.equal(refresh.status, 200);
    const refreshedBody = await refresh.json();
    const newCookies = cookieValues(refresh);
    assert.notEqual(newCookies.get('cwm_refresh'), oldCookies.get('cwm_refresh'));
    assert.notEqual(newCookies.get('cwm_csrf'), oldCsrf);

    const replay = await fetch(`${harness.baseUrl}/api/v1/auth/refresh`, {
      headers: {
        cookie: cookieHeader(oldCookies),
        origin: ORIGIN,
        'x-csrf-token': oldCsrf,
      },
      method: 'POST',
    });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).code, 'refresh_token_reuse_detected');

    const me = await fetch(`${harness.baseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${refreshedBody.accessToken}` },
    });
    assert.equal(me.status, 401);
  } finally {
    await harness.stop();
  }
});

test('login/reset request responses do not disclose account existence and Google fails unavailable', async () => {
  const harness = await startIdentityApp();
  try {
    const knownPayload = {
      displayName: 'Known User',
      email: 'known@example.test',
      password: 'known user long passphrase',
    };
    await fetch(`${harness.baseUrl}/api/v1/auth/register`, {
      body: JSON.stringify(knownPayload),
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      method: 'POST',
    });

    const loginBodies = [];
    for (const email of ['known@example.test', 'missing@example.test']) {
      const response = await fetch(`${harness.baseUrl}/api/v1/auth/login`, {
        body: JSON.stringify({ email, password: 'wrong but sufficiently long' }),
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        method: 'POST',
      });
      assert.equal(response.status, 401);
      loginBodies.push(await response.json());
    }
    assert.deepEqual(
      loginBodies.map(({ requestId: _requestId, ...problem }) => problem),
      [loginBodies[0], loginBodies[0]].map(({ requestId: _requestId, ...problem }) => problem),
    );

    const resetBodies = [];
    for (const email of ['known@example.test', 'missing@example.test']) {
      const response = await fetch(`${harness.baseUrl}/api/v1/auth/password/forgot`, {
        body: JSON.stringify({ email }),
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        method: 'POST',
      });
      assert.equal(response.status, 202);
      resetBodies.push(await response.json());
    }
    assert.deepEqual(resetBodies[0], resetBodies[1]);

    const google = await fetch(`${harness.baseUrl}/api/v1/auth/google/start`, {
      redirect: 'manual',
    });
    assert.equal(google.status, 503);
    assert.equal((await google.json()).code, 'google_auth_unavailable');
  } finally {
    await harness.stop();
  }
});
