'use strict';

const { evaluatePermission } = require('../modules/policies/authorize');

function recentAuthentication(request) {
  const authenticatedAt = request.authorization?.session?.authenticatedAt;
  if (!authenticatedAt) return false;
  const maximumAge = request.app?.locals?.recentAuthenticationMs || 10 * 60 * 1_000;
  const age = Date.now() - new Date(authenticatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= maximumAge;
}

function evaluateRequestPermission(request, permission, context = {}) {
  return evaluatePermission({
    context: { ...context, recentAuthentication: recentAuthentication(request) },
    permission,
    principal: request.authorization?.principal,
  });
}

function authorize(permission, loadContext = async () => ({})) {
  return async function centralizedAuthorization(request, response, next) {
    try {
      const context = await loadContext(request);
      const result = evaluateRequestPermission(request, permission, context);
      if (!result.allowed) {
        return response.status(403).json({ error: { code: result.reason } });
      }
      request.authorizationDecision = result;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { authorize, evaluateRequestPermission, recentAuthentication };
