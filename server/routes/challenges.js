const express = require('express');
const router = express.Router();

function retiredChallengeRoute(_request, response) {
  response.status(410).json({
    error: {
      code: 'legacy_challenge_route_retired',
      replacement: '/api/v1/challenges',
    },
  });
}

router.post('/', retiredChallengeRoute);
router.post('/:id/submit', retiredChallengeRoute);
router.get('/', retiredChallengeRoute);
router.get('/leaderboard', retiredChallengeRoute);
router.get('/:id', retiredChallengeRoute);
router.post('/:id/like', retiredChallengeRoute);
router.post('/:id/dislike', retiredChallengeRoute);
router.post('/:id/comments', retiredChallengeRoute);
router.post('/:id/comments/:commentId/reply', retiredChallengeRoute);
router.post('/:id/comments/:commentId/like', retiredChallengeRoute);
router.post('/:id/comments/:commentId/dislike', retiredChallengeRoute);
router.post('/:id/comments/:commentId/award', retiredChallengeRoute);
router.delete('/:id/comments/:commentId', retiredChallengeRoute);
router.delete('/:id', retiredChallengeRoute);

module.exports = router;
