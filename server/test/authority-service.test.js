'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createMemoryAuthorityRepository } = require('../modules/authority/memory-repository');
const { createAuthorityService } = require('../modules/authority/service');

const NOW = new Date('2026-08-01T10:00:00.000Z');

function user(id, overrides = {}) {
  return {
    authorityRevision: 1,
    avatarUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    displayName: `User ${id}`,
    email: `${id}@example.test`,
    emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    id,
    platformRole: 'learner',
    status: 'active',
    username: id,
    ...overrides,
  };
}

function authentication(userId, platformRole = 'learner', authenticatedAt = NOW) {
  return {
    principal: {
      emailVerified: true,
      platformRole,
      sessionId: `session-${userId}`,
      status: 'active',
      userId,
    },
    session: { authenticatedAt, id: `session-${userId}` },
    user: user(userId, { platformRole }),
  };
}

function harness(seed) {
  const repository = createMemoryAuthorityRepository(seed);
  return {
    repository,
    service: createAuthorityService({ now: () => new Date(NOW), repository }),
  };
}

function expectCode(code) {
  return (error) => error?.code === code;
}

test('one-shot bootstrap promotes one verified active user and appends a redacted audit event', async () => {
  const context = harness({ users: [user('first')] });
  const result = await context.service.bootstrapSuperadmin({
    email: 'FIRST@example.test',
    operatorReference: 'change-2026-001',
    reason: 'Initial platform authority approved for production launch',
  });

  assert.equal(result.user.platformRole, 'superadmin');
  assert.equal(result.user.authorityRevision, 2);
  assert.equal(result.auditEvent.action, 'superadmin_bootstrap');
  assert.equal(result.auditEvent.actorUserId, null);
  assert.equal(result.auditEvent.targetUserId, 'first');
  assert.doesNotMatch(JSON.stringify(result.auditEvent), /first@example\.test|token/i);
  await assert.rejects(
    context.service.bootstrapSuperadmin({
      email: 'first@example.test',
      operatorReference: 'change-2026-002',
      reason: 'A repeated bootstrap attempt must never change platform authority',
    }),
    expectCode('superadmin_bootstrap_consumed'),
  );
});

