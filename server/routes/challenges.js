const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getRuntimeConfig } = require('../config/runtime');
const authMiddleware = require('../middleware/authMiddleware');
const { evaluateRequestPermission } = require('../middleware/policyMiddleware');
const Challenge = require('../models/Challenge');
const User = require('../models/User');
const { PERMISSION } = require('../modules/policies/permissions');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { createLegacyLogger } = require('../utils/legacyLogger');

const legacyLogger = createLegacyLogger('challenges');

// --- Language Mapping: Frontend value → Piston language identifier ---
const LANGUAGE_MAP = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'c++',
  c: 'c',
  rust: 'rust',
  ruby: 'ruby',
  sqlite: 'sqlite3',
  go: 'go',
  php: 'php',
  kotlin: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  perl: 'perl',
  r: 'rscript',
  elixir: 'elixir',
  cobol: 'cobol',
  nasm: 'nasm',
  powershell: 'pwsh',
  bash: 'bash',
};

// --- Security: Block dangerous commands in shell languages ---
const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+(-\w+\s+)*\//i,
  /\brm\s+-rf?\s/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bmkfs\b/i,
  /\bdd\b.*\bof=/i,
  /\b(shutdown|reboot|halt|init)\b/i,
  /\bkill(all)?\s/i,
  /\benv\b/i,
  /\bexport\b/i,
  /\/etc\/(passwd|shadow|hosts)/i,
  /\/proc\//i,
  /\bsudo\b/i,
  /\bsu\b\s/i,
  /\bsystemctl\b/i,
  /\bapt(-get)?\b/i,
  /\byum\b/i,
  /\bdnf\b/i,
  /\bmount\b/i,
  /\bumount\b/i,
];

function isShellLanguage(lang) {
  return lang === 'bash' || lang === 'powershell';
}
function containsDangerousCommands(code) {
  return BLOCKED_SHELL_PATTERNS.some((p) => p.test(code));
}

// @route   POST api/challenges
// @desc    Create a new challenge
// @access  Private
router.post(
  '/',
  [
    authMiddleware,
    body('title', 'Title is required').not().isEmpty().trim().escape(),
    body('description', 'Description is required').not().isEmpty().trim().escape(),
    body('difficulty', 'Difficulty must be Easy, Medium, or Hard').isIn(['Easy', 'Medium', 'Hard']),
    body('score', 'Score must be a number between 1 and 10').isInt({ min: 1, max: 10 }),
    body('solution', 'Solution code is required').not().isEmpty(),
    body('solutionLanguage', 'Solution language is required').not().isEmpty(),
    body('testCases', 'At least one test case is required').isArray({ min: 1 }),
    // --- THIS IS THE FIX ---
    body('testCases.*.input', 'Test case input is required').not().isEmpty().trim(),
    body('testCases.*.output', 'Test case output is required').not().isEmpty().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Ban check
      const creator = await User.findById(req.user.id);
      if (creator?.isBanned)
        return res
          .status(403)
          .json({ msg: 'Your account is banned. You cannot create challenges.' });

      const {
        title,
        description,
        constraints,
        difficulty,
        score,
        tags,
        solution,
        solutionLanguage,
        testCases,
      } = req.body;

      const newChallenge = new Challenge({
        title,
        description,
        constraints,
        difficulty,
        score,
        tags: Array.isArray(tags)
          ? tags.filter((t) => t && t.trim() !== '')
          : typeof tags === 'string'
            ? tags
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t)
            : [],
        solution,
        solutionLanguage,
        testCases,
        author: req.user.id,
      });
      const challenge = await newChallenge.save();
      res.status(201).json(challenge);
    } catch (err) {
      legacyLogger.error('challenge_create_failed', err);
      if (err.code === 11000) {
        return res.status(400).json({ message: 'A challenge with this title already exists.' });
      }
      res.status(500).json({ message: 'Server error while creating challenge.' });
    }
  },
);

