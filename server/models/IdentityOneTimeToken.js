'use strict';

const mongoose = require('mongoose');

const IdentityOneTimeTokenSchema = new mongoose.Schema(
  {
    consumedAt: { default: null, index: true, type: Date },
    expiresAt: { index: true, required: true, type: Date },
    purpose: { enum: ['email_verification', 'password_reset'], required: true, type: String },
    tokenHash: { required: true, select: false, type: String },
    tokenId: { index: true, required: true, type: String, unique: true },
    user: { index: true, ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

IdentityOneTimeTokenSchema.index({ user: 1, purpose: 1, consumedAt: 1 });

module.exports = mongoose.model('IdentityOneTimeToken', IdentityOneTimeTokenSchema);
