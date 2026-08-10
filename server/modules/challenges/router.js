'use strict';

const express = require('express');
const { getPostgresPool } = require('../persistence/postgres-helpers');
const { createPostgresChallengeRepository } = require('./postgres-repository');
const { createChallengeService } = require('./service');
const { isChallengeError } = require('./errors');
const authMiddleware = require('../../middleware/authMiddleware');

function createChallengeRouter(options = {}) {
  const router = express.Router();
  const pool = options.pool || getPostgresPool();
  const repository = options.repository || createPostgresChallengeRepository(pool);
  const service = options.service || createChallengeService({ repository });
  const optionalAuth = async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match) return next();
    try {
      const authentication = await req.app.locals.identityAuthenticate(match[1]);
      req.identityAuthentication = authentication;
      req.user = { id: authentication.principal.userId };
      return next();
    } catch {
      return res.status(401).json({ error: { code: 'invalid_access_token' } });
    }
  };

  // GET /api/v1/challenges - Searchable catalog with difficulty/tag filters and pagination
  router.get('/', optionalAuth, async (req, res, next) => {
    try {
      const { difficulty, tag, search, limit, cursor } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

      const result = await service.listChallenges({
        difficulty: difficulty || null,
        tag: tag || null,
        search: typeof search === 'string' ? search.trim().slice(0, 120) || null : null,
        limit: parsedLimit,
        cursor: cursor || null,
        userId: req.user?.id || null,
      });

      res.json(result);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  router.get('/leaderboard', async (req, res, next) => {
    try {
      res.json(await service.getLeaderboard(parseInt(req.query.limit, 10) || 50));
    } catch (error) {
      next(error);
    }
  });

  // GET /api/v1/challenges/:challengeId - Learner challenge view (hidden test cases redacted)
  router.get('/:challengeId', optionalAuth, async (req, res, next) => {
    try {
      const dto = await service.getChallengeForLearner(req.params.challengeId, req.user?.id || null);
      res.json(dto);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  router.delete('/:challengeId', authMiddleware, async (req, res, next) => {
    try {
      await service.archiveChallenge(req.user.id, req.params.challengeId);
      res.status(204).end();
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.put('/:challengeId/bookmark', authMiddleware, async (req, res, next) => {
    try {
      res.json(await service.toggleBookmark(req.user.id, req.params.challengeId));
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.post('/:challengeId/reactions/:kind', authMiddleware, async (req, res, next) => {
    try {
      res.json(await service.reactToChallenge(req.user.id, req.params.challengeId, req.params.kind));
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.post('/:challengeId/comments', authMiddleware, async (req, res, next) => {
    try {
      const created = await service.addComment(req.user.id, req.params.challengeId, req.body?.text);
      res.status(201).json(created);
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.post('/:challengeId/comments/:commentId/reply', authMiddleware, async (req, res, next) => {
    try {
      const created = await service.addComment(req.user.id, req.params.challengeId, req.body?.text, req.params.commentId);
      res.status(201).json(created);
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.post('/:challengeId/comments/:commentId/reactions/:kind', authMiddleware, async (req, res, next) => {
    try {
      await service.reactToComment(req.user.id, req.params.challengeId, req.params.commentId, req.params.kind);
      res.status(204).end();
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.post('/:challengeId/comments/:commentId/award', authMiddleware, async (req, res, next) => {
    try {
      await service.reactToComment(req.user.id, req.params.challengeId, req.params.commentId, 'award', req.body?.awardType);
      res.status(204).end();
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.delete('/:challengeId/comments/:commentId', authMiddleware, async (req, res, next) => {
    try {
      const role = String(req.identityAuthentication?.user?.platformRole || '').toUpperCase();
      await service.removeComment(req.user.id, req.params.challengeId, req.params.commentId, ['SUPERADMIN', 'MODERATOR'].includes(role));
      res.status(204).end();
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  // POST /api/v1/challenges - Author create draft challenge
  router.post('/', authMiddleware, async (req, res, next) => {
    try {
      const authorUserId = req.user.id;
      const dto = await service.createChallenge(authorUserId, req.body);
      res.status(201).json(dto);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  // POST /api/v1/challenges/:challengeId/publish - Author publish challenge
  router.post('/:challengeId/publish', authMiddleware, async (req, res, next) => {
    try {
      const authorUserId = req.user.id;
      const dto = await service.publishChallenge(authorUserId, req.params.challengeId);
      res.json(dto);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  router.post('/:challengeId/review', authMiddleware, async (req, res, next) => {
    try {
      res.json(await service.submitForReview(req.user.id, req.params.challengeId));
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  router.post('/:challengeId/retire', authMiddleware, async (req, res, next) => {
    try {
      res.json(await service.retireChallenge(req.user.id, req.params.challengeId));
    } catch (error) {
      if (isChallengeError(error)) return res.status(error.status).json({ error: { code: error.code } });
      next(error);
    }
  });

  // POST /api/v1/challenges/:challengeId/run - Run code for learner against visible test cases
  router.post('/:challengeId/run', authMiddleware, async (req, res, next) => {
    try {
      const { language, code, customInput } = req.body || {};
      const result = await service.runCodeForLearner(req.params.challengeId, {
        language,
        code,
        customInput,
        userId: req.user.id || req.user.userId,
      });
      res.json(result);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  // POST /api/v1/challenges/:challengeId/submit - Submit code for learner against hidden test suite
  router.post('/:challengeId/submit', authMiddleware, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const { language, code } = req.body || {};
      const result = await service.submitCodeForLearner(userId, req.params.challengeId, {
        language,
        code,
      });
      res.json(result);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  // GET /api/v1/challenges/:challengeId/submissions - Submission history for learner
  router.get('/:challengeId/submissions', authMiddleware, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const { limit, cursor } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const result = await service.getSubmissionsForLearner(userId, req.params.challengeId, {
        limit: parsedLimit,
        cursor,
      });
      res.json(result);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  // GET /api/v1/challenges/:challengeId/submissions/:submissionId - Submission detail for learner
  router.get('/:challengeId/submissions/:submissionId', authMiddleware, async (req, res, next) => {
    try {
      const userId = req.user.id || req.user.userId;
      const result = await service.getSubmissionById(userId, req.params.submissionId);
      res.json(result);
    } catch (error) {
      if (isChallengeError(error)) {
        return res.status(error.status).json({ error: { code: error.code } });
      }
      next(error);
    }
  });

  return router;
}

function createUnavailableChallengeRouter({ reason = 'challenges_not_configured' } = {}) {
  const router = express.Router();
  router.use((_req, res) => {
    res.status(503).json({ error: reason });
  });
  return router;
}

module.exports = { createChallengeRouter, createUnavailableChallengeRouter };
