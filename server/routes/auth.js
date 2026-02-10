const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

// @route   POST api/auth/register
// @desc    Register a new user
// @access  Public
router.post(
  '/register',
  // --- INPUT VALIDATION ADDED ---
  [
    body('username', 'Username is required').not().isEmpty().trim().escape(),
    body('email', 'Please include a valid email').isEmail().normalizeEmail(),
    body('password', 'Password must be 6 or more characters').isLength({ min: 6 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    try {
      let user = await User.findOne({ email });
      if (user) {
        return res.status(400).json({ message: 'User with that email already exists' });
      }

      user = new User({
        username,
        email,
        password,
        authMethod: 'local',
      });

      // Password hashing is handled by the pre-save hook in the User model
      await user.save();

      const payload = { user: { id: user.id } };
      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '5h' },
        (err, token) => {
          if (err) throw err;
          res.status(201).json({ token });
        }
      );
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post(
  '/login',
  // --- INPUT VALIDATION ADDED ---
  [
    body('email', 'Please include a valid email').isEmail().normalizeEmail(),
    body('password', 'Password is required').exists(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      let user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      if (user.authMethod === 'google') {
        return res.status(400).json({ message: 'This account was created with Google. Please log in with Google.' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      const payload = { user: { id: user.id } };
      jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '5h' },
        (err, token) => {
          if (err) throw err;
          res.json({ token });
        }
      );
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);


// @route   POST api/auth/google-profile
// @desc    Handle Google Sign-In
// @access  Public
router.post('/google-profile', async (req, res) => {
  const { access_token } = req.body;

  if (!access_token) {
    return res.status(400).json({ message: 'Google access token is required.'});
  }

  try {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const { name, email, sub: googleId, picture } = data;

    let user = await User.findOne({ email });

    if (!user) {
      // User doesn't exist, create a new one with Google info
      user = new User({
        username: name,
        email,
        password: await bcrypt.hash(googleId, 10), // Use Google ID as a stand-in for password
        profilePictureUrl: picture,
        authMethod: 'google',
      });
      await user.save();
    } else {
      const hasCustomPicture = user.profilePictureUrl && user.profilePictureUrl.startsWith('/uploads');
      if (!hasCustomPicture) {
        user.profilePictureUrl = picture;
        await user.save();
      }
    }

    const payload = { user: { id: user.id } };
    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '5h' },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );
  } catch (err) {
    console.error('Google Sign-In Error:', err.response ? err.response.data : err.message);
    res.status(500).json({ message: 'Server error during Google authentication' });
  }
});


module.exports = router;
