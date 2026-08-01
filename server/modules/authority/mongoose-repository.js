'use strict';

const mongoose = require('mongoose');

const AuthSession = require('../../models/AuthSession');
const AuthorityAuditEvent = require('../../models/AuthorityAuditEvent');
const AuthorityControl = require('../../models/AuthorityControl');
const Organization = require('../../models/Organization');
const OrganizationMembership = require('../../models/OrganizationMembership');
const User = require('../../models/User');
const { userRecord } = require('../identity/mongoose-repository');
const { membershipRecord, organizationRecord } = require('../organizations/mongoose-repository');
const { SUPERADMIN_BOOTSTRAP_OPERATION } = require('./memory-repository');

const PLATFORM_AUTHORITY_CONTROL = 'platform-authority-v1';

function identifier(value) {
  return value == null ? null : value.toString();
}

function auditEventRecord(document) {
  if (!document) return null;
  return {
    action: document.action,
    actorSessionId: document.actorSessionId || null,
    actorUserId: document.actorUserId || null,
    afterState: { ...(document.afterState || {}) },
    beforeState: { ...(document.beforeState || {}) },
    id: document.eventId,
    occurredAt: document.occurredAt,
    operatorReference: document.operatorReference || null,
    organizationId: document.organizationId || null,
    reason: document.reason,
    requestId: document.requestId || null,
    source: document.source,
    targetUserId: document.targetUserId,
  };
}

function abortOutcome(outcome) {
  const error = new Error(outcome);
  error.authorityOutcome = outcome;
  throw error;
}

function transactionUnavailable(error) {
  return /replica set|mongos|transaction numbers|does not support transactions/i.test(
    String(error?.message || ''),
  );
}

async function withAuthorityTransaction(operation) {
  if (mongoose.connection.readyState !== 1) {
    const error = new Error('authority_transaction_unavailable');
    error.code = 'authority_transaction_unavailable';
    throw error;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await mongoose.connection.transaction(operation, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
    } catch (error) {
      if (error.authorityOutcome) return { outcome: error.authorityOutcome };
      if (error?.code === 11000 && error?.keyPattern?.operationKey) {
        error.code = 'duplicate_authority_operation';
        throw error;
      }
      if (error?.code === 11000 && error?.keyPattern?.controlKey && attempt < 2) continue;
      if (transactionUnavailable(error)) error.code = 'authority_transaction_unavailable';
      throw error;
    }
  }
  throw new Error('authority_transaction_retry_exhausted');
}

async function lockPlatformAuthority(session) {
  await AuthorityControl.findOneAndUpdate(
    { controlKey: PLATFORM_AUTHORITY_CONTROL },
    { $inc: { revision: 1 }, $setOnInsert: { controlKey: PLATFORM_AUTHORITY_CONTROL } },
    { new: true, session, setDefaultsOnInsert: true, upsert: true },
  );
}

function revisionFilter(expectedRevision) {
  return expectedRevision === 1
    ? { $or: [{ authorityRevision: 1 }, { authorityRevision: { $exists: false } }] }
    : { authorityRevision: expectedRevision };
}

function activeSuperadminQuery() {
  return {
    $and: [
      {
        $or: [
          { platformRole: 'superadmin' },
          { platformRole: { $exists: false }, role: 'superadmin' },
        ],
      },
      {
        $or: [{ status: 'active' }, { isBanned: { $ne: true }, status: { $exists: false } }],
      },
    ],
  };
}

function currentSuperadminQuery(userId) {
  return { _id: userId, ...activeSuperadminQuery() };
}

function authorityState(user) {
  const record = userRecord(user);
  return {
    authorityRevision: record.authorityRevision,
    platformRole: record.platformRole,
    status: record.status,
  };
}

