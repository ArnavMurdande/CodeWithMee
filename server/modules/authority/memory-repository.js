'use strict';

const SUPERADMIN_BOOTSTRAP_OPERATION = 'platform-superadmin-bootstrap-v1';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function membershipKey(organizationId, userId) {
  return `${organizationId}:${userId}`;
}

function createMemoryAuthorityRepository(seed = {}) {
  const users = new Map(
    (seed.users || []).map((user) => [user.id, { authorityRevision: 1, ...clone(user) }]),
  );
  const organizations = new Map(
    (seed.organizations || []).map((organization) => [organization.id, clone(organization)]),
  );
  const memberships = new Map(
    (seed.memberships || []).map((membership) => [
      membershipKey(membership.organizationId, membership.userId),
      clone(membership),
    ]),
  );
  const sessions = new Map((seed.sessions || []).map((session) => [session.id, clone(session)]));
  const auditEvents = new Map((seed.auditEvents || []).map((event) => [event.id, clone(event)]));
  const operationKeys = new Set(seed.operationKeys || []);

  function activeSuperadminCount() {
    return [...users.values()].filter(
      (user) => user.platformRole === 'superadmin' && user.status === 'active',
    ).length;
  }

  function appendEvent(baseEvent, details, operationKey = null) {
    if (auditEvents.has(baseEvent.id)) throw new Error('duplicate_audit_event');
    if (operationKey && operationKeys.has(operationKey)) {
      const error = new Error('duplicate_authority_operation');
      error.code = 'duplicate_authority_operation';
      throw error;
    }
    const event = {
      ...clone(baseEvent),
      ...clone(details),
      operationKey,
    };
    auditEvents.set(event.id, event);
    if (operationKey) operationKeys.add(operationKey);
    return event;
  }

  function revokeSessionsForUser(userId, revokedAt) {
    let count = 0;
    for (const [sessionId, session] of sessions) {
      if (session.userId === userId && !session.revokedAt) {
        sessions.set(sessionId, { ...session, revokedAt });
        count += 1;
      }
    }
    return count;
  }

  function currentActor(actorUserId) {
    const actor = users.get(actorUserId);
    return actor?.status === 'active' && actor.platformRole === 'superadmin' ? actor : null;
  }

  return Object.freeze({
    async bootstrapSuperadmin({ email, event }) {
      if (operationKeys.has(SUPERADMIN_BOOTSTRAP_OPERATION)) {
        return { outcome: 'bootstrap_consumed' };
      }
      if (activeSuperadminCount() > 0) return { outcome: 'already_configured' };
      const target = [...users.values()].find((user) => user.email === email);
      if (!target) return { outcome: 'user_not_found' };
      if (target.status !== 'active' || !target.emailVerifiedAt) {
        return { outcome: 'target_ineligible' };
      }
      const beforeState = {
        authorityRevision: target.authorityRevision,
        platformRole: target.platformRole,
        status: target.status,
      };
      const user = {
        ...target,
        authorityRevision: target.authorityRevision + 1,
        platformRole: 'superadmin',
        updatedAt: event.occurredAt,
      };
      users.set(user.id, user);
      const auditEvent = appendEvent(
        event,
        {
          afterState: {
            authorityRevision: user.authorityRevision,
            platformRole: user.platformRole,
            status: user.status,
          },
          beforeState,
          organizationId: null,
          targetUserId: user.id,
        },
        SUPERADMIN_BOOTSTRAP_OPERATION,
      );
      return clone({ auditEvent, outcome: 'updated', user });
    },

    async changeAccountStatus({ actorUserId, event, expectedRevision, status, targetUserId }) {
      if (!currentActor(actorUserId)) return { outcome: 'actor_not_authorized' };
      const target = users.get(targetUserId);
      if (!target) return { outcome: 'user_not_found' };
      if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
      if (target.authorityRevision !== expectedRevision) return { outcome: 'revision_conflict' };
      if (target.status === status) return { outcome: 'no_change' };
      if (
        target.platformRole === 'superadmin' &&
        target.status === 'active' &&
        status !== 'active' &&
        activeSuperadminCount() <= 1
      ) {
        return { outcome: 'last_superadmin' };
      }
      const beforeState = {
        authorityRevision: target.authorityRevision,
        platformRole: target.platformRole,
        status: target.status,
      };
      const user = {
        ...target,
        authorityRevision: target.authorityRevision + 1,
        status,
        updatedAt: event.occurredAt,
      };
      users.set(user.id, user);
      const revokedSessionCount =
        status === 'active' ? 0 : revokeSessionsForUser(user.id, event.occurredAt);
      const auditEvent = appendEvent(event, {
        afterState: {
          authorityRevision: user.authorityRevision,
          platformRole: user.platformRole,
          status: user.status,
        },
        beforeState,
        organizationId: null,
        targetUserId: user.id,
      });
      return clone({ auditEvent, outcome: 'updated', revokedSessionCount, user });
    },

    async changePlatformRole({ actorUserId, event, expectedRevision, platformRole, targetUserId }) {
      if (!currentActor(actorUserId)) return { outcome: 'actor_not_authorized' };
      const target = users.get(targetUserId);
      if (!target) return { outcome: 'user_not_found' };
      if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
      if (target.authorityRevision !== expectedRevision) return { outcome: 'revision_conflict' };
      if (target.platformRole === platformRole) return { outcome: 'no_change' };
      if (
        target.platformRole === 'superadmin' &&
        platformRole !== 'superadmin' &&
        target.status === 'active' &&
        activeSuperadminCount() <= 1
      ) {
        return { outcome: 'last_superadmin' };
      }
      if (
        platformRole === 'superadmin' &&
        (target.status !== 'active' || !target.emailVerifiedAt)
      ) {
        return { outcome: 'target_ineligible' };
      }
      const beforeState = {
        authorityRevision: target.authorityRevision,
        platformRole: target.platformRole,
        status: target.status,
      };
      const user = {
        ...target,
        authorityRevision: target.authorityRevision + 1,
        platformRole,
        updatedAt: event.occurredAt,
      };
      users.set(user.id, user);
      const revokedSessionCount = revokeSessionsForUser(user.id, event.occurredAt);
      const auditEvent = appendEvent(event, {
        afterState: {
          authorityRevision: user.authorityRevision,
          platformRole: user.platformRole,
          status: user.status,
        },
        beforeState,
        organizationId: null,
        targetUserId: user.id,
      });
      return clone({ auditEvent, outcome: 'updated', revokedSessionCount, user });
    },

    async findOrganizationContext(organizationId, actorUserId) {
      return clone({
        membership: memberships.get(membershipKey(organizationId, actorUserId)) || null,
        organization: organizations.get(organizationId) || null,
      });
    },

    async listAuditEvents({ before = null, limit = 50 } = {}) {
      return clone(
        [...auditEvents.values()]
          .filter((event) => !before || event.occurredAt < before)
          .sort((left, right) => {
            const timeDifference = right.occurredAt.getTime() - left.occurredAt.getTime();
            return timeDifference || right.id.localeCompare(left.id);
          })
          .slice(0, limit),
      );
    },

    async listUsers({ limit = 50 } = {}) {
      return clone(
        [...users.values()]
          .sort((left, right) => {
            const leftTime = new Date(left.createdAt || 0).getTime();
            const rightTime = new Date(right.createdAt || 0).getTime();
            return rightTime - leftTime || right.id.localeCompare(left.id);
          })
          .slice(0, limit),
      );
    },

    async transferOrganizationOwnership({
      actorUserId,
      event,
      expectedRevision,
      organizationId,
      targetUserId,
    }) {
      const organization = organizations.get(organizationId);
      if (!organization) return { outcome: 'organization_not_found' };
      if (organization.revision !== expectedRevision) return { outcome: 'revision_conflict' };
      if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
      const actor = users.get(actorUserId);
      const target = users.get(targetUserId);
      const actorKey = membershipKey(organizationId, actorUserId);
      const targetKey = membershipKey(organizationId, targetUserId);
      const actorMembership = memberships.get(actorKey);
      const targetMembership = memberships.get(targetKey);
      if (
        !actor ||
        actor.status !== 'active' ||
        organization.ownerUserId !== actorUserId ||
        actorMembership?.role !== 'owner' ||
        actorMembership.status !== 'active'
      ) {
        return { outcome: 'actor_not_owner' };
      }
      const activeOwnerCount = [...memberships.values()].filter(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.role === 'owner' &&
          membership.status === 'active',
      ).length;
      if (activeOwnerCount !== 1) return { outcome: 'ownership_invariant_violation' };
      if (
        !target ||
        target.status !== 'active' ||
        !target.emailVerifiedAt ||
        !targetMembership ||
        targetMembership.status !== 'active'
      ) {
        return { outcome: 'target_ineligible' };
      }
      if (targetMembership.role === 'owner') return { outcome: 'no_change' };

      const updatedActorMembership = {
        ...actorMembership,
        role: 'admin',
        updatedAt: event.occurredAt,
      };
      const updatedTargetMembership = {
        ...targetMembership,
        role: 'owner',
        updatedAt: event.occurredAt,
      };
      const updatedOrganization = {
        ...organization,
        ownerUserId: targetUserId,
        revision: organization.revision + 1,
        updatedAt: event.occurredAt,
      };
      memberships.set(actorKey, updatedActorMembership);
      memberships.set(targetKey, updatedTargetMembership);
      organizations.set(organizationId, updatedOrganization);
      const auditEvent = appendEvent(event, {
        afterState: {
          organizationRole: 'owner',
          ownerUserId: targetUserId,
          revision: updatedOrganization.revision,
        },
        beforeState: {
          organizationRole: actorMembership.role,
          ownerUserId: actorUserId,
          revision: organization.revision,
        },
        organizationId,
        targetUserId,
      });
      return clone({
        actorMembership: updatedActorMembership,
        auditEvent,
        organization: updatedOrganization,
        outcome: 'updated',
        targetMembership: updatedTargetMembership,
      });
    },

    snapshot() {
      return clone({
        auditEvents: [...auditEvents.values()],
        memberships: [...memberships.values()],
        operationKeys: [...operationKeys],
        organizations: [...organizations.values()],
        sessions: [...sessions.values()],
        users: [...users.values()],
      });
    },
  });
}

module.exports = {
  SUPERADMIN_BOOTSTRAP_OPERATION,
  createMemoryAuthorityRepository,
};
