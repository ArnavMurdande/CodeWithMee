'use strict';

const express = require('express');

const router = express.Router();

router.use((_request, response) => {
  response.status(410).json({
    error: {
      code: 'legacy_user_api_retired',
      message: 'Use the versioned identity and learning APIs.',
    },
  });
});

module.exports = router;
