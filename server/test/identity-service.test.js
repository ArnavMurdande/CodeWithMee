'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { PLATFORM_ROLE, USER_STATUS } = require('../modules/identity/contracts');
const { createCaptureIdentityMailer } = require('../modules/identity/mailer');
const { createMemoryIdentityRepository } = require('../modules/identity/memory-repository');
const { createPasswordHasher } = require('../modules/identity/password-hasher');
const { createPasswordRiskChecker } = require('../modules/identity/password-risk');
const { loadIdentityRuntimeConfig } = require('../modules/identity/runtime');
const { createIdentityService } = require('../modules/identity/service');
const { createAccessTokenService } = require('../modules/identity/token-crypto');

const ACCESS_SECRET = 'access-secret-'.padEnd(40, 'a');
const REFRESH_PEPPER = 'refresh-pepper-'.padEnd(40, 'b');
const PASSWORD = 'correct horse battery staple';

function fakePasswordHasher() {
  return Object.freeze({
    async hash(password) {
      return `test:${Buffer.from(password).toString('base64url')}`;
    },
    async verify(passwordHash, password) {
      const expected = `test:${Buffer.from(String(password)).toString('base64url')}`;
      return Object.freeze({
        matches: passwordHash === expected,
        needsRehash: false,
      });
    },
  });
}

function createHarness({ passwordHasher = fakePasswordHasher(), seed } = {}) {
  let currentTime = new Date('2026-08-01T00:00:00.000Z');
  const repository = createMemoryIdentityRepository(seed);
  const mailer = createCaptureIdentityMailer();
  const accessTokens = createAccessTokenService({
    audience: 'codewithmee-test',
    issuer: 'codewithmee-test-api',
    secret: ACCESS_SECRET,
    ttlSeconds: 600,
  });
  const service = createIdentityService({
    accessTokens,
    mailer,
    now: () => new Date(currentTime),
    passwordHasher,
    passwordRiskChecker: createPasswordRiskChecker({ mode: 'local' }),
    refreshTokenPepper: REFRESH_PEPPER,
    repository,
    sessionConfig: {
      absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
      idleTtlMs: 7 * 24 * 60 * 60 * 1000,
      recentAuthenticationMs: 10 * 60 * 1000,
    },
  });
  return {
    accessTokens,
    advance(milliseconds) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    mailer,
    metadata: { client: 'web', ipAddress: '127.0.0.1', userAgent: 'identity-test' },
    repository,
    service,
  };
}

async function register(harness, overrides = {}) {
  return harness.service.register({
    displayName: 'Ada Lovelace',
    email: 'Ada@Example.test',
    metadata: harness.metadata,
    password: PASSWORD,
    ...overrides,
  });
}

function expectIdentityCode(code) {
  return (error) => error?.code === code;
}

test('identity runtime requires paired strong secrets and all-or-none Google configuration', () => {
  const disabled = loadIdentityRuntimeConfig(
    {},
    { allowedOrigins: ['https://app.example.test'], nodeEnv: 'test' },
  );
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.trustedOrigins, ['https://app.example.test']);

  assert.throws(
    () => loadIdentityRuntimeConfig({ ACCESS_TOKEN_SECRET: ACCESS_SECRET }),
    /configured together/,
  );
  assert.throws(
    () =>
      loadIdentityRuntimeConfig({
        ACCESS_TOKEN_SECRET: 'short',
        REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
      }),
    /at least 32 bytes/,
  );
  assert.throws(
    () =>
      loadIdentityRuntimeConfig({
        ACCESS_TOKEN_SECRET: ACCESS_SECRET,
        GOOGLE_OAUTH_CLIENT_ID: 'client',
        REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
      }),
    /requires client ID/,
  );

  const enabled = loadIdentityRuntimeConfig({
    ACCESS_TOKEN_SECRET: ACCESS_SECRET,
    REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.accessToken.ttlSeconds, 600);

  const retiredAlias = loadIdentityRuntimeConfig(
    { JWT_SECRET: ACCESS_SECRET },
    { allowedOrigins: ['https://app.example.test'], nodeEnv: 'development' },
  );
  assert.equal(retiredAlias.enabled, false);

  assert.throws(
    () =>
      loadIdentityRuntimeConfig(
        {
          ACCESS_TOKEN_SECRET: ACCESS_SECRET,
          REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
          WEB_APP_ORIGIN: 'http://app.example.test',
        },
        { nodeEnv: 'production' },
      ),
    /must use HTTPS/,
  );
  assert.throws(
    () =>
      loadIdentityRuntimeConfig(
        {
          JWT_SECRET: ACCESS_SECRET,
          REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
          WEB_APP_ORIGIN: 'https://app.example.test',
        },
        { nodeEnv: 'production' },
      ),
    /configured together/,
  );
});