// @route   POST api/challenges/:id/submit
// @desc    Run or submit code for a challenge using self-hosted Piston API
// @access  Private
router.post('/:id/submit', authMiddleware, async (req, res) => {
  const { code, language, runOnly } = req.body;
  const { pistonApiUrl } = getRuntimeConfig();

  // Map frontend language to Piston identifier
  const pistonLanguage = LANGUAGE_MAP[language] || language;

  // Security check for shell languages
  if (isShellLanguage(language) && containsDangerousCommands(code)) {
    return res.status(400).json({
      message: '⚠️ Security Error: Your code contains blocked commands.',
    });
  }

  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) return res.status(404).json({ message: 'Challenge not found' });

    const sanitizedCode = code.replace(/\u00a0/g, ' ');
    const testCasesToRun = runOnly
      ? challenge.testCases.filter((tc) => tc.isExample)
      : challenge.testCases;
    const results = [];
    let allPassed = true;

    for (const tc of testCasesToRun) {
      try {
        const formattedStdin = tc.input.replace(/,\s*(?=[a-zA-Z_]\w*\s*=)/g, '\n');

        const payload = {
          language: pistonLanguage,
          version: '*',
          files: [{ content: sanitizedCode }],
          stdin: formattedStdin,
        };

        const { data: result } = await axios.post(pistonApiUrl, payload);

        if ((result.compile && result.compile.code !== 0) || result.run.code !== 0) {
          allPassed = false;
          results.push({
            input: tc.input,
            expected: tc.output,
            output: result.compile?.stderr || result.run.stderr || result.run.output,
            passed: false,
            isExample: tc.isExample,
          });
          continue;
        }

        const output = result.run.stdout.trim();
        const passed = output.toLowerCase() === tc.output.toLowerCase();

        if (!passed) allPassed = false;

        results.push({
          input: tc.input,
          expected: tc.output,
          output,
          passed,
          isExample: tc.isExample,
        });
      } catch (apiError) {
        legacyLogger.error('runner_request_failed', apiError);
        allPassed = false;
        results.push({
          input: tc.input,
          expected: tc.output,
          output: 'API execution error. Please check the server logs.',
          passed: false,
          isExample: tc.isExample,
        });
      }
    }

    if (allPassed && !runOnly) {
      const user = await User.findById(req.user.id);
      if (!user.solvedChallenges.some((s) => s.challenge.toString() === req.params.id)) {
        user.score += challenge.score;
        user.solvedChallenges.push({ challenge: req.params.id });
        await user.save();
      }
    }

    const message = allPassed ? 'All tests passed!' : 'One or more tests failed.';
    res.json({ message, results });
  } catch (err) {
    legacyLogger.error('submission_failed', err);
    res.status(500).json({ message: 'Error processing your submission.' });
  }
});

// --- The rest of your routes (GET challenges, comments, etc.) are unchanged ---

// --- GET ALL CHALLENGES ---
router.get('/', authMiddleware, async (req, res) => {
  try {
    const challenges = await Challenge.find()
      .populate('author', 'username')
      .sort({ createdAt: -1 })
      .lean();
    const user = await User.findById(req.user.id).select('solvedChallenges');
    const solvedChallengeIds = new Set(user.solvedChallenges.map((s) => s.challenge.toString()));
    const challengesWithStatus = challenges.map((challenge) => ({
      ...challenge,
      isSolved: solvedChallengeIds.has(challenge._id.toString()),
    }));
    res.json(challengesWithStatus);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// --- GET LEADERBOARD ---
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const leaderboard = await User.find()
      .sort({ score: -1 })
      .limit(100)
      .select('username score profilePictureUrl');
    res.json(leaderboard);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// --- GET A SINGLE CHALLENGE BY ID ---
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const challenge = await deepPopulateComments(req.params.id);
    if (!challenge) {
      return res.status(404).json({ msg: 'Challenge not found' });
    }
    res.json(challenge);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Challenge not found' });
    }
    res.status(500).send('Server Error');
  }
});

// --- VOTE ON CHALLENGE ---
router.post('/:id/like', authMiddleware, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    challenge.dislikes.pull(req.user.id);
    const hasLiked = challenge.likes.includes(req.user.id);
    if (hasLiked) {
      challenge.likes.pull(req.user.id);
    } else {
      challenge.likes.push(req.user.id);
    }
    await challenge.save();
    res.json({ likes: challenge.likes, dislikes: challenge.dislikes });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/:id/dislike', authMiddleware, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    challenge.likes.pull(req.user.id);
    const hasDisliked = challenge.dislikes.includes(req.user.id);
    if (hasDisliked) {
      challenge.dislikes.pull(req.user.id);
    } else {
      challenge.dislikes.push(req.user.id);
    }
    await challenge.save();
    res.json({ likes: challenge.likes, dislikes: challenge.dislikes });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// --- COMMENTING SYSTEM ---
const findComment = (comments, commentId) => {
  for (const comment of comments) {
    if (comment._id.toString() === commentId) return comment;
    if (comment.replies && comment.replies.length > 0) {
      const found = findComment(comment.replies, commentId);
      if (found) return found;
    }
  }
  return null;
};

// Deep populate helper — recursively populates authors at ALL nesting levels
const deepPopulateComments = async (challengeId) => {
  const challenge = await Challenge.findById(challengeId).populate('author', 'username');
  if (!challenge) return null;

  // Recursively collect all unique author IDs from comments at any depth
  const collectAuthorIds = (comments) => {
    const ids = new Set();
    for (const c of comments) {
      if (c.author) ids.add(c.author.toString());
      if (c.awards)
        c.awards.forEach((a) => {
          if (a.user) ids.add(a.user.toString());
        });
      if (c.replies && c.replies.length > 0) {
        collectAuthorIds(c.replies).forEach((id) => ids.add(id));
      }
    }
    return ids;
  };

  const authorIds = collectAuthorIds(challenge.comments);
  if (authorIds.size === 0) return challenge;

  // Single DB query for all authors
  const users = await User.find({ _id: { $in: [...authorIds] } }).select(
    'username profilePictureUrl',
  );
  const userMap = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = {
      _id: u._id,
      username: u.username,
      profilePictureUrl: u.profilePictureUrl,
    };
  });

  // Recursively assign user data to all comments
  const assignAuthors = (comments) => {
    for (const c of comments) {
      if (c.author && typeof c.author !== 'object') {
        c.author = userMap[c.author.toString()] || { username: 'Deleted User' };
      } else if (c.author && c.author._id && !c.author.username) {
        c.author = userMap[c.author._id.toString()] || { username: 'Deleted User' };
      }
      if (c.awards) {
        c.awards.forEach((a) => {
          if (a.user && typeof a.user !== 'object') {
            a.user = userMap[a.user.toString()] || { username: 'Unknown' };
          }
        });
      }
      if (c.replies && c.replies.length > 0) assignAuthors(c.replies);
    }
  };

  // Convert to plain object so we can modify fields
  const challengeObj = challenge.toObject();
  assignAuthors(challengeObj.comments);

  // Return a hybrid: mongoose doc with populated comments replaced
  challenge._doc.comments = challengeObj.comments;
  return challenge;
};

