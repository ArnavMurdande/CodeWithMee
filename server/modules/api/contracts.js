'use strict';

const { PLATFORM_ROLE, SESSION_CLIENT, USER_STATUS } = require('../identity/contracts');
const {
  ORGANIZATION_MEMBERSHIP_STATUS,
  ORGANIZATION_ROLE,
  ORGANIZATION_VERIFICATION_STATUS,
} = require('../organizations/contracts');
const {
  FILE_OWNER_TYPE,
  FILE_PURPOSE_POLICY,
  FILE_SCAN_STATUS,
  FILE_STATE,
  FILE_VISIBILITY,
} = require('../files/contracts');

const UUID = Object.freeze({ format: 'uuid', type: 'string' });
const RESOURCE_IDENTIFIER = Object.freeze({
  maxLength: 100,
  minLength: 1,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$',
  type: 'string',
});
const DATE_TIME = Object.freeze({ format: 'date-time', type: 'string' });
const NULLABLE_DATE_TIME = Object.freeze({ format: 'date-time', type: ['string', 'null'] });

function objectSchema(properties, required = [], options = {}) {
  return Object.freeze({
    additionalProperties: false,
    properties: Object.freeze(properties),
    ...(required.length ? { required: Object.freeze(required) } : {}),
    type: 'object',
    ...options,
  });
}

function arrayOf(items, options = {}) {
  return Object.freeze({ items, type: 'array', ...options });
}

function ref(name) {
  return Object.freeze({ $ref: `#/components/schemas/${name}` });
}

