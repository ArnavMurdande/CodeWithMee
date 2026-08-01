'use strict';

const { randomUUID } = require('node:crypto');

const { PLATFORM_ROLE, USER_STATUS } = require('../identity/contracts');
const { evaluatePermission } = require('../policies/authorize');
const { PERMISSION } = require('../policies/permissions');
const { AUTHORITY_ACTION, AUTHORITY_SOURCE } = require('./contracts');
const { AuthorityError } = require('./errors');

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function normalizeBootstrapEmail(value) {
  const email = normalizeText(value).toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthorityError('invalid_bootstrap_email');
  }
  return email;
}

function validateReason(value) {
  const reason = normalizeText(value);
  if (reason.length < 12 || reason.length > 500) {
    throw new AuthorityError('authority_reason_required');
  }
  return reason;
}

function validateRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new AuthorityError('authority_revision_required');
  }
  return revision;
}

function sanitizeReference(value, field, maximumLength = 120) {
  if (value == null || value === '') return null;
  const reference = normalizeText(value);
  if (!reference || reference.length > maximumLength) throw new AuthorityError(field);
  return reference;
}

function assertExactKeys(input, allowedKeys) {
  const unknown = Object.keys(input || {}).filter((key) => !allowedKeys.includes(key));
  if (unknown.length) throw new AuthorityError('authority_unknown_field');
}

const AUDIT_STATE_KEYS = Object.freeze([
  'authorityRevision',
  'organizationRole',
  'ownerUserId',
  'platformRole',
  'revision',
  'status',
]);

function auditStateDto(state) {
  const output = {};
  for (const key of AUDIT_STATE_KEYS) {
    const value = state?.[key];
    if (typeof value === 'string' || Number.isSafeInteger(value)) output[key] = value;
  }
  return Object.freeze(output);
}

function auditEventDto(event) {
  return Object.freeze({
    action: event.action,
    actorSessionId: event.actorSessionId || null,
    actorUserId: event.actorUserId || null,
    afterState: auditStateDto(event.afterState),
    beforeState: auditStateDto(event.beforeState),
    id: event.id,
    occurredAt: event.occurredAt,
    operatorReference: event.operatorReference || null,
    organizationId: event.organizationId || null,
    reason: event.reason,
    requestId: event.requestId || null,
    source: event.source,
    targetUserId: event.targetUserId,
  });
}

function authorityUserDto(user) {
  return Object.freeze({
    authorityRevision: user.authorityRevision,
    avatarUrl: user.avatarUrl || null,
    createdAt: user.createdAt || null,
    displayName: user.displayName,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    id: user.id,
    platformRole: user.platformRole,
    status: user.status,
    username: user.username || null,
  });
}

function ownershipDto(result) {
  const membership = (record) =>
    Object.freeze({
      id: record.id,
      joinedAt: record.joinedAt,
      organizationId: record.organizationId,
      role: record.role,
      status: record.status,
      userId: record.userId,
    });
  return Object.freeze({
    actorMembership: membership(result.actorMembership),
    auditEvent: auditEventDto(result.auditEvent),
    organization: Object.freeze({
      id: result.organization.id,
      ownerUserId: result.organization.ownerUserId,
      revision: result.organization.revision,
    }),
    targetMembership: membership(result.targetMembership),
  });
}

function outcomeError(outcome) {
  const outcomes = {
    actor_not_authorized: ['authority_denied', 403],
    actor_not_owner: ['ownership_transfer_denied', 403],
    already_configured: ['superadmin_already_configured', 409],
    bootstrap_consumed: ['superadmin_bootstrap_consumed', 409],
    last_superadmin: ['last_active_superadmin_required', 409],
    no_change: ['authority_change_has_no_effect', 409],
    organization_not_found: ['organization_not_found', 404],
    ownership_invariant_violation: ['ownership_invariant_violation', 409],
    revision_conflict: ['authority_revision_conflict', 409],
    self_change_denied: ['self_authority_change_denied', 409],
    target_ineligible: ['authority_target_ineligible', 409],
    user_not_found: ['user_not_found', 404],
  };
  const [code, status] = outcomes[outcome] || ['authority_change_failed', 409];
  return new AuthorityError(code, status);
}

