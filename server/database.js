const { Pool } = require('pg');

async function connectDatabase({
  logger = console,
  postgresRequired = false,
  postgresUri = '',
}) {
  let postgres = Object.freeze({
    connected: false,
    async ping() {
      return false;
    },
    pool: null,
    reason: 'not_required',
  });

  if (postgresRequired && postgresUri) {
    const pool = new Pool({
      application_name: 'codewithmee-api',
      connectionString: postgresUri,
      max: 10,
    });
    try {
      await pool.query('SELECT 1');
      logger.info('database_connected', { database: 'postgres' });
      postgres = Object.freeze({
        connected: true,
        async ping() {
          await pool.query('SELECT 1');
          return true;
        },
        pool,
        reason: null,
      });
    } catch (_error) {
      await pool.end().catch(() => undefined);
      const unavailable = new Error(
        'PostgreSQL connection required by persistence is unavailable.',
      );
      unavailable.code = 'postgres_required_unavailable';
      throw unavailable;
    }
  }

  return Object.freeze({
    connected: postgres.connected,
    postgres,
    reason: postgres.reason,
  });
}

async function disconnectDatabase(database = null) {
  if (database?.postgres?.pool) await database.postgres.pool.end();
}

module.exports = { connectDatabase, disconnectDatabase };