const schemas = Object.freeze({
  AccessSession: objectSchema(
    {
      accessToken: { minLength: 20, type: 'string' },
      session: ref('Session'),
      user: ref('User'),
    },
    ['accessToken', 'session', 'user'],
  ),
  AuditState: objectSchema({
    authorityRevision: { minimum: 1, type: 'integer' },
    organizationRole: { enum: Object.values(ORGANIZATION_ROLE), type: 'string' },
    ownerUserId: UUID,
    platformRole: { enum: Object.values(PLATFORM_ROLE), type: 'string' },
    revision: { minimum: 1, type: 'integer' },
    status: { enum: Object.values(USER_STATUS), type: 'string' },
  }),
  AuditEvent: objectSchema(
    {
      action: { minLength: 1, type: 'string' },
      actorSessionId: { type: ['string', 'null'] },
      actorUserId: { type: ['string', 'null'] },
      afterState: ref('AuditState'),
      beforeState: ref('AuditState'),
      id: UUID,
      occurredAt: DATE_TIME,
      operatorReference: { type: ['string', 'null'] },
      organizationId: { type: ['string', 'null'] },
      reason: { maxLength: 500, minLength: 1, type: 'string' },
      requestId: { type: ['string', 'null'] },
      source: { enum: ['api', 'bootstrap_cli'], type: 'string' },
      targetUserId: { type: ['string', 'null'] },
    },
    [
      'action',
      'actorSessionId',
      'actorUserId',
      'afterState',
      'beforeState',
      'id',
      'occurredAt',
      'operatorReference',
      'organizationId',
      'reason',
      'requestId',
      'source',
      'targetUserId',
    ],
  ),
  AuthorityUser: objectSchema(
    {
      authorityRevision: { minimum: 1, type: 'integer' },
      avatarUrl: { type: ['string', 'null'] },
      createdAt: { oneOf: [DATE_TIME, { type: 'null' }] },
      displayName: { maxLength: 80, minLength: 1, type: 'string' },
      email: { format: 'email', type: 'string' },
      emailVerified: { type: 'boolean' },
      id: UUID,
      platformRole: { enum: Object.values(PLATFORM_ROLE), type: 'string' },
      status: { enum: Object.values(USER_STATUS), type: 'string' },
      username: { type: ['string', 'null'] },
    },
    [
      'authorityRevision',
      'avatarUrl',
      'createdAt',
      'displayName',
      'email',
      'emailVerified',
      'id',
      'platformRole',
      'status',
      'username',
    ],
  ),
  DownloadGrant: objectSchema(
    {
      expiresAt: DATE_TIME,
      method: { enum: ['GET'], type: 'string' },
      url: { format: 'uri', type: 'string' },
    },
    ['expiresAt', 'method', 'url'],
  ),
  File: objectSchema(
    {
      byteSize: { pattern: '^[1-9][0-9]*$', type: 'string' },
      createdAt: DATE_TIME,
      declaredMime: { maxLength: 255, minLength: 3, type: 'string' },
      detectedMime: { type: ['string', 'null'] },
      id: UUID,
      originalName: { maxLength: 255, minLength: 1, type: 'string' },
      purpose: { enum: Object.keys(FILE_PURPOSE_POLICY), type: 'string' },
      scanStatus: { enum: Object.values(FILE_SCAN_STATUS), type: 'string' },
      state: { enum: Object.values(FILE_STATE), type: 'string' },
      updatedAt: DATE_TIME,
      uploadedAt: NULLABLE_DATE_TIME,
      visibility: { enum: Object.values(FILE_VISIBILITY), type: 'string' },
    },
    [
      'byteSize',
      'createdAt',
      'declaredMime',
      'detectedMime',
      'id',
      'originalName',
      'purpose',
      'scanStatus',
      'state',
      'updatedAt',
      'uploadedAt',
      'visibility',
    ],
  ),
  Invitation: objectSchema(
    {
      acceptedAt: NULLABLE_DATE_TIME,
      deliveryQueued: { type: 'boolean' },
      email: { format: 'email', type: 'string' },
      expiresAt: DATE_TIME,
      id: UUID,
      organizationId: UUID,
      revokedAt: NULLABLE_DATE_TIME,
      role: { enum: Object.values(ORGANIZATION_ROLE), type: 'string' },
    },
    ['acceptedAt', 'email', 'expiresAt', 'id', 'organizationId', 'revokedAt', 'role'],
  ),
  Membership: objectSchema(
    {
      id: UUID,
      joinedAt: NULLABLE_DATE_TIME,
      organizationId: UUID,
      role: { enum: Object.values(ORGANIZATION_ROLE), type: 'string' },
      status: { enum: Object.values(ORGANIZATION_MEMBERSHIP_STATUS), type: 'string' },
      user: ref('MembershipUser'),
    },
    ['id', 'joinedAt', 'organizationId', 'role', 'status', 'user'],
  ),
  MembershipUser: objectSchema(
    {
      avatarUrl: { type: ['string', 'null'] },
      displayName: { maxLength: 80, minLength: 1, type: 'string' },
      email: { format: 'email', type: 'string' },
      id: UUID,
    },
    ['id'],
  ),
  OwnershipMembership: objectSchema(
    {
      id: UUID,
      joinedAt: NULLABLE_DATE_TIME,
      organizationId: UUID,
      role: { enum: Object.values(ORGANIZATION_ROLE), type: 'string' },
      status: { enum: Object.values(ORGANIZATION_MEMBERSHIP_STATUS), type: 'string' },
      userId: UUID,
    },
    ['id', 'joinedAt', 'organizationId', 'role', 'status', 'userId'],
  ),
  OwnershipOrganization: objectSchema(
    {
      id: UUID,
      ownerUserId: UUID,
      revision: { minimum: 1, type: 'integer' },
    },
    ['id', 'ownerUserId', 'revision'],
  ),
  Organization: objectSchema(
    {
      createdAt: DATE_TIME,
      description: { maxLength: 2000, type: 'string' },
      id: UUID,
      industry: { maxLength: 100, type: 'string' },
      logoFile: { type: ['string', 'null'] },
      name: { maxLength: 120, minLength: 2, type: 'string' },
      ownerUserId: UUID,
      revision: { minimum: 1, type: 'integer' },
      slug: { pattern: '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$', type: 'string' },
      updatedAt: DATE_TIME,
      verificationStatus: {
        enum: Object.values(ORGANIZATION_VERIFICATION_STATUS),
        type: 'string',
      },
    },
    ['description', 'id', 'industry', 'logoFile', 'name', 'slug', 'verificationStatus'],
  ),
  OpenApiDocument: objectSchema(
    {
      components: { additionalProperties: true, type: 'object' },
      info: { additionalProperties: true, type: 'object' },
      jsonSchemaDialect: { format: 'uri', type: 'string' },
      openapi: { const: '3.1.1', type: 'string' },
      paths: { additionalProperties: true, type: 'object' },
      servers: arrayOf({ additionalProperties: true, type: 'object' }),
      tags: arrayOf({ additionalProperties: true, type: 'object' }),
    },
    ['components', 'info', 'jsonSchemaDialect', 'openapi', 'paths', 'servers', 'tags'],
  ),
  Problem: objectSchema(
    {
      code: { maxLength: 100, minLength: 1, pattern: '^[a-z0-9_]+$', type: 'string' },
      detail: { maxLength: 1000, type: 'string' },
      errors: arrayOf(ref('ValidationIssue'), { maxItems: 20 }),
      instance: { maxLength: 500, type: 'string' },
      meta: objectSchema({ maxBytes: { minimum: 1, type: 'integer' } }),
      requestId: { maxLength: 100, minLength: 1, type: 'string' },
      status: { maximum: 599, minimum: 400, type: 'integer' },
      title: { maxLength: 200, minLength: 1, type: 'string' },
      type: { format: 'uri', type: 'string' },
    },
    ['code', 'status', 'title', 'type'],
  ),
  Session: objectSchema(
    {
      authenticatedAt: DATE_TIME,
      client: { enum: Object.values(SESSION_CLIENT), type: 'string' },
      createdAt: DATE_TIME,
      current: { type: 'boolean' },
      expiresAt: DATE_TIME,
      id: UUID,
      lastUsedAt: DATE_TIME,
      revokedAt: NULLABLE_DATE_TIME,
      userAgent: { maxLength: 300, type: ['string', 'null'] },
    },
    [
      'authenticatedAt',
      'client',
      'createdAt',
      'current',
      'expiresAt',
      'id',
      'lastUsedAt',
      'revokedAt',
      'userAgent',
    ],
  ),
  UploadGrant: objectSchema(
    {
      expiresAt: DATE_TIME,
      requiredHeaders: { additionalProperties: { type: 'string' }, type: 'object' },
      method: { enum: ['PUT'], type: 'string' },
      url: { format: 'uri', type: 'string' },
    },
    ['expiresAt', 'method', 'requiredHeaders', 'url'],
  ),
  User: objectSchema(
    {
      avatarUrl: { type: ['string', 'null'] },
      displayName: { maxLength: 80, minLength: 1, type: 'string' },
      email: { format: 'email', type: 'string' },
      emailVerified: { type: 'boolean' },
      id: UUID,
      platformRole: { enum: Object.values(PLATFORM_ROLE), type: 'string' },
      status: { enum: Object.values(USER_STATUS), type: 'string' },
      username: { type: ['string', 'null'] },
    },
    [
      'avatarUrl',
      'displayName',
      'email',
      'emailVerified',
      'id',
      'platformRole',
      'status',
      'username',
    ],
  ),
  ValidationIssue: objectSchema(
    {
      code: {
        enum: [
          'additional_property',
          'constant',
          'enum',
          'format',
          'max_items',
          'max_length',
          'max_properties',
          'min_items',
          'min_length',
          'min_properties',
          'minimum',
          'maximum',
          'one_of',
          'pattern',
          'required',
          'type',
        ],
        type: 'string',
      },
      pointer: { maxLength: 500, minLength: 1, type: 'string' },
    },
    ['code', 'pointer'],
  ),
  VerificationReview: objectSchema(
    {
      decisionReason: { maxLength: 2000, type: ['string', 'null'] },
      id: UUID,
      organization: ref('Organization'),
      organizationId: UUID,
      reviewedAt: NULLABLE_DATE_TIME,
      reviewerUserId: { type: ['string', 'null'] },
      statement: { maxLength: 2000, minLength: 20, type: 'string' },
      status: { enum: Object.values(ORGANIZATION_VERIFICATION_STATUS), type: 'string' },
      submittedAt: DATE_TIME,
      submittedByUserId: UUID,
    },
    [
      'decisionReason',
      'id',
      'organizationId',
      'reviewedAt',
      'reviewerUserId',
      'statement',
      'status',
      'submittedAt',
      'submittedByUserId',
    ],
  ),
});

