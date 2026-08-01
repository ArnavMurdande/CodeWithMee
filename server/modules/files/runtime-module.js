'use strict';

const { Pool } = require('pg');

const { ORGANIZATION_MEMBERSHIP_STATUS, ORGANIZATION_ROLE } = require('../organizations/contracts');
const { createS3ObjectStore } = require('./object-store');
const { createPostgresFileRepository } = require('./postgres-repository');
const { createFileRouter, createUnavailableFileRouter } = require('./router');
const { loadFileStorageConfig } = require('./runtime');
const { createFileService } = require('./service');

function unavailable(reason) {
  return Object.freeze({
    async close() {},
    enabled: false,
    reason,
    router: createUnavailableFileRouter({ reason }),
    scannerMode: 'disabled',
  });
}

function createOrganizationAuthorizer(repository) {
  return async ({ action, organizationId, principal }) => {
    const [organization, membership] = await Promise.all([
      repository.findOrganizationById(organizationId),
      repository.findMembership(organizationId, principal.userId),
    ]);
    if (
      !organization ||
      !membership ||
      membership.organizationId !== organization.id ||
      membership.userId !== principal.userId ||
      membership.status !== ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE
    ) {
      return false;
    }
    if (action === 'read') return true;
    return [ORGANIZATION_ROLE.OWNER, ORGANIZATION_ROLE.ADMIN].includes(membership.role);
  };
}

function createRuntimeFileModule({
  environment,
  identityConfig,
  identityService,
  logger = console,
  nodeEnv,
  organizationRepository,
  postgresPool = null,
}) {
  let storageConfig;
  try {
    storageConfig = loadFileStorageConfig(environment, { nodeEnv });
  } catch (error) {
    if (nodeEnv === 'production') throw error;
    logger.warn('file_storage_configuration_invalid', {
      errorCode: error.code || 'invalid_config',
    });
    return unavailable('file_storage_configuration_invalid');
  }
  if (!storageConfig.enabled) return unavailable(storageConfig.reason);
  if (!postgresPool && !environment.DATABASE_URL?.trim())
    return unavailable('file_database_not_configured');
  if (!identityService || !organizationRepository)
    return unavailable('file_identity_not_configured');

  const ownsPool = !postgresPool;
  const pool =
    postgresPool ||
    new Pool({
      application_name: 'codewithmee-files',
      connectionString: environment.DATABASE_URL.trim(),
      max: 4,
    });
  const objectStore = createS3ObjectStore(storageConfig);
  const repository = createPostgresFileRepository(pool);
  const service = createFileService({
    authorizeOrganization: createOrganizationAuthorizer(organizationRepository),
    objectStore,
    repository,
  });
  return Object.freeze({
    async close() {
      await objectStore.close();
      if (ownsPool) await pool.end();
    },
    enabled: true,
    reason: null,
    router: createFileRouter({
      config: identityConfig,
      identityService,
      logger,
      service,
    }),
    scannerMode: storageConfig.scannerMode,
    service,
  });
}

module.exports = { createOrganizationAuthorizer, createRuntimeFileModule };
