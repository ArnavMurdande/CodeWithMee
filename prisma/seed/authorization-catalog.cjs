'use strict';

const { PLATFORM_ROLE } = require('../../server/modules/identity/contracts');
const {
  COURSE_STAFF_ROLE,
  ORGANIZATION_ROLE,
} = require('../../server/modules/organizations/contracts');
const {
  BASE_AUTHENTICATED_PERMISSIONS,
  COURSE_STAFF_ROLE_PERMISSIONS,
  KNOWN_PERMISSIONS,
  ORGANIZATION_ROLE_PERMISSIONS,
  PLATFORM_ROLE_PERMISSIONS,
} = require('../../server/modules/policies/permissions');

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function permissionScope(key) {
  if (key.startsWith('courses:')) return 'course';
  if (key.startsWith('organizations:')) return 'organization';
  return 'platform';
}

function permissionDescription(key) {
  return `Allows the ${key.replaceAll(':', ' ')} operation.`;
}

const roles = Object.freeze([
  ...Object.values(PLATFORM_ROLE).map((role) => ({
    description: `Built-in ${role} platform role.`,
    key: `platform:${role}`,
    scope: 'platform',
  })),
  ...Object.values(ORGANIZATION_ROLE).map((role) => ({
    description: `Built-in ${role} organization role.`,
    key: `organization:${role}`,
    scope: 'organization',
  })),
  ...Object.values(COURSE_STAFF_ROLE).map((role) => ({
    description: `Built-in ${role} course-staff role.`,
    key: `course:${role}`,
    scope: 'course',
  })),
]);

const grants = Object.freeze({
  ...Object.fromEntries(
    Object.values(PLATFORM_ROLE).map((role) => [
      `platform:${role}`,
      uniqueSorted([...BASE_AUTHENTICATED_PERMISSIONS, ...(PLATFORM_ROLE_PERMISSIONS[role] || [])]),
    ]),
  ),
  ...Object.fromEntries(
    Object.values(ORGANIZATION_ROLE).map((role) => [
      `organization:${role}`,
      uniqueSorted(ORGANIZATION_ROLE_PERMISSIONS[role] || []),
    ]),
  ),
  ...Object.fromEntries(
    Object.values(COURSE_STAFF_ROLE).map((role) => [
      `course:${role}`,
      uniqueSorted(COURSE_STAFF_ROLE_PERMISSIONS[role] || []),
    ]),
  ),
});

const permissions = Object.freeze(
  uniqueSorted(KNOWN_PERMISSIONS).map((key) => ({
    description: permissionDescription(key),
    key,
    scope: permissionScope(key),
  })),
);

function buildAuthorizationCatalog() {
  return {
    grants: Object.fromEntries(Object.entries(grants).map(([key, values]) => [key, [...values]])),
    permissions: permissions.map((permission) => ({ ...permission })),
    roles: roles.map((role) => ({ ...role })),
  };
}

module.exports = { buildAuthorizationCatalog };
