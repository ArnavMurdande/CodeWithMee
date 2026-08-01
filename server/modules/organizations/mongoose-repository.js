'use strict';

const Organization = require('../../models/Organization');
const OrganizationInvitation = require('../../models/OrganizationInvitation');
const OrganizationMembership = require('../../models/OrganizationMembership');
const ProviderVerificationReview = require('../../models/ProviderVerificationReview');

function identifier(value) {
  return value == null ? null : value.toString();
}

function organizationRecord(document) {
  if (!document) return null;
  return {
    createdAt: document.createdAt,
    description: document.description || '',
    id: document.organizationId,
    industry: document.industry || '',
    logoFile: identifier(document.logoFile),
    name: document.name,
    ownerUserId: identifier(document.owner),
    revision: document.revision,
    slug: document.slug,
    updatedAt: document.updatedAt,
    verificationStatus: document.verificationStatus,
  };
}

function membershipRecord(document, organizationId) {
  if (!document) return null;
  return {
    createdAt: document.createdAt,
    id: document.membershipId,
    invitedByUserId: identifier(document.invitedBy),
    joinedAt: document.joinedAt,
    organizationId,
    role: document.role,
    status: document.status,
    updatedAt: document.updatedAt,
    userId: identifier(document.user),
  };
}

function invitationRecord(document, organizationId) {
  if (!document) return null;
  return {
    acceptedAt: document.acceptedAt || null,
    acceptedByUserId: identifier(document.acceptedBy),
    activeKey: document.activeKey || null,
    createdAt: document.createdAt,
    email: document.email,
    expiresAt: document.expiresAt,
    id: document.invitationId,
    invitedByUserId: identifier(document.invitedBy),
    organizationId,
    revokedAt: document.revokedAt || null,
    role: document.role,
    tokenHash: document.tokenHash,
    updatedAt: document.updatedAt,
  };
}

function reviewRecord(document, organizationId) {
  if (!document) return null;
  return {
    activeKey: document.activeKey || null,
    createdAt: document.createdAt,
    decisionReason: document.decisionReason || null,
    id: document.reviewId,
    organizationId,
    reviewedAt: document.reviewedAt || null,
    reviewerUserId: identifier(document.reviewer),
    statement: document.statement,
    status: document.status,
    submittedAt: document.submittedAt,
    submittedByUserId: identifier(document.submittedBy),
    updatedAt: document.updatedAt,
  };
}

async function organizationDocument(organizationId) {
  return Organization.findOne({ organizationId }).lean();
}

