'use strict';

const { createFileRouter, createUnavailableFileRouter } = require('./router');
const { createFileService } = require('./service');

function createFileModule({
  authorizeOrganization,
  config,
  identityService,
  logger = console,
  objectStore,
  repository,
}) {
  if (!identityService || !objectStore || !repository) {
    return Object.freeze({
      enabled: false,
      reason: 'file_storage_not_configured',
      router: createUnavailableFileRouter(),
      service: null,
    });
  }
  const service = createFileService({ authorizeOrganization, objectStore, repository });
  return Object.freeze({
    enabled: true,
    reason: null,
    router: createFileRouter({ config, identityService, logger, service }),
    service,
  });
}

module.exports = { createFileModule };
