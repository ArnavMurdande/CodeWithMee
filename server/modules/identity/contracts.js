'use strict';

function freezeValues(values) {
  return Object.freeze({ ...values });
}

const USER_STATUS = freezeValues({
  ACTIVE: 'active',
  BANNED: 'banned',
  DELETION_PENDING: 'deletion_pending',
  SUSPENDED: 'suspended',
});

const PLATFORM_ROLE = freezeValues({
  LEARNER: 'learner',
  MODERATOR: 'moderator',
  SUPERADMIN: 'superadmin',
  SUPPORT: 'support',
});

const AUTH_IDENTITY_PROVIDER = freezeValues({
  GOOGLE: 'google',
  LOCAL: 'local',
});

const SESSION_CLIENT = freezeValues({
  EXTENSION: 'extension',
  WEB: 'web',
});

const SESSION_STATUS = freezeValues({
  ACTIVE: 'active',
  COMPROMISED: 'compromised',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
});

const ACCESS_TOKEN_CLAIMS = Object.freeze(['aud', 'exp', 'iat', 'iss', 'sid', 'sub']);

function hasEnumValue(contract, candidate) {
  return Object.values(contract).includes(candidate);
}

function isActivePrincipal(principal) {
  return Boolean(
    principal &&
    typeof principal.userId === 'string' &&
    principal.userId.length > 0 &&
    typeof principal.sessionId === 'string' &&
    principal.sessionId.length > 0 &&
    principal.status === USER_STATUS.ACTIVE &&
    hasEnumValue(PLATFORM_ROLE, principal.platformRole),
  );
}

module.exports = {
  ACCESS_TOKEN_CLAIMS,
  AUTH_IDENTITY_PROVIDER,
  PLATFORM_ROLE,
  SESSION_CLIENT,
  SESSION_STATUS,
  USER_STATUS,
  hasEnumValue,
  isActivePrincipal,
};
