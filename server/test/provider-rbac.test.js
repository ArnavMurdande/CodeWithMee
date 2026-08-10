'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createProviderRbac } = require('../modules/provider/rbac');

function createMockPool() {
  const memberships = new Map();

  return {
    async query(sql, params) {
      const norm = sql.trim().replace(/\s+/g, ' ');

      if (norm.includes('FROM organization_memberships')) {
        const key = `${params[0]}:${params[1]}`;
        const row = memberships.get(key);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    },
    addMembership(orgId, userId, role, status = 'active') {
      memberships.set(`${orgId}:${userId}`, {
        organization_id: orgId,
        user_id: userId,
        role,
        status,
      });
    },
  };
}

test('P2A-S1: provider RBAC authorizes ACTIVE members with required roles and rejects SUSPENDED/REVOKED or non-members', async () => {
  const mockPool = createMockPool();
  const orgId = '00000000-0000-4000-8000-000000000001';
  const ownerId = '00000000-0000-4000-8000-000000000002';
  const instructorId = '00000000-0000-4000-8000-000000000003';
  const suspendedId = '00000000-0000-4000-8000-000000000004';
  const revokedId = '00000000-0000-4000-8000-000000000005';
  const outsiderId = '00000000-0000-4000-8000-000000000006';

  mockPool.addMembership(orgId, ownerId, 'owner', 'active');
  mockPool.addMembership(orgId, instructorId, 'instructor', 'active');
  mockPool.addMembership(orgId, suspendedId, 'instructor', 'suspended');
  mockPool.addMembership(orgId, revokedId, 'owner', 'revoked');

  const rbac = createProviderRbac({ pool: mockPool });

  // OWNER is authorized
  const role1 = await rbac.authorizeAction(orgId, ownerId, ['OWNER', 'ADMIN', 'INSTRUCTOR']);
  assert.equal(role1, 'owner');

  // INSTRUCTOR is authorized
  const role2 = await rbac.authorizeAction(orgId, instructorId, ['OWNER', 'ADMIN', 'INSTRUCTOR']);
  assert.equal(role2, 'instructor');

  // SUSPENDED membership is rejected
  await assert.rejects(
    rbac.authorizeAction(orgId, suspendedId, ['OWNER', 'ADMIN', 'INSTRUCTOR']),
    (err) => err.status === 403 && err.code === 'provider_permission_denied'
  );

  // REVOKED membership is rejected
  await assert.rejects(
    rbac.authorizeAction(orgId, revokedId, ['OWNER', 'ADMIN', 'INSTRUCTOR']),
    (err) => err.status === 403 && err.code === 'provider_permission_denied'
  );

  // Outsider is rejected
  await assert.rejects(
    rbac.authorizeAction(orgId, outsiderId, ['OWNER', 'ADMIN', 'INSTRUCTOR']),
    (err) => err.status === 403 && err.code === 'provider_permission_denied'
  );
});
