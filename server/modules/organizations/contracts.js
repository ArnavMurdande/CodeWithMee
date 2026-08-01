'use strict';

function freezeValues(values) {
  return Object.freeze({ ...values });
}

const ORGANIZATION_VERIFICATION_STATUS = freezeValues({
  APPROVED: 'approved',
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended',
});

const ORGANIZATION_MEMBERSHIP_STATUS = freezeValues({
  ACTIVE: 'active',
  REVOKED: 'revoked',
  SUSPENDED: 'suspended',
});

const ORGANIZATION_ROLE = freezeValues({
  ADMIN: 'admin',
  ANALYST: 'analyst',
  GRADER: 'grader',
  INSTRUCTOR: 'instructor',
  OWNER: 'owner',
});

const COURSE_STAFF_ROLE = freezeValues({
  ANALYST: 'analyst',
  GRADER: 'grader',
  INSTRUCTOR: 'instructor',
  MANAGER: 'manager',
  PAYMENT_REVIEWER: 'payment_reviewer',
});

const COURSE_STAFF_STATUS = freezeValues({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

module.exports = {
  COURSE_STAFF_ROLE,
  COURSE_STAFF_STATUS,
  ORGANIZATION_MEMBERSHIP_STATUS,
  ORGANIZATION_ROLE,
  ORGANIZATION_VERIFICATION_STATUS,
};
