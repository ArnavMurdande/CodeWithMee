'use strict';

const express = require('express');

const router = express.Router();

router.use((_request, response) => {
  response.status(410).json({
    error: {
      code: 'legacy_auth_retired',
      replacement: '/api/v1/auth',
    },
  });
});

module.exports = router;
