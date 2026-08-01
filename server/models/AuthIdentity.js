'use strict';

const mongoose = require('mongoose');

const AuthIdentitySchema = new mongoose.Schema(
  {
    passwordHash: { type: String, default: null, select: false },
    provider: { enum: ['local', 'google'], required: true, type: String },
    providerSubject: { required: true, trim: true, type: String },
    user: { index: true, ref: 'User', required: true, type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

AuthIdentitySchema.index({ provider: 1, providerSubject: 1 }, { unique: true });
AuthIdentitySchema.index({ provider: 1, user: 1 }, { unique: true });

AuthIdentitySchema.pre('validate', function validateCredentialShape() {
  if (this.provider === 'local' && !this.passwordHash) {
    throw new Error('Local identities require a password hash.');
  }
  if (this.provider === 'google' && this.passwordHash) {
    throw new Error('Google identities must not contain a password hash.');
  }
});

module.exports = mongoose.model('AuthIdentity', AuthIdentitySchema);
