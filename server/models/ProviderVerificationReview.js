'use strict';

const mongoose = require('mongoose');

const ProviderVerificationReviewSchema = new mongoose.Schema(
  {
    activeKey: { default: null, select: false, sparse: true, type: String, unique: true },
    decisionReason: { default: null, maxlength: 2_000, type: String },
    organization: {
      index: true,
      ref: 'Organization',
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    reviewId: { index: true, required: true, type: String, unique: true },
    reviewedAt: { default: null, type: Date },
    reviewer: { default: null, ref: 'User', type: mongoose.Schema.Types.ObjectId },
    statement: { maxlength: 2_000, required: true, type: String },
    status: {
      default: 'pending_review',
      enum: ['pending_review', 'approved', 'rejected'],
      type: String,
    },
    submittedAt: { default: Date.now, required: true, type: Date },
    submittedBy: { ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ProviderVerificationReviewSchema.index({ status: 1, submittedAt: 1 });

module.exports = mongoose.model('ProviderVerificationReview', ProviderVerificationReviewSchema);
