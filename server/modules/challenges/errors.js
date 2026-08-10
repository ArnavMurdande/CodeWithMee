'use strict';

class ChallengeError extends Error {
  constructor(code, status = 400, options = {}) {
    super(code, options);
    this.name = 'ChallengeError';
    this.code = code;
    this.status = status;
  }
}

function isChallengeError(error) {
  return error instanceof ChallengeError;
}

module.exports = { ChallengeError, isChallengeError };
