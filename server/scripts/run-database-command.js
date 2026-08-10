'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { spawnSync } = require('node:child_process');
const { assertDatabaseSafety } = require('./database-safety');

const command = process.argv[2];
const prismaArguments = {
  'migrate-deploy': ['migrate', 'deploy', '--config', 'prisma.config.ts'],
  seed: ['db', 'seed', '--config', 'prisma.config.ts'],
};

if (!Object.hasOwn(prismaArguments, command)) {
  process.stderr.write('Usage: node scripts/run-database-command.js <migrate-deploy|seed>\n');
  process.exitCode = 2;
} else {
  const target = assertDatabaseSafety(command);
  process.stdout.write(
    `Database safety check passed: ${target.scope}/${target.host}/${target.database}/${command}\n`,
  );

  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, ...prismaArguments[command]], {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
