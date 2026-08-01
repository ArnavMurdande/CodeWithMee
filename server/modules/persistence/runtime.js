'use strict';

const {
  CORE_AUTHORITY_DOMAINS,
  DOMAIN_ENVIRONMENT_KEYS,
  PERSISTENCE_STORE,
  POSTGRES_RUNTIME_READY_DOMAINS,
} = require('./contracts');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GENERATION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;

function parseBoolean(name, rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === '') return fallback;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function parseStore(name, rawValue) {
  const value = rawValue?.trim() || PERSISTENCE_STORE.MONGOOSE;
  if (!Object.values(PERSISTENCE_STORE).includes(value)) {
    throw new Error(`${name} must be mongoose or postgres.`);
  }
  return value;
}

function parseDomainList(name, rawValue) {
  if (!rawValue?.trim()) return [];
  const domains = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (domains.length !== new Set(domains).size) throw new Error(`${name} contains a duplicate.`);
  const known = new Set(Object.keys(DOMAIN_ENVIRONMENT_KEYS));
  const unknown = domains.filter((domain) => !known.has(domain));
  if (unknown.length) throw new Error(`${name} contains an unknown domain.`);
  return domains.sort();
}

function requiredSetting(environment, name, pattern, message) {
  const value = environment[name]?.trim() || '';
  if (!pattern.test(value)) throw new Error(message || `${name} is invalid.`);
  return value;
}

function targetDatabaseName(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl || '');
  } catch {
    throw new Error('DATABASE_URL is required for persistence verification.');
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, '')).trim();
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^[a-zA-Z0-9_-]{1,63}$/.test(name)) {
    throw new Error('DATABASE_URL must name a safe PostgreSQL database.');
  }
  return name;
}

