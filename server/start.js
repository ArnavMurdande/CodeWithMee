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
const { createPostgresChallengeRepository } = require('./modules/challenges/postgres-repository');
const { createChallengeService } = require('./modules/challenges/service');
const { createChallengeRouter } = require('./modules/challenges/router');
const { createPostgresCourseRepository } = require('./modules/courses/postgres-repository');
const { createCourseService } = require('./modules/courses/service');
const { createCourseRouter } = require('./modules/courses/router');
const { createPostgresLmsRepository } = require('./modules/lms/postgres-repository');
const { createLmsService } = require('./modules/lms/service');
const { createLmsRouter } = require('./modules/lms/router');
const { createLearningRouter } = require('./modules/learning/router');
const { createPostgresSpaceRouter } = require('./modules/space/router');
const { createExecutionGateway } = require('./modules/execution/runner-gateway');
const { createExecutionJobQueue } = require('./modules/execution/job-queue');
const { createPostgresExecutionJobRepository } = require('./modules/execution/postgres-job-repository');
const { createExecutionRouter } = require('./modules/execution/router');
const authMiddleware = require('./middleware/authMiddleware');
const { createProviderRbac } = require('./modules/provider/rbac');

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
    postgresRequired: persistence.needsPostgres || fileNeedsPostgres,
    postgresUri: config.databaseUrl,
  });
  let identity = null;
  let server = null;
  try {
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
    let challengeRouter = null;
    let coursesRouter = null;
    let lmsRouter = null;
    let learningRouter = null;
    let spaceRouter = null;
    let runnerGateway = null;
    let jobQueue = null;
    let executionRouter = null;

    if (database.postgres.pool) {
      runnerGateway = createExecutionGateway({
        hmacSecret: environment.RUNNER_HMAC_SECRET,
        runnerUrl: environment.PISTON_RUNNER_URL || environment.PISTON_API_URL || null,
        isProduction: config.nodeEnv === 'production',
      });
      jobQueue = createExecutionJobQueue({
        maxConcurrency: 5,
        maxQueueDepth: 20,
        dbRepository: createPostgresExecutionJobRepository(database.postgres.pool),
      });
      executionRouter = createExecutionRouter({ jobQueue, runnerGateway });

      const courseRepo = createPostgresCourseRepository(database.postgres.pool);
      const courseService = createCourseService({ repository: courseRepo });
      const challengeRepo = createPostgresChallengeRepository(database.postgres.pool);
      const challengeService = createChallengeService({
        repository: challengeRepo,
        executionGateway: runnerGateway,
        jobQueue,
        onChallengeSolved: courseService.onChallengeSolved,
      });
      challengeRouter = createChallengeRouter({
        service: challengeService,
        pool: database.postgres.pool,
        authenticate: identity.authenticate,
      });

      const providerRbac = createProviderRbac({ pool: database.postgres.pool });
      coursesRouter = createCourseRouter({
        service: courseService,
        authMiddleware,
        providerRbac,
      });
      lmsRouter = createLmsRouter({
        service: createLmsService(createPostgresLmsRepository(database.postgres.pool), { mailer: identity.mailer }),
        providerRbac,
      });
      learningRouter = createLearningRouter(database.postgres.pool);
      spaceRouter = createPostgresSpaceRouter({ pool: database.postgres.pool, fileService: identity.fileService });
    }

    const appAllowedOrigins = [
      ...new Set([...(identity?.trustedOrigins || []), ...config.corsAllowedOrigins]),
    ];
    const app = createApp({
      allowedOrigins: appAllowedOrigins,
      challengeRouter,
      coursesRouter,
      lmsRouter,
      learningRouter,
      spaceRouter,
      executionRouter,
      fileRouter: identity.fileRouter,
      fileObjectRouter: identity.fileObjectRouter,
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
          {
            name: 'runner',
            probe: async () => !runnerGateway || !runnerGateway.isCircuitOpen(),
            required: false,
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
          if (jobQueue && typeof jobQueue.destroy === 'function') {
            jobQueue.destroy();
          }
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
