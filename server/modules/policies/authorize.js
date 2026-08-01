'use strict';

const { PLATFORM_ROLE, USER_STATUS, hasEnumValue } = require('../identity/contracts');
const {
  COURSE_STAFF_STATUS,
  ORGANIZATION_MEMBERSHIP_STATUS,
  ORGANIZATION_ROLE,
  ORGANIZATION_VERIFICATION_STATUS,
} = require('../organizations/contracts');
const {
  APPROVED_ORGANIZATION_PERMISSIONS,
  BASE_AUTHENTICATED_PERMISSIONS,
  COURSE_SCOPED_PERMISSIONS,
  COURSE_STAFF_ROLE_PERMISSIONS,
  KNOWN_PERMISSIONS,
  ORGANIZATION_ROLE_ALLOWED_COURSE_ROLES,
  ORGANIZATION_ROLE_PERMISSIONS,
  ORGANIZATION_SCOPED_PERMISSIONS,
  PERMISSION,
  PLATFORM_ROLE_PERMISSIONS,
  RECENT_AUTHENTICATION_PERMISSIONS,
  SELF_SCOPED_PERMISSIONS,
  VERIFIED_EMAIL_PERMISSIONS,
} = require('./permissions');

const AUTHORIZATION_REASON = Object.freeze({
  ACCOUNT_INACTIVE: 'account_inactive',
  ALLOWED: 'allowed',
  COURSE_ASSIGNMENT_REQUIRED: 'course_assignment_required',
  COURSE_CONTEXT_REQUIRED: 'course_context_required',
  COURSE_ROLE_DENIED: 'course_role_denied',
  COURSE_SCOPE_MISMATCH: 'course_scope_mismatch',
  DENY_BY_DEFAULT: 'deny_by_default',
  EMAIL_UNVERIFIED: 'email_unverified',
  MEMBERSHIP_INACTIVE: 'membership_inactive',
  ORGANIZATION_CONTEXT_REQUIRED: 'organization_context_required',
  ORGANIZATION_NOT_APPROVED: 'organization_not_approved',
  RECENT_AUTHENTICATION_REQUIRED: 'recent_authentication_required',
  SELF_SCOPE_MISMATCH: 'self_scope_mismatch',
  TENANT_SCOPE_MISMATCH: 'tenant_scope_mismatch',
  UNAUTHENTICATED: 'unauthenticated',
  UNKNOWN_PERMISSION: 'unknown_permission',
});

function decision(allowed, reason, source = null) {
  return Object.freeze({ allowed, reason, source });
}

function includes(values, candidate) {
  return values.includes(candidate);
}

function hasAuthenticatedShape(principal) {
  return Boolean(
    principal &&
    typeof principal.userId === 'string' &&
    principal.userId.length > 0 &&
    typeof principal.sessionId === 'string' &&
    principal.sessionId.length > 0 &&
    hasEnumValue(USER_STATUS, principal.status) &&
    hasEnumValue(PLATFORM_ROLE, principal.platformRole),
  );
}

function hasOrganizationContext(context) {
  return Boolean(
    context.organization &&
    typeof context.organization.id === 'string' &&
    context.organization.id.length > 0,
  );
}

function hasActiveMembership(principal, organization, membership) {
  return Boolean(
    membership &&
    membership.status === ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE &&
    membership.userId === principal.userId &&
    membership.organizationId === organization.id &&
    Object.values(ORGANIZATION_ROLE).includes(membership.role),
  );
}

function hasCourseContext(context) {
  return Boolean(
    context.course &&
    typeof context.course.id === 'string' &&
    context.course.id.length > 0 &&
    typeof context.course.organizationId === 'string' &&
    context.course.organizationId.length > 0,
  );
}

function hasActiveCourseAssignment(principal, course, assignment) {
  return Boolean(
    assignment &&
    assignment.status === COURSE_STAFF_STATUS.ACTIVE &&
    assignment.userId === principal.userId &&
    assignment.courseId === course.id &&
    assignment.organizationId === course.organizationId &&
    Object.hasOwn(COURSE_STAFF_ROLE_PERMISSIONS, assignment.role),
  );
}

