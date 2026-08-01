'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const mongoose = require('mongoose');

const AuthorityAuditEvent = require('../models/AuthorityAuditEvent');
const AuthorityControl = require('../models/AuthorityControl');
const User = require('../models/User');
const { createMongooseAuthorityRepository } = require('../modules/authority/mongoose-repository');

test('authority compatibility schemas expose revision locks and append-only redacted audit fields', () => {
  assert.equal(mongoose.connection.readyState, 0);
  assert.equal(User.schema.path('authorityRevision').options.default, 1);
  assert.equal(AuthorityAuditEvent.schema.path('eventId').options.unique, true);
  assert.equal(AuthorityAuditEvent.schema.path('operationKey').options.select, false);
  assert.equal(AuthorityAuditEvent.schema.path('operationKey').options.unique, true);
  assert.equal(AuthorityControl.schema.path('controlKey').options.unique, true);
  assert.equal(AuthorityAuditEvent.schema.path('beforeState').schema.options.strict, 'throw');
  assert.equal(AuthorityAuditEvent.schema.path('afterState').schema.options.strict, 'throw');
  assert.equal(AuthorityAuditEvent.schema.path('email'), undefined);
  assert.equal(AuthorityAuditEvent.schema.path('token'), undefined);
});

test('Mongoose authority repository exposes only invariant-safe workflows and fails closed without transactions', async () => {
  const repository = createMongooseAuthorityRepository();
  assert.deepEqual(Object.keys(repository).sort(), [
    'bootstrapSuperadmin',
    'changeAccountStatus',
    'changePlatformRole',
    'findOrganizationContext',
    'listAuditEvents',
    'listUsers',
    'transferOrganizationOwnership',
  ]);
  await assert.rejects(
    repository.bootstrapSuperadmin({ email: 'user@example.test', event: {} }),
    (error) => error.code === 'authority_transaction_unavailable',
  );
});
