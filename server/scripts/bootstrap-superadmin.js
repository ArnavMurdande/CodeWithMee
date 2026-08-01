'use strict';

require('dotenv').config();

const { connectDatabase, disconnectDatabase } = require('../database');
const { loadRuntimeConfig } = require('../config/runtime');
const { createAuthorityService } = require('../modules/authority/service');
const { asStructuredLogger } = require('../modules/http/structured-logger');
const { PERSISTENCE_STORE } = require('../modules/persistence/contracts');
const { createRuntimeRepositories } = require('../modules/persistence/repositories');
const {
  loadPersistenceRuntimeConfig,
  verifyPersistenceActivation,
} = require('../modules/persistence/runtime');

async function runBootstrap({ environment = process.env, logger = console } = {}) {
  const runtime = loadRuntimeConfig(environment);
  const structuredLogger = asStructuredLogger(logger, { environment: runtime.nodeEnv });
  const persistence = loadPersistenceRuntimeConfig(environment, { nodeEnv: runtime.nodeEnv });
  const database = await connectDatabase({
    logger: structuredLogger,
    mongoUri: runtime.mongoUri,
    postgresRequired: persistence.needsPostgres,
    postgresUri: runtime.databaseUrl,
  });
  const primaryAvailable =
    persistence.stores.authority === PERSISTENCE_STORE.POSTGRES
      ? database.postgres.connected
      : database.mongo.connected;
  if (!primaryAvailable) {
    await disconnectDatabase(database);
    const error = new Error('bootstrap_database_unavailable');
    error.code = 'bootstrap_database_unavailable';
    throw error;
  }

  let repositories;
  try {
    await verifyPersistenceActivation(database.postgres.pool, persistence);
    repositories = createRuntimeRepositories({
      logger: structuredLogger,
      persistence,
      postgresPool: database.postgres.pool,
    });
    const service = createAuthorityService({ repository: repositories.authority });
    const result = await service.bootstrapSuperadmin({
      email: environment.SUPERADMIN_BOOTSTRAP_EMAIL,
      operatorReference: environment.SUPERADMIN_BOOTSTRAP_OPERATOR,
      reason: environment.SUPERADMIN_BOOTSTRAP_REASON,
    });
    structuredLogger.info('superadmin_bootstrap_committed', {
      auditEventId: result.auditEvent.id,
      targetUserId: result.user.id,
    });
    return result;
  } finally {
    await repositories?.drainShadowReads();
    await disconnectDatabase(database);
  }
}

if (require.main === module) {
  const logger = asStructuredLogger(console, {
    environment: process.env.NODE_ENV || 'development',
  });
  runBootstrap().catch(async (error) => {
    logger.error('superadmin_bootstrap_failed', { errorCode: error.code || 'internal_error' });
    process.exitCode = 1;
    await disconnectDatabase();
  });
}

module.exports = { runBootstrap };
