#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFixtureSource } from './fixture-source.mjs';
import { createMongoSource } from './mongo-source.mjs';
import { exportEncryptedSnapshot, openEncryptedSnapshot } from './encrypted-snapshot.mjs';
import { buildInventory } from './inventory.mjs';
import { buildDryRunPlan, writeDryRunPlan } from './dry-run-planner.mjs';
import { parseSecretKey } from './source-safety.mjs';

/** @param {string[]} argumentsList */
function parseArguments(argumentsList) {
  /** @type {import('./types.mjs').CliOptions} */
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument: ${argument}`);
    const key = argument.slice(2);
    if (key === 'dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option --${key}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

/**
 * @param {import('./types.mjs').CliOptions} options
 * @param {string} name
 */
function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

/** @returns {import('./types.mjs').MigrationSource} */
function unavailableSource() {
  return {
    databaseLabel: 'source-unavailable',
    kind: 'unavailable',
    async close() {},
    async *iterateCollection() {},
    async listCollections() {
      return [];
    },
    async listIndexes() {
      return [];
    },
  };
}

/**
 * @param {import('./types.mjs').CliOptions} options
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Promise<import('./types.mjs').MigrationSource>}
 */
async function openSource(options, environment) {
  const sourceKind = options.source || 'auto';
  if (sourceKind === 'fixture') return createFixtureSource(requireOption(options, 'fixture'));
  if (sourceKind === 'mongo') return createMongoSource(environment);
  if (sourceKind === 'auto') {
    return environment.MIGRATION_SOURCE_MONGO_URI
      ? createMongoSource(environment)
      : unavailableSource();
  }
  throw new Error('--source must be auto, fixture, or mongo');
}

/**
 * @param {string} outputDirectory
 * @param {any} inventory
 */
async function writeInventory(outputDirectory, inventory) {
  const absolute = path.resolve(outputDirectory);
  await mkdir(path.dirname(absolute), { recursive: true });
  await mkdir(absolute, { mode: 0o700, recursive: false });
  await writeFile(
    path.join(absolute, 'inventory.json'),
    `${JSON.stringify(inventory, null, 2)}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    },
  );
  return absolute;
}

/**
 * @param {import('./types.mjs').CliOptions} options
 * @param {NodeJS.ProcessEnv} environment
 */
async function runInventory(options, environment) {
  const source = await openSource(options, environment);
  try {
    const fingerprintKey = parseSecretKey(
      environment.MIGRATION_FINGERPRINT_KEY,
      'MIGRATION_FINGERPRINT_KEY',
    );
    const inventory = await buildInventory({
      fingerprintKey,
      source,
      uploadRoot: typeof options.uploads === 'string' ? options.uploads : undefined,
    });
    const directory = await writeInventory(requireOption(options, 'output'), inventory);
    return {
      collections: inventory.collections.length,
      directory,
      sourceKind: source.kind,
      sourceStatus: source.kind === 'unavailable' ? 'unavailable' : 'inventoried',
      uploadFiles: inventory.uploads.totals.files || 0,
    };
  } finally {
    await source.close();
  }
}

/**
 * @param {import('./types.mjs').CliOptions} options
 * @param {NodeJS.ProcessEnv} environment
 */
async function runExport(options, environment) {
  const source = await openSource(options, environment);
  try {
    if (source.kind === 'unavailable') throw new Error('Cannot export without an explicit source');
    const encryptionKey = parseSecretKey(environment.MIGRATION_EXPORT_KEY, 'MIGRATION_EXPORT_KEY');
    const fingerprintKey = parseSecretKey(
      environment.MIGRATION_FINGERPRINT_KEY,
      'MIGRATION_FINGERPRINT_KEY',
    );
    const result = await exportEncryptedSnapshot({
      encryptionKey,
      fingerprintKey,
      outputDirectory: requireOption(options, 'output'),
      source,
    });
    return {
      collections: result.manifest.collections.length,
      datasetSha256: result.manifest.datasetSha256,
      directory: result.directory,
      sourceKind: source.kind,
    };
  } finally {
    await source.close();
  }
}

/**
 * @param {import('./types.mjs').CliOptions} options
 * @param {NodeJS.ProcessEnv} environment
 */
async function runImport(options, environment) {
  if (options.dryRun !== true) {
    throw new Error(
      'Live import is intentionally unavailable from this source CLI; pass --dry-run or use the separately guarded PostgreSQL snapshot importer',
    );
  }
  const encryptionKey = parseSecretKey(environment.MIGRATION_EXPORT_KEY, 'MIGRATION_EXPORT_KEY');
  const fingerprintKey = parseSecretKey(
    environment.MIGRATION_FINGERPRINT_KEY,
    'MIGRATION_FINGERPRINT_KEY',
  );
  const source = await openEncryptedSnapshot({
    encryptionKey,
    snapshotDirectory: requireOption(options, 'snapshot'),
  });
  try {
    const result = await buildDryRunPlan({ fingerprintKey, source });
    const directory = await writeDryRunPlan({
      outputDirectory: requireOption(options, 'output'),
      ...result,
    });
    return {
      directory,
      exceptions: result.report.exceptions.length,
      planSha256: result.report.planSha256,
      planned: result.report.countsByState.planned,
      quarantined: result.report.countsByState.quarantined,
      writesPerformed: false,
    };
  } finally {
    await source.close();
  }
}

/**
 * @param {string[]} argumentsList
 * @param {NodeJS.ProcessEnv} environment
 */
export async function main(argumentsList = process.argv.slice(2), environment = process.env) {
  const [command, ...rest] = argumentsList;
  const options = parseArguments(rest);
  if (command === 'inventory') return runInventory(options, environment);
  if (command === 'export') return runExport(options, environment);
  if (command === 'import') return runImport(options, environment);
  throw new Error('Usage: cli.mjs <inventory|export|import> [strict options]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown migration command error';
      process.stderr.write(`Migration command failed: ${message}\n`);
      process.exitCode = 1;
    });
}
