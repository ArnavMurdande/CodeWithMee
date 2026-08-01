'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ACCESS_TOKEN_CLAIMS,
  AUTH_IDENTITY_PROVIDER,
  PLATFORM_ROLE,
  SESSION_CLIENT,
  USER_STATUS,
} = require('../modules/identity/contracts');
const {
  COURSE_STAFF_ROLE,
  COURSE_STAFF_STATUS,
  ORGANIZATION_MEMBERSHIP_STATUS,
  ORGANIZATION_ROLE,
  ORGANIZATION_VERIFICATION_STATUS,
} = require('../modules/organizations/contracts');
const { AUTHORIZATION_REASON, evaluatePermission } = require('../modules/policies/authorize');
const {
  COURSE_SCOPED_PERMISSIONS,
  COURSE_STAFF_ROLE_PERMISSIONS,
  KNOWN_PERMISSIONS,
  ORGANIZATION_ROLE_ALLOWED_COURSE_ROLES,
  ORGANIZATION_ROLE_PERMISSIONS,
  PERMISSION,
  PLATFORM_ROLE_PERMISSIONS,
} = require('../modules/policies/permissions');

function principal(overrides = {}) {
  return {
    emailVerified: true,
    platformRole: PLATFORM_ROLE.LEARNER,
    sessionId: 'session-1',
    status: USER_STATUS.ACTIVE,
    userId: 'user-1',
    ...overrides,
  };
}

function organizationContext(overrides = {}) {
  const base = {
    organization: {
      id: 'organization-1',
      verificationStatus: ORGANIZATION_VERIFICATION_STATUS.APPROVED,
    },
    membership: {
      organizationId: 'organization-1',
      role: ORGANIZATION_ROLE.OWNER,
      status: ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE,
      userId: 'user-1',
    },
  };

  return {
    ...base,
    ...overrides,
    membership: { ...base.membership, ...overrides.membership },
    organization: { ...base.organization, ...overrides.organization },
  };
}

function courseContext(overrides = {}) {
  const base = organizationContext();
  return {
    ...base,
    course: { id: 'course-1', organizationId: 'organization-1' },
    ...overrides,
    membership: { ...base.membership, ...overrides.membership },
    organization: { ...base.organization, ...overrides.organization },
  };
}

