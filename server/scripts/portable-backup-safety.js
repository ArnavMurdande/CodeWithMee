'use strict';

const { databaseIdentity } = require('./database-safety');

const SAFE_LOCAL_DATABASE = /(?:^|_)(?:ci|test|dev)$/i;

function assertScope(environment, identity, settingName) {
  const scope = environment[settingName];
  if (!['disposable', 'staging', 'production'].includes(scope)) {
    throw new Error(`${settingName} must be disposable, staging, or production.`);
  }
  if (scope === 'disposable') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(identity.host)) {
      throw new Error('Disposable backup operations are restricted to a loopback host.');
    }
    if (!SAFE_LOCAL_DATABASE.test(identity.database)) {
      throw new Error('Disposable backup database names must end in _ci, _test, or _dev.');
    }
  } else if (identity.username.toLowerCase() === 'postgres') {
    throw new Error('Staging and production backup operations cannot use the postgres superuser.');
  }
  return scope;
}

function assertBackupSafety(environment, schemaSha256) {
  if (!environment.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
  if (environment.DATABASE_BACKUP_MODE !== 'read_only') {
    throw new Error('DATABASE_BACKUP_MODE must be read_only.');
  }
  const identity = databaseIdentity(environment.DATABASE_URL);
  const scope = assertScope(environment, identity, 'DATABASE_BACKUP_SCOPE');
  const expected = `backup:${identity.database}:${schemaSha256}`;
  if (environment.DATABASE_BACKUP_APPROVAL?.trim() !== expected) {
    throw new Error(`DATABASE_BACKUP_APPROVAL must exactly equal ${expected}.`);
  }
  return Object.freeze({ ...identity, scope });
}

function assertRestoreSafety(environment, { archiveSha256, sourceDatabase }) {
  if (!environment.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');
  if (environment.DATABASE_RESTORE_MODE !== 'apply') {
    throw new Error('DATABASE_RESTORE_MODE must be apply.');
  }
  const identity = databaseIdentity(environment.DATABASE_URL);
  const scope = assertScope(environment, identity, 'DATABASE_SAFETY_SCOPE');
  if (identity.database === sourceDatabase) {
    throw new Error('Portable restore refuses to overwrite the source database.');
  }
  const expected = `restore:${identity.database}:${archiveSha256}`;
  if (environment.DATABASE_RESTORE_APPROVAL?.trim() !== expected) {
    throw new Error(`DATABASE_RESTORE_APPROVAL must exactly equal ${expected}.`);
  }
  return Object.freeze({ ...identity, scope });
}

module.exports = { assertBackupSafety, assertRestoreSafety };