async function appendAuditEvent(event, details, session, operationKey = null) {
  const [created] = await AuthorityAuditEvent.create(
    [
      {
        action: event.action,
        actorSessionId: event.actorSessionId,
        actorUserId: event.actorUserId,
        afterState: details.afterState,
        beforeState: details.beforeState,
        eventId: event.id,
        occurredAt: event.occurredAt,
        operationKey,
        operatorReference: event.operatorReference,
        organizationId: details.organizationId,
        reason: event.reason,
        requestId: event.requestId,
        source: event.source,
        targetUserId: details.targetUserId,
      },
    ],
    { session },
  );
  return auditEventRecord(created.toObject());
}

function createMongooseAuthorityRepository() {
  return Object.freeze({
    async bootstrapSuperadmin({ email, event }) {
      return withAuthorityTransaction(async (session) => {
        await lockPlatformAuthority(session);
        const consumed = await AuthorityAuditEvent.findOne({
          operationKey: SUPERADMIN_BOOTSTRAP_OPERATION,
        })
          .select('+operationKey')
          .session(session)
          .lean();
        if (consumed) return { outcome: 'bootstrap_consumed' };
        if ((await User.countDocuments(activeSuperadminQuery()).session(session)) > 0) {
          return { outcome: 'already_configured' };
        }
        const target = await User.findOne({ email }).session(session).lean();
        if (!target) return { outcome: 'user_not_found' };
        const current = userRecord(target);
        if (current.status !== 'active' || !current.emailVerifiedAt) {
          return { outcome: 'target_ineligible' };
        }
        const beforeState = authorityState(target);
        const updates = {
          authorityRevision: current.authorityRevision + 1,
          platformRole: 'superadmin',
          role: 'superadmin',
          updatedAt: event.occurredAt,
        };
        const user = await User.findOneAndUpdate(
          { _id: target._id, ...revisionFilter(current.authorityRevision) },
          { $set: updates },
          { new: true, runValidators: true, session },
        ).lean();
        if (!user) abortOutcome('revision_conflict');
        const auditEvent = await appendAuditEvent(
          event,
          {
            afterState: authorityState(user),
            beforeState,
            organizationId: null,
            targetUserId: identifier(user._id),
          },
          session,
          SUPERADMIN_BOOTSTRAP_OPERATION,
        );
        return { auditEvent, outcome: 'updated', user: userRecord(user) };
      });
    },

    async changeAccountStatus({ actorUserId, event, expectedRevision, status, targetUserId }) {
      return withAuthorityTransaction(async (session) => {
        await lockPlatformAuthority(session);
        if (!mongoose.isValidObjectId(actorUserId)) return { outcome: 'actor_not_authorized' };
        if (!(await User.exists(currentSuperadminQuery(actorUserId)).session(session))) {
          return { outcome: 'actor_not_authorized' };
        }
        if (!mongoose.isValidObjectId(targetUserId)) return { outcome: 'user_not_found' };
        const target = await User.findById(targetUserId).session(session).lean();
        if (!target) return { outcome: 'user_not_found' };
        if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
        const current = userRecord(target);
        if (current.authorityRevision !== expectedRevision) return { outcome: 'revision_conflict' };
        if (current.status === status) return { outcome: 'no_change' };
        if (
          current.platformRole === 'superadmin' &&
          current.status === 'active' &&
          status !== 'active' &&
          (await User.countDocuments(activeSuperadminQuery()).session(session)) <= 1
        ) {
          return { outcome: 'last_superadmin' };
        }
        const beforeState = authorityState(target);
        const user = await User.findOneAndUpdate(
          { _id: target._id, ...revisionFilter(expectedRevision) },
          {
            $set: {
              authorityRevision: expectedRevision + 1,
              isBanned: status === 'banned',
              status,
              updatedAt: event.occurredAt,
            },
          },
          { new: true, runValidators: true, session },
        ).lean();
        if (!user) abortOutcome('revision_conflict');
        const revoked =
          status === 'active'
            ? { modifiedCount: 0 }
            : await AuthSession.updateMany(
                { revokedAt: null, user: target._id },
                { $set: { revokedAt: event.occurredAt } },
                { session },
              );
        const auditEvent = await appendAuditEvent(
          event,
          {
            afterState: authorityState(user),
            beforeState,
            organizationId: null,
            targetUserId,
          },
          session,
        );
        return {
          auditEvent,
          outcome: 'updated',
          revokedSessionCount: revoked.modifiedCount,
          user: userRecord(user),
        };
      });
    },

    async changePlatformRole({ actorUserId, event, expectedRevision, platformRole, targetUserId }) {
      return withAuthorityTransaction(async (session) => {
        await lockPlatformAuthority(session);
        if (!mongoose.isValidObjectId(actorUserId)) return { outcome: 'actor_not_authorized' };
        if (!(await User.exists(currentSuperadminQuery(actorUserId)).session(session))) {
          return { outcome: 'actor_not_authorized' };
        }
        if (!mongoose.isValidObjectId(targetUserId)) return { outcome: 'user_not_found' };
        const target = await User.findById(targetUserId).session(session).lean();
        if (!target) return { outcome: 'user_not_found' };
        if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
        const current = userRecord(target);
        if (current.authorityRevision !== expectedRevision) return { outcome: 'revision_conflict' };
        if (current.platformRole === platformRole) return { outcome: 'no_change' };
        if (
          current.platformRole === 'superadmin' &&
          platformRole !== 'superadmin' &&
          current.status === 'active' &&
          (await User.countDocuments(activeSuperadminQuery()).session(session)) <= 1
        ) {
          return { outcome: 'last_superadmin' };
        }
        if (
          platformRole === 'superadmin' &&
          (current.status !== 'active' || !current.emailVerifiedAt)
        ) {
          return { outcome: 'target_ineligible' };
        }
        const beforeState = authorityState(target);
        const set = {
          authorityRevision: expectedRevision + 1,
          platformRole,
          updatedAt: event.occurredAt,
        };
        if (['learner', 'moderator', 'superadmin'].includes(platformRole)) set.role = platformRole;
        const user = await User.findOneAndUpdate(
          { _id: target._id, ...revisionFilter(expectedRevision) },
          { $set: set },
          { new: true, runValidators: true, session },
        ).lean();
        if (!user) abortOutcome('revision_conflict');
        const revoked = await AuthSession.updateMany(
          { revokedAt: null, user: target._id },
          { $set: { revokedAt: event.occurredAt } },
          { session },
        );
        const auditEvent = await appendAuditEvent(
          event,
          {
            afterState: authorityState(user),
            beforeState,
            organizationId: null,
            targetUserId,
          },
          session,
        );
        return {
          auditEvent,
          outcome: 'updated',
          revokedSessionCount: revoked.modifiedCount,
          user: userRecord(user),
        };
      });
    },

    async findOrganizationContext(organizationId, actorUserId) {
      const organization = await Organization.findOne({ organizationId }).lean();
      if (!organization) return { membership: null, organization: null };
      if (!mongoose.isValidObjectId(actorUserId)) {
        return { membership: null, organization: organizationRecord(organization) };
      }
      const membership = await OrganizationMembership.findOne({
        organization: organization._id,
        user: actorUserId,
      }).lean();
      return {
        membership: membershipRecord(membership, organizationId),
        organization: organizationRecord(organization),
      };
    },

    async listAuditEvents({ before = null, limit = 50 } = {}) {
      const query = before ? { occurredAt: { $lt: before } } : {};
      const documents = await AuthorityAuditEvent.find(query)
        .sort({ occurredAt: -1, eventId: -1 })
        .limit(limit)
        .lean();
      return documents.map(auditEventRecord);
    },

    async listUsers({ limit = 50 } = {}) {
      const documents = await User.find()
        .select(
          'authorityRevision createdAt displayName email emailVerifiedAt platformRole profilePictureUrl status username',
        )
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean();
      return documents.map(userRecord);
    },

    async transferOrganizationOwnership({
      actorUserId,
      event,
      expectedRevision,
      organizationId,
      targetUserId,
    }) {
      return withAuthorityTransaction(async (session) => {
        const organization = await Organization.findOne({ organizationId }).session(session).lean();
        if (!organization) return { outcome: 'organization_not_found' };
        if (organization.revision !== expectedRevision) return { outcome: 'revision_conflict' };
        if (actorUserId === targetUserId) return { outcome: 'self_change_denied' };
        if (!mongoose.isValidObjectId(actorUserId)) return { outcome: 'actor_not_owner' };
        if (!mongoose.isValidObjectId(targetUserId)) return { outcome: 'target_ineligible' };
        const [actor, target, actorMembership, targetMembership, activeOwnerCount] =
          await Promise.all([
            User.findById(actorUserId).session(session).lean(),
            User.findById(targetUserId).session(session).lean(),
            OrganizationMembership.findOne({
              organization: organization._id,
              user: actorUserId,
            })
              .session(session)
              .lean(),
            OrganizationMembership.findOne({
              organization: organization._id,
              user: targetUserId,
            })
              .session(session)
              .lean(),
            OrganizationMembership.countDocuments({
              organization: organization._id,
              role: 'owner',
              status: 'active',
            }).session(session),
          ]);
        const currentActor = userRecord(actor);
        const currentTarget = userRecord(target);
        if (
          !currentActor ||
          currentActor.status !== 'active' ||
          identifier(organization.owner) !== actorUserId ||
          actorMembership?.role !== 'owner' ||
          actorMembership.status !== 'active'
        ) {
          return { outcome: 'actor_not_owner' };
        }
        if (activeOwnerCount !== 1) return { outcome: 'ownership_invariant_violation' };
        if (
          !currentTarget ||
          currentTarget.status !== 'active' ||
          !currentTarget.emailVerifiedAt ||
          !targetMembership ||
          targetMembership.status !== 'active'
        ) {
          return { outcome: 'target_ineligible' };
        }
        if (targetMembership.role === 'owner') return { outcome: 'no_change' };

        const updatedOrganization = await Organization.findOneAndUpdate(
          {
            _id: organization._id,
            owner: actorUserId,
            revision: expectedRevision,
          },
          {
            $set: {
              owner: targetUserId,
              revision: expectedRevision + 1,
              updatedAt: event.occurredAt,
            },
          },
          { new: true, runValidators: true, session },
        ).lean();
        if (!updatedOrganization) abortOutcome('revision_conflict');
        const actorUpdate = await OrganizationMembership.findOneAndUpdate(
          { _id: actorMembership._id, role: 'owner', status: 'active' },
          { $set: { role: 'admin', updatedAt: event.occurredAt } },
          { new: true, runValidators: true, session },
        ).lean();
        if (!actorUpdate) abortOutcome('ownership_invariant_violation');
        const targetUpdate = await OrganizationMembership.findOneAndUpdate(
          { _id: targetMembership._id, status: 'active' },
          { $set: { role: 'owner', updatedAt: event.occurredAt } },
          { new: true, runValidators: true, session },
        ).lean();
        if (!targetUpdate) abortOutcome('target_ineligible');
        const auditEvent = await appendAuditEvent(
          event,
          {
            afterState: {
              organizationRole: 'owner',
              ownerUserId: targetUserId,
              revision: updatedOrganization.revision,
            },
            beforeState: {
              organizationRole: 'owner',
              ownerUserId: actorUserId,
              revision: organization.revision,
            },
            organizationId,
            targetUserId,
          },
          session,
        );
        return {
          actorMembership: membershipRecord(actorUpdate, organizationId),
          auditEvent,
          organization: organizationRecord(updatedOrganization),
          outcome: 'updated',
          targetMembership: membershipRecord(targetUpdate, organizationId),
        };
      });
    },
  });
}

module.exports = {
  PLATFORM_AUTHORITY_CONTROL,
  auditEventRecord,
  createMongooseAuthorityRepository,
};
