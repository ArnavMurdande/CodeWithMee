'use strict';

function requestHeader(request, name) {
  if (typeof request.get === 'function') return request.get(name);
  if (typeof request.header === 'function') return request.header(name);
  return request.headers?.[name.toLowerCase()];
}

function bearerToken(request) {
  const header = requestHeader(request, 'authorization');
  if (!header) return null;
  return /^Bearer ([^\s]+)$/i.exec(header)?.[1] || false;
}

function attachAuthentication(request, authentication, source) {
  request.authorization = authentication;
  request.identityAuthentication = authentication;
  request.user = Object.freeze({ id: authentication.principal.userId });
  request.authenticationSource = source;
}

function respond(response, status, code) {
  return response.status(status).json({ error: { code } });
}

function createAuthMiddleware() {
  return async function currentPrincipalAuthentication(request, response, next) {
    const bearer = bearerToken(request);
    if (bearer === false) return respond(response, 401, 'invalid_authorization_header');

    if (bearer) {
      const authenticate = request.app?.locals?.identityAuthenticate;
      if (typeof authenticate !== 'function') {
        return respond(response, 503, 'identity_unavailable');
      }
      try {
        const authentication = await authenticate(bearer);
        attachAuthentication(request, authentication, 'access_token');
        return next();
      } catch {
        return respond(response, 401, 'invalid_access_token');
      }
    }

    return respond(response, 401, 'authentication_required');
  };
}

const authMiddleware = createAuthMiddleware();

module.exports = authMiddleware;
module.exports.createAuthMiddleware = createAuthMiddleware;
