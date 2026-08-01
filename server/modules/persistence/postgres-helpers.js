'use strict';

async function withPostgresTransaction(pool, operation, { isolation = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (isolation) await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function requirePostgresPool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new Error('A PostgreSQL pool is required.');
  }
}

module.exports = { requirePostgresPool, withPostgresTransaction };
