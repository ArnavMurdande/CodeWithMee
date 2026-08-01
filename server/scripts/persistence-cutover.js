'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { Pool } = require('pg');

const { parseParityKey, verifyParityEnvelope } = require('../modules/persistence/parity-report');
const { assertActivationSafety, assertRollbackSafety } = require('./persistence-cutover-safety');

function argument(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) return '';
  return args[index + 1];
}

async function readEnvelope(rawPath, key) {
  if (!rawPath) throw new Error('--report is required for activation.');
  const reportPath = path.resolve(rawPath);
  const stat = await fs.lstat(reportPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
    throw new Error('Parity report must be a regular non-symlink file no larger than 2 MiB.');
  }
  const envelope = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  return verifyParityEnvelope(envelope, key);
}

async function currentFlag(client, key, environment) {
  const result = await client.query(
    `SELECT value FROM feature_flags
      WHERE key = $1 AND environment = $2
      FOR UPDATE`,
    [key, environment],
  );
  return result.rows[0]?.value || null;
}

async function writeFlag(client, { domain, environment, value }) {
  const key = `persistence.${domain}.store`;
  await client.query(
    `INSERT INTO feature_flags (key, environment, value, revision)
     VALUES ($1, $2, $3::jsonb, 1)
     ON CONFLICT (key, environment) DO UPDATE
       SET value = EXCLUDED.value,
           revision = feature_flags.revision + 1,
           updated_at = CURRENT_TIMESTAMP`,
    [key, environment, JSON.stringify(value)],
  );
}

async function appendEvent(client, { action, beforeState, domain, operatorReference, value }) {
  await client.query(
    `INSERT INTO audit_events
      (id, action, target_type, target_id, reason, source, operator_ref,
       before_state, after_state, occurred_at, created_at, operation_key)
     VALUES
      ($1, $2, 'persistence_domain', $3,
       'Persistence authority changed under an approved migration freeze.',
       'migration_cli', $4, $5::jsonb, $6::jsonb, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, $7)`,
    [
      randomUUID(),
      action,
      domain,
      operatorReference,
      JSON.stringify(beforeState || {}),
      JSON.stringify(value),
      `${action}:${value.environment}:${value.generation}:${domain}`,
    ],
  );
}

async function activate(client, safety) {
  for (const domain of safety.domains) {
    const key = `persistence.${domain}.store`;
    const beforeState = await currentFlag(client, key, safety.deploymentEnvironment);
    const value = {
      datasetSha256: safety.datasetSha256,
      environment: safety.deploymentEnvironment,
      generation: safety.generation,
      parityReportSha256: safety.parityReportSha256,
      rollbackSnapshotSha256: safety.rollbackSnapshotSha256,
      rollbackUntil: safety.rollbackUntil.toISOString(),
      state: 'active',
      store: 'postgres',
    };
    if (beforeState?.state === 'active' && beforeState.generation !== safety.generation) {
      throw new Error(`Domain ${domain} already has a different active generation.`);
    }
    await writeFlag(client, {
      domain,
      environment: safety.deploymentEnvironment,
      value,
    });
    if (beforeState?.state !== 'active') {
      await appendEvent(client, {
        action: 'persistence.cutover.activate',
        beforeState,
        domain,
        operatorReference: safety.operatorReference,
        value,
      });
    }
  }
}

async function rollback(client, safety) {
  for (const domain of safety.domains) {
    const key = `persistence.${domain}.store`;
    const beforeState = await currentFlag(client, key, safety.deploymentEnvironment);
    if (
      beforeState?.store !== 'postgres' ||
      beforeState?.state !== 'active' ||
      beforeState?.generation !== safety.generation ||
      beforeState?.rollbackSnapshotSha256 !== safety.rollbackSnapshotSha256
    ) {
      throw new Error(`Domain ${domain} has no matching active generation to roll back.`);
    }
    const value = {
      ...beforeState,
      environment: safety.deploymentEnvironment,
      rolledBackAt: new Date().toISOString(),
      state: 'rolled_back',
      store: 'mongoose',
    };
    await writeFlag(client, {
      domain,
      environment: safety.deploymentEnvironment,
      value,
    });
    await appendEvent(client, {
      action: 'persistence.cutover.rollback',
      beforeState,
      domain,
      operatorReference: safety.operatorReference,
      value,
    });
  }
}

async function main({ args = process.argv.slice(2), environment = process.env } = {}) {
  const command = args[0];
  let safety;
  if (command === 'activate') {
    const key = parseParityKey(environment.PERSISTENCE_PARITY_KEY);
    const envelope = await readEnvelope(argument(args, '--report'), key);
    safety = assertActivationSafety({ args, envelope, environment });
  } else if (command === 'rollback') {
    safety = assertRollbackSafety({ args, environment });
  } else {
    throw new Error('Expected activate or rollback command.');
  }

  const pool = new Pool({
    application_name: 'codewithmee-persistence-cutover',
    connectionString: environment.DATABASE_URL,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    if (command === 'activate') await activate(client, safety);
    else await rollback(client, safety);
    await client.query('COMMIT');
    return {
      command,
      domains: safety.domains,
      environment: safety.deploymentEnvironment,
      generation: safety.generation,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ error: error.code || error.message })}\n`);
      process.exitCode = 1;
    });
}

module.exports = { activate, argument, main, readEnvelope, rollback };
