'use strict';

function requireLocalUploadCompatibility(request, response, next) {
  if (request.app.locals.localUploadServing === true) return next();
  return response.status(410).json({
    error: {
      code: 'legacy_local_upload_retired',
      replacement: '/api/v1/files/upload-intents',
    },
  });
}

module.exports = requireLocalUploadCompatibility;
