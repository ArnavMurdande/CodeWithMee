'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { createApp } = require('../app');
const { createMemoryAuthorityRepository } = require('../modules/authority/memory-repository');
const { createAuthorityRouter } = require('../modules/authority/router');
const { createAuthorityService } = require('../modules/authority/service');

const ORIGIN = 'https://app.example.test';
const NOW = new Date('2026-08-01T12:00:00.000Z');

function user(id, overrides = {}) {
  return {
    authorityRevision: 1,
    avatarUrl: null,
    createdAt: NOW,
    displayName: id,
    email: `${id}@example.test`,
    emailVerifiedAt: NOW,
    id,
    platformRole: 'learner',
    status: 'active',
    username: id,
    ...overrides,
  };
}

function authentication(userId, platformRole) {
  return {
    principal: {
      emailVerified: true,
      platformRole,
      sessionId: `session-${userId}`,
      status: 'active',
      userId,
    },
    session: { authenticatedAt: NOW, id: `session-${userId}` },
    user: user(userId, { platformRole }),
  };
}

async function withServer(run) {
  const repository = createMemoryAuthorityRepository({
    memberships: [
      {
        id: 'membership-owner',
        organizationId: 'org-1',
        role: 'owner',
        status: 'active',
        userId: 'owner',
      },
      {
        id: 'membership-candidate',
        organizationId: 'org-1',
        role: 'instructor',
        status: 'active',
        userId: 'candidate',
      },
    ],
    organizations: [
      {
        id: 'org-1',
        name: 'Provider',
        ownerUserId: 'owner',
        revision: 3,
        verificationStatus: 'approved',
      },
    ],
    sessions: [{ id: 'target-session', revokedAt: null, userId: 'target' }],
    users: [
      user('admin', { platformRole: 'superadmin' }),
      user('candidate'),
      user('owner'),
      user('stale-admin'),
      user('target'),
    ],
  });
  const service = createAuthorityService({ now: () => new Date(NOW), repository });
  const authentications = {
    admin: authentication('admin', 'superadmin'),
    learner: authentication('target', 'learner'),
    owner: authentication('owner', 'learner'),
    stale: authentication('stale-admin', 'superadmin'),
  };
  const identityService = {
    async authenticate(token) {
      const result = authentications[token];
      if (!result) {
        const error = new Error('invalid_access_token');
        error.code = 'invalid_access_token';
        error.status = 401;
        throw error;
      }
      return result;
    },
  };
  const router = createAuthorityRouter({
    config: { trustedOrigins: [ORIGIN] },
    identityService,
    logger: { error() {} },
    service,
  });
  const server = createApp({ allowedOrigins: [ORIGIN], identityRouter: router }).listen(
    0,
    '127.0.0.1',
  );
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.equal(typeof address, 'object');
    await run({
      baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
      repository,
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function headers(token = 'admin', origin = ORIGIN) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Origin: origin,
    'X-Request-ID': 'authority-router-test',
  };
}

test('authority HTTP workflow changes roles/status, revokes sessions, and exposes redacted audit events', async () => {
  await withServer(async ({ baseUrl, repository }) => {
    const roleResponse = await fetch(`${baseUrl}/admin/users/target/platform-role`, {
      body: JSON.stringify({
        platformRole: 'moderator',
        reason: 'Moderator access approved by the platform security owner',
        revision: 1,
      }),
      headers: headers(),
      method: 'PATCH',
    });
    assert.equal(roleResponse.status, 200);
    const roleBody = await roleResponse.json();
    assert.equal(roleBody.user.platformRole, 'moderator');
    assert.equal(roleBody.user.authorityRevision, 2);
    assert.equal(roleBody.auditEvent.requestId, 'authority-router-test');
    assert.equal(roleBody.revokedSessionCount, 1);

    const usersResponse = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(usersResponse.status, 200);
    const usersBody = await usersResponse.json();
    assert.ok(usersBody.users.some((entry) => entry.id === 'target'));
    assert.doesNotMatch(JSON.stringify(usersBody), /password|token/i);

    const statusResponse = await fetch(`${baseUrl}/admin/users/target/status`, {
      body: JSON.stringify({
        reason: 'Account suspended during investigation of a security report',
        revision: 2,
        status: 'suspended',
      }),
      headers: headers(),
      method: 'PATCH',
    });
    assert.equal(statusResponse.status, 200);
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.revokedSessionCount, 0);
    assert.equal(statusBody.user.status, 'suspended');

    const auditResponse = await fetch(`${baseUrl}/admin/audit-events?limit=10`, {
      headers: { Authorization: 'Bearer admin' },
    });
    assert.equal(auditResponse.status, 200);
    const auditText = await auditResponse.text();
    assert.equal(JSON.parse(auditText).events.length, 2);
    assert.doesNotMatch(auditText, /@example\.test|password|token|operationKey/i);
    assert.equal(repository.snapshot().sessions[0].revokedAt.getTime(), NOW.getTime());
  });
});

test('authority HTTP workflow denies stale authority, untrusted origins, and non-admin audit access', async () => {
  await withServer(async ({ baseUrl }) => {
    const stale = await fetch(`${baseUrl}/admin/users/target/platform-role`, {
      body: JSON.stringify({
        platformRole: 'moderator',
        reason: 'Stale embedded authority must not mutate current platform state',
        revision: 1,
      }),
      headers: headers('stale'),
      method: 'PATCH',
    });
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).code, 'authority_denied');

    const wrongOrigin = await fetch(`${baseUrl}/admin/users/target/status`, {
      body: JSON.stringify({
        reason: 'Requests from untrusted origins must fail before mutation',
        revision: 1,
        status: 'suspended',
      }),
      headers: headers('admin', 'https://attacker.example'),
      method: 'PATCH',
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal((await wrongOrigin.json()).code, 'origin_not_allowed');

    const audit = await fetch(`${baseUrl}/admin/audit-events`, {
      headers: { Authorization: 'Bearer learner' },
    });
    assert.equal(audit.status, 403);
    assert.equal((await audit.json()).code, 'deny_by_default');
  });
});

test('authority HTTP workflow permanently deletes a user and retains the deletion audit event', async () => {
  await withServer(async ({ baseUrl, repository }) => {
    const response = await fetch(`${baseUrl}/admin/users/target`, {
      body: JSON.stringify({
        reason: 'Approved permanent account erasure through admin governance',
        revision: 1,
      }),
      headers: headers(),
      method: 'DELETE',
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.deletedUserId, 'target');
    assert.equal(body.revokedSessionCount, 1);
    assert.equal(body.auditEvent.action, 'account_delete');
    assert.equal(repository.snapshot().users.some((entry) => entry.id === 'target'), false);
  });
});

test('ownership transfer HTTP route requires the current owner and commits one revision', async () => {
  await withServer(async ({ baseUrl, repository }) => {
    const response = await fetch(`${baseUrl}/organizations/org-1/ownership-transfer`, {
      body: JSON.stringify({
        reason: 'Both principals approved transfer through the provider governance process',
        revision: 3,
        targetUserId: 'candidate',
      }),
      headers: headers('owner'),
      method: 'POST',
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.organization.ownerUserId, 'candidate');
    assert.equal(body.organization.revision, 4);
    assert.equal(body.actorMembership.role, 'admin');
    assert.equal(body.targetMembership.role, 'owner');
    assert.equal(repository.snapshot().auditEvents.length, 1);
  });
});
