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


// @route   GET api/user/theme
// @desc    Get user's theme preferences
// @access  Private
router.get('/theme', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('themePreferences');
        res.json(user?.themePreferences || {
            preset: 'ocean',
            color1: '#149ecc',
            color2: '#412ecc',
            color3: '#44cf87',
            customColors: false,
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/user/theme
// @desc    Save user's theme preferences
// @access  Private
router.put('/theme', authMiddleware, async (req, res) => {
    try {
        const { preset, color1, color2, color3, customColors } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        user.themePreferences = { preset, color1, color2, color3, customColors };
        await user.save();
        res.json(user.themePreferences);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// --- Active Recall Checkpoints: Video Progress ---

// @route   PUT api/user/video-progress
// @desc    Save or update video playback position
// @access  Private
router.put('/video-progress', authMiddleware, async (req, res) => {
    try {
        const { videoId, timestamp, duration, topic, pathway } = req.body;
        if (!videoId) {
            return res.status(400).json({ msg: 'videoId is required' });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Find existing progress entry for this videoId
        const existingIndex = user.videoProgress.findIndex(vp => vp.videoId === videoId);

        if (existingIndex > -1) {
            // Update existing entry
            user.videoProgress[existingIndex].timestamp = timestamp || 0;
            user.videoProgress[existingIndex].duration = duration || 0;
            user.videoProgress[existingIndex].topic = topic || '';
            user.videoProgress[existingIndex].pathway = pathway || '';
            user.videoProgress[existingIndex].updatedAt = new Date();
        } else {
            // Create new entry
            user.videoProgress.push({
                videoId,
                timestamp: timestamp || 0,
                duration: duration || 0,
                topic: topic || '',
                pathway: pathway || '',
                updatedAt: new Date()
            });
        }

        await user.save();
        res.json({ msg: 'Video progress saved', videoId, timestamp });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET api/user/video-progress/:videoId
// @desc    Get saved video playback position
// @access  Private
router.get('/video-progress/:videoId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('videoProgress');
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const progress = user.videoProgress.find(vp => vp.videoId === req.params.videoId);
        res.json(progress || { videoId: req.params.videoId, timestamp: 0, duration: 0 });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});
// ===============================================
// --- Floating Notes Widget: Notes CRUD + Media ---
// ===============================================

// Multer config for notes media uploads (images, audio, video)
const fs = require('fs');
const notesUploadDir = 'uploads/notes';
if (!fs.existsSync(notesUploadDir)) {
    fs.mkdirSync(notesUploadDir, { recursive: true });
}

const notesStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, notesUploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, 'note-' + req.user.id + '-' + Date.now() + path.extname(file.originalname));
    }
});

const notesUpload = multer({
    storage: notesStorage,
    limits: { fileSize: 1024 * 1024 * 25 }, // 25MB limit
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|mp3|wav|ogg|webm|mp4|mov|avi|mkv/;
        const mimeAllowed = /image\/|audio\/|video\//;
        const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
        const mimeOk = mimeAllowed.test(file.mimetype);
        if (extOk || mimeOk) {
            return cb(null, true);
        }
        cb(new Error('Unsupported file type'));
    }
}).single('noteMedia');

// @route   GET api/user/notes
// @desc    Get all notes for the current user
// @access  Private
router.get('/notes', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('notes');
        if (!user) return res.status(404).json({ msg: 'User not found' });
        res.json(user.notes || []);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/user/notes
// @desc    Create a new note
// @access  Private
router.post('/notes', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const newNote = {
            title: req.body.title || 'Untitled Note',
            content: '',
            attachments: [],
            formatting: { fontSize: 14, fontWeight: 'normal', color: '#e0e0e0' },
            canvasData: '',
        };
        user.notes.push(newNote);
        await user.save();

        // Return the newly created note (last in the array)
        const created = user.notes[user.notes.length - 1];
        res.json(created);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/user/notes/:noteId
// @desc    Update a note (content, title, formatting, canvasData)
// @access  Private
router.put('/notes/:noteId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const note = user.notes.id(req.params.noteId);
        if (!note) return res.status(404).json({ msg: 'Note not found' });

        const { title, content, formatting, canvasData } = req.body;
        if (title !== undefined) note.title = title;
        if (content !== undefined) note.content = content;
        if (formatting) {
            if (formatting.fontSize !== undefined) note.formatting.fontSize = formatting.fontSize;
            if (formatting.fontWeight !== undefined) note.formatting.fontWeight = formatting.fontWeight;
            if (formatting.color !== undefined) note.formatting.color = formatting.color;
        }
        if (canvasData !== undefined) note.canvasData = canvasData;
        note.updatedAt = new Date();

        await user.save();
        res.json(note);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   DELETE api/user/notes/:noteId
// @desc    Delete a note
// @access  Private
router.delete('/notes/:noteId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const note = user.notes.id(req.params.noteId);
        if (!note) return res.status(404).json({ msg: 'Note not found' });

        note.deleteOne();
        await user.save();
        res.json({ msg: 'Note deleted' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/user/notes/:noteId/upload
// @desc    Upload a media attachment (image/audio/video) to a note
// @access  Private
router.post('/notes/:noteId/upload', authMiddleware, (req, res) => {
    notesUpload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ msg: err.message || 'File upload failed.' });
        }
        if (!req.file) {
            return res.status(400).json({ msg: 'No file selected' });
        }

        try {
            const user = await User.findById(req.user.id);
            if (!user) return res.status(404).json({ msg: 'User not found' });

            const note = user.notes.id(req.params.noteId);
            if (!note) return res.status(404).json({ msg: 'Note not found' });

            // Determine file type from mimetype
            let fileType = 'image';
            if (req.file.mimetype.startsWith('audio/')) fileType = 'audio';
            else if (req.file.mimetype.startsWith('video/')) fileType = 'video';

            const attachment = {
                fileType,
                url: `/uploads/notes/${req.file.filename}`,
                name: req.file.originalname,
            };

            note.attachments.push(attachment);
            note.updatedAt = new Date();
            await user.save();

            // Return the created attachment
            const created = note.attachments[note.attachments.length - 1];
            res.json(created);
        } catch (err) {
            console.error(err.message);
            res.status(500).send('Server Error');
        }
    });
});

// @route   DELETE api/user/notes/:noteId/attachments/:attachmentId
// @desc    Delete a media attachment from a note
// @access  Private
router.delete('/notes/:noteId/attachments/:attachmentId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const note = user.notes.id(req.params.noteId);
        if (!note) return res.status(404).json({ msg: 'Note not found' });

        const att = note.attachments.id(req.params.attachmentId);
        if (!att) return res.status(404).json({ msg: 'Attachment not found' });

        att.deleteOne();
        note.updatedAt = new Date();
        await user.save();
        res.json({ msg: 'Attachment deleted' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;