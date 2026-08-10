'use strict';

const express = require('express');
const { CourseError } = require('./errors');

function createCourseRouter(options = {}) {
  const service = options.service;
  if (!service) throw new Error('Course service is required.');

  const customAuth = options.authMiddleware || options.authenticate;
  const providerRbac = options.providerRbac;
  const requireAuth = (req, res, next) => {
    if (customAuth) return customAuth(req, res, next);
    if (req.app?.locals?.identityAuthenticate) {
      return req.app.locals.identityAuthenticate(req, res, next);
    }
    if (!req.user || (!req.user.id && !req.user.userId)) {
      return res.status(401).json({ error: 'authentication_required' });
    }
    next();
  };
  const optionalAuth = async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match) return next();
    const authenticate = req.app?.locals?.identityAuthenticate;
    if (typeof authenticate !== 'function') return res.status(503).json({ error: { code: 'identity_unavailable' } });
    try {
      const authentication = await authenticate(match[1]);
      req.identityAuthentication = authentication;
      req.user = { id: authentication.principal.userId };
      next();
    } catch {
      res.status(401).json({ error: { code: 'invalid_access_token' } });
    }
  };

  const router = express.Router();

  const authorizeProvider = (roles) => async (req, res, next) => {
    try {
      if (!providerRbac) throw Object.assign(new Error('Provider authorization unavailable.'), { status: 503, code: 'provider_unavailable' });
      await providerRbac.authorizeAction(
        req.params.organizationId,
        req.user.id || req.user.userId,
        roles,
      );
      next();
    } catch (error) {
      res.status(error.status || 403).json({ error: { code: error.code || 'provider_permission_denied' } });
    }
  };

  router.get(
    '/provider/organizations/:organizationId/courses',
    requireAuth,
    authorizeProvider(['owner', 'admin', 'instructor', 'grader', 'analyst']),
    async (req, res, next) => {
      try {
        res.json({ courses: await service.listProviderCourses(req.params.organizationId) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/provider/organizations/:organizationId/courses',
    requireAuth,
    authorizeProvider(['owner', 'admin', 'instructor']),
    async (req, res, next) => {
      try {
        const course = await service.createCourse(req.params.organizationId, req.body || {});
        res.status(201).json(course);
      } catch (error) {
        if (error instanceof CourseError) return res.status(error.status).json({ error: { code: error.code } });
        next(error);
      }
    },
  );

  router.post(
    '/provider/organizations/:organizationId/courses/:courseId/publish',
    requireAuth,
    authorizeProvider(['owner', 'admin']),
    async (req, res, next) => {
      try {
        res.json(await service.publishCourse(req.params.organizationId, req.params.courseId));
      } catch (error) {
        if (error instanceof CourseError) return res.status(error.status).json({ error: { code: error.code } });
        next(error);
      }
    },
  );

  router.post(
    '/provider/organizations/:organizationId/courses/:courseId/retire',
    requireAuth,
    authorizeProvider(['owner', 'admin']),
    async (req, res, next) => {
      try { res.json(await service.retireCourse(req.params.organizationId, req.params.courseId)); }
      catch (error) {
        if (error instanceof CourseError) return res.status(error.status).json({ error: { code: error.code } });
        next(error);
      }
    },
  );

  router.get('/', async (req, res, next) => {
    try {
      const { category, limit, cursor } = req.query;
      const parsedLimit = limit ? Number.parseInt(limit, 10) : 20;
      const result = await service.listCourses({ category, limit: parsedLimit, cursor });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/me/enrollments', requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      res.json({ enrollments: await service.listMyEnrollments(userId) });
    } catch (error) {
      if (error instanceof CourseError) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.get('/:courseId', optionalAuth, async (req, res, next) => {
    try {
      const userId = req.user ? req.user.id || req.user.userId : null;
      const result = await service.getCourseDetails(req.params.courseId, userId);
      res.json(result);
    } catch (err) {
      if (err instanceof CourseError) {
        return res.status(err.status).json({ error: err.code });
      }
      next(err);
    }
  });

  router.post('/:courseId/enroll', requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const result = await service.enrollInCourse(userId, req.params.courseId);
      res.json(result);
    } catch (err) {
      if (err instanceof CourseError) {
        return res.status(err.status).json({ error: err.code });
      }
      next(err);
    }
  });

  router.get('/:courseId/progress', requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const result = await service.getCourseProgressOverview(userId, req.params.courseId);
      res.json(result);
    } catch (err) {
      if (err instanceof CourseError) {
        return res.status(err.status).json({ error: err.code });
      }
      next(err);
    }
  });

  router.get('/:courseId/lessons/:contentId/progress', requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const result = await service.getLessonProgress(userId, req.params.courseId, req.params.contentId);
      res.json(result);
    } catch (err) {
      if (err instanceof CourseError) {
        return res.status(err.status).json({ error: err.code });
      }
      next(err);
    }
  });

  router.patch('/:courseId/lessons/:contentId/progress', requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const { lastPositionSec, watchedIntervals, markComplete } = req.body || {};
      const result = await service.updateLessonProgress(userId, req.params.courseId, req.params.contentId, {
        lastPositionSec,
        watchedIntervals,
        markComplete,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof CourseError) {
        return res.status(err.status).json({ error: err.code });
      }
      next(err);
    }
  });

  return router;
}

function createUnavailableCoursesRouter({ reason = 'courses_not_configured' } = {}) {
  const router = express.Router();
  router.use((_req, res) => {
    res.status(503).json({ error: reason });
  });
  return router;
}

module.exports = { createCourseRouter, createUnavailableCoursesRouter };
