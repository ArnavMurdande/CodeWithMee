'use strict';

const { PERMISSION } = require('../policies/permissions');
const { operations } = require('./operations');

const AUTHORIZATION_MODE = Object.freeze({
  AUTHENTICATED: 'authenticated',
  OAUTH_STATE: 'oauth_state',
  OPTIONAL_ORGANIZATION: 'optional_public_or_organization',
  ORGANIZATION_PERMISSION: 'organization_permission',
  PLATFORM_PERMISSION: 'platform_permission',
  PUBLIC: 'public',
  REFRESH_SESSION: 'refresh_session_csrf',
  RESOURCE_POLICY: 'resource_policy',
  SELF: 'self',
  SINGLE_USE_TOKEN: 'single_use_token',
});

const SENSITIVE_CAPABILITY = Object.freeze({
  ACCESS_TOKEN: 'access_token',
  DOWNLOAD_URL: 'download_url',
  NONE: 'none',
  UPLOAD_URL: 'upload_url',
});

const coverage = new Map();

function declare(ids, metadata) {
  for (const operationId of ids) {
    if (coverage.has(operationId)) throw new Error(`Duplicate security coverage: ${operationId}`);
    coverage.set(
      operationId,
      Object.freeze({
        capability: SENSITIVE_CAPABILITY.NONE,
        permission: null,
        ...metadata,
      }),
    );
  }
}