const empty = objectSchema({});
const identifierParams = (names) =>
  objectSchema(Object.fromEntries(names.map((name) => [name, RESOURCE_IDENTIFIER])), names);
const tokenParams = objectSchema(
  { token: { maxLength: 512, minLength: 20, pattern: '^oi1\\.', type: 'string' } },
  ['token'],
);
const optionalIdempotencyHeader = objectSchema({
  'idempotency-key': {
    maxLength: 128,
    minLength: 16,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$',
    type: 'string',
  },
});
const emptyQuery = empty;

const requestSchemas = Object.freeze({
  authorityAuditList: {
    query: objectSchema({
      before: DATE_TIME,
      limit: { pattern: '^(?:[1-9]|[1-9][0-9]|100)$', type: 'string' },
    }),
  },
  authorityRoleChange: {
    body: objectSchema(
      {
        platformRole: { enum: Object.values(PLATFORM_ROLE), type: 'string' },
        reason: { maxLength: 500, minLength: 12, type: 'string' },
        revision: { minimum: 1, type: 'integer' },
      },
      ['platformRole', 'reason', 'revision'],
    ),
    headers: optionalIdempotencyHeader,
    params: identifierParams(['userId']),
  },
  authorityStatusChange: {
    body: objectSchema(
      {
        reason: { maxLength: 500, minLength: 12, type: 'string' },
        revision: { minimum: 1, type: 'integer' },
        status: { enum: Object.values(USER_STATUS), type: 'string' },
      },
      ['reason', 'revision', 'status'],
    ),
    headers: optionalIdempotencyHeader,
    params: identifierParams(['userId']),
  },
  authorityTransfer: {
    body: objectSchema(
      {
        reason: { maxLength: 500, minLength: 12, type: 'string' },
        revision: { minimum: 1, type: 'integer' },
        targetUserId: RESOURCE_IDENTIFIER,
      },
      ['reason', 'revision', 'targetUserId'],
    ),
    headers: optionalIdempotencyHeader,
    params: identifierParams(['organizationId']),
  },
  authorityUserList: {
    query: objectSchema({
      limit: { pattern: '^(?:[1-9]|[1-9][0-9]|100)$', type: 'string' },
    }),
  },
  empty: { body: empty },
  fileId: { params: identifierParams(['fileId']) },
  fileIdMutation: {
    body: empty,
    headers: optionalIdempotencyHeader,
    params: identifierParams(['fileId']),
  },
  fileUploadIntent: {
    body: objectSchema(
      {
        byteSize: { maximum: 104857600, minimum: 1, type: 'integer' },
        declaredMime: { maxLength: 255, minLength: 3, type: 'string' },
        originalName: { maxLength: 255, minLength: 1, type: 'string' },
        ownerOrganizationId: UUID,
        ownerType: { enum: Object.values(FILE_OWNER_TYPE), type: 'string' },
        purpose: { enum: Object.keys(FILE_PURPOSE_POLICY), type: 'string' },
        sha256: { pattern: '^[0-9a-f]{64}$', type: 'string' },
      },
      ['byteSize', 'declaredMime', 'originalName', 'purpose', 'sha256'],
    ),
    headers: optionalIdempotencyHeader,
  },
  fileVisibility: {
    body: objectSchema({ visibility: { enum: Object.values(FILE_VISIBILITY), type: 'string' } }, [
      'visibility',
    ]),
    params: identifierParams(['fileId']),
  },
  googleCallback: {
    query: objectSchema(
      {
        code: { maxLength: 4096, minLength: 1, type: 'string' },
        state: { maxLength: 4096, minLength: 1, type: 'string' },
      },
      ['code', 'state'],
    ),
  },
  googleStart: {
    query: objectSchema({ returnTo: { maxLength: 2048, minLength: 1, type: 'string' } }),
  },
  identityConfirmToken: {
    body: objectSchema(
      { token: { maxLength: 512, minLength: 20, pattern: '^ev1\\.', type: 'string' } },
      ['token'],
    ),
  },
  identityForgotPassword: {
    body: objectSchema({ email: { format: 'email', type: 'string' } }, ['email']),
  },
  identityLogin: {
    body: objectSchema(
      {
        email: { format: 'email', type: 'string' },
        password: { maxLength: 128, minLength: 1, type: 'string' },
      },
      ['email', 'password'],
    ),
  },
  identityRegister: {
    body: objectSchema(
      {
        displayName: { maxLength: 80, minLength: 1, type: 'string' },
        email: { format: 'email', type: 'string' },
        password: { maxLength: 128, minLength: 12, type: 'string' },
      },
      ['displayName', 'email', 'password'],
    ),
  },
  identityResetPassword: {
    body: objectSchema(
      {
        password: { maxLength: 128, minLength: 12, type: 'string' },
        token: { maxLength: 512, minLength: 20, pattern: '^pr1\\.', type: 'string' },
      },
      ['password', 'token'],
    ),
  },
  noInput: { body: empty, query: emptyQuery },
  organizationCreate: {
    body: objectSchema(
      {
        description: { maxLength: 2000, type: 'string' },
        industry: { maxLength: 100, type: 'string' },
        name: { maxLength: 120, minLength: 2, type: 'string' },
        slug: { pattern: '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$', type: 'string' },
      },
      ['name', 'slug'],
    ),
    headers: optionalIdempotencyHeader,
  },
  organizationDecision: {
    body: objectSchema(
      {
        reason: { maxLength: 2000, type: 'string' },
        status: { enum: ['approved', 'rejected'], type: 'string' },
      },
      ['status'],
    ),
    params: identifierParams(['reviewId']),
  },
  organizationId: { params: identifierParams(['organizationId']) },
  organizationInvitation: {
    body: objectSchema(
      {
        email: { format: 'email', type: 'string' },
        role: { enum: ['admin', 'analyst', 'grader', 'instructor'], type: 'string' },
      },
      ['email', 'role'],
    ),
    headers: optionalIdempotencyHeader,
    params: identifierParams(['organizationId']),
  },
  organizationInvitationAccept: { body: empty, params: tokenParams },
  organizationMemberMutation: {
    body: objectSchema(
      {
        role: { enum: ['admin', 'analyst', 'grader', 'instructor'], type: 'string' },
        status: { enum: Object.values(ORGANIZATION_MEMBERSHIP_STATUS), type: 'string' },
      },
      [],
      { minProperties: 1 },
    ),
    params: identifierParams(['organizationId', 'userId']),
  },
  organizationMembers: { params: identifierParams(['organizationId']) },
  organizationReviews: {
    query: objectSchema({
      status: { enum: ['', 'approved', 'pending_review', 'rejected'], type: 'string' },
    }),
  },
  organizationUpdate: {
    body: objectSchema(
      {
        description: { maxLength: 2000, type: 'string' },
        industry: { maxLength: 100, type: 'string' },
        name: { maxLength: 120, minLength: 2, type: 'string' },
        revision: { minimum: 1, type: 'integer' },
      },
      ['revision'],
      { minProperties: 2 },
    ),
    params: identifierParams(['organizationId']),
  },
  organizationVerification: {
    body: objectSchema({ statement: { maxLength: 2000, minLength: 20, type: 'string' } }, [
      'statement',
    ]),
    params: identifierParams(['organizationId']),
  },
  sessionId: { body: empty, params: identifierParams(['sessionId']) },
});

