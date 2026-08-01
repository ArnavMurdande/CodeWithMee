'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const Organization = require('../models/Organization');
const OrganizationInvitation = require('../models/OrganizationInvitation');
const OrganizationMembership = require('../models/OrganizationMembership');
const ProviderVerificationReview = require('../models/ProviderVerificationReview');
const {
  createMongooseOrganizationRepository,
} = require('../modules/organizations/mongoose-repository');

test('organization compatibility schemas enforce tenant keys, role enums, and hidden secrets', () => {
  assert.equal(Organization.schema.path('organizationId').options.unique, true);
  assert.equal(Organization.schema.path('slug').options.unique, true);
  assert.deepEqual(Organization.schema.path('verificationStatus').options.enum, [
    'draft',
    'pending_review',
    'approved',
    'rejected',
    'suspended',
  ]);
  assert.deepEqual(OrganizationMembership.schema.path('role').options.enum, [
    'owner',
    'admin',
    'instructor',
    'grader',
    'analyst',
  ]);
  assert.equal(OrganizationInvitation.schema.path('tokenHash').options.select, false);
  assert.equal(OrganizationInvitation.schema.path('activeKey').options.select, false);
  assert.equal(ProviderVerificationReview.schema.path('activeKey').options.select, false);
  assert.ok(
    OrganizationMembership.schema
      .indexes()
      .some(([keys, options]) => keys.organization === 1 && keys.user === 1 && options.unique),
  );
});

test('Mongoose organization repository exposes the replaceable compatibility adapter contract', () => {
  const repository = createMongooseOrganizationRepository();
  const methods = [
    'countActiveOwners',
    'createInvitation',
    'createOrganizationWithOwner',
    'createVerificationReview',
    'decideVerificationReview',
    'consumeInvitation',
    'findInvitation',
    'findMembership',
    'findOrganizationById',
    'findOrganizationBySlug',
    'findVerificationReview',
    'listMemberships',
    'listMembershipsForUser',
    'listVerificationReviews',
    'revokeActiveInvitations',
    'updateMembership',
    'updateOrganization',
  ];
  assert.deepEqual(Object.keys(repository).sort(), methods.sort());
});
