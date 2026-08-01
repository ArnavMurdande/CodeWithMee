'use strict';

const { randomUUID } = require('node:crypto');

const { normalizeEmail } = require('../identity/service');
const {
  createOpaqueToken,
  hashOpaqueToken,
  parseOpaqueToken,
} = require('../identity/token-crypto');
const { evaluatePermission } = require('../policies/authorize');
const { PERMISSION } = require('../policies/permissions');
const {
  ORGANIZATION_MEMBERSHIP_STATUS,
  ORGANIZATION_ROLE,
  ORGANIZATION_VERIFICATION_STATUS,
} = require('./contracts');
const { OrganizationError } = require('./errors');

const INVITABLE_ROLES = Object.freeze([
  ORGANIZATION_ROLE.ADMIN,
  ORGANIZATION_ROLE.INSTRUCTOR,
  ORGANIZATION_ROLE.GRADER,
  ORGANIZATION_ROLE.ANALYST,
]);
const MUTABLE_MEMBERSHIP_STATUSES = Object.freeze([
  ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE,
  ORGANIZATION_MEMBERSHIP_STATUS.SUSPENDED,
  ORGANIZATION_MEMBERSHIP_STATUS.REVOKED,
]);

function normalizeText(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

function validateOrganizationInput(input, { partial = false } = {}) {
  const output = {};
  if (!partial || Object.hasOwn(input, 'name')) {
    output.name = normalizeText(input.name);
    if (output.name.length < 2 || output.name.length > 120) {
      throw new OrganizationError('invalid_organization_name');
    }
  }
  if (!partial || Object.hasOwn(input, 'slug')) {
    output.slug = normalizeSlug(input.slug);
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(output.slug)) {
      throw new OrganizationError('invalid_organization_slug');
    }
  }
  if (!partial || Object.hasOwn(input, 'description')) {
    output.description = normalizeText(input.description);
    if (output.description.length > 2_000) {
      throw new OrganizationError('invalid_organization_description');
    }
  }
  if (!partial || Object.hasOwn(input, 'industry')) {
    output.industry = normalizeText(input.industry);
    if (output.industry.length > 100) {
      throw new OrganizationError('invalid_organization_industry');
    }
  }
  return output;
}

function organizationDto(organization, { privateView = false } = {}) {
  const dto = {
    description: organization.description || '',
    id: organization.id,
    industry: organization.industry || '',
    logoFile: organization.logoFile || null,
    name: organization.name,
    slug: organization.slug,
    verificationStatus: organization.verificationStatus,
  };
  if (privateView) {
    Object.assign(dto, {
      createdAt: organization.createdAt,
      ownerUserId: organization.ownerUserId,
      revision: organization.revision,
      updatedAt: organization.updatedAt,
    });
  }
  return Object.freeze(dto);
}

function membershipDto(membership, user = null) {
  return Object.freeze({
    id: membership.id,
    joinedAt: membership.joinedAt,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
    user: user
      ? Object.freeze({
          avatarUrl: user.avatarUrl || null,
          displayName: user.displayName,
          email: user.email,
          id: user.id,
        })
      : Object.freeze({ id: membership.userId }),
  });
}

function invitationDto(invitation, deliveryQueued = undefined) {
  const dto = {
    acceptedAt: invitation.acceptedAt || null,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    id: invitation.id,
    organizationId: invitation.organizationId,
    revokedAt: invitation.revokedAt || null,
    role: invitation.role,
  };
  if (typeof deliveryQueued === 'boolean') dto.deliveryQueued = deliveryQueued;
  return Object.freeze(dto);
}

function reviewDto(review, organization = null) {
  return Object.freeze({
    decisionReason: review.decisionReason || null,
    id: review.id,
    organization: organization ? organizationDto(organization, { privateView: true }) : undefined,
    organizationId: review.organizationId,
    reviewedAt: review.reviewedAt || null,
    reviewerUserId: review.reviewerUserId || null,
    statement: review.statement,
    status: review.status,
    submittedAt: review.submittedAt,
    submittedByUserId: review.submittedByUserId,
  });
}

