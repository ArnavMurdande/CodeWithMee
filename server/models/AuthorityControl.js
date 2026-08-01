'use strict';

const mongoose = require('mongoose');

const AuthorityControlSchema = new mongoose.Schema(
  {
    controlKey: { immutable: true, index: true, required: true, type: String, unique: true },
    revision: { default: 0, min: 0, required: true, type: Number },
  },
  { collection: 'authority_controls', timestamps: true, versionKey: false },
);

module.exports = mongoose.model('AuthorityControl', AuthorityControlSchema);
