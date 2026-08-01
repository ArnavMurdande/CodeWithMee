'use strict';

const mongoose = require('mongoose');

const OrganizationInvitationSchema = new mongoose.Schema(
  {
    acceptedAt: { default: null, type: Date },
    acceptedBy: { default: null, ref: 'User', type: mongoose.Schema.Types.ObjectId },
    activeKey: { default: null, select: false, sparse: true, type: String, unique: true },
    email: { index: true, lowercase: true, required: true, trim: true, type: String },
    expiresAt: { index: true, required: true, type: Date },
    invitationId: { index: true, required: true, type: String, unique: true },
    invitedBy: { ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
    organization: {
      index: true,
      ref: 'Organization',
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    revokedAt: { default: null, type: Date },
    role: { enum: ['admin', 'instructor', 'grader', 'analyst'], required: true, type: String },
    tokenHash: { required: true, select: false, type: String },
  },
  { timestamps: true },
);

OrganizationInvitationSchema.index({ organization: 1, email: 1, expiresAt: 1 });

module.exports = mongoose.model('OrganizationInvitation', OrganizationInvitationSchema);
