'use strict';

const SAFE_LOCAL_DATABASE = /(?:^|_)(?:ci|test|dev)$/i;

function databaseIdentity(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL must name a database');

  return {
    database,
    host: parsed.hostname.toLowerCase(),
    username: decodeURIComponent(parsed.username),
  };
}

function assertDatabaseSafety(operation, environment = process.env) {
  const scope = environment.DATABASE_SAFETY_SCOPE;
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for database mutation');
  if (!['disposable', 'staging', 'production'].includes(scope)) {
    throw new Error(
      'DATABASE_SAFETY_SCOPE must be disposable, staging, or production for database mutation',
    );
  }

  const identity = databaseIdentity(databaseUrl);
  if (scope === 'disposable') {
    if (!['127.0.0.1', 'localhost', '::1'].includes(identity.host)) {
      throw new Error('Disposable database operations are restricted to a loopback host');
    }
    if (!SAFE_LOCAL_DATABASE.test(identity.database)) {
      throw new Error('Disposable database names must end in _ci, _test, or _dev');
    }
  } else {
    if (identity.username.toLowerCase() === 'postgres') {
      throw new Error(
        'Staging and production application migrations cannot use postgres superuser',
      );
    }
    const expectedApproval = `${scope}:${identity.database}`;
    if (environment.DATABASE_DEPLOY_APPROVAL !== expectedApproval) {
      throw new Error(`DATABASE_DEPLOY_APPROVAL must equal ${expectedApproval}`);
    }
  }

  return Object.freeze({ database: identity.database, host: identity.host, operation, scope });
}

if (require.main === module) {
  const result = assertDatabaseSafety(process.argv[2] || 'unspecified');
  process.stdout.write(
    `${JSON.stringify({ database: result.database, host: result.host, operation: result.operation, scope: result.scope })}\n`,
  );
}

module.exports = { assertDatabaseSafety, databaseIdentity };
