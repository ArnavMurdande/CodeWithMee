'use strict';

const AUTHORITY_ACTION = Object.freeze({
  ACCOUNT_STATUS_CHANGE: 'account_status_change',
  ORGANIZATION_OWNERSHIP_TRANSFER: 'organization_ownership_transfer',
  PLATFORM_ROLE_CHANGE: 'platform_role_change',
  SUPERADMIN_BOOTSTRAP: 'superadmin_bootstrap',
});

const AUTHORITY_SOURCE = Object.freeze({
  API: 'api',
  BOOTSTRAP_CLI: 'bootstrap_cli',
});

const AUTHORITY_AUDIT_ACTIONS = Object.freeze(Object.values(AUTHORITY_ACTION));
const AUTHORITY_SOURCES = Object.freeze(Object.values(AUTHORITY_SOURCE));

module.exports = {
  AUTHORITY_ACTION,
  AUTHORITY_AUDIT_ACTIONS,
  AUTHORITY_SOURCE,
  AUTHORITY_SOURCES,
};
