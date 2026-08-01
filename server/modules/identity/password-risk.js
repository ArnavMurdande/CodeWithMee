'use strict';

const { createHash } = require('node:crypto');

const { IdentityError } = require('./errors');

const PASSWORD_COMPROMISE_MODE = Object.freeze({
  BEST_EFFORT: 'best_effort',
  LOCAL: 'local',
  REQUIRED: 'required',
});

const LOCAL_DENYLIST = new Set([
  '123456789012',
  'codewithmee',
  'letmein123456',
  'password1234',
  'qwerty123456',
]);

function isLocallyCompromised(password) {
  return LOCAL_DENYLIST.has(String(password).toLowerCase());
}

function parseRangeResponse(body, suffix) {
  for (const line of body.split(/\r?\n/)) {
    const [candidate, rawCount] = line.trim().split(':');
    if (candidate === suffix && Number(rawCount) > 0) return true;
  }
  return false;
}

function createPasswordRiskChecker({
  endpoint = 'https://api.pwnedpasswords.com/range',
  fetchImpl = fetch,
  mode = PASSWORD_COMPROMISE_MODE.LOCAL,
  timeoutMs = 5_000,
} = {}) {
  if (!Object.values(PASSWORD_COMPROMISE_MODE).includes(mode)) {
    throw new Error('PASSWORD_COMPROMISE_CHECK_MODE must be local, best_effort, or required.');
  }

  return Object.freeze({
    async assertAllowed(password) {
      if (isLocallyCompromised(password)) {
        throw new IdentityError('password_compromised', 400);
      }
      if (mode === PASSWORD_COMPROMISE_MODE.LOCAL) return;

      const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
      const prefix = digest.slice(0, 5);
      const suffix = digest.slice(5);
      try {
        const response = await fetchImpl(`${endpoint}/${prefix}`, {
          headers: {
            'add-padding': 'true',
            'user-agent': 'CodeWithMee-Password-Screening',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error(`Unexpected password range status ${response.status}.`);
        const body = await response.text();
        if (body.length > 256_000) throw new Error('Password range response exceeded limit.');
        if (parseRangeResponse(body, suffix)) {
          throw new IdentityError('password_compromised', 400);
        }
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        if (mode === PASSWORD_COMPROMISE_MODE.REQUIRED) {
          throw new IdentityError('password_screening_unavailable', 503, { cause: error });
        }
      }
    },
  });
}

module.exports = {
  PASSWORD_COMPROMISE_MODE,
  createPasswordRiskChecker,
  isLocallyCompromised,
  parseRangeResponse,
};
