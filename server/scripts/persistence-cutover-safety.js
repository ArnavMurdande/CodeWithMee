'use strict';

const {
  CORE_AUTHORITY_DOMAINS,
  DOMAIN_ENVIRONMENT_KEYS,
} = require('../modules/persistence/contracts');
const { targetDatabaseName } = require('../modules/persistence/runtime');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GENERATION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const ENVIRONMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;

function bool(environment, name) {
  if (environment[name] === 'true') return true;
  if (environment[name] === 'false' || !environment[name]) return false;
  throw new Error(`${name} must be true or false.`);
}

function setting(environment, name, pattern = /\S/) {
  const value = environment[name]?.trim() || '';
  if (!pattern.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function parseDomains(rawValue) {
  const domains = String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
  if (!domains.length || domains.length !== new Set(domains).size) {
    throw new Error('--domains must contain unique persistence domains.');
  }
  const unknown = domains.filter((domain) => !Object.hasOwn(DOMAIN_ENVIRONMENT_KEYS, domain));
  if (unknown.length) throw new Error('--domains contains an unknown persistence domain.');
  const coreSelected = domains.some((domain) => CORE_AUTHORITY_DOMAINS.includes(domain));
  if (coreSelected && !CORE_AUTHORITY_DOMAINS.every((domain) => domains.includes(domain))) {
    throw new Error('Identity, organizations, and authority must be selected together.');
  }
  return domains;
}

function baseSafety({ args, environment, now = () => new Date() }) {
  if (!args.includes('--apply')) throw new Error('--apply is required.');
  const domainIndex = args.indexOf('--domains');
  if (domainIndex < 0 || !args[domainIndex + 1]) throw new Error('--domains is required.');
  const domains = parseDomains(args[domainIndex + 1]);
  const deploymentEnvironment = setting(
    environment,
    'PERSISTENCE_ENVIRONMENT',
    ENVIRONMENT_PATTERN,
  );
  const databaseName = targetDatabaseName(environment.DATABASE_URL);
  const generation = setting(environment, 'PERSISTENCE_CUTOVER_GENERATION', GENERATION_PATTERN);
  const rollbackSnapshotSha256 = setting(
    environment,
    'PERSISTENCE_ROLLBACK_SNAPSHOT_SHA256',
    SHA256_PATTERN,
  );
  const rollbackUntil = new Date(environment.PERSISTENCE_ROLLBACK_UNTIL || '');
  if (Number.isNaN(rollbackUntil.getTime()) || rollbackUntil <= now()) {
    throw new Error('PERSISTENCE_ROLLBACK_UNTIL must be a future ISO timestamp.');
  }
  const operatorReference = setting(
    environment,
    'PERSISTENCE_CUTOVER_OPERATOR',
    /^[a-zA-Z0-9][a-zA-Z0-9 ._:/-]{7,119}$/,
  );
  if (!bool(environment, 'PERSISTENCE_WRITE_FREEZE_CONFIRMED')) {
    throw new Error('PERSISTENCE_WRITE_FREEZE_CONFIRMED must be true.');
  }
  if (!bool(environment, 'PERSISTENCE_ROLLBACK_REHEARSED')) {
    throw new Error('PERSISTENCE_ROLLBACK_REHEARSED must be true.');
  }
  return {
    databaseName,
    deploymentEnvironment,
    domains,
    generation,
    operatorReference,
    rollbackSnapshotSha256,
    rollbackUntil,
  };
}

function assertActivationSafety({ args, envelope, environment, now }) {
  if (args[0] !== 'activate' || environment.PERSISTENCE_CUTOVER_MODE !== 'activate') {
    throw new Error(
      'Activation requires the activate command and PERSISTENCE_CUTOVER_MODE=activate.',
    );
  }
  const safety = baseSafety({ args, environment, now });
  const datasetSha256 = setting(
    environment,
    'PERSISTENCE_MIGRATION_DATASET_SHA256',
    SHA256_PATTERN,
  );
  const parityReportSha256 = setting(
    environment,
    'PERSISTENCE_PARITY_REPORT_SHA256',
    SHA256_PATTERN,
  );
  if (envelope.reportSha256 !== parityReportSha256) {
    throw new Error('The authenticated parity report checksum does not match approval.');
  }
  if (envelope.report.datasetSha256 !== datasetSha256) {
    throw new Error('The parity report dataset does not match approval.');
  }
  for (const domain of safety.domains) {
    if (envelope.report.domains?.[domain]?.readyForCutover !== true) {
      throw new Error(`Parity report does not authorize cutover for domain ${domain}.`);
    }
  }
  const expected = `cutover:${safety.deploymentEnvironment}:${safety.databaseName}:${safety.generation}:${parityReportSha256}:${safety.domains.join(',')}`;
  if (environment.PERSISTENCE_CUTOVER_APPROVAL?.trim() !== expected) {
    throw new Error(`PERSISTENCE_CUTOVER_APPROVAL must exactly equal ${expected}.`);
  }
  return Object.freeze({
    ...safety,
    datasetSha256,
    parityReportSha256,
  });
}

function assertRollbackSafety({ args, environment, now }) {
  if (args[0] !== 'rollback' || environment.PERSISTENCE_CUTOVER_MODE !== 'rollback') {
    throw new Error(
      'Rollback requires the rollback command and PERSISTENCE_CUTOVER_MODE=rollback.',
    );
  }
  const safety = baseSafety({ args, environment, now });
  const expected = `rollback:${safety.deploymentEnvironment}:${safety.databaseName}:${safety.generation}:${safety.domains.join(',')}`;
  if (environment.PERSISTENCE_ROLLBACK_APPROVAL?.trim() !== expected) {
    throw new Error(`PERSISTENCE_ROLLBACK_APPROVAL must exactly equal ${expected}.`);
  }
  return Object.freeze(safety);
}

module.exports = { assertActivationSafety, assertRollbackSafety, parseDomains };
