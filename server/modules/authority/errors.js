'use strict';

class AuthorityError extends Error {
  constructor(code, status = 400, options = {}) {
    super(code, options);
    this.name = 'AuthorityError';
    this.code = code;
    this.status = status;
  }
}

function isAuthorityError(error) {
  return error instanceof AuthorityError;
}

module.exports = { AuthorityError, isAuthorityError };