function createAuthorityService({
  now = () => new Date(),
  recentAuthenticationMs = 10 * 60 * 1_000,
  repository,
}) {
  function recentAuthentication(authentication) {
    const authenticatedAt = authentication?.session?.authenticatedAt;
    return Boolean(
      authenticatedAt &&
      now().getTime() - new Date(authenticatedAt).getTime() <= recentAuthenticationMs,
    );
  }

  function requirePermission(permission, authentication, context = {}) {
    const result = evaluatePermission({
      context: {
        ...context,
        recentAuthentication: recentAuthentication(authentication),
      },
      permission,
      principal: authentication?.principal,
    });
    if (!result.allowed) throw new AuthorityError(result.reason, 403);
  }

  function apiEvent(authentication, action, reason, metadata = {}) {
    return {
      action,
      actorSessionId: authentication.principal.sessionId,
      actorUserId: authentication.principal.userId,
      id: randomUUID(),
      occurredAt: now(),
      operatorReference: null,
      reason: validateReason(reason),
      requestId: sanitizeReference(metadata.requestId, 'invalid_request_id', 100),
      source: AUTHORITY_SOURCE.API,
    };
  }

  async function runRepository(operation) {
    try {
      const result = await operation();
      if (result.outcome !== 'updated') throw outcomeError(result.outcome);
      return result;
    } catch (error) {
      if (error.code === 'authority_transaction_unavailable') {
        throw new AuthorityError('authority_transaction_unavailable', 503);
      }
      if (error.code === 'duplicate_authority_operation') {
        throw new AuthorityError('superadmin_bootstrap_consumed', 409);
      }
      throw error;
    }
  }

  return Object.freeze({
    async bootstrapSuperadmin(rawInput = {}) {
      assertExactKeys(rawInput, ['email', 'operatorReference', 'reason']);
      const email = normalizeBootstrapEmail(rawInput.email);
      const operatorReference = sanitizeReference(
        rawInput.operatorReference,
        'bootstrap_operator_reference_required',
      );
      if (!operatorReference) {
        throw new AuthorityError('bootstrap_operator_reference_required');
      }
      const event = {
        action: AUTHORITY_ACTION.SUPERADMIN_BOOTSTRAP,
        actorSessionId: null,
        actorUserId: null,
        id: randomUUID(),
        occurredAt: now(),
        operatorReference,
        reason: validateReason(rawInput.reason),
        requestId: null,
        source: AUTHORITY_SOURCE.BOOTSTRAP_CLI,
      };
      const result = await runRepository(() => repository.bootstrapSuperadmin({ email, event }));
      return Object.freeze({
        auditEvent: auditEventDto(result.auditEvent),
        user: authorityUserDto(result.user),
      });
    },

    async changeAccountStatus(authentication, targetUserId, rawInput = {}, metadata = {}) {
      requirePermission(PERMISSION.PLATFORM_ACCOUNT_STATUS_MANAGE, authentication);
      assertExactKeys(rawInput, ['reason', 'revision', 'status']);
      if (!Object.values(USER_STATUS).includes(rawInput.status)) {
        throw new AuthorityError('invalid_user_status');
      }
      const result = await runRepository(() =>
        repository.changeAccountStatus({
          actorUserId: authentication.principal.userId,
          event: apiEvent(
            authentication,
            AUTHORITY_ACTION.ACCOUNT_STATUS_CHANGE,
            rawInput.reason,
            metadata,
          ),
          expectedRevision: validateRevision(rawInput.revision),
          status: rawInput.status,
          targetUserId,
        }),
      );
      return Object.freeze({
        auditEvent: auditEventDto(result.auditEvent),
        revokedSessionCount: result.revokedSessionCount,
        user: authorityUserDto(result.user),
      });
    },

    async changePlatformRole(authentication, targetUserId, rawInput = {}, metadata = {}) {
      requirePermission(PERMISSION.PLATFORM_ROLE_MANAGE, authentication);
      assertExactKeys(rawInput, ['platformRole', 'reason', 'revision']);
      if (!Object.values(PLATFORM_ROLE).includes(rawInput.platformRole)) {
        throw new AuthorityError('invalid_platform_role');
      }
      const result = await runRepository(() =>
        repository.changePlatformRole({
          actorUserId: authentication.principal.userId,
          event: apiEvent(
            authentication,
            AUTHORITY_ACTION.PLATFORM_ROLE_CHANGE,
            rawInput.reason,
            metadata,
          ),
          expectedRevision: validateRevision(rawInput.revision),
          platformRole: rawInput.platformRole,
          targetUserId,
        }),
      );
      return Object.freeze({
        auditEvent: auditEventDto(result.auditEvent),
        revokedSessionCount: result.revokedSessionCount,
        user: authorityUserDto(result.user),
      });
    },

    async listAuditEvents(authentication, rawQuery = {}) {
      requirePermission(PERMISSION.PLATFORM_AUDIT_READ, authentication);
      assertExactKeys(rawQuery, ['before', 'limit']);
      const limit = rawQuery.limit == null ? 50 : Number(rawQuery.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new AuthorityError('invalid_audit_limit');
      }
      let before = null;
      if (rawQuery.before) {
        before = new Date(rawQuery.before);
        if (Number.isNaN(before.getTime())) throw new AuthorityError('invalid_audit_cursor');
      }
      return (await repository.listAuditEvents({ before, limit })).map(auditEventDto);
    },

    async listUsers(authentication, rawQuery = {}) {
      requirePermission(PERMISSION.PLATFORM_USERS_READ, authentication);
      assertExactKeys(rawQuery, ['limit']);
      const limit = rawQuery.limit == null ? 50 : Number(rawQuery.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new AuthorityError('invalid_user_limit');
      }
      return (await repository.listUsers({ limit })).map(authorityUserDto);
    },

    async transferOrganizationOwnership(
      authentication,
      organizationId,
      rawInput = {},
      metadata = {},
    ) {
      const context = await repository.findOrganizationContext(
        organizationId,
        authentication?.principal?.userId,
      );
      if (!context.organization) throw new AuthorityError('organization_not_found', 404);
      requirePermission(PERMISSION.ORGANIZATION_OWNERSHIP_TRANSFER, authentication, context);
      assertExactKeys(rawInput, ['reason', 'revision', 'targetUserId']);
      const targetUserId = sanitizeReference(
        rawInput.targetUserId,
        'ownership_target_required',
        100,
      );
      if (!targetUserId) throw new AuthorityError('ownership_target_required');
      const result = await runRepository(() =>
        repository.transferOrganizationOwnership({
          actorUserId: authentication.principal.userId,
          event: apiEvent(
            authentication,
            AUTHORITY_ACTION.ORGANIZATION_OWNERSHIP_TRANSFER,
            rawInput.reason,
            metadata,
          ),
          expectedRevision: validateRevision(rawInput.revision),
          organizationId,
          targetUserId,
        }),
      );
      return ownershipDto(result);
    },
  });
}

module.exports = {
  auditStateDto,
  auditEventDto,
  authorityUserDto,
  createAuthorityService,
  normalizeBootstrapEmail,
  validateReason,
  validateRevision,
};
