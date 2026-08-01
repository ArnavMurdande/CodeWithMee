'use strict';

const { randomUUID } = require('node:crypto');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function membershipKey(organizationId, userId) {
  return `${organizationId}:${userId}`;
}

function createMemoryOrganizationRepository(seed = {}) {
  const organizations = new Map(
    (seed.organizations || []).map((organization) => [organization.id, clone(organization)]),
  );
  const memberships = new Map(
    (seed.memberships || []).map((membership) => [
      membershipKey(membership.organizationId, membership.userId),
      clone(membership),
    ]),
  );
  const invitations = new Map(
    (seed.invitations || []).map((invitation) => [invitation.id, clone(invitation)]),
  );
  const reviews = new Map((seed.reviews || []).map((review) => [review.id, clone(review)]));

  return Object.freeze({
    async createOrganizationWithOwner({ membership, organization }) {
      if ([...organizations.values()].some((record) => record.slug === organization.slug)) {
        const error = new Error('duplicate_slug');
        error.code = 'duplicate_slug';
        throw error;
      }
      const createdOrganization = {
        ...clone(organization),
        createdAt: organization.createdAt || new Date(),
        id: organization.id || randomUUID(),
        revision: 1,
        updatedAt: organization.updatedAt || new Date(),
      };
      const createdMembership = {
        ...clone(membership),
        createdAt: membership.createdAt || new Date(),
        id: membership.id || randomUUID(),
        joinedAt: membership.joinedAt || new Date(),
        organizationId: createdOrganization.id,
        updatedAt: membership.updatedAt || new Date(),
      };
      organizations.set(createdOrganization.id, createdOrganization);
      memberships.set(
        membershipKey(createdOrganization.id, createdMembership.userId),
        createdMembership,
      );
      return clone({ membership: createdMembership, organization: createdOrganization });
    },

    async findOrganizationById(organizationId) {
      return clone(organizations.get(organizationId) || null);
    },

    async findOrganizationBySlug(slug) {
      return clone(
        [...organizations.values()].find((organization) => organization.slug === slug) || null,
      );
    },

    async updateOrganization(organizationId, expectedRevision, updates) {
      const organization = organizations.get(organizationId);
      if (!organization) return { outcome: 'not_found', organization: null };
      if (organization.revision !== expectedRevision) {
        return { outcome: 'conflict', organization: clone(organization) };
      }
      const updated = {
        ...organization,
        ...clone(updates),
        revision: organization.revision + 1,
        updatedAt: new Date(),
      };
      organizations.set(organizationId, updated);
      return clone({ outcome: 'updated', organization: updated });
    },

    async findMembership(organizationId, userId) {
      return clone(memberships.get(membershipKey(organizationId, userId)) || null);
    },

    async listMemberships(organizationId) {
      return clone(
        [...memberships.values()]
          .filter((membership) => membership.organizationId === organizationId)
          .sort((left, right) => left.joinedAt - right.joinedAt),
      );
    },

    async listMembershipsForUser(userId) {
      return clone(
        [...memberships.values()]
          .filter((membership) => membership.userId === userId)
          .sort((left, right) => left.joinedAt - right.joinedAt),
      );
    },

    async countActiveOwners(organizationId) {
      return [...memberships.values()].filter(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.role === 'owner' &&
          membership.status === 'active',
      ).length;
    },

    async updateMembership(organizationId, userId, updates) {
      const key = membershipKey(organizationId, userId);
      const membership = memberships.get(key);
      if (!membership) return null;
      const updated = { ...membership, ...clone(updates), updatedAt: new Date() };
      memberships.set(key, updated);
      return clone(updated);
    },

    async revokeActiveInvitations(organizationId, email, role, revokedAt) {
      for (const [invitationId, invitation] of invitations) {
        if (
          invitation.organizationId === organizationId &&
          invitation.email === email &&
          invitation.role === role &&
          !invitation.acceptedAt &&
          !invitation.revokedAt
        ) {
          invitations.set(invitationId, { ...invitation, activeKey: null, revokedAt });
        }
      }
    },

    async createInvitation(invitation) {
      if (
        [...invitations.values()].some(
          (record) => record.activeKey && record.activeKey === invitation.activeKey,
        )
      ) {
        const error = new Error('duplicate_active_invitation');
        error.code = 'duplicate_active_invitation';
        throw error;
      }
      const created = {
        ...clone(invitation),
        createdAt: invitation.createdAt || new Date(),
        id: invitation.id || randomUUID(),
        updatedAt: invitation.updatedAt || new Date(),
      };
      invitations.set(created.id, created);
      return clone(created);
    },

    async findInvitation(invitationId) {
      return clone(invitations.get(invitationId) || null);
    },

    async consumeInvitation({ acceptedAt, email, invitationId, tokenHash, userId }) {
      const invitation = invitations.get(invitationId);
      if (
        !invitation ||
        invitation.email !== email ||
        invitation.tokenHash !== tokenHash ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= acceptedAt
      ) {
        return null;
      }
      const accepted = {
        ...invitation,
        acceptedAt,
        acceptedByUserId: userId,
        activeKey: null,
        updatedAt: acceptedAt,
      };
      invitations.set(invitationId, accepted);

      const key = membershipKey(invitation.organizationId, userId);
      const existing = memberships.get(key);
      const membership = {
        ...existing,
        createdAt: existing?.createdAt || acceptedAt,
        id: existing?.id || randomUUID(),
        invitedByUserId: invitation.invitedByUserId,
        joinedAt: acceptedAt,
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: 'active',
        updatedAt: acceptedAt,
        userId,
      };
      memberships.set(key, membership);
      return clone({ invitation: accepted, membership });
    },

    async createVerificationReview({ organizationId, review, submittedAt }) {
      const organization = organizations.get(organizationId);
      if (!organization) return null;
      if ([...reviews.values()].some((record) => record.activeKey === organizationId)) {
        const error = new Error('verification_already_pending');
        error.code = 'verification_already_pending';
        throw error;
      }
      const created = {
        ...clone(review),
        activeKey: organizationId,
        createdAt: submittedAt,
        id: review.id || randomUUID(),
        organizationId,
        status: 'pending_review',
        submittedAt,
        updatedAt: submittedAt,
      };
      reviews.set(created.id, created);
      organizations.set(organizationId, {
        ...organization,
        revision: organization.revision + 1,
        updatedAt: submittedAt,
        verificationStatus: 'pending_review',
      });
      return clone({ organization: organizations.get(organizationId), review: created });
    },

    async findVerificationReview(reviewId) {
      return clone(reviews.get(reviewId) || null);
    },

    async listVerificationReviews(status = 'pending_review') {
      return clone(
        [...reviews.values()]
          .filter((review) => !status || review.status === status)
          .sort((left, right) => left.submittedAt - right.submittedAt),
      );
    },

    async decideVerificationReview({
      decidedAt,
      decisionReason,
      reviewId,
      reviewerUserId,
      status,
    }) {
      const review = reviews.get(reviewId);
      if (!review || review.status !== 'pending_review') return null;
      const organization = organizations.get(review.organizationId);
      if (!organization) return null;
      const decided = {
        ...review,
        activeKey: null,
        decisionReason,
        reviewedAt: decidedAt,
        reviewerUserId,
        status,
        updatedAt: decidedAt,
      };
      reviews.set(reviewId, decided);
      organizations.set(organization.id, {
        ...organization,
        revision: organization.revision + 1,
        updatedAt: decidedAt,
        verificationStatus: status,
      });
      return clone({ organization: organizations.get(organization.id), review: decided });
    },

    snapshot() {
      return clone({
        invitations: [...invitations.values()],
        memberships: [...memberships.values()],
        organizations: [...organizations.values()],
        reviews: [...reviews.values()],
      });
    },
  });
}

module.exports = { createMemoryOrganizationRepository };