test('production password hashing uses Argon2id and upgrades verified bcrypt hashes', async () => {
  const hasher = createPasswordHasher();
  const hash = await hasher.hash(PASSWORD);
  assert.match(hash, /^\$argon2id\$/);
  assert.deepEqual(await hasher.verify(hash, PASSWORD), { matches: true, needsRehash: false });
  assert.equal((await hasher.verify(hash, 'incorrect value')).matches, false);

  const legacyHash = await bcrypt.hash(PASSWORD, 4);
  assert.deepEqual(await hasher.verify(legacyHash, PASSWORD), {
    matches: true,
    needsRehash: true,
  });
});

test('successful login upgrades a stored bcrypt local identity to Argon2id', async () => {
  const passwordHasher = createPasswordHasher();
  const legacyHash = await bcrypt.hash(PASSWORD, 4);
  const harness = createHarness({
    passwordHasher,
    seed: {
      identities: [
        {
          id: 'identity-1',
          passwordHash: legacyHash,
          provider: 'local',
          providerSubject: 'legacy@example.test',
          userId: 'user-legacy',
        },
      ],
      users: [
        {
          avatarUrl: null,
          displayName: 'Legacy User',
          email: 'legacy@example.test',
          emailVerifiedAt: null,
          id: 'user-legacy',
          platformRole: PLATFORM_ROLE.LEARNER,
          status: USER_STATUS.ACTIVE,
          username: 'legacy',
        },
      ],
    },
  });
  await harness.service.login({
    email: 'legacy@example.test',
    metadata: harness.metadata,
    password: PASSWORD,
  });
  const [identity] = harness.repository.snapshot().identities;
  assert.match(identity.passwordHash, /^\$argon2id\$/);
});

test('registration normalizes identity data, emits verification, and issues claims without roles', async () => {
  const harness = createHarness();
  const result = await register(harness);
  assert.equal(result.user.email, 'ada@example.test');
  assert.equal(result.user.platformRole, PLATFORM_ROLE.LEARNER);
  assert.equal(result.user.emailVerified, false);
  assert.equal(harness.mailer.messages.length, 1);
  assert.equal(harness.mailer.messages[0].purpose, 'email_verification');
  assert.match(harness.mailer.messages[0].token, /^ev1\./);

  const claims = jwt.decode(result.accessToken);
  assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
  const authentication = await harness.service.authenticate(result.accessToken);
  assert.equal(authentication.principal.userId, result.user.id);
  assert.equal(authentication.principal.platformRole, PLATFORM_ROLE.LEARNER);

  await assert.rejects(register(harness), expectIdentityCode('registration_unavailable'));
  await assert.rejects(
    register(harness, { email: 'other@example.test', password: 'password1234' }),
    expectIdentityCode('password_compromised'),
  );
});

