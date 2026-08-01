'use strict';

const express = require('express');

const { operationContract } = require('../api/middleware');
const { createIdentityHttpGuards } = require('../identity/router');
const { FileError } = require('./errors');

function createFileRouter({ config, identityService, service }) {
  const router = express.Router();
  const { authenticate, requireTrustedOrigin } = createIdentityHttpGuards({
    config,
    service: identityService,
  });

  router.post(
    '/files/upload-intents',
    requireTrustedOrigin,
    authenticate,
    operationContract('createFileUploadIntent'),
    async (request, response, next) => {
      try {
        const result = await service.createUploadIntent(
          request.identityAuthentication,
          request.body,
        );
        response.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/files/:fileId',
    authenticate,
    operationContract('getFileMetadata'),
    async (request, response, next) => {
      try {
        response.json({
          file: await service.getMetadata(request.identityAuthentication, request.params.fileId),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/files/:fileId/complete',
    requireTrustedOrigin,
    authenticate,
    operationContract('completeFileUpload'),
    async (request, response, next) => {
      try {
        response.json({
          file: await service.completeUpload(request.identityAuthentication, request.params.fileId),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/files/:fileId/download',
    requireTrustedOrigin,
    authenticate,
    operationContract('createFileDownload'),
    async (request, response, next) => {
      try {
        response.json({
          download: await service.createDownload(
            request.identityAuthentication,
            request.params.fileId,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/files/:fileId/visibility',
    requireTrustedOrigin,
    authenticate,
    operationContract('setFileVisibility'),
    async (request, response, next) => {
      try {
        response.json({
          file: await service.setVisibility(
            request.identityAuthentication,
            request.params.fileId,
            request.body?.visibility,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/files/:fileId',
    requireTrustedOrigin,
    authenticate,
    operationContract('deleteFile'),
    async (request, response, next) => {
      try {
        await service.deleteFile(request.identityAuthentication, request.params.fileId);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

function createUnavailableFileRouter({ reason = 'file_storage_not_configured' } = {}) {
  const router = express.Router();
  router.use('/files', (_request, _response, next) => {
    next(new FileError(reason, 503));
  });
  return router;
}

module.exports = { createFileRouter, createUnavailableFileRouter };
