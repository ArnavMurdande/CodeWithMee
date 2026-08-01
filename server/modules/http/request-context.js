'use strict';

const { randomUUID } = require('node:crypto');
const { traceContext } = require('../observability/telemetry');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/;

function requestContext({
  clock = () => process.hrtime.bigint(),
  idFactory = randomUUID,
  logger,
  telemetry,
  traceFactory = traceContext,
}) {
  return function requestContextMiddleware(request, response, next) {
    const supplied = request.get('x-request-id');
    const requestId =
      typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied) ? supplied : idFactory();
    const trace = traceFactory(request.get('traceparent'));
    const startedAt = clock();
    request.requestContext = Object.freeze({ requestId, startedAt, ...trace });
    response.set('x-request-id', requestId);
    response.set('traceparent', trace.traceparent);
    response.once('finish', () => {
      const elapsed = Number(clock() - startedAt) / 1_000_000;
      logger.info('http_request_completed', {
        durationMs: Number(elapsed.toFixed(3)),
        method: request.method,
        requestId,
        route: request.route?.path || 'unmatched',
        spanId: trace.spanId,
        status: response.statusCode,
        traceId: trace.traceId,
      });
      telemetry?.recordRequest?.({
        durationMs: Number(elapsed.toFixed(3)),
        method: request.method,
        status: response.statusCode,
      });
    });
    next();
  };
}

module.exports = { REQUEST_ID_PATTERN, requestContext };
