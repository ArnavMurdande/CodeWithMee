const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');

// @route   POST api/code/run
// @desc    Run user-submitted code via Piston API
// @access  Private
router.post('/run', authMiddleware, async (req, res) => {
  const { code, language } = req.body;
  const PISTON_API_URL = 'https://emkc.org/api/v2/piston/execute';

  if (!code) {
    return res.status(400).json({ error: 'No code provided.' });
  }

  if (!language) {
    return res.status(400).json({ error: 'No language specified.' });
  }

  try {
    const payload = {
      language: language,
      version: '*', // Let Piston choose the latest stable version
      files: [{ content: code }],
      stdin: '', // Standard input, can be used in the future if needed
    };

    const { data: result } = await axios.post(PISTON_API_URL, payload);

    // Check for compilation or runtime errors
    if (result.compile?.stderr || result.run.stderr) {
      const errorOutput = result.compile?.stderr || result.run.stderr;
      // Return a 400 Bad Request for code errors, which is more appropriate
      return res.status(400).json({ error: errorOutput });
    }

    // Send back the standard output
    res.json({ output: result.run.stdout });
  } catch (apiError) {
    console.error("Piston API Error:", apiError.response ? apiError.response.data : apiError.message);
    res.status(500).json({ error: 'Error executing code via API. The service may be temporarily down.' });
  }
});

module.exports = router;
