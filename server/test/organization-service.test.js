'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { PLATFORM_ROLE, USER_STATUS } = require('../modules/identity/contracts');
const { createCaptureIdentityMailer } = require('../modules/identity/mailer');
const { createMemoryIdentityRepository } = require('../modules/identity/memory-repository');
const { evaluatePermission } = require('../modules/policies/authorize');
const { PERMISSION } = require('../modules/policies/permissions');
const {
  createMemoryOrganizationRepository,
} = require('../modules/organizations/memory-repository');
const { createOrganizationService } = require('../modules/organizations/service');

const PEPPER = 'organization-invitation-pepper-'.padEnd(40, 'x');

function user(id, email, overrides = {}) {
  return {
    avatarUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    displayName: id,
    email,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    id,
    platformRole: PLATFORM_ROLE.LEARNER,
    status: USER_STATUS.ACTIVE,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    username: null,
    ...overrides,
  };
}

function authentication(account, authenticatedAt = new Date('2026-03-01T12:00:00.000Z')) {
  return {
    principal: {
      emailVerified: Boolean(account.emailVerifiedAt),
      platformRole: account.platformRole,
      sessionId: `session-${account.id}`,
      status: account.status,
      userId: account.id,
    },
    session: { authenticatedAt, id: `session-${account.id}` },
    user: account,
  };
}

function expectCode(code) {
  return (error) => error?.code === code;
}

function createHarness() {
  const users = [
    user('owner-a', 'owner-a@example.test'),
    user('owner-b', 'owner-b@example.test'),
    user('admin-a', 'admin-a@example.test'),
    user('admin-b', 'admin-b@example.test'),
    user('instructor-a', 'instructor-a@example.test'),
    user('unverified', 'unverified@example.test', { emailVerifiedAt: null }),
    user('moderator', 'moderator@example.test', { platformRole: PLATFORM_ROLE.MODERATOR }),
    user('superadmin', 'superadmin@example.test', { platformRole: PLATFORM_ROLE.SUPERADMIN }),
  ];
  let currentTime = new Date('2026-03-01T12:00:00.000Z');
  const identityRepository = createMemoryIdentityRepository({ users });
  const organizationRepository = createMemoryOrganizationRepository();
  const mailer = createCaptureIdentityMailer();
  const service = createOrganizationService({
    identityRepository,
    invitationTokenPepper: PEPPER,
    mailer,
    now: () => new Date(currentTime),
    recentAuthenticationMs: 10 * 60 * 1_000,
    repository: organizationRepository,
  });
  return {
    account(id) {
      return users.find((entry) => entry.id === id);
    },
    advance(milliseconds) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    auth(id, authenticatedAt = currentTime) {
      return authentication(this.account(id), authenticatedAt);
    },
    mailer,
    organizationRepository,
    service,
  };
}

async function createOrganization(harness, ownerId = 'owner-a', suffix = 'alpha') {
  return harness.service.createOrganization(harness.auth(ownerId), {
    description: 'A provider organization used for contract tests.',
    industry: 'Education',
    name: `Provider ${suffix}`,
    slug: `provider-${suffix}`,
  });
}

async function inviteAndAccept(harness, ownerAuth, organizationId, targetId, role) {
  const target = harness.account(targetId);
  const invitation = await harness.service.inviteMember(ownerAuth, organizationId, {
    email: target.email,
    role,
  });
  const message = harness.mailer.messages.at(-1);
  const accepted = await harness.service.acceptInvitation(harness.auth(targetId), message.token);
  return { accepted, invitation, token: message.token };
}