test('concurrent bootstrap attempts produce exactly one superadmin', async () => {
  const context = harness({ users: [user('first'), user('second')] });
  const attempts = await Promise.allSettled([
    context.service.bootstrapSuperadmin({
      email: 'first@example.test',
      operatorReference: 'change-a',
      reason: 'First concurrent production authority bootstrap request',
    }),
    context.service.bootstrapSuperadmin({
      email: 'second@example.test',
      operatorReference: 'change-b',
      reason: 'Second concurrent production authority bootstrap request',
    }),
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(
    context.repository
      .snapshot()
      .users.filter((record) => record.platformRole === 'superadmin' && record.status === 'active')
      .length,
    1,
  );
  assert.equal(context.repository.snapshot().auditEvents.length, 1);
});

test('bootstrap refuses missing, unverified, inactive, and already-configured targets', async () => {
  for (const [seed, expectedCode] of [
    [{ users: [] }, 'user_not_found'],
    [{ users: [user('target', { emailVerifiedAt: null })] }, 'authority_target_ineligible'],
    [{ users: [user('target', { status: 'suspended' })] }, 'authority_target_ineligible'],
    [
      {
        users: [user('existing', { platformRole: 'superadmin' }), user('target')],
      },
      'superadmin_already_configured',
    ],
  ]) {
    const context = harness(seed);
    await assert.rejects(
      context.service.bootstrapSuperadmin({
        email: 'target@example.test',
        operatorReference: 'change-eligibility',
        reason: 'Bootstrap eligibility must be verified before authority changes',
      }),
      expectCode(expectedCode),
    );
    assert.equal(context.repository.snapshot().auditEvents.length, 0);
  }
});

test('platform role changes require recent superadmin authority, revision, reason, and a non-self target', async () => {
  const context = harness({
    users: [user('admin', { platformRole: 'superadmin' }), user('target')],
  });

  await assert.rejects(
    context.service.changePlatformRole(
      authentication('admin', 'superadmin', new Date('2026-08-01T09:30:00.000Z')),
      'target',
      { platformRole: 'moderator', reason: 'Approved moderator assignment', revision: 1 },
    ),
    expectCode('recent_authentication_required'),
  );
  await assert.rejects(
    context.service.changePlatformRole(authentication('admin', 'superadmin'), 'admin', {
      platformRole: 'moderator',
      reason: 'Self demotion is never an allowed authority workflow',
      revision: 1,
    }),
    expectCode('self_authority_change_denied'),
  );

  const result = await context.service.changePlatformRole(
    authentication('admin', 'superadmin'),
    'target',
    {
      platformRole: 'moderator',
      reason: 'Approved moderator assignment for current moderation queue',
      revision: 1,
    },
    { requestId: 'request-role-1' },
  );
  assert.equal(result.user.platformRole, 'moderator');
  assert.equal(result.user.authorityRevision, 2);
  assert.equal(result.auditEvent.requestId, 'request-role-1');

  await assert.rejects(
    context.service.changePlatformRole(authentication('admin', 'superadmin'), 'target', {
      platformRole: 'learner',
      reason: 'A stale operator screen cannot overwrite newer authority state',
      revision: 1,
    }),
    expectCode('authority_revision_conflict'),
  );
  await assert.rejects(
    context.service.changePlatformRole(authentication('admin', 'superadmin'), 'target', {
      platformRole: 'learner',
      reason: 'Unknown privileged fields are rejected rather than ignored',
      revision: 2,
      status: 'active',
    }),
    expectCode('authority_unknown_field'),
  );
});

test('serialized cross-demotion cannot remove every active superadmin', async () => {
  const context = harness({
    users: [
      user('admin-a', { platformRole: 'superadmin' }),
      user('admin-b', { platformRole: 'superadmin' }),
    ],
  });
  const attempts = await Promise.allSettled([
    context.service.changePlatformRole(authentication('admin-a', 'superadmin'), 'admin-b', {
      platformRole: 'learner',
      reason: 'Approved removal of the second platform administrator',
      revision: 1,
    }),
    context.service.changePlatformRole(authentication('admin-b', 'superadmin'), 'admin-a', {
      platformRole: 'learner',
      reason: 'Competing removal must observe serialized current authority',
      revision: 1,
    }),
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(
    context.repository
      .snapshot()
      .users.filter((record) => record.platformRole === 'superadmin' && record.status === 'active')
      .length,
    1,
  );
});

test('status changes revoke target sessions and cannot target the acting superadmin', async () => {
  const context = harness({
    sessions: [
      { id: 'target-one', revokedAt: null, userId: 'target' },
      { id: 'target-two', revokedAt: null, userId: 'target' },
    ],
    users: [user('admin', { platformRole: 'superadmin' }), user('target')],
  });

  const result = await context.service.changeAccountStatus(
    authentication('admin', 'superadmin'),
    'target',
    {
      reason: 'Account suspended while a security report is investigated',
      revision: 1,
      status: 'suspended',
    },
  );
  assert.equal(result.user.status, 'suspended');
  assert.equal(result.revokedSessionCount, 2);
  assert.ok(
    context.repository
      .snapshot()
      .sessions.filter((session) => session.userId === 'target')
      .every((session) => session.revokedAt?.getTime() === NOW.getTime()),
  );

  await assert.rejects(
    context.service.changeAccountStatus(authentication('admin', 'superadmin'), 'admin', {
      reason: 'The active operator cannot suspend their own authority session',
      revision: 1,
      status: 'suspended',
    }),
    expectCode('self_authority_change_denied'),
  );
});

test('permanent user deletion removes the account and sessions while retaining an audit event', async () => {
  const context = harness({
    sessions: [{ id: 'target-session', revokedAt: null, userId: 'target' }],
    users: [user('admin', { platformRole: 'superadmin' }), user('target')],
  });

  const result = await context.service.deleteUser(
    authentication('admin', 'superadmin'),
    'target',
    { reason: 'Approved permanent account erasure request', revision: 1 },
  );
  const snapshot = context.repository.snapshot();

  assert.equal(result.deletedUserId, 'target');
  assert.equal(result.revokedSessionCount, 1);
  assert.equal(snapshot.users.some((entry) => entry.id === 'target'), false);
  assert.equal(snapshot.sessions.some((entry) => entry.userId === 'target'), false);
  assert.equal(result.auditEvent.action, 'account_delete');
});

test('ownership transfer atomically changes owner, roles, revision, and audit state', async () => {
  const context = harness({
    memberships: [
      {
        id: 'member-owner',
        organizationId: 'org-1',
        role: 'owner',
        status: 'active',
        userId: 'owner',
      },
      {
        id: 'member-target',
        organizationId: 'org-1',
        role: 'instructor',
        status: 'active',
        userId: 'target',
      },
    ],
    organizations: [
      {
        id: 'org-1',
        name: 'Verified Learning',
        ownerUserId: 'owner',
        revision: 4,
        verificationStatus: 'approved',
      },
    ],
    users: [user('owner'), user('target')],
  });

  const result = await context.service.transferOrganizationOwnership(
    authentication('owner'),
    'org-1',
    {
      reason: 'Ownership transfer approved by both organization principals',
      revision: 4,
      targetUserId: 'target',
    },
  );
  assert.equal(result.organization.ownerUserId, 'target');
  assert.equal(result.organization.revision, 5);
  assert.equal(result.actorMembership.role, 'admin');
  assert.equal(result.targetMembership.role, 'owner');
  assert.equal(result.auditEvent.organizationId, 'org-1');
  assert.deepEqual(result.auditEvent.beforeState, {
    organizationRole: 'owner',
    ownerUserId: 'owner',
    revision: 4,
  });

  await assert.rejects(
    context.service.transferOrganizationOwnership(authentication('owner'), 'org-1', {
      reason: 'A stale ownership screen cannot repeat or overwrite transfer',
      revision: 4,
      targetUserId: 'target',
    }),
    expectCode('deny_by_default'),
  );
});

test('audit listing is superadmin-only, bounded, ordered, and excludes credentials', async () => {
  const context = harness({
    users: [user('admin', { platformRole: 'superadmin' }), user('target')],
  });
  await context.service.changePlatformRole(authentication('admin', 'superadmin'), 'target', {
    platformRole: 'moderator',
    reason: 'Moderator role approved for incident response coverage',
    revision: 1,
  });

  await assert.rejects(
    context.service.listAuditEvents(authentication('target', 'moderator')),
    expectCode('deny_by_default'),
  );
  const events = await context.service.listAuditEvents(authentication('admin', 'superadmin'), {
    limit: 10,
  });
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /@example\.test|password|token|operationKey/i);
});
