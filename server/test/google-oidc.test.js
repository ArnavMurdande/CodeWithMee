'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGoogleOidcClient, safeReturnPath } = require('../modules/identity/google-oidc');

const GOOGLE_CONFIG = Object.freeze({
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  enabled: true,
  redirectUri: 'https://api.example.test/api/v1/auth/google/callback',
  transactionSecret: 'oauth-transaction-secret-'.padEnd(40, 'x'),
});

test('Google start creates state, nonce, S256 PKCE, and an encrypted HttpOnly-cookie payload', () => {
  const client = createGoogleOidcClient({
    config: GOOGLE_CONFIG,
    now: () => new Date('2026-08-01T00:00:00.000Z'),
  });
  const result = client.begin('/settings?sessions=true');
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), GOOGLE_CONFIG.redirectUri);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(url.searchParams.get('nonce'));
  assert.ok(url.searchParams.get('state'));
  assert.doesNotMatch(result.transactionCookie, new RegExp(url.searchParams.get('state')));
  assert.equal(result.maxAgeMs, 10 * 60 * 1000);
});

test('Google callback exchanges only the code, verifies nonce-bound ID token, and restores a safe path', async () => {
  const seen = {};
  const client = createGoogleOidcClient({
    config: GOOGLE_CONFIG,
    fetchImpl: async (url, options) => {
      seen.url = url;
      seen.body = Object.fromEntries(options.body.entries());
      return new Response(JSON.stringify({ id_token: 'signed-id-token' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    },
    idTokenVerifier: async (idToken, expectations) => {
      seen.idToken = idToken;
      seen.expectations = expectations;
      return {
        email: 'verified@example.test',
        email_verified: true,
        name: 'Verified User',
        nonce: expectations.nonce,
        picture: 'https://images.example.test/user.png',
        sub: 'google-subject',
      };
    },
    now: () => new Date('2026-08-01T00:00:00.000Z'),
  });
  const started = client.begin('/dashboard');
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  const completed = await client.complete({
    code: 'one-time-code',
    state,
    transactionCookie: started.transactionCookie,
  });

  assert.equal(seen.url, 'https://oauth2.googleapis.com/token');
  assert.equal(seen.body.code, 'one-time-code');
  assert.equal(seen.body.client_secret, GOOGLE_CONFIG.clientSecret);
  assert.ok(seen.body.code_verifier);
  assert.equal(seen.idToken, 'signed-id-token');
  assert.equal(seen.expectations.clientId, GOOGLE_CONFIG.clientId);
  assert.equal(completed.profile.emailVerified, true);
  assert.equal(completed.profile.subject, 'google-subject');
  assert.equal(completed.returnTo, '/dashboard');
});

test('Google callback rejects tampered/expired state before token exchange', async () => {
  let exchanges = 0;
  let currentTime = new Date('2026-08-01T00:00:00.000Z');
  const client = createGoogleOidcClient({
    config: GOOGLE_CONFIG,
    fetchImpl: async () => {
      exchanges += 1;
      throw new Error('should not exchange');
    },
    now: () => new Date(currentTime),
  });
  const started = client.begin('/dashboard');
  const state = new URL(started.authorizationUrl).searchParams.get('state');

  await assert.rejects(
    client.complete({
      code: 'code',
      state: `${state}tampered`,
      transactionCookie: started.transactionCookie,
    }),
    (error) => error.code === 'invalid_google_transaction',
  );
  currentTime = new Date(currentTime.getTime() + 10 * 60 * 1000 + 1);
  await assert.rejects(
    client.complete({ code: 'code', state, transactionCookie: started.transactionCookie }),
    (error) => error.code === 'invalid_google_transaction',
  );
  assert.equal(exchanges, 0);
});

test('return paths cannot escape the configured web origin', () => {
  assert.equal(safeReturnPath('https://attacker.example/path'), '/auth/callback');
  assert.equal(safeReturnPath('//attacker.example/path'), '/auth/callback');
  assert.equal(safeReturnPath('/safe/path?tab=1'), '/safe/path?tab=1');
});