test('local login returns one generic failure for absent, wrong, Google-only, and inactive accounts', async () => {
  const harness = createHarness();
  const registration = await register(harness);

  for (const credentials of [
    { email: 'missing@example.test', password: PASSWORD },
    { email: 'ada@example.test', password: 'incorrect password value' },
  ]) {
    await assert.rejects(
      harness.service.login({ ...credentials, metadata: harness.metadata }),
      expectIdentityCode('invalid_credentials'),
    );
  }

  await harness.repository.updateUserStatus(registration.user.id, USER_STATUS.BANNED);
  await assert.rejects(
    harness.service.login({
      email: 'ada@example.test',
      metadata: harness.metadata,
      password: PASSWORD,
    }),
    expectIdentityCode('invalid_credentials'),
  );

  const googleHarness = createHarness();
  await googleHarness.service.loginWithGoogle({
    metadata: googleHarness.metadata,
    profile: {
      email: 'google@example.test',
      emailVerified: true,
      name: 'Google User',
      subject: 'google-subject',
    },
  });
  await assert.rejects(
    googleHarness.service.login({
      email: 'google@example.test',
      metadata: googleHarness.metadata,
      password: PASSWORD,
    }),
    expectIdentityCode('invalid_credentials'),
  );
});

test('refresh rotates both secrets and reuse revokes the token family', async () => {
  const harness = createHarness();
  const first = await register(harness);
  const rotated = await harness.service.refresh({
    csrfCookie: first.csrfToken,
    csrfHeader: first.csrfToken,
    metadata: harness.metadata,
    refreshToken: first.refreshToken,
  });
  assert.notEqual(rotated.refreshToken, first.refreshToken);
  assert.notEqual(rotated.csrfToken, first.csrfToken);
  await harness.service.authenticate(rotated.accessToken);

  await assert.rejects(
    harness.service.refresh({
      csrfCookie: first.csrfToken,
      csrfHeader: first.csrfToken,
      metadata: harness.metadata,
      refreshToken: first.refreshToken,
    }),
    expectIdentityCode('refresh_token_reuse_detected'),
  );
  await assert.rejects(
    harness.service.authenticate(rotated.accessToken),
    expectIdentityCode('invalid_access_token'),
  );
  const [session] = harness.repository.snapshot().sessions;
  assert.ok(session.compromisedAt);
  assert.ok(session.revokedAt);
});

test('refresh rejects missing CSRF without rotating or revoking the current token', async () => {
  const harness = createHarness();
  const first = await register(harness);
  await assert.rejects(
    harness.service.refresh({
      csrfCookie: first.csrfToken,
      csrfHeader: 'attacker-value',
      metadata: harness.metadata,
      refreshToken: first.refreshToken,
    }),
    expectIdentityCode('csrf_validation_failed'),
  );
  await harness.service.authenticate(first.accessToken);
  const [session] = harness.repository.snapshot().sessions;
  assert.equal(session.consumedTokenHashes.length, 0);
  assert.equal(session.revokedAt, null);
});

test('logout validates the cookie-bound CSRF secret and revokes the current session', async () => {
  const harness = createHarness();
  const registration = await register(harness);
  await assert.rejects(
    harness.service.logout({
      csrfCookie: registration.csrfToken,
      csrfHeader: 'invalid-csrf',
      refreshToken: registration.refreshToken,
    }),
    expectIdentityCode('csrf_validation_failed'),
  );
  await harness.service.authenticate(registration.accessToken);
  await harness.service.logout({
    csrfCookie: registration.csrfToken,
    csrfHeader: registration.csrfToken,
    refreshToken: registration.refreshToken,
  });
  await assert.rejects(
    harness.service.authenticate(registration.accessToken),
    expectIdentityCode('invalid_access_token'),
  );
});

test('verification tokens are single-use and expiry is enforced', async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const verificationToken = harness.mailer.messages[0].token;
  const verified = await harness.service.confirmEmailVerification(verificationToken);
  assert.equal(verified.emailVerified, true);
  await assert.rejects(
    harness.service.confirmEmailVerification(verificationToken),
    expectIdentityCode('invalid_or_expired_token'),
  );

  const expiringHarness = createHarness();
  await register(expiringHarness);
  const expiringToken = expiringHarness.mailer.messages[0].token;
  expiringHarness.advance(24 * 60 * 60 * 1000 + 1);
  await assert.rejects(
    expiringHarness.service.confirmEmailVerification(expiringToken),
    expectIdentityCode('invalid_or_expired_token'),
  );

  await harness.service.requestEmailVerification(
    await harness.service.authenticate(registration.accessToken),
  );
  assert.equal(harness.mailer.messages.length, 1);
});

