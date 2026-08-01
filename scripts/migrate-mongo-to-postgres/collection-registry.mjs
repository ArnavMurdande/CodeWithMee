export const MIGRATION_SCHEMA_VERSION = 1;

/** @type {readonly import('./types.mjs').CollectionDefinition[]} */
export const COLLECTIONS = Object.freeze([
  {
    collection: 'users',
    modelFile: 'User.js',
    sensitiveFields: ['email', 'password', 'resetPasswordToken'],
    targets: ['user', 'auth_identity', 'learning_profile', 'social_profile'],
  },
  {
    collection: 'authidentities',
    modelFile: 'AuthIdentity.js',
    sensitiveFields: ['passwordHash', 'providerSubject'],
    targets: ['auth_identity'],
  },
  {
    collection: 'authsessions',
    modelFile: 'AuthSession.js',
    sensitiveFields: [
      'consumedTokenHashes',
      'csrfTokenHash',
      'currentTokenHash',
      'ipHash',
      'userAgent',
    ],
    targets: ['session', 'session_refresh_token'],
  },
  {
    collection: 'identityonetimetokens',
    modelFile: 'IdentityOneTimeToken.js',
    sensitiveFields: ['tokenHash'],
    targets: ['identity_one_time_token'],
  },
  {
    collection: 'organizations',
    modelFile: 'Organization.js',
    sensitiveFields: [],
    targets: ['organization'],
  },
  {
    collection: 'organizationmemberships',
    modelFile: 'OrganizationMembership.js',
    sensitiveFields: [],
    targets: ['organization_membership'],
  },
  {
    collection: 'organizationinvitations',
    modelFile: 'OrganizationInvitation.js',
    sensitiveFields: ['activeKey', 'email', 'tokenHash'],
    targets: ['organization_invitation'],
  },
  {
    collection: 'providerverificationreviews',
    modelFile: 'ProviderVerificationReview.js',
    sensitiveFields: ['activeKey', 'decisionReason', 'statement'],
    targets: ['provider_verification_review'],
  },
  {
    collection: 'authority_controls',
    modelFile: 'AuthorityControl.js',
    sensitiveFields: [],
    targets: ['authority_control'],
  },
  {
    collection: 'authority_audit_events',
    modelFile: 'AuthorityAuditEvent.js',
    sensitiveFields: ['operationKey', 'operatorReference', 'reason'],
    targets: ['audit_event'],
  },
  {
    collection: 'challenges',
    modelFile: 'Challenge.js',
    sensitiveFields: ['solution', 'testCases'],
    targets: ['challenge', 'challenge_version', 'challenge_test_case'],
  },
  {
    collection: 'companies',
    modelFile: 'Company.js',
    sensitiveFields: ['adminEmail', 'password'],
    targets: ['organization_claim'],
  },
  {
    collection: 'companyemployees',
    modelFile: 'CompanyEmployee.js',
    sensitiveFields: ['employeeId'],
    targets: ['organization_membership_legacy'],
  },
  {
    collection: 'courses',
    modelFile: 'Course.js',
    sensitiveFields: [],
    targets: ['course', 'course_version'],
  },
  {
    collection: 'enrollments',
    modelFile: 'Enrollment.js',
    sensitiveFields: ['employeeId'],
    targets: ['enrollment', 'course_progress_import_snapshot'],
  },
  {
    collection: 'posts',
    modelFile: 'Post.js',
    sensitiveFields: [],
    targets: ['post', 'comment', 'reaction'],
  },
  {
    collection: 'projects',
    modelFile: 'Project.js',
    sensitiveFields: [],
    targets: ['idea', 'idea_update'],
  },
  {
    collection: 'youtubecaches',
    modelFile: 'YouTubeCache.js',
    sensitiveFields: ['query'],
    targets: ['integration_cache'],
  },
]);

export const COLLECTION_BY_NAME = new Map(
  COLLECTIONS.map((definition) => [definition.collection, definition]),
);

export const COLLECTION_NAMES = Object.freeze(
  COLLECTIONS.map((definition) => definition.collection),
);