test('verified users create isolated draft organizations with an immutable owner membership', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.service.createOrganization(harness.auth('unverified'), {
      name: 'Unverified Provider',
      slug: 'unverified-provider',
    }),
    expectCode('email_unverified'),
  );

  const first = await createOrganization(harness, 'owner-a', 'alpha');
  const second = await createOrganization(harness, 'owner-b', 'beta');
  assert.equal(first.organization.verificationStatus, 'draft');
  assert.equal(first.membership.role, 'owner');
  assert.equal(first.membership.organizationId, first.organization.id);
  assert.notEqual(first.organization.id, second.organization.id);

  await assert.rejects(
    harness.service.getOrganization(harness.auth('owner-b'), first.organization.id),
    expectCode('membership_inactive'),
  );
  const mine = await harness.service.listMyOrganizations(harness.auth('owner-a'));
  assert.deepEqual(
    mine.map((entry) => entry.organization.id),
    [first.organization.id],
  );

  const snapshot = harness.organizationRepository.snapshot();
  assert.equal(snapshot.organizations.length, 2);
  assert.equal(snapshot.memberships.filter((entry) => entry.role === 'owner').length, 2);
});

test('invitations are email-bound, expiring, single-use, and never return raw secrets', async () => {
  const harness = createHarness();
  const created = await createOrganization(harness);
  const invitation = await harness.service.inviteMember(
    harness.auth('owner-a'),
    created.organization.id,
    { email: 'admin-a@example.test', role: 'admin' },
  );
  assert.equal(Object.hasOwn(invitation, 'token'), false);
  assert.equal(Object.hasOwn(invitation, 'tokenHash'), false);
  const rawToken = harness.mailer.messages[0].token;
  assert.match(rawToken, /^oi1\./);

  const stored = harness.organizationRepository.snapshot().invitations[0];
  assert.notEqual(stored.tokenHash, rawToken);
  assert.equal(stored.tokenHash.length, 64);

  await assert.rejects(
    harness.service.acceptInvitation(harness.auth('admin-b'), rawToken),
    expectCode('invalid_or_expired_invitation'),
  );
  const accepted = await harness.service.acceptInvitation(harness.auth('admin-a'), rawToken);
  assert.equal(accepted.membership.role, 'admin');
  await assert.rejects(
    harness.service.acceptInvitation(harness.auth('admin-a'), rawToken),
    expectCode('invalid_or_expired_invitation'),
  );

  await harness.service.inviteMember(harness.auth('owner-a'), created.organization.id, {
    email: 'instructor-a@example.test',
    role: 'instructor',
  });
  const expiringToken = harness.mailer.messages.at(-1).token;
  harness.advance(8 * 24 * 60 * 60 * 1_000);
  await assert.rejects(
    harness.service.acceptInvitation(harness.auth('instructor-a'), expiringToken),
    expectCode('invalid_or_expired_invitation'),
  );
});

test('owner/admin hierarchy and tenant boundaries prevent membership escalation and IDOR', async () => {
  const harness = createHarness();
  const first = await createOrganization(harness, 'owner-a', 'alpha');
  const second = await createOrganization(harness, 'owner-b', 'beta');
  await inviteAndAccept(
    harness,
    harness.auth('owner-a'),
    first.organization.id,
    'admin-a',
    'admin',
  );
  await inviteAndAccept(
    harness,
    harness.auth('owner-a'),
    first.organization.id,
    'admin-b',
    'admin',
  );
  await inviteAndAccept(
    harness,
    harness.auth('owner-a'),
    first.organization.id,
    'instructor-a',
    'instructor',
  );

  await assert.rejects(
    harness.service.inviteMember(harness.auth('admin-a'), first.organization.id, {
      email: 'moderator@example.test',
      role: 'admin',
    }),
    expectCode('membership_hierarchy_denied'),
  );
  await assert.rejects(
    harness.service.updateMembership(harness.auth('admin-a'), first.organization.id, 'admin-b', {
      status: 'suspended',
    }),
    expectCode('membership_hierarchy_denied'),
  );
  await assert.rejects(
    harness.service.updateMembership(harness.auth('admin-a'), first.organization.id, 'owner-a', {
      status: 'revoked',
    }),
    expectCode('ownership_transfer_required'),
  );
  await assert.rejects(
    harness.service.listMemberships(harness.auth('admin-a'), second.organization.id),
    expectCode('membership_inactive'),
  );

  const updated = await harness.service.updateMembership(
    harness.auth('owner-a'),
    first.organization.id,
    'instructor-a',
    { role: 'grader', status: 'suspended' },
  );
  assert.equal(updated.role, 'grader');
  assert.equal(updated.status, 'suspended');
});

