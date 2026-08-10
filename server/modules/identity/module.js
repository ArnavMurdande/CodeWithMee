'use strict';

const express = require('express');

const { createAuthorityRouter } = require('../authority/router');
const { createAuthorityService } = require('../authority/service');
const { createUnavailableFileRouter } = require('../files/router');
const { createRuntimeFileModule } = require('../files/runtime-module');
const { createOrganizationRouter } = require('../organizations/router');
const { createOrganizationService } = require('../organizations/service');
const { PERSISTENCE_STORE } = require('../persistence/contracts');
const { createRuntimeRepositories } = require('../persistence/repositories');
const { loadPersistenceRuntimeConfig } = require('../persistence/runtime');
const { createAccessTokenService } = require('./token-crypto');
const {
  createDisabledIdentityMailer,
  createResendIdentityMailer,
  createSmtpIdentityMailer,
} = require('./mailer');
const { createGoogleOidcClient } = require('./google-oidc');
const { createPasswordHasher } = require('./password-hasher');
const { createPasswordRiskChecker } = require('./password-risk');
const { createIdentityRouter, createUnavailableIdentityRouter } = require('./router');
const { loadIdentityRuntimeConfig } = require('./runtime');
const { createIdentityService } = require('./service');

function unavailable(reason, webAppOrigin = 'http://127.0.0.1:3000') {
  return Object.freeze({
    async close() {},
    authenticate: null,
    enabled: false,
    fileEnabled: false,
    fileReason: 'file_identity_not_configured',
    fileRouter: createUnavailableFileRouter({ reason: 'file_identity_not_configured' }),
    fileObjectRouter: null,
    googleEnabled: false,
    reason,
    recentAuthenticationMs: 10 * 60 * 1000,
    router: createUnavailableIdentityRouter({ reason }),
    trustedOrigins: Object.freeze([webAppOrigin]),
  });
}

function createIdentityModule({
  allowedOrigins,
  databaseAvailable,
  database = null,
  environment,
  logger = console,
  nodeEnv,
  persistence: suppliedPersistence = null,
  postgresPool = null,
}) {
  let config;
  try {
    config = loadIdentityRuntimeConfig(environment, { allowedOrigins, nodeEnv });
  } catch (error) {
    if (nodeEnv === 'production') throw error;
    logger.warn('identity_configuration_invalid', { errorCode: error.code || 'invalid_config' });
    return unavailable('identity_configuration_invalid');
  }

  if (!config.enabled) return unavailable('identity_not_configured');

  if (config.google.partial) {
    logger.warn('google_oauth_partially_configured', {
      reasonCode: 'google_oauth_requires_full_credentials',
    });
  }

  const persistence = suppliedPersistence || loadPersistenceRuntimeConfig(environment, { nodeEnv });
  const primaryAvailable =
    persistence.stores.identity === PERSISTENCE_STORE.POSTGRES
      ? Boolean(postgresPool || database?.postgres?.connected)
      : Boolean(database?.mongo?.connected ?? databaseAvailable);
  if (!primaryAvailable) return unavailable('identity_database_unavailable');

  const repositories = createRuntimeRepositories({
    logger,
    persistence,
    postgresPool: postgresPool || database?.postgres?.pool || null,
  });
  const repository = repositories.identity;
  const organizationRepository = repositories.organizations;
  const authorityRepository = repositories.authority;
  const accessTokens = createAccessTokenService(config.accessToken);
  const mailer =
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? createSmtpIdentityMailer({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: process.env.SMTP_PORT || 587,
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
          from: process.env.EMAIL_FROM || `CodeWithMee <${process.env.SMTP_USER}>`,
          logger,
        })
      : process.env.RESEND_API_KEY
        ? createResendIdentityMailer({
            apiKey: process.env.RESEND_API_KEY,
            from: process.env.EMAIL_FROM || 'CodeWithMee <onboarding@resend.dev>',
            logger,
          })
        : createDisabledIdentityMailer({ logger });
  const service = createIdentityService({
    accessTokens,
    mailer,
    passwordHasher: createPasswordHasher(),
    passwordRiskChecker: createPasswordRiskChecker({ mode: config.passwordCompromiseMode }),
    refreshTokenPepper: config.refreshTokenPepper,
    repository,
    sessionConfig: config.session,
  });
  const organizationService = createOrganizationService({
    identityRepository: repository,
    invitationTokenPepper: config.refreshTokenPepper,
    mailer,
    recentAuthenticationMs: config.session.recentAuthenticationMs,
    repository: organizationRepository,
  });
  const authorityService = createAuthorityService({
    recentAuthenticationMs: config.session.recentAuthenticationMs,
    repository: authorityRepository,
  });
  const googleClient = createGoogleOidcClient({ config: config.google });
  const fileModule = createRuntimeFileModule({
    environment,
    identityConfig: config,
    identityService: service,
    logger,
    nodeEnv,
    organizationRepository,
    postgresPool: postgresPool || database?.postgres?.pool || null,
  });
  const router = express.Router();
  router.use(createIdentityRouter({ config, googleClient, logger, service }));
  router.use(
    createOrganizationRouter({
      config,
      identityService: service,
      logger,
      service: organizationService,
    }),
  );
  router.use(
    createAuthorityRouter({
      config,
      identityService: service,
      logger,
      service: authorityService,
    }),
  );
  return Object.freeze({
    close: () => Promise.all([fileModule.close(), repositories.drainShadowReads()]),
    authenticate: (accessToken) => service.authenticate(accessToken),
    enabled: true,
    fileEnabled: fileModule.enabled,
    fileReason: fileModule.reason,
    fileRouter: fileModule.router,
    fileObjectRouter: fileModule.objectRouter || null,
    fileService: fileModule.service || null,
    googleEnabled: googleClient.enabled,
    mailer,
    reason: null,
    recentAuthenticationMs: config.session.recentAuthenticationMs,
    router,
    trustedOrigins: config.trustedOrigins,
  });
}

module.exports = { createIdentityModule };
