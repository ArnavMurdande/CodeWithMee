'use strict';

class OrganizationError extends Error {
  constructor(code, status = 400, options = {}) {
    super(code, options);
    this.name = 'OrganizationError';
    this.code = code;
    this.status = status;
  }
}

function isOrganizationError(error) {
  return error instanceof OrganizationError;
}

module.exports = { OrganizationError, isOrganizationError };
