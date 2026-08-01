'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const express = require('express');

const { createApp } = require('../app');
const { PLATFORM_ROLE, USER_STATUS } = require('../modules/identity/contracts');
const { createCaptureIdentityMailer } = require('../modules/identity/mailer');
const { createMemoryIdentityRepository } = require('../modules/identity/memory-repository');
const { createPasswordRiskChecker } = require('../modules/identity/password-risk');
const { createIdentityRouter } = require('../modules/identity/router');
const { loadIdentityRuntimeConfig } = require('../modules/identity/runtime');
const { createIdentityService } = require('../modules/identity/service');
const { createAccessTokenService } = require('../modules/identity/token-crypto');
const {
  createMemoryOrganizationRepository,
} = require('../modules/organizations/memory-repository');
const { createOrganizationRouter } = require('../modules/organizations/router');
const { createOrganizationService } = require('../modules/organizations/service');

const ORIGIN = 'https://app.example.test';
const ACCESS_SECRET = 'organization-router-access-'.padEnd(40, 'a');
const REFRESH_PEPPER = 'organization-router-pepper-'.padEnd(40, 'b');
const SUPERADMIN_PASSWORD = 'superadmin test passphrase';

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

async function startApp() {
  const config = loadIdentityRuntimeConfig(
    {
      ACCESS_TOKEN_SECRET: ACCESS_SECRET,
      REFRESH_TOKEN_PEPPER: REFRESH_PEPPER,
      WEB_APP_ORIGIN: ORIGIN,
    },
    { allowedOrigins: [ORIGIN], nodeEnv: 'test' },
  );
  const timestamp = new Date();
  const superadmin = {
    avatarUrl: null,
    createdAt: timestamp,
    displayName: 'Platform Administrator',
    email: 'superadmin@example.test',
    emailVerifiedAt: timestamp,
    id: 'superadmin',
    platformRole: PLATFORM_ROLE.SUPERADMIN,
    status: USER_STATUS.ACTIVE,
    updatedAt: timestamp,
    username: null,
  };
  const identityRepository = createMemoryIdentityRepository({
    identities: [
      {
        createdAt: timestamp,
        id: 'superadmin-identity',
        passwordHash: `test:${Buffer.from(SUPERADMIN_PASSWORD).toString('base64url')}`,
        provider: 'local',
        providerSubject: superadmin.email,
        updatedAt: timestamp,
        userId: superadmin.id,
      },
    ],
    users: [superadmin],
  });
  const mailer = createCaptureIdentityMailer();
  const identityService = createIdentityService({
    accessTokens: createAccessTokenService(config.accessToken),
    mailer,
    passwordHasher: fakePasswordHasher(),
    passwordRiskChecker: createPasswordRiskChecker({ mode: 'local' }),
    refreshTokenPepper: config.refreshTokenPepper,
    repository: identityRepository,
    sessionConfig: config.session,
  });
  const organizationRepository = createMemoryOrganizationRepository();
  const organizationService = createOrganizationService({
    identityRepository,
    invitationTokenPepper: config.refreshTokenPepper,
    mailer,
    recentAuthenticationMs: config.session.recentAuthenticationMs,
    repository: organizationRepository,
  });
  const logger = { error() {}, warn() {} };
  const apiRouter = express.Router();
  apiRouter.use(
    createIdentityRouter({
      config,
      googleClient: { enabled: false },
      logger,
      service: identityService,
    }),
  );
  apiRouter.use(
    createOrganizationRouter({
      config,
      identityService,
      logger,
      service: organizationService,
    }),
  );
  const server = createApp({ allowedOrigins: [ORIGIN], identityRouter: apiRouter }).listen(
    0,
    '127.0.0.1',
  );
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    mailer,
    async stop() {
      server.close();
      await once(server, 'close');
    },
  };
}

async function request(harness, path, { body, method = 'GET', origin = ORIGIN, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (origin !== null) headers.origin = origin;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${harness.baseUrl}/api/v1${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  });
  const payload = response.status === 204 ? null : await response.json();
  return { payload, response };
}

async function registerVerified(harness, email, displayName) {
  const registration = await request(harness, '/auth/register', {
    body: { displayName, email, password: 'a unique router testing passphrase' },
    method: 'POST',
  });
  assert.equal(registration.response.status, 201);
  const verification = harness.mailer.messages.find(
    (message) => message.purpose === 'email_verification' && message.to === email,
  );
  const confirmed = await request(harness, '/auth/email/verify/confirm', {
    body: { token: verification.token },
    method: 'POST',
  });
  assert.equal(confirmed.response.status, 200);
  return registration.payload.accessToken;
}

