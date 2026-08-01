'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { schemas } = require('../modules/api/contracts');
const { operations } = require('../modules/api/operations');
const {
  AUTHORIZATION_MODE,
  SENSITIVE_CAPABILITY,
  securityCoverage,
} = require('../modules/api/security-coverage');
const { auditEventDto, authorityUserDto } = require('../modules/authority/service');
const { publicFileDto } = require('../modules/files/service');
const { userDto } = require('../modules/identity/service');
const {
  invitationDto,
  membershipDto,
  organizationDto,
  reviewDto,
} = require('../modules/organizations/service');
const { KNOWN_PERMISSIONS } = require('../modules/policies/permissions');

const FORBIDDEN_RESPONSE_KEY =
  /^(?:password|passwordHash|refreshToken|refreshTokenHash|csrfToken|csrfHash|tokenHash|objectKey|bucket|checksumSha256|quarantineReason|providerSubject|providerToken|secret)$/i;

function collectSchemaKeys(schema, keys = new Set(), seen = new Set()) {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return keys;
  seen.add(schema);
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    collectSchemaKeys(schemas[name], keys, seen);
  }
  for (const key of Object.keys(schema.properties || {})) keys.add(key);
  for (const child of Object.values(schema.properties || {})) collectSchemaKeys(child, keys, seen);
  collectSchemaKeys(schema.items, keys, seen);
  for (const child of schema.oneOf || []) collectSchemaKeys(child, keys, seen);
  return keys;
}

function objectKeysDeep(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    for (const item of value) objectKeysDeep(item, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    objectKeysDeep(child, keys);
  }
  return keys;
}

function assertRedacted(value) {
  const forbidden = [...objectKeysDeep(value)].filter((key) => FORBIDDEN_RESPONSE_KEY.test(key));
  assert.deepEqual(forbidden, []);
}

test('every deployed operation has one exact authorization, scope, exposure, and capability record', () => {
  assert.deepEqual(
    Object.keys(securityCoverage).sort(),
    operations.map((entry) => entry.id).sort(),
  );
  const permissions = new Set(KNOWN_PERMISSIONS);
  const publicModes = new Set([
    AUTHORIZATION_MODE.OAUTH_STATE,
    AUTHORIZATION_MODE.PUBLIC,
    AUTHORIZATION_MODE.SINGLE_USE_TOKEN,
  ]);

  for (const operation of operations) {
    const coverage = securityCoverage[operation.id];
    assert.ok(coverage.authorization);
    assert.ok(coverage.exposure);
    assert.ok(coverage.scope);
    if (coverage.permission) assert.equal(permissions.has(coverage.permission), true);

    const publicOperation = operation.security.length === 0;
    assert.equal(publicModes.has(coverage.authorization), publicOperation);
    if (coverage.authorization === AUTHORIZATION_MODE.OPTIONAL_ORGANIZATION) {
      assert.deepEqual(operation.security, [{}, { bearerAuth: [] }]);
    }
    if (coverage.authorization === AUTHORIZATION_MODE.REFRESH_SESSION) {
      assert.deepEqual(operation.security, [{ csrfHeader: [], refreshCookie: [] }]);
    }
  }
});

test('only reviewed exchanges expose ephemeral bearer or object capabilities', () => {
  const capable = Object.entries(securityCoverage)
    .filter(([, coverage]) => coverage.capability !== SENSITIVE_CAPABILITY.NONE)
    .map(([operationId, coverage]) => `${operationId}:${coverage.capability}`)
    .sort();
  assert.deepEqual(capable, [
    'createFileDownload:download_url',
    'createFileUploadIntent:upload_url',
    'login:access_token',
    'refreshSession:access_token',
    'register:access_token',
  ]);

  for (const operation of operations) {
    const keys = collectSchemaKeys(operation.response);
    const forbidden = [...keys].filter((key) => FORBIDDEN_RESPONSE_KEY.test(key));
    assert.deepEqual(forbidden, [], operation.id);
    if (keys.has('accessToken')) {
      assert.equal(
        securityCoverage[operation.id].capability,
        SENSITIVE_CAPABILITY.ACCESS_TOKEN,
        operation.id,
      );
    }
  }
});

