'use strict';

function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

function createProviderRbac({ pool }) {
  if (!pool) throw new Error('Database pool is required for provider RBAC.');

  async function getMemberRole(organizationId, userId) {
    if (!isUuid(organizationId) || !isUuid(userId)) return null;

    const res = await pool.query(
      `SELECT role, status
       FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    if (String(row.status).toLowerCase() !== 'active') {
      return null;
    }

    return String(row.role).toLowerCase();
  }

  async function authorizeAction(organizationId, userId, allowedRoles = []) {
    const role = await getMemberRole(organizationId, userId);
    if (!role) {
      const err = new Error('User is not an active member of this organization.');
      err.code = 'provider_permission_denied';
      err.status = 403;
      throw err;
    }

    const normalizedAllowedRoles = allowedRoles.map((value) => String(value).toLowerCase());
    if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(role)) {
      const err = new Error('Insufficient organization membership role.');
      err.code = 'provider_permission_denied';
      err.status = 403;
      throw err;
    }

    return role;
  }

  async function authorizeCourseAction(organizationId, courseId, userId, allowedRoles = []) {
    if (!isUuid(organizationId) || !isUuid(courseId) || !isUuid(userId)) {
      throw Object.assign(new Error('Invalid provider resource identifier.'), { code: 'provider_permission_denied', status: 403 });
    }
    const organizationRole = await getMemberRole(organizationId, userId);
    if (!organizationRole) {
      const error = Object.assign(new Error('User is not an active organization member.'), { code: 'provider_permission_denied', status: 403 });
      throw error;
    }
    const normalized = allowedRoles.map((role) => String(role).toLowerCase());
    if (normalized.includes(organizationRole) || ['owner', 'admin'].includes(organizationRole)) return organizationRole;
    const result = await pool.query(
      `SELECT csa.role FROM course_staff_assignments csa JOIN courses c ON c.id=csa.course_id
       WHERE csa.course_id=$1 AND csa.user_id=$2 AND c.organization_id=$3`,
      [courseId, userId, organizationId],
    );
    const courseRole = result.rows[0]?.role;
    if (courseRole && normalized.includes(courseRole)) return courseRole;
    throw Object.assign(new Error('Insufficient course role.'), { code: 'provider_permission_denied', status: 403 });
  }

  return {
    getMemberRole,
    authorizeAction,
    authorizeCourseAction,
  };
}

module.exports = { createProviderRbac, isUuid };
