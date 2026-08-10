'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { assertDatabaseSafety } = require('./database-safety');
const { buildAuthorizationCatalog } = require('../../prisma/seed/authorization-catalog.cjs');
const { seedChallenges } = require('../../prisma/seed/challenges.cjs');
const { seedAuthorizationCatalog } = require('./seed-database');

const CONFIRMATION = '--confirm=RESET-STAGING-APPLICATION-DATA';

async function main() {
  if (!process.argv.includes(CONFIRMATION)) throw new Error(`Explicit ${CONFIRMATION} is required.`);
  const safety = assertDatabaseSafety('reset-staging-application-data');
  if (safety.scope === 'production') throw new Error('This command refuses production databases.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    const featureFlags = await client.query('SELECT key,environment,value,rollout_rules,revision,created_at,updated_at FROM feature_flags');
    await client.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE TABLE integration_cache,outbox_events RESTART IDENTITY CASCADE');
    for (const flag of featureFlags.rows) {
      await client.query(
        `INSERT INTO feature_flags (key,environment,value,rollout_rules,revision,updated_by_user_id,created_at,updated_at)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,NULL,$6,$7) ON CONFLICT (key,environment) DO UPDATE
         SET value=EXCLUDED.value,rollout_rules=EXCLUDED.rollout_rules,revision=EXCLUDED.revision,updated_by_user_id=NULL,updated_at=EXCLUDED.updated_at`,
        [flag.key,flag.environment,JSON.stringify(flag.value),flag.rollout_rules == null ? null : JSON.stringify(flag.rollout_rules),flag.revision,flag.created_at,flag.updated_at],
      );
    }
    const authorizationCatalog = await seedAuthorizationCatalog(client, buildAuthorizationCatalog());
    const challengeSeed = await seedChallenges(client);
    await client.query('COMMIT');
    const counts = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM challenges) AS challenges,
      (SELECT COUNT(*)::int FROM organizations) AS organizations,
      (SELECT COUNT(*)::int FROM courses) AS courses,
      (SELECT COUNT(*)::int FROM social_posts) AS posts`);
    process.stdout.write(`${JSON.stringify({ target: `${safety.host}/${safety.database}`, preservedFeatureFlags: featureFlags.rowCount, authorizationCatalog, ...challengeSeed, counts: counts.rows[0] })}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { CONFIRMATION, main };