router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    // Ban check
    const commenter = await User.findById(req.user.id);
    if (commenter?.isBanned)
      return res.status(403).json({ msg: 'Your account is banned. You cannot post comments.' });

    const challenge = await Challenge.findById(req.params.id);
    challenge.comments.unshift({ text: req.body.text, author: req.user.id });
    await challenge.save();
    const updated = await deepPopulateComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/:id/comments/:commentId/reply', authMiddleware, async (req, res) => {
  try {
    // Ban check
    const replier = await User.findById(req.user.id);
    if (replier?.isBanned)
      return res.status(403).json({ msg: 'Your account is banned. You cannot reply.' });

    const challenge = await Challenge.findById(req.params.id);
    const parentComment = findComment(challenge.comments, req.params.commentId);
    if (!parentComment) return res.status(404).json({ msg: 'Comment not found' });

    parentComment.replies.unshift({ text: req.body.text, author: req.user.id });
    await challenge.save();
    const updated = await deepPopulateComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/:id/comments/:commentId/like', authMiddleware, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    const comment = findComment(challenge.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    comment.dislikes.pull(req.user.id);
    const hasLiked = comment.likes.includes(req.user.id);
    if (hasLiked) {
      comment.likes.pull(req.user.id);
    } else {
      comment.likes.push(req.user.id);
    }

    await challenge.save();
    res.json(comment);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

router.post('/:id/comments/:commentId/dislike', authMiddleware, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    const comment = findComment(challenge.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    comment.likes.pull(req.user.id);
    const hasDisliked = comment.dislikes.includes(req.user.id);
    if (hasDisliked) {
      comment.dislikes.pull(req.user.id);
    } else {
      comment.dislikes.push(req.user.id);
    }

    await challenge.save();
    res.json(comment);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// --- AWARD A COMMENT ---
router.post('/:id/comments/:commentId/award', authMiddleware, async (req, res) => {
  try {
    const { awardType } = req.body;
    const validTypes = ['star', 'fire', 'heart', 'rocket', 'diamond'];
    if (!validTypes.includes(awardType)) {
      return res.status(400).json({ msg: 'Invalid award type' });
    }
    const challenge = await Challenge.findById(req.params.id);
    const comment = findComment(challenge.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    // One award per user per comment
    const existing = comment.awards.find((a) => a.user.toString() === req.user.id);
    if (existing) {
      comment.awards.pull(existing._id);
    } else {
      comment.awards.push({ user: req.user.id, type: awardType });
    }
    await challenge.save();
    const updated = await deepPopulateComments(req.params.id);
    const updatedComment = findComment(updated.comments, req.params.commentId);
    res.json(updatedComment);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// --- DELETE A COMMENT ---
const removeComment = (comments, commentId) => {
  for (let i = 0; i < comments.length; i++) {
    if (comments[i]._id.toString() === commentId) {
      comments.splice(i, 1);
      return true;
    }
    if (comments[i].replies && comments[i].replies.length > 0) {
      if (removeComment(comments[i].replies, commentId)) return true;
    }
  }
  return false;
};

router.delete('/:id/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) return res.status(404).json({ msg: 'Challenge not found' });

    const comment = findComment(challenge.comments, req.params.commentId);
    if (!comment) return res.status(404).json({ msg: 'Comment not found' });

    // Allow comment author, moderators, and superadmins to delete
    const isAuthor = comment.author.toString() === req.user.id;
    const isMod = evaluateRequestPermission(req, PERMISSION.MODERATION_ACTION_CREATE).allowed;

    if (!isAuthor && !isMod) {
      return res.status(401).json({ msg: 'Not authorized to delete this comment' });
    }

    removeComment(challenge.comments, req.params.commentId);
    await challenge.save();
    const updated = await deepPopulateComments(req.params.id);
    res.json(updated.comments);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// --- DELETE A CHALLENGE ---
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const challenge = await Challenge.findById(req.params.id);
    if (!challenge) return res.status(404).json({ msg: 'Challenge not found' });
    if (challenge.author.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'User not authorized' });
    }
    await Challenge.deleteOne({ _id: req.params.id });
    res.json({ msg: 'Challenge removed' });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

module.exports = router;