function evaluatePermission(input = {}) {
  const { context = {}, permission, principal } = input;

  if (!KNOWN_PERMISSIONS.includes(permission)) {
    return decision(false, AUTHORIZATION_REASON.UNKNOWN_PERMISSION);
  }

  if (!hasAuthenticatedShape(principal)) {
    return decision(false, AUTHORIZATION_REASON.UNAUTHENTICATED);
  }

  if (principal.status !== USER_STATUS.ACTIVE) {
    return decision(false, AUTHORIZATION_REASON.ACCOUNT_INACTIVE);
  }

  if (includes(SELF_SCOPED_PERMISSIONS, permission) && context.targetUserId !== principal.userId) {
    return decision(false, AUTHORIZATION_REASON.SELF_SCOPE_MISMATCH);
  }

  if (includes(VERIFIED_EMAIL_PERMISSIONS, permission) && principal.emailVerified !== true) {
    return decision(false, AUTHORIZATION_REASON.EMAIL_UNVERIFIED);
  }

  if (
    includes(RECENT_AUTHENTICATION_PERMISSIONS, permission) &&
    context.recentAuthentication !== true
  ) {
    return decision(false, AUTHORIZATION_REASON.RECENT_AUTHENTICATION_REQUIRED);
  }

  const platformPermissions = PLATFORM_ROLE_PERMISSIONS[principal.platformRole] || [];
  const hasPlatformGrant =
    includes(BASE_AUTHENTICATED_PERMISSIONS, permission) ||
    includes(platformPermissions, permission);
  const needsOrganization =
    includes(ORGANIZATION_SCOPED_PERMISSIONS, permission) ||
    includes(COURSE_SCOPED_PERMISSIONS, permission);

  if (needsOrganization && !hasOrganizationContext(context)) {
    return decision(false, AUTHORIZATION_REASON.ORGANIZATION_CONTEXT_REQUIRED);
  }

  if (hasPlatformGrant) {
    return decision(true, AUTHORIZATION_REASON.ALLOWED, 'platform_role');
  }

  if (!needsOrganization) {
    return decision(false, AUTHORIZATION_REASON.DENY_BY_DEFAULT);
  }

  const { organization } = context;

  if (
    includes(APPROVED_ORGANIZATION_PERMISSIONS, permission) &&
    organization.verificationStatus !== ORGANIZATION_VERIFICATION_STATUS.APPROVED
  ) {
    return decision(false, AUTHORIZATION_REASON.ORGANIZATION_NOT_APPROVED);
  }

  if (!hasActiveMembership(principal, organization, context.membership)) {
    const membershipMatchesUser = context.membership?.userId === principal.userId;
    const membershipMatchesOrganization = context.membership?.organizationId === organization.id;

    if (context.membership && membershipMatchesUser && !membershipMatchesOrganization) {
      return decision(false, AUTHORIZATION_REASON.TENANT_SCOPE_MISMATCH);
    }

    return decision(false, AUTHORIZATION_REASON.MEMBERSHIP_INACTIVE);
  }

  const membership = context.membership;
  const organizationPermissions = ORGANIZATION_ROLE_PERMISSIONS[membership.role] || [];

  if (!includes(COURSE_SCOPED_PERMISSIONS, permission)) {
    if (includes(organizationPermissions, permission)) {
      return decision(true, AUTHORIZATION_REASON.ALLOWED, 'organization_role');
    }

    return decision(false, AUTHORIZATION_REASON.DENY_BY_DEFAULT);
  }

  if (permission === PERMISSION.COURSE_CREATE) {
    if (includes(organizationPermissions, permission)) {
      return decision(true, AUTHORIZATION_REASON.ALLOWED, 'organization_role');
    }

    return decision(false, AUTHORIZATION_REASON.COURSE_ROLE_DENIED);
  }

  if (!hasCourseContext(context)) {
    return decision(false, AUTHORIZATION_REASON.COURSE_CONTEXT_REQUIRED);
  }

  if (context.course.organizationId !== organization.id) {
    return decision(false, AUTHORIZATION_REASON.COURSE_SCOPE_MISMATCH);
  }

  if (includes(organizationPermissions, permission)) {
    return decision(true, AUTHORIZATION_REASON.ALLOWED, 'organization_role');
  }

  if (!hasActiveCourseAssignment(principal, context.course, context.courseAssignment)) {
    return decision(false, AUTHORIZATION_REASON.COURSE_ASSIGNMENT_REQUIRED);
  }

  const assignment = context.courseAssignment;
  const allowedCourseRoles = ORGANIZATION_ROLE_ALLOWED_COURSE_ROLES[membership.role] || [];
  if (!includes(allowedCourseRoles, assignment.role)) {
    return decision(false, AUTHORIZATION_REASON.COURSE_ROLE_DENIED);
  }

  const assignmentPermissions = COURSE_STAFF_ROLE_PERMISSIONS[assignment.role] || [];
  const separatelyGrantedInstructorPublish =
    permission === PERMISSION.COURSE_PUBLISH &&
    assignment.role === 'instructor' &&
    assignment.publishAllowed === true;

  if (includes(assignmentPermissions, permission) || separatelyGrantedInstructorPublish) {
    return decision(true, AUTHORIZATION_REASON.ALLOWED, 'course_role');
  }

  return decision(false, AUTHORIZATION_REASON.COURSE_ROLE_DENIED);
}

module.exports = {
  AUTHORIZATION_REASON,
  evaluatePermission,
};
