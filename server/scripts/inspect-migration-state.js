'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tables = [
  '_prisma_migrations',
  'challenge_submissions',
  'challenge_versions',
  'challenges',
  'courses',
  'execution_jobs',
  'lesson_progress',
  'users',
];

(async () => {
  const result = await pool.query({
    text: `SELECT table_name, column_name, data_type, udt_name, character_maximum_length
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = ANY($1::text[])
           ORDER BY table_name, ordinal_position`,
    values: [tables],
  });
  process.stdout.write(`${JSON.stringify(result.rows, null, 2)}\n`);
})()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
