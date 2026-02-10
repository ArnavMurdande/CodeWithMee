const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const User = require('../models/User');
// FIX: Correctly import the authMiddleware function from the middleware folder
const authMiddleware = require('../middleware/authMiddleware');

// --- START: Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, 'user-' + req.user.id + '-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1024 * 1024 * 5 }, // Limit file size to 5MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Error: Images Only!')); // Use new Error for better message handling
    }
}).single('profilePicture');
// --- END: Multer Configuration ---

// @route   GET api/user/me
// @desc    Get current user's data
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/user/me
// @desc    Update user profile data
// @access  Private
router.put('/me', authMiddleware, async (req, res) => {
    const { username, email } = req.body;

    try {
        let user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (username) user.username = username;
        if (email) user.email = email;

        await user.save();
        res.json(user);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/user/upload-picture
// @desc    Upload a profile picture
// @access  Private
router.post('/upload-picture', authMiddleware, (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            // Multer errors can be objects, so we extract the message property.
            return res.status(400).json({ message: err.message || 'File upload failed.' });
        }
        if (req.file == null) {
            return res.status(400).json({ message: 'No file selected' });
        }

        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            user.profilePictureUrl = `/uploads/${req.file.filename}`;
            await user.save();

            res.json({
                message: 'Profile picture updated successfully!',
                profilePictureUrl: user.profilePictureUrl
            });

        } catch (err) {
            console.error(err.message);
            res.status(500).send('Server Error');
        }
    });
});

// --- NEW: Route to save/unsave a challenge ---
router.put('/save-challenge/:id', authMiddleware, async (req, res) => {
    try {
        const challengeId = req.params.id;
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const isSaved = user.savedChallenges.includes(challengeId);

        if (isSaved) {
            // Unsave the challenge
            user.savedChallenges.pull(challengeId);
        } else {
            // Save the challenge
            user.savedChallenges.push(challengeId);
        }

        await user.save();
        // Return the updated list of saved challenges
        res.json({ savedChallenges: user.savedChallenges });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


// FIX: Removed the extra 'r' from the end of this line
module.exports = router;