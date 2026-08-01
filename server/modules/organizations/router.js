'use strict';

const express = require('express');

const { operationContract } = require('../api/middleware');
const { createIdentityHttpGuards } = require('../identity/router');

function createOrganizationRouter({ config, identityService, service }) {
  const router = express.Router();
  const { authenticate, optionalAuthenticate, requireTrustedOrigin } = createIdentityHttpGuards({
    config,
    service: identityService,
  });

  router.get(
    '/organizations',
    authenticate,
    operationContract('listMyOrganizations'),
    async (request, response, next) => {
      try {
        response.json({
          organizations: await service.listMyOrganizations(request.identityAuthentication),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/organizations',
    requireTrustedOrigin,
    authenticate,
    operationContract('createOrganization'),
    async (request, response, next) => {
      try {
        response
          .status(201)
          .json(await service.createOrganization(request.identityAuthentication, request.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/organization-invitations/:token/accept',
    requireTrustedOrigin,
    authenticate,
    operationContract('acceptOrganizationInvitation'),
    async (request, response, next) => {
      try {
        response.json(
          await service.acceptInvitation(request.identityAuthentication, request.params.token),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/admin/provider-verifications',
    authenticate,
    operationContract('listProviderVerificationReviews'),
    async (request, response, next) => {
      try {
        response.json({
          reviews: await service.listVerificationReviews(
            request.identityAuthentication,
            request.query.status,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/admin/provider-verifications/:reviewId/decision',
    requireTrustedOrigin,
    authenticate,
    operationContract('decideProviderVerification'),
    async (request, response, next) => {
      try {
        response.json(
          await service.decideVerification(
            request.identityAuthentication,
            request.params.reviewId,
            request.body,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/organizations/:organizationId',
    optionalAuthenticate,
    operationContract('getOrganization'),
    async (request, response, next) => {
      try {
        response.json({
          organization: await service.getOrganization(
            request.identityAuthentication,
            request.params.organizationId,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/organizations/:organizationId',
    requireTrustedOrigin,
    authenticate,
    operationContract('updateOrganization'),
    async (request, response, next) => {
      try {
        response.json({
          organization: await service.updateOrganization(
            request.identityAuthentication,
            request.params.organizationId,
            request.body,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/organizations/:organizationId/members',
    authenticate,
    operationContract('listOrganizationMembers'),
    async (request, response, next) => {
      try {
        response.json({
          members: await service.listMemberships(
            request.identityAuthentication,
            request.params.organizationId,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/organizations/:organizationId/invitations',
    requireTrustedOrigin,
    authenticate,
    operationContract('inviteOrganizationMember'),
    async (request, response, next) => {
      try {
        response.status(201).json({
          invitation: await service.inviteMember(
            request.identityAuthentication,
            request.params.organizationId,
            request.body,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/organizations/:organizationId/members/:userId',
    requireTrustedOrigin,
    authenticate,
    operationContract('updateOrganizationMember'),
    async (request, response, next) => {
      try {
        response.json({
          membership: await service.updateMembership(
            request.identityAuthentication,
            request.params.organizationId,
            request.params.userId,
            request.body,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/organizations/:organizationId/members/:userId',
    requireTrustedOrigin,
    authenticate,
    operationContract('removeOrganizationMember'),
    async (request, response, next) => {
      try {
        await service.updateMembership(
          request.identityAuthentication,
          request.params.organizationId,
          request.params.userId,
          { status: 'revoked' },
        );
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/organizations/:organizationId/verification',
    requireTrustedOrigin,
    authenticate,
    operationContract('submitProviderVerification'),
    async (request, response, next) => {
      try {
        response
          .status(201)
          .json(
            await service.submitVerification(
              request.identityAuthentication,
              request.params.organizationId,
              request.body,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

module.exports = { createOrganizationRouter };
