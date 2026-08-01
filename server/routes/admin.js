'use strict';

const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/policyMiddleware');
const { PERMISSION } = require('../modules/policies/permissions');

const router = express.Router();

function retired(replacement) {
  return (_request, response) => {
    response.status(410).json({ error: { code: 'legacy_admin_route_retired', replacement } });
  };
}

const providerReviewPolicy = [
  authMiddleware,
  authorize(PERMISSION.ORGANIZATION_VERIFICATION_REVIEW),
];

router.get(
  '/companies/pending',
  providerReviewPolicy,
  retired('/api/v1/admin/provider-verifications?status=pending_review'),
);
router.put(
  '/companies/:id/approve',
  providerReviewPolicy,
  retired('/api/v1/admin/provider-verifications/:reviewId/decision'),
);
router.delete(
  '/companies/:id/reject',
  providerReviewPolicy,
  retired('/api/v1/admin/provider-verifications/:reviewId/decision'),
);
router.get(
  '/companies/approved',
  providerReviewPolicy,
  retired('/api/v1/admin/provider-verifications?status=approved'),
);
router.put(
  '/companies/:id/revoke',
  providerReviewPolicy,
  retired('/api/v1/admin/provider-verifications/:reviewId/decision'),
);

router.delete(
  '/users/:id',
  [authMiddleware, authorize(PERMISSION.PLATFORM_ACCOUNT_STATUS_MANAGE)],
  retired('/api/v1/admin/users/:id/status'),
);

router.put(
  '/users/:id/ban',
  [authMiddleware, authorize(PERMISSION.PLATFORM_ACCOUNT_STATUS_MANAGE)],
  retired('/api/v1/admin/users/:id/status'),
);

router.get(
  '/users',
  [authMiddleware, authorize(PERMISSION.PLATFORM_USERS_READ)],
  retired('/api/v1/admin/users'),
);

router.put(
  '/users/:id/role',
  [authMiddleware, authorize(PERMISSION.PLATFORM_ROLE_MANAGE)],
  retired('/api/v1/admin/users/:id/platform-role'),
);

module.exports = router;