const responseSchemas = Object.freeze({
  accessSession: ref('AccessSession'),
  auditEvents: objectSchema({ events: arrayOf(ref('AuditEvent')) }, ['events']),
  authorityChange: objectSchema(
    {
      auditEvent: ref('AuditEvent'),
      revokedSessionCount: { minimum: 0, type: 'integer' },
      user: ref('AuthorityUser'),
    },
    ['auditEvent', 'revokedSessionCount', 'user'],
  ),
  authorityUsers: objectSchema({ users: arrayOf(ref('AuthorityUser')) }, ['users']),
  download: objectSchema({ download: ref('DownloadGrant') }, ['download']),
  file: objectSchema({ file: ref('File') }, ['file']),
  health: objectSchema({ status: { enum: ['not_ready', 'ok', 'ready'], type: 'string' } }, [
    'status',
  ]),
  healthDependencies: objectSchema(
    {
      checks: arrayOf(
        objectSchema(
          {
            name: { maxLength: 100, minLength: 1, type: 'string' },
            status: { enum: ['ok', 'optional_unavailable', 'unavailable'], type: 'string' },
          },
          ['name', 'status'],
        ),
      ),
      status: { enum: ['not_ready', 'ready'], type: 'string' },
    },
    ['checks', 'status'],
  ),
  invitation: objectSchema({ invitation: ref('Invitation') }, ['invitation']),
  invitationAccepted: objectSchema(
    { invitation: ref('Invitation'), membership: ref('Membership') },
    ['invitation', 'membership'],
  ),
  membership: objectSchema({ membership: ref('Membership') }, ['membership']),
  memberships: objectSchema({ members: arrayOf(ref('Membership')) }, ['members']),
  message: objectSchema({ message: { maxLength: 500, minLength: 1, type: 'string' } }, ['message']),
  organization: objectSchema({ organization: ref('Organization') }, ['organization']),
  organizationCreated: objectSchema(
    { membership: ref('Membership'), organization: ref('Organization') },
    ['membership', 'organization'],
  ),
  organizations: objectSchema(
    {
      organizations: arrayOf(
        objectSchema({ membership: ref('Membership'), organization: ref('Organization') }, [
          'membership',
          'organization',
        ]),
      ),
    },
    ['organizations'],
  ),
  ownershipTransfer: objectSchema(
    {
      actorMembership: ref('OwnershipMembership'),
      auditEvent: ref('AuditEvent'),
      organization: ref('OwnershipOrganization'),
      targetMembership: ref('OwnershipMembership'),
    },
    ['actorMembership', 'auditEvent', 'organization', 'targetMembership'],
  ),
  reviews: objectSchema({ reviews: arrayOf(ref('VerificationReview')) }, ['reviews']),
  openApi: ref('OpenApiDocument'),
  sessions: objectSchema({ sessions: arrayOf(ref('Session')) }, ['sessions']),
  uploadIntent: objectSchema({ file: ref('File'), upload: ref('UploadGrant') }, ['file', 'upload']),
  user: objectSchema({ user: ref('User') }, ['user']),
  verification: objectSchema(
    { organization: ref('Organization'), review: ref('VerificationReview') },
    ['organization', 'review'],
  ),
});

module.exports = {
  DATE_TIME,
  RESOURCE_IDENTIFIER,
  UUID,
  arrayOf,
  objectSchema,
  ref,
  requestSchemas,
  responseSchemas,
  schemas,
};
