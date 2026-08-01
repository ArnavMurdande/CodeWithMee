'use strict';

const { assertSchema, ContractValidationError, isPlainObject } = require('./schema-validator');

const EMPTY_OBJECT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {},
  type: 'object',
});

function normalizedBody(body) {
  return body == null ? {} : body;
}

function selectedHeaders(request, schema) {
  return Object.fromEntries(
    Object.keys(schema?.properties || {}).flatMap((name) => {
      const value = request.get(name);
      return value == null ? [] : [[name.toLowerCase(), value]];
    }),
  );
}

function validateRequest(contract, { components } = {}) {
  const resolved = Object.freeze({
    body: contract.body === false ? EMPTY_OBJECT_SCHEMA : contract.body,
    headers: contract.headers,
    params: contract.params,
    query: contract.query,
  });
  return function requestContractMiddleware(request, _response, next) {
    try {
      const validated = {};
      if (resolved.body) {
        validated.body = normalizedBody(request.body);
        assertSchema(validated.body, resolved.body, { components, location: 'body' });
      }
      if (resolved.params) {
        validated.params = request.params;
        assertSchema(validated.params, resolved.params, { components, location: 'params' });
      }
      if (resolved.query) {
        validated.query = request.query;
        assertSchema(validated.query, resolved.query, { components, location: 'query' });
      }
      if (resolved.headers) {
        validated.headers = selectedHeaders(request, resolved.headers);
        assertSchema(validated.headers, resolved.headers, { components, location: 'headers' });
      }
      request.contract = Object.freeze(validated);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function isContractValidationError(error) {
  return error instanceof ContractValidationError;
}

function assertContractDefinition(contract) {
  if (!isPlainObject(contract)) throw new Error('Request contract must be a plain object.');
  for (const location of ['body', 'headers', 'params', 'query']) {
    if (
      contract[location] !== undefined &&
      contract[location] !== false &&
      !isPlainObject(contract[location])
    ) {
      throw new Error(`Request contract ${location} must be a schema object.`);
    }
  }
  return contract;
}

module.exports = {
  EMPTY_OBJECT_SCHEMA,
  assertContractDefinition,
  isContractValidationError,
  validateRequest,
};
