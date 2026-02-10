const express = require('express');
const router = express.Router();
const { generateContentWithRetry } = require('../utils/geminiHelper');
const authMiddleware = require('../middleware/authMiddleware');
const User = require('../models/User');

// ---------------- CHAT ROUTE ----------------
router.post('/chat', authMiddleware, async (req, res) => {
  const { question, code } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'A question is required.' });
  }

  try {
    // Find the authenticated user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Prepare brief conversation history
    const history = user.conversations
      .slice(-5)
      .map(
        (conv) =>
          `User asked: "${conv.prompt}"\nMee answered: "${conv.response}"`
      )
      .join('\n\n');

    // Build the complete prompt
    const prompt = `
You are a friendly and helpful coding assistant named "Mee".
A user is working on a coding problem.

This is their current code:
\`\`\`
${code || '(No code provided)'}
\`\`\`

Here is the recent conversation history:
${history || '(No recent history)'}

Now, they have the following new question: "${question}"

Provide a concise, helpful, and encouraging answer. Address the user directly.
`;

    // Generate response using Gemini with Retry Logic
    const result = await generateContentWithRetry('models/gemini-3-flash-preview', prompt);
    const answer =
      result.response.text() || 'Sorry, I could not generate a response.';

    // Save conversation
    user.conversations.push({ prompt: question, response: answer });
    if (user.conversations.length > 20) {
      user.conversations = user.conversations.slice(-20);
    }
    await user.save();

    // Send back the AI’s response
    res.json({ answer });
  } catch (error) {
    console.error('AI Chat Error (Gemini):', error);
    res
      .status(500)
      .json({ error: 'Failed to get a response from the AI assistant.' });
  }
});

// ---------------- HISTORY ROUTE ----------------
router.get('/chat-history', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('conversations');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json(user.conversations);
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history.' });
  }
});

module.exports = router;
