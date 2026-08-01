'use strict';

const mongoose = require('mongoose');

const AuthSessionSchema = new mongoose.Schema(
  {
    authenticatedAt: { required: true, type: Date },
    client: { enum: ['web', 'extension'], required: true, type: String },
    compromisedAt: { default: null, type: Date },
    consumedTokenHashes: { default: [], select: false, type: [String] },
    csrfTokenHash: { required: true, select: false, type: String },
    currentTokenHash: { required: true, select: false, type: String },
    expiresAt: { index: true, required: true, type: Date },
    idleExpiresAt: { index: true, required: true, type: Date },
    ipHash: { default: null, select: false, type: String },
    lastUsedAt: { required: true, type: Date },
    revokedAt: { default: null, index: true, type: Date },
    sessionId: { index: true, required: true, type: String, unique: true },
    user: { index: true, ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
    userAgent: { default: null, maxlength: 300, type: String },
  },
  { timestamps: true },
);

AuthSessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model('AuthSession', AuthSessionSchema);
