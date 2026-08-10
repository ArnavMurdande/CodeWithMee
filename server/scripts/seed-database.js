'use strict';

const { Pool } = require('pg');
const { buildAuthorizationCatalog } = require('../../prisma/seed/authorization-catalog.cjs');
const { seedChallenges } = require('../../prisma/seed/challenges.cjs');
const { assertDatabaseSafety } = require('./database-safety');

async function seedAuthorizationCatalog(client, catalog) {
  for (const permission of catalog.permissions) {
    await client.query(
      `INSERT INTO permission_definitions (key, scope, description)
       VALUES ($1, $2::authorization_scope, $3)
       ON CONFLICT (key) DO UPDATE
       SET scope = EXCLUDED.scope, description = EXCLUDED.description, updated_at = now()`,
      [permission.key, permission.scope, permission.description],
    );
  }

  for (const role of catalog.roles) {
    await client.query(
      `INSERT INTO role_definitions (key, scope, description, builtin)
       VALUES ($1, $2::authorization_scope, $3, true)
       ON CONFLICT (key) DO UPDATE
       SET scope = EXCLUDED.scope, description = EXCLUDED.description,
           builtin = true, updated_at = now()`,
      [role.key, role.scope, role.description],
    );
  }

  const roleKeys = catalog.roles.map((role) => role.key);
  await client.query('DELETE FROM role_permissions WHERE role_key = ANY($1::varchar[])', [
    roleKeys,
  ]);

  let grantCount = 0;
  for (const [roleKey, permissionKeys] of Object.entries(catalog.grants)) {
    for (const permissionKey of permissionKeys) {
      await client.query(
        `INSERT INTO role_permissions (role_key, permission_key)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [roleKey, permissionKey],
      );
      grantCount += 1;
    }
  }

  return {
    grants: grantCount,
    permissions: catalog.permissions.length,
    roles: catalog.roles.length,
  };
}

async function main() {
  assertDatabaseSafety('seed');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    const counts = await seedAuthorizationCatalog(client, buildAuthorizationCatalog());
    const challengeCounts = await seedChallenges(client);
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ authorizationCatalog: counts, ...challengeCounts })}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Database seed failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { seedAuthorizationCatalog, seedChallenges };
