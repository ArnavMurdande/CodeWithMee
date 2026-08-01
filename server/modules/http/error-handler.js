'use strict';

const { isAuthorityError } = require('../authority/errors');
const { isFileError } = require('../files/errors');
const { isIdentityError } = require('../identity/errors');
const { isOrganizationError } = require('../organizations/errors');
const { isContentValidationError } = require('../content/restricted-content');
const { sendProblem } = require('./problem');
const { isContractValidationError } = require('./request-contract');

const PUBLIC_CODE_PATTERN = /^[a-z][a-z0-9_]{1,99}$/;

class PublicHttpError extends Error {
  constructor(code, status, options = {}) {
    super(code, options);
    this.code = code;
    this.name = 'PublicHttpError';
    this.status = status;
  }
}

function knownPublicError(error) {
  return (
    error instanceof PublicHttpError ||
    isAuthorityError(error) ||
    isFileError(error) ||
    isIdentityError(error) ||
    isOrganizationError(error) ||
    isContentValidationError(error) ||
    isContractValidationError(error)
  );
}

function titleForStatus(status) {
  if (status === 400) return 'Invalid request';
  if (status === 401) return 'Authentication required';
  if (status === 403) return 'Access denied';
  if (status === 404) return 'Resource not found';
  if (status === 409) return 'State conflict';
  if (status === 410) return 'Resource retired';
  if (status === 413) return 'Request too large';
  if (status === 415) return 'Unsupported media type';
  if (status === 422) return 'Request cannot be processed';
  if (status === 428) return 'Precondition required';
  if (status === 429) return 'Too many requests';
  if (status === 503) return 'Service unavailable';
  return status >= 500 ? 'Internal server error' : 'Request failed';
}

function normalizeError(error) {
  if (error?.type === 'entity.parse.failed') {
    return { code: 'invalid_json', status: 400 };
  }
  if (error?.type === 'entity.too.large') {
    return { code: 'request_body_too_large', status: 413 };
  }
  if (error?.type === 'encoding.unsupported') {
    return { code: 'unsupported_content_encoding', status: 415 };
  }
  if (
    error?.code === 'origin_not_allowed' &&
    Number.isInteger(error.status) &&
    error.status === 403
  ) {
    return { code: error.code, status: error.status };
  }
  if (
    knownPublicError(error) &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599 &&
    PUBLIC_CODE_PATTERN.test(String(error.code || ''))
  ) {
    const normalized = { code: error.code, status: error.status };
    if (isContractValidationError(error)) normalized.issues = error.issues;
    if (isFileError(error) && Number.isSafeInteger(error.details?.maxBytes)) {
      normalized.meta = { maxBytes: error.details.maxBytes };
    }
    return normalized;
  }
  return { code: 'internal_error', status: 500 };
}

function notFoundHandler(request, _response, next) {
  next(new PublicHttpError('route_not_found', 404));
}

function errorHandler({ errorReporter, logger, telemetry }) {
  return function finalErrorHandler(error, request, response, next) {
    if (response.headersSent) return next(error);
    const normalized = normalizeError(error);
    const requestId = request.requestContext?.requestId;
    const traceId = request.requestContext?.traceId;
    const log = normalized.status >= 500 ? logger.error : logger.warn;
    log('http_request_failed', {
      errorCode: normalized.code,
      errorName: error?.name || 'Error',
      method: request.method,
      requestId,
      route: request.route?.path || 'unmatched',
      status: normalized.status,
      traceId,
    });
    telemetry?.recordError?.({ code: normalized.code, status: normalized.status });
    try {
      errorReporter?.capture?.({
        code: normalized.code,
        errorName: error?.name || 'Error',
        requestId,
        route: request.route?.path || 'unmatched',
        status: normalized.status,
        traceId,
      });
    } catch {
      logger.warn('error_reporter_failed', { requestId, traceId });
    }
    const document = {
      code: normalized.code,
      instance: request.originalUrl.split('?')[0],
      issues: normalized.issues,
      requestId,
      status: normalized.status,
      title: titleForStatus(normalized.status),
    };
    if (normalized.meta) document.meta = normalized.meta;
    return sendProblem(response, document);
  };
}

module.exports = {
  PublicHttpError,
  errorHandler,
  normalizeError,
  notFoundHandler,
  titleForStatus,
};
