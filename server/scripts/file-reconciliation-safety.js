'use strict';

const { databaseIdentity } = require('./database-safety');

function assertFileReconciliationSafety(environment, storageConfig) {
  if (environment.FILE_RECONCILIATION_MODE !== 'read_only') {
    throw new Error('FILE_RECONCILIATION_MODE must be read_only.');
  }
  if (!environment.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
  const identity = databaseIdentity(environment.DATABASE_URL);
  const scope = environment.FILE_RECONCILIATION_SCOPE;
  if (!['disposable', 'staging', 'production'].includes(scope)) {
    throw new Error('FILE_RECONCILIATION_SCOPE must be disposable, staging, or production.');
  }
  if (scope === 'disposable') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(identity.host)) {
      throw new Error('Disposable reconciliation is restricted to a loopback host.');
    }
    if (!/(?:^|_)(?:ci|test|dev)$/i.test(identity.database)) {
      throw new Error('Disposable reconciliation database must end in _ci, _test, or _dev.');
    }
  } else if (identity.username.toLowerCase() === 'postgres') {
    throw new Error('Staging and production reconciliation cannot use postgres superuser.');
  }
  const expected = `reconcile:${identity.database}:${storageConfig.bucket}:${storageConfig.prefix}`;
  if (environment.FILE_RECONCILIATION_APPROVAL?.trim() !== expected) {
    throw new Error(`FILE_RECONCILIATION_APPROVAL must exactly equal ${expected}.`);
  }
  return Object.freeze({ ...identity, scope });
}

module.exports = { assertFileReconciliationSafety };
