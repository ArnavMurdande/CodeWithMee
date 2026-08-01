'use strict';

const { randomUUID } = require('node:crypto');
const express = require('express');

const { operationContract } = require('../api/middleware');
const { createIdentityHttpGuards } = require('../identity/router');

function requestAuthorityMetadata(request) {
  return Object.freeze({
    requestId: request.get('x-request-id') || randomUUID(),
  });
}

function createAuthorityRouter({ config, identityService, service }) {
  const router = express.Router();
  const { authenticate, requireTrustedOrigin } = createIdentityHttpGuards({
    config,
    service: identityService,
  });

  router.get(
    '/admin/audit-events',
    authenticate,
    operationContract('listAuthorityAuditEvents'),
    async (request, response, next) => {
      try {
        response.json({
          events: await service.listAuditEvents(request.identityAuthentication, request.query),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/users',
    authenticate,
    operationContract('listAuthorityUsers'),
    async (request, response, next) => {
      try {
        response.json({
          users: await service.listUsers(request.identityAuthentication, request.query),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/admin/users/:userId/platform-role',
    requireTrustedOrigin,
    authenticate,
    operationContract('changePlatformRole'),
    async (request, response, next) => {
      try {
        response.json(
          await service.changePlatformRole(
            request.identityAuthentication,
            request.params.userId,
            request.body,
            requestAuthorityMetadata(request),
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/admin/users/:userId/status',
    requireTrustedOrigin,
    authenticate,
    operationContract('changeAccountStatus'),
    async (request, response, next) => {
      try {
        response.json(
          await service.changeAccountStatus(
            request.identityAuthentication,
            request.params.userId,
            request.body,
            requestAuthorityMetadata(request),
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/organizations/:organizationId/ownership-transfer',
    requireTrustedOrigin,
    authenticate,
    operationContract('transferOrganizationOwnership'),
    async (request, response, next) => {
      try {
        response.json(
          await service.transferOrganizationOwnership(
            request.identityAuthentication,
            request.params.organizationId,
            request.body,
            requestAuthorityMetadata(request),
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

module.exports = { createAuthorityRouter, requestAuthorityMetadata };
