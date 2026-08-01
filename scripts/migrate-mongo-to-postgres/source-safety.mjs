const READ_ONLY_ROLES = new Set(['clusterMonitor', 'read', 'readAnyDatabase']);

/**
 * @param {string | undefined} value
 * @param {string} name
 */
export function parseSecretKey(value, name) {
  if (!value) throw new Error(`${name} is required`);
  const key = Buffer.from(value, 'base64');
  if (
    key.length !== 32 ||
    key.toString('base64').replaceAll('=', '') !== value.replaceAll('=', '')
  ) {
    throw new Error(`${name} must be one canonical base64-encoded 32-byte key`);
  }
  return key;
}

/** @param {NodeJS.ProcessEnv} environment */
export function assertMongoSourceSafety(environment = process.env) {
  const mongoUri = environment.MIGRATION_SOURCE_MONGO_URI;
  if (!mongoUri)
    throw new Error('MIGRATION_SOURCE_MONGO_URI is required for an explicit Mongo source');
  if (environment.MIGRATION_SOURCE_MODE !== 'read_only') {
    throw new Error('MIGRATION_SOURCE_MODE must equal read_only');
  }

  const schemeMatch = mongoUri.match(/^(mongodb(?:\+srv)?):\/\//i);
  if (!schemeMatch || /\s/.test(mongoUri)) {
    throw new Error('Migration source URL must use mongodb:// or mongodb+srv://');
  }
  const pathStart = mongoUri.indexOf('/', schemeMatch[0].length);
  if (pathStart < 0) throw new Error('Migration source URL must name one database');
  const rawDatabase = mongoUri.slice(pathStart + 1).split(/[?#]/, 1)[0];
  let database;
  try {
    database = decodeURIComponent(rawDatabase);
  } catch {
    throw new Error('Migration source database name contains invalid URL encoding');
  }
  if (!database) throw new Error('Migration source URL must name one database');
  if (database.includes('/'))
    throw new Error('Migration source URL must name exactly one database');
  const expectedApproval = `read-only:${database}`;
  if (environment.MIGRATION_SOURCE_APPROVAL !== expectedApproval) {
    throw new Error(`MIGRATION_SOURCE_APPROVAL must equal ${expectedApproval}`);
  }

  return Object.freeze({ database, mongoUri });
}

/**
 * @param {any} authentication
 * @returns {import('./types.mjs').MigrationRole[]}
 */
export function assertReadOnlyRoles(authentication) {
  const roles = authentication?.authInfo?.authenticatedUserRoles;
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('Mongo source did not disclose an authenticated read-only role');
  }
  const rejected = roles.filter((role) => !READ_ONLY_ROLES.has(role.role));
  if (rejected.length > 0) {
    throw new Error(
      `Mongo source role is not allowlisted for migration reads: ${rejected
        .map((role) => role.role)
        .sort()
        .join(',')}`,
    );
  }
  if (!roles.some((role) => role.role === 'read' || role.role === 'readAnyDatabase')) {
    throw new Error('Mongo source requires an explicit read or readAnyDatabase role');
  }
  return roles.map((role) => ({ database: role.db, role: role.role }));
}
