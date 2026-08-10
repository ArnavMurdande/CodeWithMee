'use strict';

const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');

function createLmsRouter({ service, providerRbac }) {
  if (!service || !providerRbac) throw new Error('LMS service and provider authorization are required.');
  const router = express.Router();
  const provider = (roles) => async (req, res, next) => {
    try {
      if (req.params.courseId) await providerRbac.authorizeCourseAction(req.params.organizationId, req.params.courseId, req.user.id, roles);
      else await providerRbac.authorizeAction(req.params.organizationId, req.user.id, roles);
      next();
    } catch (error) {
      res.status(error.status || 403).json({ error: { code: error.code || 'provider_permission_denied' } });
    }
  };
  const handle = (work, status = 200) => async (req, res, next) => {
    try {
      const value = await work(req);
      if (!value) return res.status(404).json({ error: { code: 'resource_not_found_or_not_permitted' } });
      res.status(status).json(value);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  };

  router.get('/provider/organizations/:organizationId/dashboard', authMiddleware, provider(['owner','admin','instructor','grader','analyst']), handle((req) => service.dashboard(req.params.organizationId)));
  router.get('/provider/organizations/:organizationId/courses/:courseId/staff', authMiddleware, provider(['owner','admin','manager']), handle((req) => service.listStaff(req.params.organizationId, req.params.courseId)));
  router.put('/provider/organizations/:organizationId/courses/:courseId/staff/:userId', authMiddleware, provider(['owner','admin','manager']), handle((req) => service.setStaffRole(req.params.organizationId, req.params.courseId, req.params.userId, req.body?.role)));
  router.get('/provider/organizations/:organizationId/courses/:courseId/structure', authMiddleware, provider(['owner','admin','instructor']), handle((req) => service.getStructure(req.params.organizationId, req.params.courseId)));
  router.put('/provider/organizations/:organizationId/courses/:courseId/structure', authMiddleware, provider(['owner','admin','instructor']), handle((req) => service.replaceStructure(req.params.organizationId, req.params.courseId, req.body?.modules, req.body?.expectedVersion)));
  router.get('/provider/organizations/:organizationId/courses/:courseId/roster', authMiddleware, provider(['owner','admin','instructor','grader','analyst']), handle((req) => service.roster(req.params.organizationId, req.params.courseId)));
  router.patch('/provider/organizations/:organizationId/courses/:courseId/enrollments/:enrollmentId', authMiddleware, provider(['owner','admin','instructor']), handle((req) => service.setEnrollmentStatus(req.params.organizationId, req.params.courseId, req.params.enrollmentId, req.body?.status)));
  router.post('/provider/organizations/:organizationId/courses/:courseId/invitations', authMiddleware, provider(['owner','admin','instructor']), handle((req) => service.createInvitation(req.params.organizationId, req.params.courseId, req.body?.email, req.user.id), 201));
  router.get('/provider/organizations/:organizationId/courses/:courseId/grading', authMiddleware, provider(['owner','admin','instructor','grader']), handle((req) => service.gradingQueue(req.params.organizationId, req.params.courseId)));
  router.get('/provider/organizations/:organizationId/courses/:courseId/quiz-grading', authMiddleware, provider(['owner','admin','instructor','grader']), handle((req) => service.quizGradingQueue(req.params.organizationId, req.params.courseId)));
  router.put('/provider/organizations/:organizationId/courses/:courseId/quiz-attempts/:attemptId/grade', authMiddleware, provider(['owner','admin','instructor','grader']), handle((req) => service.gradeQuizAttempt(req.params.organizationId, req.params.courseId, req.params.attemptId, req.user.id, req.body)));
  router.put('/provider/organizations/:organizationId/courses/:courseId/submissions/:submissionId/grade', authMiddleware, provider(['owner','admin','instructor','grader']), handle((req) => service.gradeSubmission(req.params.organizationId, req.params.courseId, req.params.submissionId, req.user.id, req.body)));
  router.get('/provider/organizations/:organizationId/payments', authMiddleware, provider(['owner','admin','payment_reviewer']), handle((req) => service.paymentQueue(req.params.organizationId)));
  router.get('/provider/organizations/:organizationId/payment-settings', authMiddleware, provider(['owner','admin','payment_reviewer']), handle((req) => service.getPaymentSettings(req.params.organizationId)));
  router.put('/provider/organizations/:organizationId/payment-settings', authMiddleware, provider(['owner','admin']), handle((req) => service.setPaymentSettings(req.params.organizationId, req.user.id, req.body)));
  router.put('/provider/organizations/:organizationId/payments/:orderId/review', authMiddleware, provider(['owner','admin','payment_reviewer']), handle((req) => service.reviewPayment(req.params.organizationId, req.params.orderId, req.user.id, req.body)));
  router.get('/provider/organizations/:organizationId/courses/:courseId/analytics', authMiddleware, provider(['owner','admin','instructor','analyst']), handle((req) => service.analytics(req.params.organizationId, req.params.courseId)));
  router.get('/provider/organizations/:organizationId/courses/:courseId/analytics.csv', authMiddleware, provider(['owner','admin','analyst']), async (req, res, next) => {
    try {
      const csv = await service.analyticsExport(req.params.organizationId, req.params.courseId, req.user.id);
      res.set('content-disposition', `attachment; filename="course-${req.params.courseId}-analytics.csv"`);
      res.type('text/csv').send(csv);
    } catch (error) { next(error); }
  });

  router.post('/invitations/:token/accept', authMiddleware, handle((req) => service.acceptInvitation(req.params.token, req.identityAuthentication.user)));
  router.post('/courses/:courseId/quizzes/:quizId/attempts', authMiddleware, handle((req) => service.submitQuiz(req.user.id, req.params.courseId, req.params.quizId, req.body?.answers), 201));
  router.post('/courses/:courseId/assignments/:assignmentId/submissions', authMiddleware, handle((req) => service.submitAssignment(req.user.id, req.params.courseId, req.params.assignmentId, req.body || {}), 201));
  router.post('/courses/:courseId/payment-orders', authMiddleware, handle((req) => service.createPaymentOrder(req.user.id, req.params.courseId), 201));
  router.put('/payment-orders/:orderId/proof', authMiddleware, handle((req) => service.attachPaymentProof(req.user.id, req.params.orderId, req.body?.fileId)));
  router.get('/courses/:courseId/results', authMiddleware, handle((req) => service.learnerResults(req.user.id, req.params.courseId)));
  return router;
}

function createUnavailableLmsRouter() {
  const router = express.Router();
  router.use((_req, res) => res.status(503).json({ error: { code: 'lms_not_configured' } }));
  return router;
}

module.exports = { createLmsRouter, createUnavailableLmsRouter };
