'use strict';

const mongoose = require('mongoose');

const OrganizationMembershipSchema = new mongoose.Schema(
  {
    invitedBy: { default: null, ref: 'User', type: mongoose.Schema.Types.ObjectId },
    joinedAt: { default: Date.now, required: true, type: Date },
    membershipId: { index: true, required: true, type: String, unique: true },
    organization: {
      index: true,
      ref: 'Organization',
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    role: {
      enum: ['owner', 'admin', 'instructor', 'grader', 'analyst'],
      required: true,
      type: String,
    },
    status: { default: 'active', enum: ['active', 'suspended', 'revoked'], type: String },
    user: { index: true, ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

OrganizationMembershipSchema.index({ organization: 1, user: 1 }, { unique: true });
OrganizationMembershipSchema.index({ organization: 1, role: 1, status: 1 });

module.exports = mongoose.model('OrganizationMembership', OrganizationMembershipSchema);
