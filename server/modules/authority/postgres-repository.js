'use strict';

const { userRecord } = require('../identity/postgres-repository');
const { membershipRecord, organizationRecord } = require('../organizations/postgres-repository');
const { requirePostgresPool } = require('../persistence/postgres-helpers');
const { SUPERADMIN_BOOTSTRAP_OPERATION } = require('./memory-repository');

const PLATFORM_AUTHORITY_CONTROL = 'platform-authority-v1';

function auditEventRecord(row) {
  if (!row) return null;
  return {
    action: row.action,
    actorSessionId: row.actor_session_id,
    actorUserId: row.actor_user_id,
    afterState: row.after_state || {},
    beforeState: row.before_state || {},
    id: row.id,
    occurredAt: row.occurred_at,
    operatorReference: row.operator_ref,
    organizationId: row.organization_id,
    reason: row.reason,
    requestId: row.request_id,
    source: row.source,
    targetUserId: row.target_id,
  };
}

function authorityState(row) {
  return {
    authorityRevision: row.authority_revision,
    platformRole: row.platform_role,
    status: row.status,
  };
}

async function appendAuditEvent(client, event, details, operationKey = null) {
  const result = await client.query(
    `INSERT INTO audit_events
      (id, actor_user_id, actor_session_id, organization_id, action, target_type,
       target_id, request_id, reason, source, operator_ref, before_state,
       after_state, operation_key, occurred_at, created_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
       $13::jsonb, $14, $15, $15)
     RETURNING *`,
    [
      event.id,
      event.actorUserId,
      event.actorSessionId,
      details.organizationId,
      event.action,
      details.organizationId ? 'organization' : 'user',
      details.targetUserId,
      event.requestId,
      event.reason,
      event.source,
      event.operatorReference,
      JSON.stringify(details.beforeState || {}),
      JSON.stringify(details.afterState || {}),
      operationKey,
      event.occurredAt,
    ],
  );
  return auditEventRecord(result.rows[0]);
}

async function withAuthorityTransaction(pool, operation) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error?.code === '40001' && attempt < 2) continue;
      if (error?.code === '23505' && error.constraint === 'audit_events_operation_key_key') {
        error.code = 'duplicate_authority_operation';
      }
      throw error;
    } finally {
      client.release();
    }
  }
  const error = new Error('authority_transaction_retry_exhausted');
  error.code = 'authority_transaction_unavailable';
  throw error;
}

async function lockPlatformAuthority(client) {
  await client.query(
    `INSERT INTO authority_controls (key, revision)
     VALUES ($1, 0)
     ON CONFLICT (key) DO NOTHING`,
    [PLATFORM_AUTHORITY_CONTROL],
  );
  await client.query(
    `UPDATE authority_controls
        SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
      WHERE key = $1`,
    [PLATFORM_AUTHORITY_CONTROL],
  );
  return (
    await client.query('SELECT * FROM authority_controls WHERE key = $1 FOR UPDATE', [
      PLATFORM_AUTHORITY_CONTROL,
    ])
  ).rows[0];
}

async function activeSuperadminCount(client) {
  const result = await client.query(
    `SELECT COUNT(*)::integer AS count
       FROM users
      WHERE platform_role = 'superadmin' AND status = 'active'`,
  );
  return result.rows[0].count;
}

async function activeSuperadmin(client, userId) {
  const result = await client.query(
    `SELECT * FROM users
      WHERE id = $1 AND platform_role = 'superadmin' AND status = 'active'`,
    [userId],
  );
  return result.rows[0] || null;
}

