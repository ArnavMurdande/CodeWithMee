'use strict';

const mongoose = require('mongoose');

const { AUTHORITY_AUDIT_ACTIONS, AUTHORITY_SOURCES } = require('../modules/authority/contracts');

const AuthorityStateSchema = new mongoose.Schema(
  {
    authorityRevision: { min: 1, type: Number },
    organizationRole: { enum: ['owner', 'admin', 'instructor', 'grader', 'analyst'], type: String },
    ownerUserId: { maxlength: 100, type: String },
    platformRole: { enum: ['learner', 'moderator', 'superadmin', 'support'], type: String },
    status: { enum: ['active', 'suspended', 'banned', 'deletion_pending'], type: String },
  },
  { _id: false, minimize: false, strict: 'throw' },
);

const AuthorityAuditEventSchema = new mongoose.Schema(
  {
    action: {
      enum: AUTHORITY_AUDIT_ACTIONS,
      immutable: true,
      index: true,
      required: true,
      type: String,
    },
    actorSessionId: { default: null, immutable: true, maxlength: 100, type: String },
    actorUserId: { default: null, immutable: true, index: true, maxlength: 100, type: String },
    afterState: { immutable: true, required: true, type: AuthorityStateSchema },
    beforeState: { immutable: true, required: true, type: AuthorityStateSchema },
    eventId: { immutable: true, index: true, required: true, type: String, unique: true },
    occurredAt: { immutable: true, index: true, required: true, type: Date },
    operationKey: {
      default: null,
      immutable: true,
      select: false,
      sparse: true,
      type: String,
      unique: true,
    },
    operatorReference: { default: null, immutable: true, maxlength: 120, type: String },
    organizationId: { default: null, immutable: true, index: true, maxlength: 100, type: String },
    reason: { immutable: true, maxlength: 500, minlength: 12, required: true, type: String },
    requestId: { default: null, immutable: true, maxlength: 100, type: String },
    source: { enum: AUTHORITY_SOURCES, immutable: true, required: true, type: String },
    targetUserId: { immutable: true, index: true, maxlength: 100, required: true, type: String },
  },
  { collection: 'authority_audit_events', minimize: false, strict: 'throw', versionKey: false },
);

AuthorityAuditEventSchema.index({ occurredAt: -1, eventId: -1 });
AuthorityAuditEventSchema.index({ organizationId: 1, occurredAt: -1 });

for (const operation of [
  'deleteMany',
  'deleteOne',
  'findOneAndDelete',
  'findOneAndUpdate',
  'updateMany',
  'updateOne',
]) {
  AuthorityAuditEventSchema.pre(operation, function rejectAuditMutation() {
    const error = new Error('authority_audit_events_are_append_only');
    error.code = 'authority_audit_events_are_append_only';
    throw error;
  });
}

module.exports = mongoose.model('AuthorityAuditEvent', AuthorityAuditEventSchema);
