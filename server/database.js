const mongoose = require('mongoose');
const { Pool } = require('pg');

async function connectDatabase({
  logger = console,
  mongoUri,
  postgresRequired = false,
  postgresUri = '',
}) {
  if (postgresRequired && !postgresUri) {
    throw new Error('DATABASE_URL is required by the persistence configuration.');
  }
  let mongo;
  if (!mongoUri) {
    logger.warn('database_unavailable', { database: 'mongo', reasonCode: 'not_configured' });
    mongo = Object.freeze({
      connected: false,
      async ping() {
        return false;
      },
      reason: 'not_configured',
    });
  } else {
    try {
      await mongoose.connect(mongoUri);
      logger.info('database_connected', { database: 'mongo' });
      mongo = Object.freeze({
        connected: true,
        async ping() {
          if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
          await mongoose.connection.db.command({ ping: 1 });
          return true;
        },
        reason: null,
      });
    } catch (error) {
      logger.error('database_connection_failed', {
        database: 'mongo',
        errorCode: error.code || 'connection_failed',
      });
      logger.warn('database_unavailable', { database: 'mongo', reasonCode: 'connection_failed' });
      mongo = Object.freeze({
        connected: false,
        async ping() {
          return false;
        },
        reason: 'connection_failed',
      });
    }
  }

  let postgres = Object.freeze({
    connected: false,
    async ping() {
      return false;
    },
    pool: null,
    reason: 'not_required',
  });
  if (postgresRequired) {
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
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => undefined);
      const unavailable = new Error(
        'PostgreSQL connection required by persistence is unavailable.',
      );
      unavailable.code = 'postgres_required_unavailable';
      throw unavailable;
    }
  }

  return Object.freeze({
    connected: mongo.connected,
    mongo,
    postgres,
    reason: mongo.reason,
  });
}

async function disconnectDatabase(database = null) {
  if (database?.postgres?.pool) await database.postgres.pool.end();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = { connectDatabase, disconnectDatabase };
