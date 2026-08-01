'use strict';

const API_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
].join('; ');

function securityHeaders({ nodeEnv = 'development' } = {}) {
  return function securityHeadersMiddleware(request, response, next) {
    response.removeHeader('x-powered-by');
    response.set({
      'cache-control': 'no-store',
      'content-security-policy': API_CSP,
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy':
        request.path.startsWith('/api/') || request.path.startsWith('/uploads')
          ? 'cross-origin'
          : 'same-origin',
      'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-dns-prefetch-control': 'off',
      'x-frame-options': 'DENY',
      'x-permitted-cross-domain-policies': 'none',
    });
    if (nodeEnv === 'production') {
      response.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

module.exports = { API_CSP, securityHeaders };