test('organization updates require optimistic revisions and ignore privileged fields', async () => {
  const harness = createHarness();
  const created = await createOrganization(harness);
  const updated = await harness.service.updateOrganization(
    harness.auth('owner-a'),
    created.organization.id,
    {
      name: 'Provider Alpha Updated',
      ownerUserId: 'attacker',
      revision: created.organization.revision,
      slug: 'attempted-slug-change',
      verificationStatus: 'approved',
    },
  );
  assert.equal(updated.name, 'Provider Alpha Updated');
  assert.equal(updated.ownerUserId, 'owner-a');
  assert.equal(updated.slug, 'provider-alpha');
  assert.equal(updated.verificationStatus, 'draft');
  await assert.rejects(
    harness.service.updateOrganization(harness.auth('owner-a'), created.organization.id, {
      description: 'stale update',
      revision: created.organization.revision,
    }),
    expectCode('organization_revision_conflict'),
  );
});

test('provider verification is recent-auth superadmin-only and gates publishing', async () => {
  const harness = createHarness();
  const created = await createOrganization(harness);
  const submitted = await harness.service.submitVerification(
    harness.auth('owner-a'),
    created.organization.id,
    { statement: 'We own and operate this educational provider account.' },
  );
  assert.equal(submitted.organization.verificationStatus, 'pending_review');
  await assert.rejects(
    harness.service.submitVerification(harness.auth('owner-a'), created.organization.id, {
      statement: 'This second submission must be rejected while one is pending.',
    }),
    expectCode('verification_submission_unavailable'),
  );

  const snapshot = harness.organizationRepository.snapshot();
  const organization = snapshot.organizations[0];
  const membership = snapshot.memberships[0];
  const course = { id: 'course-alpha', organizationId: organization.id };
  assert.equal(
    evaluatePermission({
      context: { course, membership, organization },
      permission: PERMISSION.COURSE_DRAFT_WRITE,
      principal: harness.auth('owner-a').principal,
    }).allowed,
    true,
  );
  assert.equal(
    evaluatePermission({
      context: { course, membership, organization },
      permission: PERMISSION.COURSE_PUBLISH,
      principal: harness.auth('owner-a').principal,
    }).reason,
    'organization_not_approved',
  );

  await assert.rejects(
    harness.service.listVerificationReviews(harness.auth('moderator')),
    expectCode('deny_by_default'),
  );
  await assert.rejects(
    harness.service.listVerificationReviews(
      harness.auth('superadmin', new Date('2026-03-01T11:00:00.000Z')),
    ),
    expectCode('recent_authentication_required'),
  );
  const queue = await harness.service.listVerificationReviews(harness.auth('superadmin'));
  assert.equal(queue.length, 1);
  const decided = await harness.service.decideVerification(
    harness.auth('superadmin'),
    queue[0].id,
    { status: 'approved' },
  );
  assert.equal(decided.organization.verificationStatus, 'approved');
  assert.equal(
    evaluatePermission({
      context: {
        course,
        membership,
        organization: { ...organization, verificationStatus: 'approved' },
      },
      permission: PERMISSION.COURSE_PUBLISH,
      principal: harness.auth('owner-a').principal,
    }).allowed,
    true,
  );

  const publicView = await harness.service.getOrganization(null, created.organization.id);
  assert.equal(publicView.id, created.organization.id);
  assert.equal(Object.hasOwn(publicView, 'ownerUserId'), false);
});
