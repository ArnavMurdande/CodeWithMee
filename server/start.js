const dns = require('dns');

const { createApp } = require('./app');
const { loadRuntimeConfig } = require('./config/runtime');
const { connectDatabase, disconnectDatabase } = require('./database');
const { createIdentityModule } = require('./modules/identity/module');
const { createReadinessProbe } = require('./modules/health/readiness');
const { asStructuredLogger } = require('./modules/http/structured-logger');
const { createOperationRuntime } = require('./modules/operations/runtime');
const {
  loadPersistenceRuntimeConfig,
  verifyPersistenceActivation,
} = require('./modules/persistence/runtime');
const { getGeminiKeys, getYoutubeKeys } = require('./utils/keyManager');

function listen(app, { host, port }) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server));
    server.once('error', reject);
  });
}

async function startServer({ environment = process.env, logger = console } = {}) {
  const config = loadRuntimeConfig(environment);
  const runtimeLogger = asStructuredLogger(logger, { environment: config.nodeEnv });
  const persistence = loadPersistenceRuntimeConfig(environment, { nodeEnv: config.nodeEnv });
  if (config.dnsServers.length) {
    dns.setServers(config.dnsServers);
    runtimeLogger.info('dns_resolvers_configured', { count: config.dnsServers.length });
  }

  runtimeLogger.info('external_key_slots_loaded', {
    geminiCount: getGeminiKeys(environment).length,
    youtubeCount: getYoutubeKeys(environment).length,
  });

  const fileNeedsPostgres = Boolean(environment.FILE_STORAGE_MODE?.trim());
  const database = await connectDatabase({
    logger: runtimeLogger,
    mongoUri: config.mongoUri,
    postgresRequired: persistence.needsPostgres || fileNeedsPostgres,
    postgresUri: config.databaseUrl,
  });
  let identity = null;
  let server = null;
  try {
    if (persistence.shadowDomains.length && !database.mongo.connected) {
      throw new Error('MongoDB must be available while persistence shadow reads are enabled.');
    }
    await verifyPersistenceActivation(database.postgres.pool, persistence);
    identity = createIdentityModule({
      allowedOrigins: config.corsAllowedOrigins,
      databaseAvailable: database.connected,
      database,
      environment,
      logger: runtimeLogger,
      nodeEnv: config.nodeEnv,
      persistence,
      postgresPool: database.postgres.pool,
    });
    runtimeLogger.info('identity_runtime_state', {
      enabled: identity.enabled,
      googleEnabled: identity.googleEnabled,
      reasonCode: identity.reason,
    });
    runtimeLogger.info('file_runtime_state', {
      enabled: identity.fileEnabled,
      reasonCode: identity.fileReason,
    });
    const operationRuntime = createOperationRuntime({
      nodeEnv: config.nodeEnv,
      postgresPool: database.postgres.pool,
    });
    runtimeLogger.info('operation_runtime_state', {
      durable: operationRuntime.durable,
      enabled: operationRuntime.enabled,
      reasonCode: operationRuntime.reason,
    });
    const app = createApp({
      allowedOrigins: config.corsAllowedOrigins,
      fileRouter: identity.fileRouter,
      identityAuthenticate: identity.authenticate,
      identityRouter: identity.router,
      legacyApiEnabled: persistence.legacyApiEnabled,
      logger: runtimeLogger,
      localUploadServing: config.localUploadServing,
      nodeEnv: config.nodeEnv,
      operationRuntime,
      readinessProbe: createReadinessProbe({
        checks: [
          {
            name: 'mongo',
            probe: () => database.mongo.ping(),
            required: persistence.needsMongo,
          },
          {
            name: 'postgres',
            probe: () => database.postgres.ping(),
            required: persistence.needsPostgres || fileNeedsPostgres,
          },
          {
            name: 'identity',
            probe: async () => identity.enabled,
            required: config.nodeEnv === 'production' || Boolean(environment.ACCESS_TOKEN_SECRET),
          },
          {
            name: 'file_storage',
            probe: async () => identity.fileEnabled,
            required: fileNeedsPostgres,
          },
        ],
      }),
      recentAuthenticationMs: identity.recentAuthenticationMs,
      trustedProxies: config.trustedProxies,
    });
    server = await listen(app, config);
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : config.port;
    runtimeLogger.info('server_listening', { host: config.host, port: listeningPort });

    return {
      app,
      config,
      database,
      identity: Object.freeze({
        enabled: identity.enabled,
        fileEnabled: identity.fileEnabled,
        fileReason: identity.fileReason,
        googleEnabled: identity.googleEnabled,
        reason: identity.reason,
      }),
      persistence: Object.freeze({
        environment: persistence.deploymentEnvironment,
        legacyApiEnabled: persistence.legacyApiEnabled,
        postgresDomains: persistence.postgresDomains,
        shadowDomains: persistence.shadowDomains,
      }),
      operations: Object.freeze({
        durable: operationRuntime.durable,
        enabled: operationRuntime.enabled,
        reason: operationRuntime.reason,
      }),
      server,
      async close() {
        try {
          await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        } finally {
          await identity.close();
          await disconnectDatabase(database);
        }
      },
    };
  } catch (error) {
    if (server?.listening) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    await identity?.close();
    await disconnectDatabase(database);
    throw error;
  }
}

module.exports = { startServer };