function createMongooseOrganizationRepository() {
  return Object.freeze({
    async createOrganizationWithOwner({ membership, organization }) {
      let createdOrganization;
      try {
        createdOrganization = await Organization.create({
          description: organization.description,
          industry: organization.industry,
          logoFile: organization.logoFile,
          name: organization.name,
          organizationId: organization.id,
          owner: organization.ownerUserId,
          revision: 1,
          slug: organization.slug,
          verificationStatus: organization.verificationStatus,
        });
        const createdMembership = await OrganizationMembership.create({
          invitedBy: membership.invitedByUserId,
          joinedAt: membership.joinedAt,
          membershipId: membership.id,
          organization: createdOrganization._id,
          role: membership.role,
          status: membership.status,
          user: membership.userId,
        });
        return {
          membership: membershipRecord(
            createdMembership.toObject(),
            createdOrganization.organizationId,
          ),
          organization: organizationRecord(createdOrganization.toObject()),
        };
      } catch (error) {
        if (createdOrganization?._id) {
          await OrganizationMembership.deleteMany({ organization: createdOrganization._id });
          await Organization.deleteOne({ _id: createdOrganization._id });
        }
        if (error?.code === 11000 && error?.keyPattern?.slug) error.code = 'duplicate_slug';
        throw error;
      }
    },

    async createInvitation(invitation) {
      const organization = await organizationDocument(invitation.organizationId);
      if (!organization) return null;
      let created;
      try {
        created = await OrganizationInvitation.create({
          acceptedAt: invitation.acceptedAt,
          acceptedBy: invitation.acceptedByUserId,
          activeKey: invitation.activeKey,
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          invitationId: invitation.id,
          invitedBy: invitation.invitedByUserId,
          organization: organization._id,
          revokedAt: invitation.revokedAt,
          role: invitation.role,
          tokenHash: invitation.tokenHash,
        });
      } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.activeKey) {
          error.code = 'duplicate_active_invitation';
        }
        throw error;
      }
      const withSecrets = await OrganizationInvitation.findById(created._id)
        .select('+activeKey +tokenHash')
        .lean();
      return invitationRecord(withSecrets, organization.organizationId);
    },

    async createVerificationReview({ organizationId, review, submittedAt }) {
      const organization = await organizationDocument(organizationId);
      if (!organization) return null;
      let created;
      try {
        created = await ProviderVerificationReview.create({
          activeKey: organizationId,
          decisionReason: null,
          organization: organization._id,
          reviewId: review.id,
          reviewedAt: null,
          reviewer: null,
          statement: review.statement,
          status: 'pending_review',
          submittedAt,
          submittedBy: review.submittedByUserId,
        });
        const updatedOrganization = await Organization.findOneAndUpdate(
          {
            _id: organization._id,
            verificationStatus: { $in: ['draft', 'rejected'] },
          },
          { $inc: { revision: 1 }, $set: { verificationStatus: 'pending_review' } },
          { new: true, runValidators: true },
        ).lean();
        if (!updatedOrganization) {
          await ProviderVerificationReview.deleteOne({ _id: created._id });
          return null;
        }
        const withSecrets = await ProviderVerificationReview.findById(created._id)
          .select('+activeKey')
          .lean();
        return {
          organization: organizationRecord(updatedOrganization),
          review: reviewRecord(withSecrets, organizationId),
        };
      } catch (error) {
        if (created?._id) await ProviderVerificationReview.deleteOne({ _id: created._id });
        if (error?.code === 11000 && error?.keyPattern?.activeKey) {
          error.code = 'verification_already_pending';
        }
        throw error;
      }
    },

    async decideVerificationReview({
      decidedAt,
      decisionReason,
      reviewId,
      reviewerUserId,
      status,
    }) {
      const existing = await ProviderVerificationReview.findOne({ reviewId }).lean();
      if (!existing) return null;
      const organization = await Organization.findById(existing.organization).lean();
      if (!organization) return null;
      const decided = await ProviderVerificationReview.findOneAndUpdate(
        { reviewId, status: 'pending_review' },
        {
          $set: {
            activeKey: null,
            decisionReason,
            reviewedAt: decidedAt,
            reviewer: reviewerUserId,
            status,
          },
        },
        { new: true, runValidators: true },
      )
        .select('+activeKey')
        .lean();
      if (!decided) return null;
      try {
        const updatedOrganization = await Organization.findByIdAndUpdate(
          organization._id,
          { $inc: { revision: 1 }, $set: { verificationStatus: status } },
          { new: true, runValidators: true },
        ).lean();
        if (!updatedOrganization) throw new Error('organization_not_found');
        return {
          organization: organizationRecord(updatedOrganization),
          review: reviewRecord(decided, organization.organizationId),
        };
      } catch (error) {
        await ProviderVerificationReview.updateOne(
          { _id: decided._id, status },
          {
            $set: {
              activeKey: organization.organizationId,
              decisionReason: null,
              reviewedAt: null,
              reviewer: null,
              status: 'pending_review',
            },
          },
        );
        throw error;
      }
    },

    async consumeInvitation({ acceptedAt, email, invitationId, tokenHash, userId }) {
      const accepted = await OrganizationInvitation.findOneAndUpdate(
        {
          acceptedAt: null,
          email,
          expiresAt: { $gt: acceptedAt },
          invitationId,
          revokedAt: null,
          tokenHash,
        },
        { $set: { acceptedAt, acceptedBy: userId, activeKey: null } },
        { new: true, runValidators: true },
      )
        .select('+activeKey +tokenHash')
        .lean();
      if (!accepted) return null;
      const organization = await Organization.findById(accepted.organization).lean();
      if (!organization) return null;
      try {
        const membership = await OrganizationMembership.findOneAndUpdate(
          { organization: organization._id, user: userId },
          {
            $set: {
              invitedBy: accepted.invitedBy,
              joinedAt: acceptedAt,
              role: accepted.role,
              status: 'active',
            },
            $setOnInsert: { membershipId: require('node:crypto').randomUUID() },
          },
          { new: true, runValidators: true, setDefaultsOnInsert: true, upsert: true },
        ).lean();
        return {
          invitation: invitationRecord(accepted, organization.organizationId),
          membership: membershipRecord(membership, organization.organizationId),
        };
      } catch (error) {
        await OrganizationInvitation.updateOne(
          { _id: accepted._id, acceptedBy: userId },
          {
            $set: {
              acceptedAt: null,
              acceptedBy: null,
              activeKey: `${organization.organizationId}:${accepted.email}:${accepted.role}`,
            },
          },
        );
        throw error;
      }
    },

    async countActiveOwners(organizationId) {
      const organization = await organizationDocument(organizationId);
      if (!organization) return 0;
      return OrganizationMembership.countDocuments({
        organization: organization._id,
        role: 'owner',
        status: 'active',
      });
    },

    async findInvitation(invitationId) {
      const invitation = await OrganizationInvitation.findOne({ invitationId })
        .select('+activeKey +tokenHash')
        .lean();
      if (!invitation) return null;
      const organization = await Organization.findById(invitation.organization).lean();
      return organization ? invitationRecord(invitation, organization.organizationId) : null;
    },

    async findMembership(organizationId, userId) {
      const organization = await organizationDocument(organizationId);
      if (!organization) return null;
      return membershipRecord(
        await OrganizationMembership.findOne({
          organization: organization._id,
          user: userId,
        }).lean(),
        organizationId,
      );
    },

    async findOrganizationById(organizationId) {
      return organizationRecord(await organizationDocument(organizationId));
    },

    async findOrganizationBySlug(slug) {
      return organizationRecord(await Organization.findOne({ slug }).lean());
    },

    async findVerificationReview(reviewId) {
      const review = await ProviderVerificationReview.findOne({ reviewId })
        .select('+activeKey')
        .lean();
      if (!review) return null;
      const organization = await Organization.findById(review.organization).lean();
      return organization ? reviewRecord(review, organization.organizationId) : null;
    },

    async listMemberships(organizationId) {
      const organization = await organizationDocument(organizationId);
      if (!organization) return [];
      const documents = await OrganizationMembership.find({ organization: organization._id })
        .sort({ joinedAt: 1 })
        .lean();
      return documents.map((document) => membershipRecord(document, organizationId));
    },

    async listMembershipsForUser(userId) {
      const documents = await OrganizationMembership.find({ user: userId })
        .sort({ joinedAt: 1 })
        .lean();
      const memberships = await Promise.all(
        documents.map(async (document) => {
          const organization = await Organization.findById(document.organization).lean();
          return organization ? membershipRecord(document, organization.organizationId) : null;
        }),
      );
      return memberships.filter(Boolean);
    },

    async listVerificationReviews(status = 'pending_review') {
      const query = status ? { status } : {};
      const documents = await ProviderVerificationReview.find(query)
        .sort({ submittedAt: 1 })
        .select('+activeKey')
        .lean();
      return Promise.all(
        documents.map(async (document) => {
          const organization = await Organization.findById(document.organization).lean();
          return reviewRecord(document, organization?.organizationId || 'deleted');
        }),
      );
    },

    async revokeActiveInvitations(organizationId, email, role, revokedAt) {
      const organization = await organizationDocument(organizationId);
      if (!organization) return 0;
      const result = await OrganizationInvitation.updateMany(
        {
          acceptedAt: null,
          email,
          organization: organization._id,
          revokedAt: null,
          role,
        },
        { $set: { activeKey: null, revokedAt } },
      );
      return result.modifiedCount;
    },

    async updateMembership(organizationId, userId, updates) {
      const organization = await organizationDocument(organizationId);
      if (!organization) return null;
      return membershipRecord(
        await OrganizationMembership.findOneAndUpdate(
          { organization: organization._id, user: userId },
          { $set: updates },
          { new: true, runValidators: true },
        ).lean(),
        organizationId,
      );
    },

    async updateOrganization(organizationId, expectedRevision, updates) {
      const organization = await Organization.findOneAndUpdate(
        { organizationId, revision: expectedRevision },
        { $inc: { revision: 1 }, $set: updates },
        { new: true, runValidators: true },
      ).lean();
      if (organization)
        return { outcome: 'updated', organization: organizationRecord(organization) };
      const current = await organizationDocument(organizationId);
      return current
        ? { outcome: 'conflict', organization: organizationRecord(current) }
        : { outcome: 'not_found', organization: null };
    },
  });
}

module.exports = {
  createMongooseOrganizationRepository,
  invitationRecord,
  membershipRecord,
  organizationRecord,
  reviewRecord,
};
