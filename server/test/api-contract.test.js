'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { createApp } = require('../app');
const { requestSchemas, schemas } = require('../modules/api/contracts');
const { openApiDocument } = require('../modules/api/openapi');
const { operations } = require('../modules/api/operations');
const {
  decodeCursor,
  encodeCursor,
  parseIdempotencyKey,
  parseRevisionEtag,
  revisionEtag,
} = require('../modules/http/conventions');
const { problemDetails } = require('../modules/http/problem');
const { assertSchema, validateSchema } = require('../modules/http/schema-validator');

function visitSchemas(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitSchemas(item, visitor));
    return;
  }
  if (!value || typeof value !== 'object') return;
  visitor(value);
  Object.values(value).forEach((item) => visitSchemas(item, visitor));
}

test('OpenAPI 3.1 publishes every and only implemented v1 operation with resolvable schemas', () => {
  assert.equal(openApiDocument.openapi, '3.1.1');
  assert.equal(openApiDocument.jsonSchemaDialect, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(operations.length, 82);

  const published = [];
  for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      published.push(`${method} ${path} ${operation.operationId}`);
      assert.equal(operation['x-codewithmee-contract'], operation.operationId);
      assert.ok(operation.responses.default.content['application/problem+json']);
    }
  }
  assert.equal(published.length, operations.length);
  assert.equal(new Set(published).size, published.length);

  visitSchemas(openApiDocument, (schema) => {
    if (schema.$ref) {
      const prefix = '#/components/schemas/';
      assert.ok(schema.$ref.startsWith(prefix));
      assert.ok(schemas[schema.$ref.slice(prefix.length)]);
    }
  });
  assert.equal(JSON.stringify(openApiDocument).includes('passwordHash'), false);
  assert.equal(JSON.stringify(openApiDocument).includes('tokenHash'), false);
  assert.equal(JSON.stringify(openApiDocument).includes('storageKey'), false);
});

test('strict transport schemas reject unknown, missing, ambiguous, and mistyped request fields', () => {
  const valid = {
    displayName: 'Ada Lovelace',
    email: 'ada@example.test',
    password: 'correct horse battery staple',
  };
  assert.equal(validateSchema(valid, requestSchemas.identityRegister.body).valid, true);

  for (const invalid of [
    { ...valid, platformRole: 'superadmin' },
    { ...valid, password: 123456789012 },
    { displayName: valid.displayName, password: valid.password },
  ]) {
    const result = validateSchema(invalid, requestSchemas.identityRegister.body);
    assert.equal(result.valid, false);
    assert.equal(JSON.stringify(result.issues).includes(valid.password), false);
  }

  const nestedSchema = {
    additionalProperties: false,
    properties: {
      item: {
        additionalProperties: false,
        properties: { label: { minLength: 1, type: 'string' } },
        required: ['label'],
        type: 'object',
      },
    },
    required: ['item'],
    type: 'object',
  };
  assert.throws(
    () => assertSchema({ item: { label: 'safe', secret: 'do-not-reflect' } }, nestedSchema),
    (error) =>
      error.code === 'invalid_request' &&
      error.issues[0].pointer === '/item/secret' &&
      !JSON.stringify(error.issues).includes('do-not-reflect'),
  );
});

test('cursor, revision, idempotency, and problem-details conventions fail closed', () => {
  const secret = Buffer.alloc(32, 7);
  const cursor = encodeCursor({ id: 'row-17', sort: '2026-08-01T00:00:00.000Z' }, secret);
  assert.deepEqual(decodeCursor(cursor, secret), {
    id: 'row-17',
    sort: '2026-08-01T00:00:00.000Z',
    v: 1,
  });
  assert.equal(decodeCursor(`${cursor}x`, secret), null);
  assert.equal(decodeCursor(cursor, Buffer.alloc(32, 8)), null);
  assert.throws(() => encodeCursor({ id: 'row', sort: 'time' }, Buffer.alloc(16)), /32 bytes/);

  assert.equal(revisionEtag(17), '"rev-17"');
  assert.equal(parseRevisionEtag('"rev-17"'), 17);
  assert.equal(parseRevisionEtag(null, { required: false }), null);
  assert.throws(
    () => parseRevisionEtag('17'),
    (error) => error.status === 428,
  );
  assert.equal(parseIdempotencyKey('request_20260801-0001'), 'request_20260801-0001');
  assert.throws(
    () => parseIdempotencyKey('short'),
    (error) => error.status === 400,
  );

  const problem = problemDetails({
    code: 'invalid_request',
    issues: [{ code: 'required', pointer: '/email', sensitive: 'not included' }],
    status: 400,
    title: 'Invalid request',
  });
  assert.deepEqual(problem.errors, [{ code: 'required', pointer: '/email' }]);
  assert.equal(validateSchema(problem, schemas.Problem, { components: { schemas } }).valid, true);
});

test('the versioned OpenAPI document is available even when identity is unavailable', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/openapi.json`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    const document = await response.json();
    assert.equal(document.openapi, '3.1.1');
    assert.equal(document.paths['/auth/register'].post.operationId, 'register');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