test('identity, session, organization and role enums are stable and non-overlapping contracts', () => {
  assert.deepEqual(ACCESS_TOKEN_CLAIMS, ['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);
  assert.deepEqual(Object.values(AUTH_IDENTITY_PROVIDER).sort(), ['google', 'local']);
  assert.deepEqual(Object.values(SESSION_CLIENT).sort(), ['extension', 'web']);
  assert.deepEqual(Object.values(PLATFORM_ROLE).sort(), [
    'learner',
    'moderator',
    'superadmin',
    'support',
  ]);
  assert.deepEqual(Object.values(ORGANIZATION_ROLE).sort(), [
    'admin',
    'analyst',
    'grader',
    'instructor',
    'owner',
  ]);
  assert.deepEqual(Object.values(COURSE_STAFF_ROLE).sort(), [
    'analyst',
    'grader',
    'instructor',
    'manager',
    'payment_reviewer',
  ]);
});

test('every role grant names a known permission and platform roles do not gain tenant content access', () => {
  assert.equal(new Set(KNOWN_PERMISSIONS).size, KNOWN_PERMISSIONS.length);

  const grantMaps = [
    PLATFORM_ROLE_PERMISSIONS,
    ORGANIZATION_ROLE_PERMISSIONS,
    COURSE_STAFF_ROLE_PERMISSIONS,
  ];
  for (const grants of grantMaps) {
    for (const permissions of Object.values(grants)) {
      for (const permission of permissions) {
        assert.ok(KNOWN_PERMISSIONS.includes(permission), permission);
      }
    }
  }

  for (const permissions of Object.values(PLATFORM_ROLE_PERMISSIONS)) {
    assert.equal(
      permissions.some((permission) => COURSE_SCOPED_PERMISSIONS.includes(permission)),
      false,
    );
  }
});

test('authorization denies unknown, unauthenticated, inactive and cross-user requests by default', () => {
  assert.equal(
    evaluatePermission({ permission: 'invented:permission' }).reason,
    'unknown_permission',
  );
  assert.equal(
    evaluatePermission({ permission: PERMISSION.PROFILE_READ_SELF }).reason,
    'unauthenticated',
  );

  const banned = evaluatePermission({
    context: { targetUserId: 'user-1' },
    permission: PERMISSION.PROFILE_READ_SELF,
    principal: principal({ status: USER_STATUS.BANNED }),
  });
  assert.deepEqual(banned, {
    allowed: false,
    reason: AUTHORIZATION_REASON.ACCOUNT_INACTIVE,
    source: null,
  });

  const otherUser = evaluatePermission({
    context: { targetUserId: 'user-2' },
    permission: PERMISSION.SESSION_REVOKE_SELF,
    principal: principal(),
  });
  assert.equal(otherUser.reason, AUTHORIZATION_REASON.SELF_SCOPE_MISMATCH);
});

test('verified email and recent authentication gates are independent of roles', () => {
  const unverifiedOrganizationCreate = evaluatePermission({
    permission: PERMISSION.ORGANIZATION_CREATE,
    principal: principal({ emailVerified: false, platformRole: PLATFORM_ROLE.SUPERADMIN }),
  });
  assert.equal(unverifiedOrganizationCreate.reason, AUTHORIZATION_REASON.EMAIL_UNVERIFIED);

  const staleSessionRevoke = evaluatePermission({
    context: { targetUserId: 'user-1' },
    permission: PERMISSION.SESSION_REVOKE_ALL_SELF,
    principal: principal(),
  });
  assert.equal(staleSessionRevoke.reason, AUTHORIZATION_REASON.RECENT_AUTHENTICATION_REQUIRED);

  const recentSessionRevoke = evaluatePermission({
    context: { recentAuthentication: true, targetUserId: 'user-1' },
    permission: PERMISSION.SESSION_REVOKE_ALL_SELF,
    principal: principal(),
  });
  assert.equal(recentSessionRevoke.allowed, true);
});

test('organization permissions require active same-tenant membership and preserve role hierarchy', () => {
  const ownerTransfer = evaluatePermission({
    context: organizationContext({ recentAuthentication: true }),
    permission: PERMISSION.ORGANIZATION_OWNERSHIP_TRANSFER,
    principal: principal(),
  });
  assert.equal(ownerTransfer.allowed, true);

  const adminTransfer = evaluatePermission({
    context: organizationContext({
      membership: { role: ORGANIZATION_ROLE.ADMIN },
      recentAuthentication: true,
    }),
    permission: PERMISSION.ORGANIZATION_OWNERSHIP_TRANSFER,
    principal: principal(),
  });
  assert.equal(adminTransfer.reason, AUTHORIZATION_REASON.DENY_BY_DEFAULT);

  const crossTenant = evaluatePermission({
    context: organizationContext({ membership: { organizationId: 'organization-2' } }),
    permission: PERMISSION.ORGANIZATION_UPDATE,
    principal: principal(),
  });
  assert.equal(crossTenant.reason, AUTHORIZATION_REASON.TENANT_SCOPE_MISMATCH);
});

test('pending providers may author drafts but cannot publish or operate enrollments', () => {
  const pendingContext = courseContext({
    organization: { verificationStatus: ORGANIZATION_VERIFICATION_STATUS.PENDING_REVIEW },
  });

  const draft = evaluatePermission({
    context: pendingContext,
    permission: PERMISSION.COURSE_DRAFT_WRITE,
    principal: principal(),
  });
  assert.equal(draft.allowed, true);

  for (const permission of [PERMISSION.COURSE_PUBLISH, PERMISSION.COURSE_ENROLLMENTS_MANAGE]) {
    const denied = evaluatePermission({
      context: pendingContext,
      permission,
      principal: principal(),
    });
    assert.equal(denied.reason, AUTHORIZATION_REASON.ORGANIZATION_NOT_APPROVED);
  }
});

test('course assignments narrow organization roles and cannot elevate a membership', () => {
  const instructorContext = courseContext({
    courseAssignment: {
      organizationId: 'organization-1',
      courseId: 'course-1',
      publishAllowed: false,
      role: COURSE_STAFF_ROLE.INSTRUCTOR,
      status: COURSE_STAFF_STATUS.ACTIVE,
      userId: 'user-1',
    },
    membership: { role: ORGANIZATION_ROLE.INSTRUCTOR },
  });

  assert.equal(
    evaluatePermission({
      context: instructorContext,
      permission: PERMISSION.COURSE_DRAFT_WRITE,
      principal: principal(),
    }).allowed,
    true,
  );
  assert.equal(
    evaluatePermission({
      context: instructorContext,
      permission: PERMISSION.COURSE_PUBLISH,
      principal: principal(),
    }).reason,
    AUTHORIZATION_REASON.COURSE_ROLE_DENIED,
  );

  const explicitlyPublishing = {
    ...instructorContext,
    courseAssignment: { ...instructorContext.courseAssignment, publishAllowed: true },
  };
  assert.equal(
    evaluatePermission({
      context: explicitlyPublishing,
      permission: PERMISSION.COURSE_PUBLISH,
      principal: principal(),
    }).allowed,
    true,
  );

  const graderEscalation = courseContext({
    courseAssignment: {
      organizationId: 'organization-1',
      courseId: 'course-1',
      role: COURSE_STAFF_ROLE.MANAGER,
      status: COURSE_STAFF_STATUS.ACTIVE,
      userId: 'user-1',
    },
    membership: { role: ORGANIZATION_ROLE.GRADER },
  });
  assert.equal(
    evaluatePermission({
      context: graderEscalation,
      permission: PERMISSION.COURSE_DRAFT_WRITE,
      principal: principal(),
    }).reason,
    AUTHORIZATION_REASON.COURSE_ROLE_DENIED,
  );

  assert.deepEqual(ORGANIZATION_ROLE_ALLOWED_COURSE_ROLES[ORGANIZATION_ROLE.GRADER], [
    COURSE_STAFF_ROLE.GRADER,
  ]);
});

test('platform administration is independent from tenant data and break-glass is never implicit', () => {
  const superadmin = principal({ platformRole: PLATFORM_ROLE.SUPERADMIN });
  const verificationReview = evaluatePermission({
    context: { organization: { id: 'organization-1' }, recentAuthentication: true },
    permission: PERMISSION.ORGANIZATION_VERIFICATION_REVIEW,
    principal: superadmin,
  });
  assert.equal(verificationReview.allowed, true);

  const privateCourse = evaluatePermission({
    context: courseContext({
      membership: { status: ORGANIZATION_MEMBERSHIP_STATUS.SUSPENDED },
    }),
    permission: PERMISSION.COURSE_DRAFT_READ,
    principal: superadmin,
  });
  assert.equal(privateCourse.reason, AUTHORIZATION_REASON.MEMBERSHIP_INACTIVE);

  const moderatorRoleGrant = evaluatePermission({
    context: { recentAuthentication: true },
    permission: PERMISSION.PLATFORM_ROLE_MANAGE,
    principal: principal({ platformRole: PLATFORM_ROLE.MODERATOR }),
  });
  assert.equal(moderatorRoleGrant.reason, AUTHORIZATION_REASON.DENY_BY_DEFAULT);

  const breakGlassWithoutRecentAuth = evaluatePermission({
    permission: PERMISSION.BREAK_GLASS_REQUEST,
    principal: superadmin,
  });
  assert.equal(
    breakGlassWithoutRecentAuth.reason,
    AUTHORIZATION_REASON.RECENT_AUTHENTICATION_REQUIRED,
  );
});
