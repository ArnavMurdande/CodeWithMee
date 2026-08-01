'use strict';

const { PublicHttpError } = require('./error-handler');

function browserRequestDefense({ trustedOrigins = [] } = {}) {
  const allowlist = new Set(trustedOrigins);
  return function browserRequestDefenseMiddleware(request, _response, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const fetchSite = request.get('sec-fetch-site');
    const origin = request.get('origin');
    if (fetchSite === 'cross-site' && !allowlist.has(origin)) {
      return next(new PublicHttpError('cross_site_request_blocked', 403));
    }
    if (origin && !allowlist.has(origin)) {
      return next(new PublicHttpError('origin_not_allowed', 403));
    }
    return next();
  };
}

module.exports = { browserRequestDefense };
