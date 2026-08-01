'use strict';

const express = require('express');

const { operationContract } = require('../api/middleware');
const { AuthorityError } = require('../authority/errors');
const { bearerToken } = require('../identity/router');
const { evaluatePermission } = require('../policies/authorize');
const { PERMISSION } = require('../policies/permissions');

function createHealthRouter({ authenticate, readinessProbe }) {
  const router = express.Router();

  router.get('/health/live', operationContract('getLiveness'), (_request, response) => {
    response.json({ status: 'ok' });
  });

  router.get('/health/ready', operationContract('getReadiness'), async (_request, response) => {
    const readiness = await readinessProbe();
    response.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ready' : 'not_ready',
    });
  });

  router.get(
    '/health/dependencies',
    operationContract('getDependencyReadiness'),
    async (request, response) => {
      if (typeof authenticate !== 'function') {
        throw new AuthorityError('authentication_required', 401);
      }
      const token = bearerToken(request);
      if (!token) throw new AuthorityError('authentication_required', 401);
      const authentication = await authenticate(token);
      const decision = evaluatePermission({
        context: {},
        permission: PERMISSION.PLATFORM_AUDIT_READ,
        principal: authentication.principal,
      });
      if (!decision.allowed) throw new AuthorityError(decision.reason, 403);
      const readiness = await readinessProbe();
      response.status(readiness.ready ? 200 : 503).json({
        checks: readiness.checks,
        status: readiness.ready ? 'ready' : 'not_ready',
      });
    },
  );

  return router;
}

module.exports = { createHealthRouter };
