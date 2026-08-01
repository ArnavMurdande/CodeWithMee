'use strict';

const { requirePostgresPool, withPostgresTransaction } = require('../persistence/postgres-helpers');

function organizationRecord(row) {
  if (!row) return null;
  return {
    createdAt: row.created_at,
    description: row.description || '',
    id: row.id,
    industry: row.industry || '',
    logoFile: row.logo_file_id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    revision: row.revision,
    slug: row.slug,
    updatedAt: row.updated_at,
    verificationStatus: row.verification_status,
  };
}

function membershipRecord(row) {
  if (!row) return null;
  return {
    createdAt: row.created_at,
    id: row.id,
    invitedByUserId: row.invited_by_user_id || null,
    joinedAt: row.joined_at,
    organizationId: row.organization_id,
    role: row.role,
    status: row.status,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function invitationRecord(row) {
  if (!row) return null;
  return {
    acceptedAt: row.accepted_at,
    acceptedByUserId: row.accepted_by_user_id,
    activeKey:
      row.status === 'pending'
        ? `${row.organization_id}:${row.email_normalized}:${row.role}`
        : null,
    createdAt: row.created_at,
    email: row.email_normalized,
    expiresAt: row.expires_at,
    id: row.id,
    invitedByUserId: row.invited_by_user_id,
    organizationId: row.organization_id,
    revokedAt: row.revoked_at,
    role: row.role,
    tokenHash: row.token_hash,
    updatedAt: row.updated_at,
  };
}

function reviewRecord(row) {
  if (!row) return null;
  return {
    activeKey: row.status === 'pending_review' ? row.organization_id : null,
    createdAt: row.created_at,
    decisionReason: row.decision_reason,
    id: row.id,
    organizationId: row.organization_id,
    reviewedAt: row.reviewed_at,
    reviewerUserId: row.reviewer_user_id,
    statement: row.statement,
    status: row.status,
    submittedAt: row.submitted_at,
    submittedByUserId: row.submitted_by_user_id,
    updatedAt: row.updated_at,
  };
}

function mapOrganizationError(error) {
  if (error?.code !== '23505') return error;
  if (error.constraint === 'organizations_slug_key') error.code = 'duplicate_slug';
  if (error.constraint === 'organization_invitations_one_pending_per_role') {
    error.code = 'duplicate_active_invitation';
  }
  if (error.constraint === 'provider_verification_reviews_one_pending_per_org') {
    error.code = 'verification_already_pending';
  }
  return error;
}

function createPostgresOrganizationRepository(pool) {
  requirePostgresPool(pool);
  return Object.freeze({
    async createOrganizationWithOwner({ membership, organization }) {
      try {
        return await withPostgresTransaction(pool, async (client) => {
          const createdOrganization = await client.query(
            `INSERT INTO organizations
              (id, slug, name, description, industry, owner_user_id, logo_file_id,
               verification_status, revision, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)
             RETURNING *`,
            [
              organization.id,
              organization.slug,
              organization.name,
              organization.description || null,
              organization.industry || null,
              organization.ownerUserId,
              organization.logoFile || null,
              organization.verificationStatus,
              organization.createdAt || new Date(),
            ],
          );
          const createdMembership = await client.query(
            `INSERT INTO organization_memberships
              (id, organization_id, user_id, role, status, joined_at,
               suspended_at, revoked_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $7)
             RETURNING *`,
            [
              membership.id,
              organization.id,
              membership.userId,
              membership.role,
              membership.status,
              membership.joinedAt,
              membership.createdAt || new Date(),
            ],
          );
          return {
            membership: membershipRecord(createdMembership.rows[0]),
            organization: organizationRecord(createdOrganization.rows[0]),
          };
        });
      } catch (error) {
        throw mapOrganizationError(error);
      }
    },

    async createInvitation(invitation) {
      try {
        const result = await pool.query(
          `INSERT INTO organization_invitations
            (id, organization_id, email_normalized, role, status, token_hash,
             invited_by_user_id, accepted_by_user_id, expires_at, accepted_at,
             revoked_at, created_at, updated_at)
           SELECT $1, id, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, $11, $11
             FROM organizations
            WHERE id = $2 AND deleted_at IS NULL
           RETURNING *`,
          [
            invitation.id,
            invitation.organizationId,
            invitation.email,
            invitation.role,
            invitation.tokenHash,
            invitation.invitedByUserId,
            invitation.acceptedByUserId,
            invitation.expiresAt,
            invitation.acceptedAt,
            invitation.revokedAt,
            invitation.createdAt,
          ],
        );
        return invitationRecord(result.rows[0]);
      } catch (error) {
        throw mapOrganizationError(error);
      }
    },

    async createVerificationReview({ organizationId, review, submittedAt }) {
      try {
        return await withPostgresTransaction(pool, async (client) => {
          const organization = await client.query(
            `UPDATE organizations
                SET verification_status = 'pending_review', revision = revision + 1,
                    updated_at = $2
              WHERE id = $1 AND deleted_at IS NULL
                AND verification_status IN ('draft', 'rejected')
              RETURNING *`,
            [organizationId, submittedAt],
          );
          if (!organization.rows[0]) return null;
          const created = await client.query(
            `INSERT INTO provider_verification_reviews
              (id, organization_id, submitted_by_user_id, statement, status,
               submitted_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'pending_review', $5, $5, $5)
             RETURNING *`,
            [review.id, organizationId, review.submittedByUserId, review.statement, submittedAt],
          );
          return {
            organization: organizationRecord(organization.rows[0]),
            review: reviewRecord(created.rows[0]),
          };
        });
      } catch (error) {
        throw mapOrganizationError(error);
      }
    },

    async decideVerificationReview({
      decidedAt,
      decisionReason,
      reviewId,
      reviewerUserId,
      status,
    }) {
      return withPostgresTransaction(pool, async (client) => {
        const decided = await client.query(
          `UPDATE provider_verification_reviews
              SET status = $2, decision_reason = $3, reviewed_at = $4,
                  reviewer_user_id = $5, updated_at = $4
            WHERE id = $1 AND status = 'pending_review'
            RETURNING *`,
          [reviewId, status, decisionReason, decidedAt, reviewerUserId],
        );
        if (!decided.rows[0]) return null;
        const organization = await client.query(
          `UPDATE organizations
              SET verification_status = $2, revision = revision + 1, updated_at = $3
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING *`,
          [decided.rows[0].organization_id, status, decidedAt],
        );
        if (!organization.rows[0]) throw new Error('organization_not_found');
        return {
          organization: organizationRecord(organization.rows[0]),
          review: reviewRecord(decided.rows[0]),
        };
      });
    },

    async consumeInvitation({ acceptedAt, email, invitationId, tokenHash, userId }) {
      return withPostgresTransaction(pool, async (client) => {
        const accepted = await client.query(
          `UPDATE organization_invitations
              SET status = 'accepted', accepted_at = $1, accepted_by_user_id = $2,
                  updated_at = $1
            WHERE id = $3 AND email_normalized = $4 AND token_hash = $5
              AND status = 'pending' AND expires_at > $1
            RETURNING *`,
          [acceptedAt, userId, invitationId, email, tokenHash],
        );
        if (!accepted.rows[0]) return null;
        const membership = await client.query(
          `INSERT INTO organization_memberships
            (organization_id, user_id, role, status, joined_at, suspended_at,
             revoked_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'active', $4, NULL, NULL, $4, $4)
           ON CONFLICT (organization_id, user_id) DO UPDATE
             SET role = EXCLUDED.role, status = 'active', joined_at = EXCLUDED.joined_at,
                 suspended_at = NULL, revoked_at = NULL, updated_at = EXCLUDED.updated_at,
                 revision = organization_memberships.revision + 1
           RETURNING *`,
          [accepted.rows[0].organization_id, userId, accepted.rows[0].role, acceptedAt],
        );
        return {
          invitation: invitationRecord(accepted.rows[0]),
          membership: membershipRecord(membership.rows[0]),
        };
      });
    },

    async countActiveOwners(organizationId) {
      const result = await pool.query(
        `SELECT COUNT(*)::integer AS count
           FROM organization_memberships
          WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`,
        [organizationId],
      );
      return result.rows[0].count;
    },

    async findInvitation(invitationId) {
      const result = await pool.query('SELECT * FROM organization_invitations WHERE id = $1', [
        invitationId,
      ]);
      return invitationRecord(result.rows[0]);
    },

    async findMembership(organizationId, userId) {
      const result = await pool.query(
        `SELECT * FROM organization_memberships
          WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );
      return membershipRecord(result.rows[0]);
    },

    async findOrganizationById(organizationId) {
      const result = await pool.query(
        'SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL',
        [organizationId],
      );
      return organizationRecord(result.rows[0]);
    },

    async findOrganizationBySlug(slug) {
      const result = await pool.query(
        'SELECT * FROM organizations WHERE slug = $1 AND deleted_at IS NULL',
        [slug],
      );
      return organizationRecord(result.rows[0]);
    },

    async findVerificationReview(reviewId) {
      const result = await pool.query('SELECT * FROM provider_verification_reviews WHERE id = $1', [
        reviewId,
      ]);
      return reviewRecord(result.rows[0]);
    },

    async listMemberships(organizationId) {
      const result = await pool.query(
        `SELECT * FROM organization_memberships
          WHERE organization_id = $1
          ORDER BY joined_at, id`,
        [organizationId],
      );
      return result.rows.map(membershipRecord);
    },

    async listMembershipsForUser(userId) {
      const result = await pool.query(
        `SELECT m.*
           FROM organization_memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
          WHERE m.user_id = $1
          ORDER BY m.joined_at, m.id`,
        [userId],
      );
      return result.rows.map(membershipRecord);
    },

    async listVerificationReviews(status = 'pending_review') {
      const result = status
        ? await pool.query(
            `SELECT * FROM provider_verification_reviews
              WHERE status = $1 ORDER BY submitted_at, id`,
            [status],
          )
        : await pool.query('SELECT * FROM provider_verification_reviews ORDER BY submitted_at, id');
      return result.rows.map(reviewRecord);
    },

    async revokeActiveInvitations(organizationId, email, role, revokedAt) {
      const result = await pool.query(
        `UPDATE organization_invitations
            SET status = 'revoked', revoked_at = $4, updated_at = $4
          WHERE organization_id = $1 AND email_normalized = $2 AND role = $3
            AND status = 'pending'`,
        [organizationId, email, role, revokedAt],
      );
      return result.rowCount;
    },

    async updateMembership(organizationId, userId, updates) {
      return withPostgresTransaction(pool, async (client) => {
        const current = await client.query(
          `SELECT * FROM organization_memberships
            WHERE organization_id = $1 AND user_id = $2
            FOR UPDATE`,
          [organizationId, userId],
        );
        if (!current.rows[0]) return null;
        const role = updates.role || current.rows[0].role;
        const status = updates.status || current.rows[0].status;
        const now = new Date();
        const suspendedAt = status === 'suspended' ? now : null;
        const revokedAt = status === 'revoked' ? now : null;
        const result = await client.query(
          `UPDATE organization_memberships
              SET role = $3, status = $4, suspended_at = $5, revoked_at = $6,
                  revision = revision + 1, updated_at = $7
            WHERE organization_id = $1 AND user_id = $2
            RETURNING *`,
          [organizationId, userId, role, status, suspendedAt, revokedAt, now],
        );
        return membershipRecord(result.rows[0]);
      });
    },

    async updateOrganization(organizationId, expectedRevision, updates) {
      const result = await pool.query(
        `UPDATE organizations
            SET name = COALESCE($3, name),
                description = COALESCE($4, description),
                industry = COALESCE($5, industry),
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND revision = $2 AND deleted_at IS NULL
          RETURNING *`,
        [
          organizationId,
          expectedRevision,
          Object.hasOwn(updates, 'name') ? updates.name : null,
          Object.hasOwn(updates, 'description') ? updates.description : null,
          Object.hasOwn(updates, 'industry') ? updates.industry : null,
        ],
      );
      if (result.rows[0]) {
        return { outcome: 'updated', organization: organizationRecord(result.rows[0]) };
      }
      const current = await pool.query(
        'SELECT * FROM organizations WHERE id = $1 AND deleted_at IS NULL',
        [organizationId],
      );
      return current.rows[0]
        ? { outcome: 'conflict', organization: organizationRecord(current.rows[0]) }
        : { outcome: 'not_found', organization: null };
    },
  });
}

module.exports = {
  createPostgresOrganizationRepository,
  invitationRecord,
  membershipRecord,
  organizationRecord,
  reviewRecord,
};
