'use strict';

const { asStructuredLogger } = require('../modules/http/structured-logger');

const logger = asStructuredLogger(console, {
  environment: process.env.NODE_ENV || 'development',
});

function safeErrorCode(error) {
  const code = String(error?.code || error?.response?.status || 'internal_error');
  return /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : 'internal_error';
}

function createLegacyLogger(domain) {
  return Object.freeze({
    error(event, error) {
      logger.error('legacy_route_failed', {
        domain,
        errorCode: safeErrorCode(error),
        operation: String(event || 'unknown').slice(0, 100),
      });
    },
    info(event, fields = {}) {
      logger.info('legacy_route_event', {
        domain,
        operation: String(event || 'unknown').slice(0, 100),
        ...fields,
      });
    },
    warn(event, error) {
      logger.warn('legacy_route_degraded', {
        domain,
        errorCode: safeErrorCode(error),
        operation: String(event || 'unknown').slice(0, 100),
      });
    },
  });
}

module.exports = { createLegacyLogger, safeErrorCode };
