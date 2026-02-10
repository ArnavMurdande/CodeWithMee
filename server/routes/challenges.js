const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');
const Challenge = require('../models/Challenge');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');

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
            const { title, description, constraints, difficulty, score, tags, solution, solutionLanguage, testCases } = req.body;

            const newChallenge = new Challenge({
                title,
                description,
                constraints,
                difficulty,
                score,
                tags: Array.isArray(tags) ? tags.filter(t => t && t.trim() !== '') : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(t => t) : []),
                solution,
                solutionLanguage,
                testCases,
                author: req.user.id,
            });
            const challenge = await newChallenge.save();
            res.status(201).json(challenge);
        } catch (err) {
            console.error("Error creating challenge:", err);
            if (err.code === 11000) {
                return res.status(400).json({ message: 'A challenge with this title already exists.' });
            }
            res.status(500).json({ message: 'Server error while creating challenge.' });
        }
    }
);


// @route   POST api/challenges/:id/submit
// @desc    Run or submit code for a challenge using the PUBLIC Piston API
// @access  Private
router.post('/:id/submit', authMiddleware, async (req, res) => {
    const { code, language, runOnly } = req.body;
    const PISTON_API_URL = 'https://emkc.org/api/v2/piston/execute';

    try {
        const challenge = await Challenge.findById(req.params.id);
        if (!challenge) return res.status(404).json({ message: "Challenge not found" });

        const sanitizedCode = code.replace(/\u00a0/g, " ");
        const testCasesToRun = runOnly ? challenge.testCases.filter(tc => tc.isExample) : challenge.testCases;
        const results = [];
        let allPassed = true;

        for (const tc of testCasesToRun) {
            try {
                const formattedStdin = tc.input.replace(/,\s*(?=[a-zA-Z_]\w*\s*=)/g, '\n');

                const payload = {
                    language: language,
                    version: '*',
                    files: [ { content: sanitizedCode } ],
                    stdin: formattedStdin
                };

                const { data: result } = await axios.post(PISTON_API_URL, payload);

                if (result.compile?.stderr || result.run.stderr) {
                    allPassed = false;
                    results.push({
                        input: tc.input,
                        expected: tc.output,
                        output: result.compile?.stderr || result.run.stderr,
                        passed: false,
                        isExample: tc.isExample
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
                    isExample: tc.isExample
                });

            } catch (apiError) {
                console.error("Piston API Error:", apiError.response ? apiError.response.data : apiError.message);
                allPassed = false;
                results.push({
                    input: tc.input,
                    expected: tc.output,
                    output: 'API execution error. Please check the server logs.',
                    passed: false,
                    isExample: tc.isExample
                });
            }
        }

        if (allPassed && !runOnly) {
            const user = await User.findById(req.user.id);
            if (!user.solvedChallenges.some(s => s.challenge.toString() === req.params.id)) {
                user.score += challenge.score;
                user.solvedChallenges.push({ challenge: req.params.id });
                await user.save();
            }
        }

        const message = allPassed ? "All tests passed!" : "One or more tests failed.";
        res.json({ message, results });

    } catch (err) {
        console.error("Submission error:", err.message);
        res.status(500).json({ message: "Error processing your submission." });
    }
});


// --- The rest of your routes (GET challenges, comments, etc.) are unchanged ---

// --- GET ALL CHALLENGES ---
router.get('/', authMiddleware, async (req, res) => {
    try {
        const challenges = await Challenge.find().populate('author', 'username').sort({ createdAt: -1 }).lean();
        const user = await User.findById(req.user.id).select('solvedChallenges');
        const solvedChallengeIds = new Set(user.solvedChallenges.map(s => s.challenge.toString()));
        const challengesWithStatus = challenges.map(challenge => ({
            ...challenge,
            isSolved: solvedChallengeIds.has(challenge._id.toString())
        }));
        res.json(challengesWithStatus);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- GET LEADERBOARD ---
router.get('/leaderboard', authMiddleware, async (req, res) => {
    try {
        const leaderboard = await User.find().sort({ score: -1 }).limit(100).select('username score profilePictureUrl');
        res.json(leaderboard);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// --- GET A SINGLE CHALLENGE BY ID ---
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id)
            .populate('author', 'username')
            .populate({
                path: 'comments',
                populate: {
                    path: 'author replies.author',
                    select: 'username profilePictureUrl'
                }
            });

        if (!challenge) {
            return res.status(404).json({ msg: 'Challenge not found' });
        }
        res.json(challenge);
    } catch (err) {
        console.error(err.message);
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
    } catch (err) { res.status(500).send('Server Error'); }
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
    } catch (err) { res.status(500).send('Server Error'); }
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

router.post('/:id/comments', authMiddleware, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        challenge.comments.unshift({ text: req.body.text, author: req.user.id });
        await challenge.save();
        const updatedChallenge = await Challenge.findById(req.params.id).populate({
            path: 'comments',
            populate: { path: 'author replies.author', select: 'username profilePictureUrl' }
        });
        res.json(updatedChallenge.comments);
    } catch (err) { res.status(500).send('Server Error'); }
});

router.post('/:id/comments/:commentId/reply', authMiddleware, async (req, res) => {
    try {
        const challenge = await Challenge.findById(req.params.id);
        const parentComment = findComment(challenge.comments, req.params.commentId);
        if (!parentComment) return res.status(404).json({ msg: 'Comment not found' });

        parentComment.replies.unshift({ text: req.body.text, author: req.user.id });
        await challenge.save();
        const updatedChallenge = await Challenge.findById(req.params.id).populate({
            path: 'comments',
            populate: { path: 'author replies.author', select: 'username profilePictureUrl' }
        });
        res.json(updatedChallenge.comments);
    } catch (err) { res.status(500).send('Server Error'); }
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
    } catch (err) { res.status(500).send('Server Error'); }
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
    } catch (err) { res.status(500).send('Server Error'); }
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