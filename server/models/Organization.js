'use strict';

const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema(
  {
    description: { default: '', maxlength: 2_000, type: String },
    industry: { default: '', maxlength: 100, type: String },
    logoFile: { default: null, type: mongoose.Schema.Types.ObjectId },
    name: { maxlength: 120, required: true, trim: true, type: String },
    organizationId: { index: true, required: true, type: String, unique: true },
    owner: { index: true, ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
    revision: { default: 1, min: 1, required: true, type: Number },
    slug: { index: true, lowercase: true, required: true, trim: true, type: String, unique: true },
    verificationStatus: {
      default: 'draft',
      enum: ['draft', 'pending_review', 'approved', 'rejected', 'suspended'],
      index: true,
      type: String,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Organization', OrganizationSchema);
