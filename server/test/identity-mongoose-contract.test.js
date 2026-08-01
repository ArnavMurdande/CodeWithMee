'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const mongoose = require('mongoose');

const AuthIdentity = require('../models/AuthIdentity');
const AuthSession = require('../models/AuthSession');
const IdentityOneTimeToken = require('../models/IdentityOneTimeToken');
const User = require('../models/User');
const {
  createMongooseIdentityRepository,
  userRecord,
} = require('../modules/identity/mongoose-repository');

function hasUniqueIndex(model, keys) {
  return model.schema.indexes().some(([fields, options]) => {
    return options.unique === true && JSON.stringify(fields) === JSON.stringify(keys);
  });
}

test('compatibility identity schemas keep credentials hashed/hidden and enforce unique identities', () => {
  assert.equal(mongoose.connection.readyState, 0);
  assert.equal(AuthIdentity.schema.path('passwordHash').options.select, false);
  assert.equal(AuthSession.schema.path('currentTokenHash').options.select, false);
  assert.equal(AuthSession.schema.path('csrfTokenHash').options.select, false);
  assert.equal(AuthSession.schema.path('consumedTokenHashes').options.select, false);
  assert.equal(IdentityOneTimeToken.schema.path('tokenHash').options.select, false);
  assert.ok(hasUniqueIndex(AuthIdentity, { provider: 1, providerSubject: 1 }));
  assert.ok(hasUniqueIndex(AuthIdentity, { provider: 1, user: 1 }));
  assert.equal(mongoose.connection.readyState, 0);
});

test('identity schema rejects placeholder passwords on Google identities and missing local hashes', async () => {
  const userId = new mongoose.Types.ObjectId();
  await assert.rejects(
    new AuthIdentity({
      passwordHash: null,
      provider: 'local',
      providerSubject: 'local@example.test',
      user: userId,
    }).validate(),
    /require a password hash/,
  );
  await assert.rejects(
    new AuthIdentity({
      passwordHash: 'placeholder-secret',
      provider: 'google',
      providerSubject: 'google-subject',
      user: userId,
    }).validate(),
    /must not contain a password hash/,
  );
});

test('unified users can exist without placeholder passwords and have explicit current status/role fields', () => {
  assert.equal(User.schema.path('password').options.required, false);
  assert.equal(User.schema.path('username').options.required, false);
  assert.deepEqual([...User.schema.path('status').options.enum].sort(), [
    'active',
    'banned',
    'deletion_pending',
    'suspended',
  ]);
  assert.deepEqual([...User.schema.path('platformRole').options.enum].sort(), [
    'learner',
    'moderator',
    'superadmin',
    'support',
  ]);
});

test('legacy ban state overrides a default-looking compatibility status', () => {
  const record = userRecord({
    _id: new mongoose.Types.ObjectId(),
    createdAt: new Date(),
    email: 'banned@example.test',
    isBanned: true,
    platformRole: 'learner',
    status: 'active',
  });
  assert.equal(record.status, 'banned');
});

test('Mongoose repository exposes the complete replaceable Phase 0C adapter contract', () => {
  const repository = createMongooseIdentityRepository();
  for (const method of [
    'createUserWithIdentity',
    'findUserByEmail',
    'findUserById',
    'findIdentity',
    'findIdentityForUser',
    'findLegacyLocalIdentityByEmail',
    'linkIdentity',
    'updateIdentityPassword',
    'markEmailVerified',
    'updateUserStatus',
    'createSession',
    'findSession',
    'rotateSession',
    'revokeSession',
    'revokeAllSessions',
    'listSessionsForUser',
    'createOneTimeToken',
    'invalidateOneTimeTokens',
    'consumeOneTimeToken',
  ]) {
    assert.equal(typeof repository[method], 'function', method);
  }
  assert.equal(mongoose.connection.readyState, 0);
});
