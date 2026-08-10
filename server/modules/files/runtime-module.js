'use strict';

const { Pool } = require('pg');

const { ORGANIZATION_MEMBERSHIP_STATUS, ORGANIZATION_ROLE } = require('../organizations/contracts');
const { createS3ObjectStore } = require('./object-store');
const { createLocalObjectStore } = require('./local-object-store');
const { createPostgresFileRepository } = require('./postgres-repository');
const { createFileRouter, createUnavailableFileRouter } = require('./router');
const { loadFileStorageConfig } = require('./runtime');
const { createFileService } = require('./service');

function unavailable(reason) {
  return Object.freeze({
    async close() {},
    enabled: false,
    objectRouter: null,
    reason,
    router: createUnavailableFileRouter({ reason }),
    scannerMode: 'disabled',
  });
}

function createOrganizationAuthorizer(repository, postgresPool = null) {
  return async ({ action, organizationId, principal, record }) => {
    const [organization, membership] = await Promise.all([
      repository.findOrganizationById(organizationId),
      repository.findMembership(organizationId, principal.userId),
    ]);
    if (!organization) return false;
    if (
      !membership ||
      membership.organizationId !== organization.id ||
      membership.userId !== principal.userId ||
      membership.status !== ORGANIZATION_MEMBERSHIP_STATUS.ACTIVE
    ) {
      if (
        action === 'read' &&
        postgresPool &&
        record?.purpose === 'payment_qr'
      ) {
        const entitled = await postgresPool.query(
          `SELECT 1 FROM course_payment_orders p
           JOIN courses c ON c.id=p.course_id
           WHERE p.qr_file_id=$1 AND c.organization_id=$2 AND p.user_id=$3
             AND p.status IN ('pending_payment','pending_review','more_information') LIMIT 1`,
          [record.id, organizationId, principal.userId],
        );
        return entitled.rowCount > 0;
      }
      if (
        action === 'read' &&
        postgresPool &&
        record?.visibility === 'enrolled' &&
        ['course_resource', 'course_video'].includes(record?.purpose)
      ) {
        const entitled = await postgresPool.query(
          `SELECT 1 FROM course_contents cc
           JOIN course_modules cm ON cm.id=cc.module_id
           JOIN course_versions cv ON cv.id=cm.version_id
           JOIN courses c ON c.id=cv.course_id
           JOIN enrollments e ON e.course_id=c.id AND e.course_version_id=cv.id
           LEFT JOIN course_resources cr ON cr.content_id=cc.id
           WHERE ((cr.file_id=$1 AND cr.allow_download=true) OR cc.media_file_id=$1)
             AND c.organization_id=$2
             AND e.user_id=$3 AND e.status IN ('enrolled','completed') LIMIT 1`,
          [record.id, organizationId, principal.userId],
        );
        return entitled.rowCount > 0;
      }
      return false;
    }
    if (action === 'read') return true;
    return [ORGANIZATION_ROLE.OWNER, ORGANIZATION_ROLE.ADMIN].includes(membership.role);
  };
}

function createRelatedFileAuthorizer(postgresPool) {
  return async ({ action, principal, record }) => {
    if (action !== 'read' || !postgresPool || !record?.id) return false;
    if (record.purpose === 'payment_proof') {
      const result = await postgresPool.query(
        `SELECT 1 FROM course_payment_orders p
         JOIN courses c ON c.id=p.course_id
         JOIN organization_memberships om ON om.organization_id=c.organization_id
           AND om.user_id=$2 AND om.status='active'
         LEFT JOIN course_staff_assignments csa ON csa.course_id=c.id AND csa.user_id=$2
         WHERE p.proof_file_id=$1
           AND (om.role IN ('owner','admin') OR csa.role='payment_reviewer') LIMIT 1`,
        [record.id, principal.userId],
      );
      return result.rowCount > 0;
    }
    if (record.purpose === 'assignment_submission') {
      const result = await postgresPool.query(
        `SELECT 1 FROM course_assignment_submission_files sf
         JOIN course_assignment_submissions s ON s.id=sf.submission_id
         JOIN course_assignments a ON a.id=s.assignment_id
         JOIN course_contents cc ON cc.id=a.content_id
         JOIN course_modules cm ON cm.id=cc.module_id
         JOIN course_versions cv ON cv.id=cm.version_id
         JOIN courses c ON c.id=cv.course_id
         JOIN organization_memberships om ON om.organization_id=c.organization_id
           AND om.user_id=$2 AND om.status='active'
         LEFT JOIN course_staff_assignments csa ON csa.course_id=c.id AND csa.user_id=$2
         WHERE sf.file_id=$1
           AND (om.role IN ('owner','admin','instructor','grader') OR csa.role IN ('manager','instructor','grader'))
         LIMIT 1`,
        [record.id, principal.userId],
      );
      return result.rowCount > 0;
    }
    return false;
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
  const objectStore = storageConfig.provider === 'local'
    ? createLocalObjectStore(storageConfig)
    : createS3ObjectStore(storageConfig);
  const repository = createPostgresFileRepository(pool);
  const service = createFileService({
    authorizeOrganization: createOrganizationAuthorizer(organizationRepository, pool),
    authorizeRelated: createRelatedFileAuthorizer(pool),
    objectStore,
    repository,
  });
  return Object.freeze({
    async close() {
      await objectStore.close();
      if (ownsPool) await pool.end();
    },
    enabled: true,
    objectRouter: objectStore.httpRouter || null,
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

module.exports = { createOrganizationAuthorizer, createRelatedFileAuthorizer, createRuntimeFileModule };