declare(['getOpenApiDocument'], {
  authorization: AUTHORIZATION_MODE.PUBLIC,
  exposure: 'public_contract',
  scope: 'global',
});
declare(['getLiveness', 'getReadiness'], {
  authorization: AUTHORIZATION_MODE.PUBLIC,
  exposure: 'aggregate_health',
  scope: 'global',
});
declare(['getDependencyReadiness'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'dependency_status',
  permission: PERMISSION.PLATFORM_AUDIT_READ,
  scope: 'platform',
});
declare(['register', 'login'], {
  authorization: AUTHORIZATION_MODE.PUBLIC,
  capability: SENSITIVE_CAPABILITY.ACCESS_TOKEN,
  exposure: 'credential_exchange',
  scope: 'new_session',
});
declare(['refreshSession'], {
  authorization: AUTHORIZATION_MODE.REFRESH_SESSION,
  capability: SENSITIVE_CAPABILITY.ACCESS_TOKEN,
  exposure: 'credential_exchange',
  scope: 'owned_session',
});
declare(['logout'], {
  authorization: AUTHORIZATION_MODE.REFRESH_SESSION,
  exposure: 'none',
  scope: 'owned_session',
});
declare(['logoutAll'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'none',
  permission: PERMISSION.SESSION_REVOKE_ALL_SELF,
  scope: 'self',
});
declare(['requestEmailVerification'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'generic_message',
  permission: PERMISSION.PROFILE_WRITE_SELF,
  scope: 'self',
});
declare(['confirmEmailVerification', 'resetPassword'], {
  authorization: AUTHORIZATION_MODE.SINGLE_USE_TOKEN,
  exposure: 'user_or_none',
  scope: 'token_subject',
});
declare(['requestPasswordReset'], {
  authorization: AUTHORIZATION_MODE.PUBLIC,
  exposure: 'non_enumerating_message',
  scope: 'global',
});
declare(['startGoogleLogin', 'completeGoogleLogin'], {
  authorization: AUTHORIZATION_MODE.OAUTH_STATE,
  exposure: 'safe_redirect',
  scope: 'oauth_transaction',
});
declare(['getMe'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'user',
  permission: PERMISSION.PROFILE_READ_SELF,
  scope: 'self',
});
declare(['getMyTheme'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'theme_preferences',
  permission: PERMISSION.PROFILE_READ_SELF,
  scope: 'self',
});
declare(['updateMyTheme'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'theme_preferences',
  permission: PERMISSION.PROFILE_WRITE_SELF,
  scope: 'self',
});
declare(['listMySessions'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'session_metadata',
  permission: PERMISSION.SESSION_LIST_SELF,
  scope: 'self',
});
declare(['revokeMySession'], {
  authorization: AUTHORIZATION_MODE.SELF,
  exposure: 'none',
  permission: PERMISSION.SESSION_REVOKE_SELF,
  scope: 'self',
});
declare(['listMyOrganizations'], {
  authorization: AUTHORIZATION_MODE.AUTHENTICATED,
  exposure: 'membership_and_organization',
  scope: 'self_memberships',
});
declare(['createOrganization'], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'membership_and_organization',
  permission: PERMISSION.ORGANIZATION_CREATE,
  scope: 'created_organization',
});
declare(['acceptOrganizationInvitation'], {
  authorization: AUTHORIZATION_MODE.AUTHENTICATED,
  exposure: 'invitation_and_membership',
  scope: 'email_bound_invitation',
});
declare(['listProviderVerificationReviews', 'decideProviderVerification'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'provider_review',
  permission: PERMISSION.ORGANIZATION_VERIFICATION_REVIEW,
  scope: 'platform',
});
declare(['getOrganization'], {
  authorization: AUTHORIZATION_MODE.OPTIONAL_ORGANIZATION,
  exposure: 'public_or_private_organization',
  permission: PERMISSION.ORGANIZATION_READ_PRIVATE,
  scope: 'organization',
});
declare(['updateOrganization'], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'private_organization',
  permission: PERMISSION.ORGANIZATION_UPDATE,
  scope: 'organization',
});
declare(['listOrganizationMembers'], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'membership',
  permission: PERMISSION.ORGANIZATION_MEMBERS_READ,
  scope: 'organization',
});
declare(['inviteOrganizationMember', 'updateOrganizationMember', 'removeOrganizationMember'], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'invitation_membership_or_none',
  permission: PERMISSION.ORGANIZATION_MEMBERS_MANAGE,
  scope: 'organization',
});
declare(['submitProviderVerification'], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'provider_review',
  permission: PERMISSION.ORGANIZATION_VERIFICATION_SUBMIT,
  scope: 'organization',
});
declare(['listAuthorityAuditEvents'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'redacted_authority_audit',
  permission: PERMISSION.PLATFORM_AUDIT_READ,
  scope: 'platform',
});
declare(['listAuthorityUsers'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'authority_user',
  permission: PERMISSION.PLATFORM_USERS_READ,
  scope: 'platform',
});
declare(['changePlatformRole'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'authority_change',
  permission: PERMISSION.PLATFORM_ROLE_MANAGE,
  scope: 'platform',
});
declare(['changeAccountStatus'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'authority_change',
  permission: PERMISSION.PLATFORM_ACCOUNT_STATUS_MANAGE,
  scope: 'platform',
});
declare(['deleteAuthorityUser'], {
  authorization: AUTHORIZATION_MODE.PLATFORM_PERMISSION,
  exposure: 'authority_change',
  permission: PERMISSION.PLATFORM_ACCOUNT_STATUS_MANAGE,
  scope: 'platform',
});
declare(['transferOrganizationOwnership'], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'ownership_change',
  permission: PERMISSION.ORGANIZATION_OWNERSHIP_TRANSFER,
  scope: 'organization',
});
declare(['createFileUploadIntent'], {
  authorization: AUTHORIZATION_MODE.RESOURCE_POLICY,
  capability: SENSITIVE_CAPABILITY.UPLOAD_URL,
  exposure: 'file_and_upload_capability',
  scope: 'user_or_organization_owner',
});
declare(['getFileMetadata', 'completeFileUpload', 'setFileVisibility', 'deleteFile'], {
  authorization: AUTHORIZATION_MODE.RESOURCE_POLICY,
  exposure: 'file_or_none',
  scope: 'file_owner_or_authorized_organization',
});
declare(['createFileDownload'], {
  authorization: AUTHORIZATION_MODE.RESOURCE_POLICY,
  capability: SENSITIVE_CAPABILITY.DOWNLOAD_URL,
  exposure: 'download_capability',
  scope: 'file_owner_or_authorized_organization',
});
declare(['listChallenges', 'getChallenge', 'listCourses', 'getCourse'], {
  authorization: AUTHORIZATION_MODE.PUBLIC,
  exposure: 'public_catalog',
  scope: 'global',
});
declare(['createChallenge', 'publishChallenge'], {
  authorization: AUTHORIZATION_MODE.AUTHENTICATED,
  exposure: 'challenge',
  scope: 'author',
});
declare(['runChallengeCode', 'submitChallengeCode', 'listChallengeSubmissions', 'getChallengeSubmission'], {
  authorization: AUTHORIZATION_MODE.AUTHENTICATED,
  exposure: 'submission',
  scope: 'learner',
});
declare(['enrollInCourse', 'getCourseProgress', 'getLessonProgress', 'updateLessonProgress'], {
  authorization: AUTHORIZATION_MODE.AUTHENTICATED,
  exposure: 'progress',
  scope: 'learner',
});
declare([
  'getProviderDashboard','listCourseStaff','setCourseStaffRole','getCourseStructure','replaceCourseStructure','getCourseRoster',
  'updateCourseEnrollment','inviteCourseLearner','listAssignmentGrading','listQuizGrading','gradeQuizAttempt',
  'gradeAssignmentSubmission','listPaymentReviews','getPaymentSettings','setPaymentSettings',
  'reviewManualPayment','getProviderCourseAnalytics','exportProviderCourseAnalytics',
], {
  authorization: AUTHORIZATION_MODE.ORGANIZATION_PERMISSION,
  exposure: 'provider_lms',
  permission: PERMISSION.ORGANIZATION_READ_PRIVATE,
  scope: 'organization_and_course',
});
declare([
  'acceptCourseInvitation','submitCourseQuiz','submitCourseAssignment','createCoursePaymentOrder',
  'attachCoursePaymentProof','getLearnerCourseResults',
], {
  authorization: AUTHORIZATION_MODE.AUTHENTICATED,
  exposure: 'learner_lms',
  scope: 'learner',
});

const operationIds = new Set(operations.map((entry) => entry.id));
const missing = [...operationIds].filter((operationId) => !coverage.has(operationId));
const extra = [...coverage.keys()].filter((operationId) => !operationIds.has(operationId));
if (missing.length || extra.length) {
  throw new Error(
    `Incomplete security coverage: missing=${missing.join(',')} extra=${extra.join(',')}`,
  );
}

const securityCoverage = Object.freeze(
  Object.fromEntries([...coverage.entries()].sort(([left], [right]) => left.localeCompare(right))),
);

module.exports = { AUTHORIZATION_MODE, SENSITIVE_CAPABILITY, securityCoverage };