function loadPersistenceRuntimeConfig(
  environment = process.env,
  { nodeEnv = 'development', now = () => new Date() } = {},
) {
  const deploymentEnvironment =
    environment.PERSISTENCE_ENVIRONMENT?.trim() || (nodeEnv === 'test' ? 'test' : nodeEnv);
  if (!ENVIRONMENT_PATTERN.test(deploymentEnvironment)) {
    throw new Error('PERSISTENCE_ENVIRONMENT must be a simple environment name.');
  }

  const stores = Object.fromEntries(
    Object.entries(DOMAIN_ENVIRONMENT_KEYS).map(([domain, name]) => [
      domain,
      parseStore(name, environment[name]),
    ]),
  );
  const postgresDomains = Object.keys(stores)
    .filter((domain) => stores[domain] === PERSISTENCE_STORE.POSTGRES)
    .sort();
  const unsupported = postgresDomains.filter(
    (domain) => !POSTGRES_RUNTIME_READY_DOMAINS.has(domain),
  );
  if (unsupported.length) {
    throw new Error(
      `PostgreSQL runtime cutover is not ready for domain(s): ${unsupported.join(', ')}.`,
    );
  }

  const coreStores = new Set(CORE_AUTHORITY_DOMAINS.map((domain) => stores[domain]));
  if (coreStores.size !== 1) {
    throw new Error(
      'Identity, organizations, and authority must cut over or roll back as one atomic boundary.',
    );
  }

  const legacyApiMode = environment.PERSISTENCE_LEGACY_API_MODE?.trim() || 'enabled';
  if (!['disabled', 'enabled'].includes(legacyApiMode)) {
    throw new Error('PERSISTENCE_LEGACY_API_MODE must be enabled or disabled.');
  }

  const shadowDomains = parseDomainList(
    'PERSISTENCE_SHADOW_DOMAINS',
    environment.PERSISTENCE_SHADOW_DOMAINS,
  );
  const unsupportedShadow = shadowDomains.filter(
    (domain) => !POSTGRES_RUNTIME_READY_DOMAINS.has(domain),
  );
  if (unsupportedShadow.length) {
    throw new Error(`Shadow reads are not ready for domain(s): ${unsupportedShadow.join(', ')}.`);
  }

  let parityReportSha256 = null;
  let datasetSha256 = null;
  if (shadowDomains.length || postgresDomains.length) {
    parityReportSha256 = requiredSetting(
      environment,
      'PERSISTENCE_PARITY_REPORT_SHA256',
      SHA256_PATTERN,
      'PERSISTENCE_PARITY_REPORT_SHA256 must be a lowercase SHA-256.',
    );
    datasetSha256 = requiredSetting(
      environment,
      'PERSISTENCE_MIGRATION_DATASET_SHA256',
      SHA256_PATTERN,
      'PERSISTENCE_MIGRATION_DATASET_SHA256 must be a lowercase SHA-256.',
    );
  }

  if (shadowDomains.length) {
    const databaseName = targetDatabaseName(environment.DATABASE_URL);
    const expected = `shadow:${deploymentEnvironment}:${databaseName}:${datasetSha256}:${shadowDomains.join(',')}`;
    if (environment.PERSISTENCE_SHADOW_APPROVAL?.trim() !== expected) {
      throw new Error(`PERSISTENCE_SHADOW_APPROVAL must exactly equal ${expected}.`);
    }
  }

  let cutover = null;
  if (postgresDomains.length) {
    if (legacyApiMode !== 'disabled') {
      throw new Error(
        'PERSISTENCE_LEGACY_API_MODE must be disabled before PostgreSQL identity cutover.',
      );
    }
    if (
      !parseBoolean(
        'PERSISTENCE_WRITE_FREEZE_CONFIRMED',
        environment.PERSISTENCE_WRITE_FREEZE_CONFIRMED,
      )
    ) {
      throw new Error('PERSISTENCE_WRITE_FREEZE_CONFIRMED must be true for cutover.');
    }
    if (
      !parseBoolean('PERSISTENCE_ROLLBACK_REHEARSED', environment.PERSISTENCE_ROLLBACK_REHEARSED)
    ) {
      throw new Error('PERSISTENCE_ROLLBACK_REHEARSED must be true for cutover.');
    }
    const generation = requiredSetting(
      environment,
      'PERSISTENCE_CUTOVER_GENERATION',
      GENERATION_PATTERN,
      'PERSISTENCE_CUTOVER_GENERATION is invalid.',
    );
    const rollbackSnapshotSha256 = requiredSetting(
      environment,
      'PERSISTENCE_ROLLBACK_SNAPSHOT_SHA256',
      SHA256_PATTERN,
      'PERSISTENCE_ROLLBACK_SNAPSHOT_SHA256 must be a lowercase SHA-256.',
    );
    const rollbackUntil = new Date(environment.PERSISTENCE_ROLLBACK_UNTIL || '');
    if (Number.isNaN(rollbackUntil.getTime()) || rollbackUntil <= now()) {
      throw new Error('PERSISTENCE_ROLLBACK_UNTIL must be a future ISO timestamp.');
    }
    const databaseName = targetDatabaseName(environment.DATABASE_URL);
    const expected = `cutover:${deploymentEnvironment}:${databaseName}:${generation}:${parityReportSha256}:${postgresDomains.join(',')}`;
    if (environment.PERSISTENCE_CUTOVER_APPROVAL?.trim() !== expected) {
      throw new Error(`PERSISTENCE_CUTOVER_APPROVAL must exactly equal ${expected}.`);
    }
    cutover = Object.freeze({
      datasetSha256,
      domains: Object.freeze(postgresDomains),
      generation,
      parityReportSha256,
      rollbackSnapshotSha256,
      rollbackUntil,
      targetDatabase: databaseName,
    });
  }

  return Object.freeze({
    cutover,
    deploymentEnvironment,
    legacyApiEnabled: legacyApiMode === 'enabled',
    needsMongo: legacyApiMode === 'enabled' || stores.identity === PERSISTENCE_STORE.MONGOOSE,
    needsPostgres:
      postgresDomains.length > 0 ||
      shadowDomains.some((domain) => stores[domain] === PERSISTENCE_STORE.MONGOOSE),
    postgresDomains: Object.freeze(postgresDomains),
    shadowDomains: Object.freeze(shadowDomains),
    stores: Object.freeze(stores),
  });
}

async function verifyPersistenceActivation(pool, config) {
  if (!config.cutover) return;
  if (!pool?.query) throw new Error('PostgreSQL activation verification requires a pool.');
  const keys = config.cutover.domains.map((domain) => `persistence.${domain}.store`);
  const result = await pool.query(
    `SELECT key, value
       FROM feature_flags
      WHERE environment = $1
        AND key = ANY($2::text[])`,
    [config.deploymentEnvironment, keys],
  );
  const values = new Map(result.rows.map((row) => [row.key, row.value]));
  for (const domain of config.cutover.domains) {
    const value = values.get(`persistence.${domain}.store`);
    if (
      !value ||
      value.store !== PERSISTENCE_STORE.POSTGRES ||
      value.state !== 'active' ||
      value.generation !== config.cutover.generation ||
      value.parityReportSha256 !== config.cutover.parityReportSha256 ||
      value.datasetSha256 !== config.cutover.datasetSha256 ||
      value.rollbackSnapshotSha256 !== config.cutover.rollbackSnapshotSha256 ||
      value.rollbackUntil !== config.cutover.rollbackUntil.toISOString()
    ) {
      throw new Error(`PostgreSQL activation record does not match domain ${domain}.`);
    }
  }
}

module.exports = {
  loadPersistenceRuntimeConfig,
  targetDatabaseName,
  verifyPersistenceActivation,
};
