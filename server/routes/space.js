const express = require('express');
const router = express.Router();

function retiredSpaceRoute(_request, response) {
  response.status(410).json({
    error: {
      code: 'legacy_space_route_retired',
      replacement: '/api/v1/space',
    },
  });
}

router.get('/leaderboard', retiredSpaceRoute);
router.get('/posts', retiredSpaceRoute);
router.post('/posts', retiredSpaceRoute);
router.delete('/posts/:id', retiredSpaceRoute);
router.put('/posts/:id/:action', retiredSpaceRoute);
router.post('/posts/:id/award', retiredSpaceRoute);
router.post('/posts/:id/comment', retiredSpaceRoute);
router.post('/posts/:id/comment/:commentId/reply', retiredSpaceRoute);
router.post('/posts/:id/comment/:commentId/like', retiredSpaceRoute);
router.post('/posts/:id/comment/:commentId/dislike', retiredSpaceRoute);
router.post('/posts/:id/comment/:commentId/save', retiredSpaceRoute);
router.post('/posts/:id/comment/:commentId/award', retiredSpaceRoute);
router.delete('/posts/:id/comment/:commentId', retiredSpaceRoute);
router.get('/projects', retiredSpaceRoute);
router.get('/projects/mine', retiredSpaceRoute);
router.post('/projects', retiredSpaceRoute);
router.put('/projects/:id/milestone/:milestoneId', retiredSpaceRoute);
router.put('/projects/:id/like', retiredSpaceRoute);
router.delete('/projects/:id', retiredSpaceRoute);
router.get('/profile/me', retiredSpaceRoute);
router.get('/profile/:id', retiredSpaceRoute);
router.post('/network/follow/:id', retiredSpaceRoute);
router.post('/network/follow-request/:id/:status', retiredSpaceRoute);
router.post('/network/block/:id', retiredSpaceRoute);
router.post('/network/remove-follower/:id', retiredSpaceRoute);

module.exports = router;