async function loginSuperadmin(harness) {
  const result = await request(harness, '/auth/login', {
    body: { email: 'superadmin@example.test', password: SUPERADMIN_PASSWORD },
    method: 'POST',
  });
  assert.equal(result.response.status, 200);
  return result.payload.accessToken;
}

test('organization HTTP contract enforces origin/auth, token redaction, and membership scope', async () => {
  const harness = await startApp();
  try {
    const ownerToken = await registerVerified(harness, 'owner@example.test', 'Owner');
    const memberToken = await registerVerified(harness, 'member@example.test', 'Member');
    const blocked = await request(harness, '/organizations', {
      body: { name: 'Provider Alpha', slug: 'provider-alpha' },
      method: 'POST',
      origin: null,
      token: ownerToken,
    });
    assert.equal(blocked.response.status, 403);
    assert.equal(blocked.payload.code, 'origin_not_allowed');

    const created = await request(harness, '/organizations', {
      body: { name: 'Provider Alpha', slug: 'provider-alpha' },
      method: 'POST',
      token: ownerToken,
    });
    assert.equal(created.response.status, 201);
    const organizationId = created.payload.organization.id;

    const anonymous = await request(harness, `/organizations/${organizationId}`, {
      origin: null,
    });
    assert.equal(anonymous.response.status, 403);
    assert.equal(anonymous.payload.code, 'unauthenticated');

    const invited = await request(harness, `/organizations/${organizationId}/invitations`, {
      body: { email: 'member@example.test', role: 'instructor' },
      method: 'POST',
      token: ownerToken,
    });
    assert.equal(invited.response.status, 201);
    assert.equal('token' in invited.payload.invitation, false);
    assert.equal('tokenHash' in invited.payload.invitation, false);
    const rawInvitation = harness.mailer.messages.find(
      (message) => message.purpose === 'organization_invitation',
    ).token;
    assert.equal(JSON.stringify(invited.payload).includes(rawInvitation), false);

    const accepted = await request(
      harness,
      `/organization-invitations/${encodeURIComponent(rawInvitation)}/accept`,
      { body: {}, method: 'POST', token: memberToken },
    );
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.payload.membership.role, 'instructor');
    const replay = await request(
      harness,
      `/organization-invitations/${encodeURIComponent(rawInvitation)}/accept`,
      { body: {}, method: 'POST', token: memberToken },
    );
    assert.equal(replay.response.status, 400);

    const members = await request(harness, `/organizations/${organizationId}/members`, {
      origin: null,
      token: ownerToken,
    });
    assert.equal(members.response.status, 200);
    assert.equal(members.payload.members.length, 2);
  } finally {
    await harness.stop();
  }
});

test('provider review endpoints are superadmin-only and approval changes public visibility', async () => {
  const harness = await startApp();
  try {
    const ownerToken = await registerVerified(harness, 'provider@example.test', 'Provider Owner');
    const created = await request(harness, '/organizations', {
      body: { name: 'Verified Provider', slug: 'verified-provider' },
      method: 'POST',
      token: ownerToken,
    });
    const organizationId = created.payload.organization.id;
    const submitted = await request(harness, `/organizations/${organizationId}/verification`, {
      body: { statement: 'We verify that this provider account represents our organization.' },
      method: 'POST',
      token: ownerToken,
    });
    assert.equal(submitted.response.status, 201);

    const denied = await request(harness, '/admin/provider-verifications', {
      origin: null,
      token: ownerToken,
    });
    assert.equal(denied.response.status, 403);

    const superadminToken = await loginSuperadmin(harness);
    const queue = await request(harness, '/admin/provider-verifications', {
      origin: null,
      token: superadminToken,
    });
    assert.equal(queue.response.status, 200);
    assert.equal(queue.payload.reviews.length, 1);
    const approved = await request(
      harness,
      `/admin/provider-verifications/${queue.payload.reviews[0].id}/decision`,
      { body: { status: 'approved' }, method: 'POST', token: superadminToken },
    );
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.organization.verificationStatus, 'approved');

    const publicView = await request(harness, `/organizations/${organizationId}`, {
      origin: null,
    });
    assert.equal(publicView.response.status, 200);
    assert.equal('ownerUserId' in publicView.payload.organization, false);
  } finally {
    await harness.stop();
  }
});