test('password reset is non-enumerating, single-use, and revokes every session', async () => {
  const harness = createHarness();
  const registration = await register(harness);
  await harness.service.requestPasswordReset('missing@example.test');
  assert.equal(harness.mailer.messages.length, 1);

  await harness.service.requestPasswordReset('ADA@example.test');
  assert.equal(harness.mailer.messages.length, 2);
  const resetToken = harness.mailer.messages[1].token;
  await harness.service.resetPassword({
    password: 'a new correct horse battery staple',
    token: resetToken,
  });
  await assert.rejects(
    harness.service.authenticate(registration.accessToken),
    expectIdentityCode('invalid_access_token'),
  );
  await assert.rejects(
    harness.service.resetPassword({
      password: 'another correct horse battery staple',
      token: resetToken,
    }),
    expectIdentityCode('invalid_or_expired_token'),
  );
  await assert.rejects(
    harness.service.login({
      email: 'ada@example.test',
      metadata: harness.metadata,
      password: PASSWORD,
    }),
    expectIdentityCode('invalid_credentials'),
  );
  const login = await harness.service.login({
    email: 'ada@example.test',
    metadata: harness.metadata,
    password: 'a new correct horse battery staple',
  });
  assert.equal(login.user.id, registration.user.id);
});

test('Google identity links by verified email without a placeholder local password', async () => {
  const harness = createHarness();
  const registration = await register(harness);
  const google = await harness.service.loginWithGoogle({
    metadata: harness.metadata,
    profile: {
      email: 'ADA@example.test',
      emailVerified: true,
      name: 'Ada from Google',
      picture: 'https://images.example.test/ada.png',
      subject: 'google-ada',
    },
  });
  assert.equal(google.user.id, registration.user.id);
  assert.equal(google.user.emailVerified, true);
  const snapshot = harness.repository.snapshot();
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.identities.length, 2);
  assert.equal(
    snapshot.identities.find((identity) => identity.provider === 'google').passwordHash,
    null,
  );

  await assert.rejects(
    harness.service.loginWithGoogle({
      metadata: harness.metadata,
      profile: {
        email: 'unverified@example.test',
        emailVerified: false,
        subject: 'unverified-google',
      },
    }),
    expectIdentityCode('invalid_google_identity'),
  );
});

test('session management is owner-scoped and sensitive revocation requires recent authentication', async () => {
  const harness = createHarness();
  const first = await register(harness);
  const second = await harness.service.login({
    email: 'ada@example.test',
    metadata: { ...harness.metadata, userAgent: 'second-device' },
    password: PASSWORD,
  });
  const authentication = await harness.service.authenticate(first.accessToken);
  const sessions = await harness.service.listSessions(authentication);
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((session) => session.current).length, 1);

  await harness.service.revokeSession(authentication, second.session.id);
  await assert.rejects(
    harness.service.authenticate(second.accessToken),
    expectIdentityCode('invalid_access_token'),
  );
  await assert.rejects(
    harness.service.revokeSession(authentication, 'someone-elses-session'),
    expectIdentityCode('session_not_found'),
  );

  harness.advance(10 * 60 * 1000 + 1);
  await assert.rejects(
    harness.service.logoutAll(authentication),
    expectIdentityCode('recent_authentication_required'),
  );
});

test('access-token authentication reloads current account status from the repository', async () => {
  const harness = createHarness();
  const registration = await register(harness);
  await harness.service.authenticate(registration.accessToken);
  await harness.repository.updateUserStatus(registration.user.id, USER_STATUS.SUSPENDED);
  await assert.rejects(
    harness.service.authenticate(registration.accessToken),
    expectIdentityCode('invalid_access_token'),
  );
});
