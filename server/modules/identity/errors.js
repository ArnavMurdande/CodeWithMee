'use strict';

class IdentityError extends Error {
  constructor(code, status = 400, options = {}) {
    super(code, options);
    this.name = 'IdentityError';
    this.code = code;
    this.status = status;
  }
}

function isIdentityError(error) {
  return error instanceof IdentityError;
}

module.exports = { IdentityError, isIdentityError };
