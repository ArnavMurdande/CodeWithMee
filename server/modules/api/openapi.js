'use strict';

const express = require('express');

const { operationContract } = require('./middleware');
const { schemas } = require('./contracts');
const { operations } = require('./operations');

function responseContent(schema) {
  return schema
    ? {
        content: { 'application/json': { schema } },
        description: 'Successful response.',
      }
    : { description: 'Successful response with no representation.' };
}

function parametersFor(operation) {
  const parameters = [];
  for (const [name, schema] of Object.entries(operation.request.params?.properties || {})) {
    parameters.push({ in: 'path', name, required: true, schema });
  }
  for (const [name, schema] of Object.entries(operation.request.query?.properties || {})) {
    parameters.push({ in: 'query', name, required: false, schema });
  }
  for (const [name, schema] of Object.entries(operation.request.headers?.properties || {})) {
    parameters.push({ in: 'header', name, required: false, schema });
  }
  return parameters;
}

function operationDocument(operation) {
  const document = {
    operationId: operation.id,
    responses: {
      [operation.status]: responseContent(operation.response),
      default: {
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
        description: 'A stable problem-details response.',
      },
    },
    security: operation.security,
    summary: operation.summary,
    tags: operation.tags,
    'x-codewithmee-contract': operation.id,
  };
  if (['getReadiness', 'getDependencyReadiness'].includes(operation.id)) {
    document.responses[503] = responseContent(operation.response);
  }
  const parameters = parametersFor(operation);
  if (parameters.length) document.parameters = parameters;
  if (operation.acceptsBody) {
    document.requestBody = {
      content: { 'application/json': { schema: operation.request.body } },
      required: true,
    };
  }
  return document;
}

function createOpenApiDocument() {
  const paths = {};
  for (const operation of operations) {
    paths[operation.path] ||= {};
    if (paths[operation.path][operation.method]) {
      throw new Error(`Duplicate OpenAPI route: ${operation.method} ${operation.path}`);
    }
    paths[operation.path][operation.method] = operationDocument(operation);
  }
  return Object.freeze({
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { bearerFormat: 'JWT', scheme: 'bearer', type: 'http' },
        csrfHeader: { in: 'header', name: 'X-CSRF-Token', type: 'apiKey' },
        refreshCookie: { in: 'cookie', name: 'cwm_refresh', type: 'apiKey' },
      },
    },
    info: {
      description:
        'Implemented CodeWithMee v1 operations. Unknown request fields are rejected. Future roadmap operations are intentionally omitted until deployed.',
      title: 'CodeWithMee API',
      version: '1.0.0',
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    openapi: '3.1.1',
    paths,
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'Identity' },
      { name: 'Organizations' },
      { name: 'Administration' },
      { name: 'Files' },
      { name: 'Operations' },
    ],
  });
}

const openApiDocument = createOpenApiDocument();

function createApiContractRouter() {
  const router = express.Router();
  router.get('/openapi.json', operationContract('getOpenApiDocument'), (_request, response) => {
    response.set('cache-control', 'public, max-age=300');
    response.json(openApiDocument);
  });
  return router;
}

module.exports = { createApiContractRouter, createOpenApiDocument, openApiDocument };
