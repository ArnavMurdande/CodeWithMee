'use strict';

const fs = require('node:fs/promises');

const { Pool } = require('pg');

const {
  createParityReport,
  parseParityKey,
  signParityReport,
} = require('../modules/persistence/parity-report');
const { assertParitySafety } = require('./persistence-parity-safety');

function argument(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) return '';
  return args[index + 1];
}

async function main({ args = process.argv.slice(2), environment = process.env } = {}) {
  const datasetSha256 = argument(args, '--dataset-sha256');
  const safety = assertParitySafety({
    datasetSha256,
    environment,
    output: argument(args, '--output'),
  });
  const key = parseParityKey(environment.PERSISTENCE_PARITY_KEY);
  const pool = new Pool({
    application_name: 'codewithmee-parity-read-only',
    connectionString: environment.DATABASE_URL,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report = await createParityReport(client, { datasetSha256 });
    const envelope = signParityReport(report, key);
    await fs.writeFile(safety.outputPath, `${JSON.stringify(envelope, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await client.query('COMMIT');
    return {
      datasetSha256,
      readyDomains: Object.entries(report.domains)
        .filter(([, value]) => value.readyForCutover)
        .map(([domain]) => domain)
        .sort(),
      reportSha256: envelope.reportSha256,
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

module.exports = { argument, main };