function createOrganizationService({
  identityRepository,
  invitationTokenPepper,
  mailer,
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
    if (!result.allowed) throw new OrganizationError(result.reason, 403);
    return result;
  }

  async function contextFor(authentication, organizationId) {
    const organization = await repository.findOrganizationById(organizationId);
    if (!organization) throw new OrganizationError('organization_not_found', 404);
    const membership = authentication
      ? await repository.findMembership(organizationId, authentication.principal.userId)
      : null;
    return { membership, organization };
  }

  function validateInviteRole(actorRole, role) {
    if (!INVITABLE_ROLES.includes(role)) throw new OrganizationError('invalid_organization_role');
    if (actorRole === ORGANIZATION_ROLE.ADMIN && role === ORGANIZATION_ROLE.ADMIN) {
      throw new OrganizationError('membership_hierarchy_denied', 403);
    }
  }

  return Object.freeze({
    async acceptInvitation(authentication, rawToken) {
      requirePermission(PERMISSION.ORGANIZATION_CREATE, authentication);
      const parsed = parseOpaqueToken(rawToken, 'oi1');
      if (!parsed) throw new OrganizationError('invalid_or_expired_invitation', 400);
      const invitation = await repository.findInvitation(parsed.id);
      if (!invitation || invitation.email !== authentication.user.email) {
        throw new OrganizationError('invalid_or_expired_invitation', 400);
      }
      const acceptedAt = now();
      const result = await repository.consumeInvitation({
        acceptedAt,
        email: authentication.user.email,
        invitationId: parsed.id,
        tokenHash: hashOpaqueToken(rawToken, invitationTokenPepper),
        userId: authentication.principal.userId,
      });
      if (!result) throw new OrganizationError('invalid_or_expired_invitation', 400);
      return Object.freeze({
        invitation: invitationDto(result.invitation),
        membership: membershipDto(result.membership, authentication.user),
      });
    },

    async createOrganization(authentication, rawInput = {}) {
      requirePermission(PERMISSION.ORGANIZATION_CREATE, authentication);
      const input = validateOrganizationInput(rawInput);
      const createdAt = now();
      try {
        const created = await repository.createOrganizationWithOwner({
          membership: {
            id: randomUUID(),
            invitedByUserId: null,
            joinedAt: createdAt,
            role: ORGANIZATION_ROLE.OWNER,
            status: ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE,
            userId: authentication.principal.userId,
          },
          organization: {
            ...input,
            createdAt,
            id: randomUUID(),
            logoFile: null,
            ownerUserId: authentication.principal.userId,
            updatedAt: createdAt,
            verificationStatus: ORGANIZATION_VERIFICATION_STATUS.DRAFT,
          },
        });
        return Object.freeze({
          membership: membershipDto(created.membership, authentication.user),
          organization: organizationDto(created.organization, { privateView: true }),
        });
      } catch (error) {
        if (error.code === 'duplicate_slug') {
          throw new OrganizationError('organization_slug_unavailable', 409);
        }
        throw error;
      }
    },

    async decideVerification(authentication, reviewId, rawInput = {}) {
      requirePermission(PERMISSION.ORGANIZATION_VERIFICATION_REVIEW, authentication);
      const status = rawInput.status;
      if (
        ![
          ORGANIZATION_VERIFICATION_STATUS.APPROVED,
          ORGANIZATION_VERIFICATION_STATUS.REJECTED,
        ].includes(status)
      ) {
        throw new OrganizationError('invalid_verification_decision');
      }
      const decisionReason = normalizeText(rawInput.reason);
      if (
        decisionReason.length > 2_000 ||
        (status === ORGANIZATION_VERIFICATION_STATUS.REJECTED && decisionReason.length < 10)
      ) {
        throw new OrganizationError('invalid_verification_reason');
      }
      const result = await repository.decideVerificationReview({
        decidedAt: now(),
        decisionReason: decisionReason || null,
        reviewId,
        reviewerUserId: authentication.principal.userId,
        status,
      });
      if (!result) throw new OrganizationError('verification_review_not_found', 404);
      return Object.freeze({
        organization: organizationDto(result.organization, { privateView: true }),
        review: reviewDto(result.review, result.organization),
      });
    },

    async getOrganization(authentication, organizationId) {
      const context = await contextFor(authentication, organizationId);
      const isPublic =
        context.organization.verificationStatus === ORGANIZATION_VERIFICATION_STATUS.APPROVED;
      if (!isPublic) {
        requirePermission(PERMISSION.ORGANIZATION_READ_PRIVATE, authentication, context);
      }
      return organizationDto(context.organization, {
        privateView: Boolean(context.membership?.status === ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE),
      });
    },

    async inviteMember(authentication, organizationId, rawInput = {}) {
      const context = await contextFor(authentication, organizationId);
      requirePermission(PERMISSION.ORGANIZATION_MEMBERS_MANAGE, authentication, context);
      const email = normalizeEmail(rawInput.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new OrganizationError('invalid_invitation_email');
      }
      validateInviteRole(context.membership.role, rawInput.role);
      const knownUser = await identityRepository.findUserByEmail(email);
      if (knownUser) {
        const existing = await repository.findMembership(organizationId, knownUser.id);
        if (existing?.status === ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE) {
          throw new OrganizationError('membership_already_active', 409);
        }
      }
      const issuedAt = now();
      const opaque = createOpaqueToken('oi1');
      await repository.revokeActiveInvitations(organizationId, email, rawInput.role, issuedAt);
      let invitation;
      try {
        invitation = await repository.createInvitation({
          acceptedAt: null,
          acceptedByUserId: null,
          activeKey: `${organizationId}:${email}:${rawInput.role}`,
          createdAt: issuedAt,
          email,
          expiresAt: new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
          id: opaque.id,
          invitedByUserId: authentication.principal.userId,
          organizationId,
          revokedAt: null,
          role: rawInput.role,
          tokenHash: hashOpaqueToken(opaque.raw, invitationTokenPepper),
          updatedAt: issuedAt,
        });
      } catch (error) {
        if (error.code === 'duplicate_active_invitation') {
          throw new OrganizationError('invitation_conflict', 409);
        }
        throw error;
      }
      if (!invitation) throw new OrganizationError('organization_not_found', 404);
      const delivery = await mailer.send({
        organization: { id: context.organization.id, name: context.organization.name },
        purpose: 'organization_invitation',
        role: invitation.role,
        to: invitation.email,
        token: opaque.raw,
      });
      return invitationDto(invitation, delivery.delivered === true);
    },

    async listMemberships(authentication, organizationId) {
      const context = await contextFor(authentication, organizationId);
      requirePermission(PERMISSION.ORGANIZATION_MEMBERS_READ, authentication, context);
      const memberships = await repository.listMemberships(organizationId);
      return Promise.all(
        memberships.map(async (membership) =>
          membershipDto(membership, await identityRepository.findUserById(membership.userId)),
        ),
      );
    },

    async listMyOrganizations(authentication) {
      const memberships = await repository.listMembershipsForUser(authentication.principal.userId);
      const active = memberships.filter(
        (membership) => membership.status === ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE,
      );
      return Promise.all(
        active.map(async (membership) => {
          const organization = await repository.findOrganizationById(membership.organizationId);
          return Object.freeze({
            membership: membershipDto(membership, authentication.user),
            organization: organizationDto(organization, { privateView: true }),
          });
        }),
      );
    },

    async listVerificationReviews(authentication, status = 'pending_review') {
      requirePermission(PERMISSION.ORGANIZATION_VERIFICATION_REVIEW, authentication);
      const allowed = ['', 'pending_review', 'approved', 'rejected'];
      if (!allowed.includes(status || '')) throw new OrganizationError('invalid_review_status');
      const reviews = await repository.listVerificationReviews(status || null);
      return Promise.all(
        reviews.map(async (review) =>
          reviewDto(review, await repository.findOrganizationById(review.organizationId)),
        ),
      );
    },

    async submitVerification(authentication, organizationId, rawInput = {}) {
      const context = await contextFor(authentication, organizationId);
      requirePermission(PERMISSION.ORGANIZATION_VERIFICATION_SUBMIT, authentication, context);
      if (
        ![
          ORGANIZATION_VERIFICATION_STATUS.DRAFT,
          ORGANIZATION_VERIFICATION_STATUS.REJECTED,
        ].includes(context.organization.verificationStatus)
      ) {
        throw new OrganizationError('verification_submission_unavailable', 409);
      }
      const statement = normalizeText(rawInput.statement);
      if (statement.length < 20 || statement.length > 2_000) {
        throw new OrganizationError('invalid_verification_statement');
      }
      try {
        const result = await repository.createVerificationReview({
          organizationId,
          review: {
            decisionReason: null,
            id: randomUUID(),
            reviewedAt: null,
            reviewerUserId: null,
            statement,
            submittedByUserId: authentication.principal.userId,
          },
          submittedAt: now(),
        });
        if (!result) throw new OrganizationError('organization_not_found', 404);
        return Object.freeze({
          organization: organizationDto(result.organization, { privateView: true }),
          review: reviewDto(result.review, result.organization),
        });
      } catch (error) {
        if (error.code === 'verification_already_pending') {
          throw new OrganizationError('verification_already_pending', 409);
        }
        throw error;
      }
    },

    async updateMembership(authentication, organizationId, userId, rawInput = {}) {
      const context = await contextFor(authentication, organizationId);
      requirePermission(PERMISSION.ORGANIZATION_MEMBERS_MANAGE, authentication, context);
      const target = await repository.findMembership(organizationId, userId);
      if (!target) throw new OrganizationError('membership_not_found', 404);
      if (target.userId === authentication.principal.userId) {
        throw new OrganizationError('membership_self_change_denied', 403);
      }
      if (target.role === ORGANIZATION_ROLE.OWNER || rawInput.role === ORGANIZATION_ROLE.OWNER) {
        throw new OrganizationError('ownership_transfer_required', 409);
      }
      if (
        context.membership.role === ORGANIZATION_ROLE.ADMIN &&
        target.role === ORGANIZATION_ROLE.ADMIN
      ) {
        throw new OrganizationError('membership_hierarchy_denied', 403);
      }
      const updates = {};
      if (Object.hasOwn(rawInput, 'role')) {
        validateInviteRole(context.membership.role, rawInput.role);
        updates.role = rawInput.role;
      }
      if (Object.hasOwn(rawInput, 'status')) {
        if (!MUTABLE_MEMBERSHIP_STATUSES.includes(rawInput.status)) {
          throw new OrganizationError('invalid_membership_status');
        }
        updates.status = rawInput.status;
      }
      if (!Object.keys(updates).length) throw new OrganizationError('membership_update_empty');
      const updated = await repository.updateMembership(organizationId, userId, updates);
      if (!updated) throw new OrganizationError('membership_not_found', 404);
      return membershipDto(updated, await identityRepository.findUserById(userId));
    },

    async updateOrganization(authentication, organizationId, rawInput = {}) {
      const context = await contextFor(authentication, organizationId);
      requirePermission(PERMISSION.ORGANIZATION_UPDATE, authentication, context);
      const expectedRevision = Number(rawInput.revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new OrganizationError('organization_revision_required');
      }
      const updates = validateOrganizationInput(rawInput, { partial: true });
      delete updates.slug;
      if (!Object.keys(updates).length) throw new OrganizationError('organization_update_empty');
      const result = await repository.updateOrganization(organizationId, expectedRevision, updates);
      if (result.outcome === 'conflict') {
        throw new OrganizationError('organization_revision_conflict', 409);
      }
      if (result.outcome === 'not_found')
        throw new OrganizationError('organization_not_found', 404);
      return organizationDto(result.organization, { privateView: true });
    },
  });
}

module.exports = {
  createOrganizationService,
  invitationDto,
  membershipDto,
  organizationDto,
  reviewDto,
  validateOrganizationInput,
};
