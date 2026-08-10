const express = require('express');
const router = express.Router();

function retiredCourseRoute(_request, response) {
  response.status(410).json({
    error: {
      code: 'legacy_course_route_retired',
      replacement: '/api/v1/courses',
    },
  });
}

function retiredProviderCourseRoute(_request, response) {
  response.status(410).json({
    error: {
      code: 'legacy_provider_course_route_retired',
      replacement: '/api/v1/organizations/:organizationId/courses',
    },
  });
}

router.get('/company/mine', retiredProviderCourseRoute);
router.get('/company/enrollments', retiredProviderCourseRoute);
router.post('/company/create', retiredProviderCourseRoute);
router.put('/company/:courseId', retiredProviderCourseRoute);
router.delete('/company/:courseId', retiredProviderCourseRoute);

router.get('/learner/enrolled', retiredCourseRoute);
router.get('/', retiredCourseRoute);
router.get('/:id', retiredCourseRoute);
router.post('/:id/enroll', retiredCourseRoute);
router.put('/:id/progress', retiredCourseRoute);

module.exports = router;
