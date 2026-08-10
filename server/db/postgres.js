'use strict';

const { Pool } = require('pg');

let pool = null;

function getPgPool() {
  if (!pool && process.env.DATABASE_URL) {
    const isSsl = process.env.DATABASE_URL.includes('sslmode=require');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      application_name: 'codewithmee-api',
      max: 10,
      ssl: isSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

module.exports = { getPgPool };
