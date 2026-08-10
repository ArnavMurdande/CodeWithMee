const cors = require('cors');
const express = require('express');
const path = require('path');

const { createApiContractRouter } = require('./modules/api/openapi');
const { LEGACY_ROUTE_LIFECYCLE } = require('./modules/api/legacy-route-lifecycle');
const { browserRequestDefense } = require('./modules/http/browser-defense');
const { createUnavailableIdentityRouter } = require('./modules/identity/router');
const { createUnavailableFileRouter } = require('./modules/files/router');
const { createUnavailableChallengeRouter } = require('./modules/challenges/router');
const { createUnavailableCoursesRouter } = require('./modules/courses/router');
const { createUnavailableLmsRouter } = require('./modules/lms/router');
const { errorHandler, notFoundHandler, PublicHttpError } = require('./modules/http/error-handler');
const { requestContext } = require('./modules/http/request-context');
const { createJsonBodyParser } = require('./modules/http/route-security');
const { createRateLimitMiddleware } = require('./modules/http/rate-limit');
const { securityHeaders } = require('./modules/http/security-headers');
const { asStructuredLogger } = require('./modules/http/structured-logger');
const { createHealthRouter } = require('./modules/health/router');
const roadmapRouter = require('./routes/roadmap');
const aiRouter = require('./routes/ai');
const youtubeRouter = require('./routes/youtube');
const {
  createDisabledErrorReporter,
  createTelemetry,
} = require('./modules/observability/telemetry');

function corsOptions(allowedOrigins) {
  const allowlist = new Set(allowedOrigins || []);
  return {
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'If-Match',
      'X-CSRF-Token',
      'X-Request-ID',
    ],
    credentials: true,
    exposedHeaders: [
      'ETag',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
      'X-Request-ID',
    ],
    maxAge: 600,
    methods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    optionsSuccessStatus: 204,
    origin(origin, callback) {
      if (!origin || allowlist.has(origin)) return callback(null, true);
      const error = new Error('Origin is not allowed by CORS policy.');
      error.code = 'origin_not_allowed';
      error.status = 403;
      return callback(error);
    },
  };
}

function createApp({
  allowedOrigins = [],
  errorReporter = createDisabledErrorReporter(),
  challengeRouter,
  coursesRouter,
  lmsRouter,
  learningRouter,
  spaceRouter,
  executionRouter,
  fileObjectRouter,
  fileRouter,
  identityAuthenticate = null,
  identityRouter,
  legacyApiEnabled = true,
  logger = console,
  localUploadServing,
  nodeEnv = 'development',
  operationRuntime = null,
  rateLimitStore,
  rateLimits,
  readinessProbe = async () => Object.freeze({ checks: Object.freeze([]), ready: true }),
  recentAuthenticationMs = 10 * 60 * 1000,
  uploadsDirectory,
  trustedProxies = [],
  telemetry,
} = {}) {
  const app = express();
  const structuredLogger = asStructuredLogger(logger, { environment: nodeEnv });
  const resolvedTelemetry = telemetry || createTelemetry({ logger: structuredLogger });
  const resolvedUploadsDirectory = uploadsDirectory || path.join(__dirname, 'uploads');
  const serveLocalUploads = localUploadServing ?? nodeEnv !== 'production';
  if (nodeEnv === 'production' && serveLocalUploads) {
    throw new Error('Local upload serving cannot be enabled in production.');
  }

  app.locals.identityAuthenticate = identityAuthenticate;
  app.locals.localUploadServing = serveLocalUploads;
  app.locals.nodeEnv = nodeEnv;
  app.locals.operationRuntime = operationRuntime;
  app.locals.recentAuthenticationMs = recentAuthenticationMs;
  app.locals.telemetry = resolvedTelemetry;

  app.disable('x-powered-by');
  if (trustedProxies.length) app.set('trust proxy', trustedProxies);
  app.use(securityHeaders({ nodeEnv }));
  app.use(requestContext({ logger: structuredLogger, telemetry: resolvedTelemetry }));
  app.use(cors(corsOptions(allowedOrigins)));
  app.use(browserRequestDefense({ trustedOrigins: allowedOrigins }));
  app.use(createRateLimitMiddleware({ limits: rateLimits, store: rateLimitStore }));
  if (fileObjectRouter) app.use('/api/v1/file-objects', fileObjectRouter);
  app.use(createJsonBodyParser());
  if (serveLocalUploads) {
    app.use('/uploads', express.static(resolvedUploadsDirectory));
  } else {
    app.use('/uploads', (_request, _response, next) => {
      next(new PublicHttpError('legacy_local_upload_retired', 410));
    });
  }

  app.use('/api/v1', createApiContractRouter());
  app.use('/api/v1', createHealthRouter({ authenticate: identityAuthenticate, readinessProbe }));
  app.use(
    '/api/v1/challenges',
    challengeRouter || createUnavailableChallengeRouter({ reason: 'challenges_not_configured' }),
  );
  app.use(
    '/api/v1/courses',
    coursesRouter || createUnavailableCoursesRouter({ reason: 'courses_not_configured' }),
  );
  app.use('/api/v1/lms', lmsRouter || createUnavailableLmsRouter());
  if (learningRouter) app.use('/api/v1/learning', learningRouter);
  if (spaceRouter) app.use('/api/v1/space', spaceRouter);
  if (executionRouter) app.use('/api/v1/execution', executionRouter);
  app.use('/api/v1/roadmaps', roadmapRouter);
  app.use('/api/v1/ai', aiRouter);
  app.use('/api/v1/videos', youtubeRouter);
  app.use(
    '/api/v1',
    identityRouter || createUnavailableIdentityRouter({ reason: 'identity_not_configured' }),
  );
  app.use('/api/v1', fileRouter || createUnavailableFileRouter());

  if (legacyApiEnabled) {
    for (const entry of LEGACY_ROUTE_LIFECYCLE) {
      app.use(entry.mount, require(entry.modulePath));
    }
  } else {
    const retired = (_request, _response, next) =>
      next(new PublicHttpError('legacy_api_disabled_for_cutover', 410));
    for (const entry of LEGACY_ROUTE_LIFECYCLE) app.use(entry.mount, retired);
  }

  app.get('/api/test', (_request, response) => {
    response.json({ message: 'Hello from the server!' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler({ errorReporter, logger: structuredLogger, telemetry: resolvedTelemetry }));

  return app;
}

module.exports = { createApp };