test('DTO allowlists remove repository secrets and audit state denies unknown keys', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const secretFields = {
    bucket: 'private-bucket',
    checksumSha256: 'a'.repeat(64),
    csrfToken: 'csrf-secret',
    objectKey: 'tenant/private/object',
    password: 'password-secret',
    passwordHash: 'password-hash',
    providerSubject: 'provider-subject',
    refreshTokenHash: 'refresh-hash',
    secret: 'secret-value',
    tokenHash: 'token-hash',
  };
  const user = {
    ...secretFields,
    authorityRevision: 3,
    avatarUrl: null,
    createdAt: now,
    displayName: 'Learner',
    email: 'learner@example.test',
    emailVerifiedAt: now,
    id: 'user-1',
    platformRole: 'learner',
    status: 'active',
    username: 'learner',
  };
  const organization = {
    ...secretFields,
    createdAt: now,
    description: 'Description',
    id: 'org-1',
    industry: 'Education',
    logoFile: null,
    name: 'Provider',
    ownerUserId: 'user-1',
    revision: 2,
    slug: 'provider',
    updatedAt: now,
    verificationStatus: 'approved',
  };
  const membership = {
    ...secretFields,
    id: 'membership-1',
    joinedAt: now,
    organizationId: 'org-1',
    role: 'owner',
    status: 'active',
    userId: 'user-1',
  };
  const invitation = {
    ...secretFields,
    acceptedAt: null,
    email: user.email,
    expiresAt: now,
    id: 'invitation-1',
    organizationId: 'org-1',
    revokedAt: null,
    role: 'admin',
  };
  const review = {
    ...secretFields,
    decisionReason: null,
    id: 'review-1',
    organizationId: 'org-1',
    reviewedAt: null,
    reviewerUserId: null,
    statement: 'A sufficiently long provider statement.',
    status: 'pending_review',
    submittedAt: now,
    submittedByUserId: 'user-1',
  };
  const file = {
    ...secretFields,
    byteSize: 42,
    createdAt: now,
    declaredMime: 'text/plain',
    detectedMime: 'text/plain',
    id: 'file-1',
    originalName: 'lesson.txt',
    purpose: 'course_resource',
    scanStatus: 'clean',
    state: 'ready',
    updatedAt: now,
    uploadedAt: now,
    visibility: 'private',
  };
  const audit = {
    ...secretFields,
    action: 'platform.role.changed',
    actorSessionId: 'session-1',
    actorUserId: 'user-2',
    afterState: { ...secretFields, authorityRevision: 4, platformRole: 'moderator' },
    beforeState: { ...secretFields, authorityRevision: 3, platformRole: 'learner' },
    id: 'audit-1',
    occurredAt: now,
    operatorReference: null,
    organizationId: null,
    reason: 'A sufficiently long audit reason.',
    requestId: 'request-1',
    source: 'api',
    targetUserId: 'user-1',
  };

  const publicOrganization = organizationDto(organization);
  assert.equal(Object.hasOwn(publicOrganization, 'ownerUserId'), false);
  assert.equal(Object.hasOwn(publicOrganization, 'revision'), false);
  const projected = [
    userDto(user),
    authorityUserDto(user),
    publicOrganization,
    organizationDto(organization, { privateView: true }),
    membershipDto(membership, user),
    invitationDto(invitation, true),
    reviewDto(review, organization),
    publicFileDto(file),
    auditEventDto(audit),
  ];
  projected.forEach(assertRedacted);
  assert.deepEqual(auditEventDto(audit).afterState, {
    authorityRevision: 4,
    platformRole: 'moderator',
  });
});

test('resource-scoped operations cannot degrade to platform-wide or unscoped access', () => {
  const organizationScoped = Object.entries(securityCoverage)
    .filter(([, coverage]) => coverage.scope === 'organization')
    .map(([operationId]) => operationId);
  assert.ok(organizationScoped.length >= 8);
  for (const operationId of organizationScoped) {
    assert.match(
      securityCoverage[operationId].authorization,
      /organization|permission/,
      operationId,
    );
  }

  for (const operationId of [
    'getFileMetadata',
    'completeFileUpload',
    'createFileDownload',
    'setFileVisibility',
    'deleteFile',
  ]) {
    assert.equal(securityCoverage[operationId].authorization, AUTHORIZATION_MODE.RESOURCE_POLICY);
    assert.match(securityCoverage[operationId].scope, /file_owner/);
  }
  for (const operationId of ['getMe', 'listMySessions', 'revokeMySession', 'logoutAll']) {
    assert.equal(securityCoverage[operationId].scope, 'self');
  }
});