function createPostgresAuthorityRepository(pool) {
  requirePostgresPool(pool);
  return Object.freeze({
    async bootstrapSuperadmin({ email, event }) {
      return withAuthorityTransaction(pool, async (client) => {
        const control = await lockPlatformAuthority(client);
        const consumed = await client.query('SELECT 1 FROM audit_events WHERE operation_key = $1', [
          SUPERADMIN_BOOTSTRAP_OPERATION,
        ]);
        if (control.consumed_at || consumed.rows[0]) return { outcome: 'bootstrap_consumed' };
        if ((await activeSuperadminCount(client)) > 0) return { outcome: 'already_configured' };
        const targetResult = await client.query(
          'SELECT * FROM users WHERE email_normalized = $1 FOR UPDATE',
          [email],
        );
        const target = targetResult.rows[0];
        if (!target) return { outcome: 'user_not_found' };
        if (target.status !== 'active' || !target.email_verified_at) {
          return { outcome: 'target_ineligible' };
        }
        const beforeState = authorityState(target);
        const updated = await client.query(
          `UPDATE users
              SET platform_role = 'superadmin', authority_revision = authority_revision + 1,
                  updated_at = $2
            WHERE id = $1
            RETURNING *`,
          [target.id, event.occurredAt],
        );
        await client.query(
          `UPDATE authority_controls
              SET consumed_at = $2, operator_ref = $3, updated_at = $2
            WHERE key = $1`,
          [PLATFORM_AUTHORITY_CONTROL, event.occurredAt, event.operatorReference],
        );
        const auditEvent = await appendAuditEvent(
          client,
          event,
          {
            afterState: authorityState(updated.rows[0]),
            beforeState,
            organizationId: null,
            targetUserId: target.id,
          },
          SUPERADMIN_BOOTSTRAP_OPERATION,
        );
        return { auditEvent, outcome: 'updated', user: userRecord(updated.rows[0]) };
      });
    },

    async changeAccountStatus({ actorUserId, event, expectedRevision, status, targetUserId }) {
      return withAuthorityTransaction(pool, async (client) => {
        await lockPlatformAuthority(client);
        if (!(await activeSuperadmin(client, actorUserId))) {
          return { outcome: 'actor_not_authorized' };
        }
        const targetResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [
          targetUserId,
        ]);
        const target = targetResult.rows[0];
        if (!target) return { outcome: 'user_not_found' };
        if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
        if (target.authority_revision !== expectedRevision) return { outcome: 'revision_conflict' };
        if (target.status === status) return { outcome: 'no_change' };
        if (
          target.platform_role === 'superadmin' &&
          target.status === 'active' &&
          status !== 'active' &&
          (await activeSuperadminCount(client)) <= 1
        ) {
          return { outcome: 'last_superadmin' };
        }
        const beforeState = authorityState(target);
        const updated = await client.query(
          `UPDATE users
              SET status = $2, authority_revision = authority_revision + 1, updated_at = $3
            WHERE id = $1 AND authority_revision = $4
            RETURNING *`,
          [targetUserId, status, event.occurredAt, expectedRevision],
        );
        if (!updated.rows[0]) return { outcome: 'revision_conflict' };
        const revoked =
          status === 'active'
            ? { rowCount: 0 }
            : await client.query(
                `UPDATE sessions
                    SET revoked_at = $2, updated_at = $2
                  WHERE user_id = $1 AND revoked_at IS NULL`,
                [targetUserId, event.occurredAt],
              );
        const auditEvent = await appendAuditEvent(client, event, {
          afterState: authorityState(updated.rows[0]),
          beforeState,
          organizationId: null,
          targetUserId,
        });
        return {
          auditEvent,
          outcome: 'updated',
          revokedSessionCount: revoked.rowCount,
          user: userRecord(updated.rows[0]),
        };
      });
    },

    async changePlatformRole({ actorUserId, event, expectedRevision, platformRole, targetUserId }) {
      return withAuthorityTransaction(pool, async (client) => {
        await lockPlatformAuthority(client);
        if (!(await activeSuperadmin(client, actorUserId))) {
          return { outcome: 'actor_not_authorized' };
        }
        const targetResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [
          targetUserId,
        ]);
        const target = targetResult.rows[0];
        if (!target) return { outcome: 'user_not_found' };
        if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
        if (target.authority_revision !== expectedRevision) return { outcome: 'revision_conflict' };
        if (target.platform_role === platformRole) return { outcome: 'no_change' };
        if (
          target.platform_role === 'superadmin' &&
          platformRole !== 'superadmin' &&
          target.status === 'active' &&
          (await activeSuperadminCount(client)) <= 1
        ) {
          return { outcome: 'last_superadmin' };
        }
        if (
          platformRole === 'superadmin' &&
          (target.status !== 'active' || !target.email_verified_at)
        ) {
          return { outcome: 'target_ineligible' };
        }
        const beforeState = authorityState(target);
        const updated = await client.query(
          `UPDATE users
              SET platform_role = $2, authority_revision = authority_revision + 1,
                  updated_at = $3
            WHERE id = $1 AND authority_revision = $4
            RETURNING *`,
          [targetUserId, platformRole, event.occurredAt, expectedRevision],
        );
        if (!updated.rows[0]) return { outcome: 'revision_conflict' };
        const revoked = await client.query(
          `UPDATE sessions
              SET revoked_at = $2, updated_at = $2
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [targetUserId, event.occurredAt],
        );
        const auditEvent = await appendAuditEvent(client, event, {
          afterState: authorityState(updated.rows[0]),
          beforeState,
          organizationId: null,
          targetUserId,
        });
        return {
          auditEvent,
          outcome: 'updated',
          revokedSessionCount: revoked.rowCount,
          user: userRecord(updated.rows[0]),
        };
      });
    },

    async findOrganizationContext(organizationId, actorUserId) {
      const [organization, membership] = await Promise.all([
        pool.query('SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL', [
          organizationId,
        ]),
        pool.query(
          `SELECT * FROM organization_memberships
            WHERE organization_id = $1 AND user_id = $2`,
          [organizationId, actorUserId],
        ),
      ]);
      return {
        membership: membershipRecord(membership.rows[0]),
        organization: organizationRecord(organization.rows[0]),
      };
    },

    async listAuditEvents({ before = null, limit = 50 } = {}) {
      const result = await pool.query(
        `SELECT * FROM audit_events
          WHERE ($1::timestamptz IS NULL OR occurred_at < $1)
          ORDER BY occurred_at DESC, id DESC
          LIMIT $2`,
        [before, limit],
      );
      return result.rows.map(auditEventRecord);
    },

    async listUsers({ limit = 50 } = {}) {
      const result = await pool.query(
        'SELECT * FROM users ORDER BY created_at DESC, id DESC LIMIT $1',
        [limit],
      );
      return result.rows.map(userRecord);
    },

    async transferOrganizationOwnership({
      actorUserId,
      event,
      expectedRevision,
      organizationId,
      targetUserId,
    }) {
      return withAuthorityTransaction(pool, async (client) => {
        const organizationResult = await client.query(
          'SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [organizationId],
        );
        const organization = organizationResult.rows[0];
        if (!organization) return { outcome: 'organization_not_found' };
        if (organization.revision !== expectedRevision) return { outcome: 'revision_conflict' };
        if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
        const actor = await client.query('SELECT * FROM users WHERE id = $1', [actorUserId]);
        const target = await client.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
        const memberships = await client.query(
          `SELECT * FROM organization_memberships
            WHERE organization_id = $1 AND user_id = ANY($2::uuid[])
            FOR UPDATE`,
          [organizationId, [actorUserId, targetUserId]],
        );
        const actorMembership = memberships.rows.find((row) => row.user_id === actorUserId);
        const targetMembership = memberships.rows.find((row) => row.user_id === targetUserId);
        if (
          !actor.rows[0] ||
          actor.rows[0].status !== 'active' ||
          organization.owner_user_id !== actorUserId ||
          actorMembership?.role !== 'owner' ||
          actorMembership.status !== 'active'
        ) {
          return { outcome: 'actor_not_owner' };
        }
        const ownerCount = await client.query(
          `SELECT COUNT(*)::integer AS count
             FROM organization_memberships
            WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`,
          [organizationId],
        );
        if (ownerCount.rows[0].count !== 1) {
          return { outcome: 'ownership_invariant_violation' };
        }
        if (
          !target.rows[0] ||
          target.rows[0].status !== 'active' ||
          !target.rows[0].email_verified_at ||
          !targetMembership ||
          targetMembership.status !== 'active'
        ) {
          return { outcome: 'target_ineligible' };
        }
        if (targetMembership.role === 'owner') return { outcome: 'no_change' };
        const actorUpdate = await client.query(
          `UPDATE organization_memberships
              SET role = 'admin', revision = revision + 1, updated_at = $3
            WHERE organization_id = $1 AND user_id = $2
            RETURNING *`,
          [organizationId, actorUserId, event.occurredAt],
        );
        const targetUpdate = await client.query(
          `UPDATE organization_memberships
              SET role = 'owner', revision = revision + 1, updated_at = $3
            WHERE organization_id = $1 AND user_id = $2
            RETURNING *`,
          [organizationId, targetUserId, event.occurredAt],
        );
        const organizationUpdate = await client.query(
          `UPDATE organizations
              SET owner_user_id = $2, revision = revision + 1, updated_at = $3
            WHERE id = $1 AND revision = $4
            RETURNING *`,
          [organizationId, targetUserId, event.occurredAt, expectedRevision],
        );
        if (!organizationUpdate.rows[0]) return { outcome: 'revision_conflict' };
        const auditEvent = await appendAuditEvent(client, event, {
          afterState: {
            organizationRole: 'owner',
            ownerUserId: targetUserId,
            revision: organizationUpdate.rows[0].revision,
          },
          beforeState: {
            organizationRole: actorMembership.role,
            ownerUserId: actorUserId,
            revision: organization.revision,
          },
          organizationId,
          targetUserId,
        });
        return {
          actorMembership: membershipRecord(actorUpdate.rows[0]),
          auditEvent,
          organization: organizationRecord(organizationUpdate.rows[0]),
          outcome: 'updated',
          targetMembership: membershipRecord(targetUpdate.rows[0]),
        };
      });
    },
  });
}

module.exports = {
  PLATFORM_AUTHORITY_CONTROL,
  auditEventRecord,
  createPostgresAuthorityRepository,
};
