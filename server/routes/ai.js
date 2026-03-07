const express = require('express');
const router = express.Router();
const { generateContentWithRetry } = require('../utils/geminiHelper');
const authMiddleware = require('../middleware/authMiddleware');
const User = require('../models/User');

// ---------------- SANDBOX CHAT ROUTE (per pathway/chapter) ----------------
router.post('/chat', authMiddleware, async (req, res) => {
  const { question, code, pathway, chapter } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'A question is required.' });
  }

  const pathwayKey = pathway || 'General';
  const chapterKey = chapter || 'General';

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Get recent history for this specific pathway+chapter
    const chapterHistory = (user.sandboxConversations || [])
      .filter(c => c.pathway === pathwayKey && c.chapter === chapterKey)
      .slice(-5)
      .map(conv => `User asked: "${conv.prompt}"\nMee answered: "${conv.response}"`)
      .join('\n\n');

    const prompt = `
You are a friendly and helpful coding assistant named "Mee".
A user is studying the topic "${chapterKey}" from the pathway "${pathwayKey}".

This is their current code:
\`\`\`
${code || '(No code provided)'}
\`\`\`

Here is the recent conversation history for this chapter:
${chapterHistory || '(No recent history)'}

Now, they have the following new question: "${question}"

Provide a concise, helpful, and encouraging answer. Address the user directly.
Keep answers relevant to the pathway and chapter context.
`;

    const result = await generateContentWithRetry('models/gemini-3-flash-preview', prompt);
    const answer = result.response.text() || 'Sorry, I could not generate a response.';

    // Save to sandboxConversations (per pathway/chapter)
    user.sandboxConversations.push({
      pathway: pathwayKey,
      chapter: chapterKey,
      prompt: question,
      response: answer,
    });

    // Also save to legacy conversations for backward compatibility
    user.conversations.push({ prompt: question, response: answer });
    if (user.conversations.length > 20) {
      user.conversations = user.conversations.slice(-20);
    }

    await user.save();
    res.json({ answer });
  } catch (error) {
    console.error('AI Chat Error (Gemini):', error);
    res.status(500).json({ error: 'Failed to get a response from the AI assistant.' });
  }
});

// ---------------- SANDBOX CHAT HISTORY (per pathway/chapter) ----------------
router.get('/sandbox-history', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('sandboxConversations roadmaps');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Build a structured response: { pathways: [{name, chapters: [{name, messages: [...]}]}] }
    const convos = user.sandboxConversations || [];
    const pathwayMap = {};

    convos.forEach(c => {
      if (!pathwayMap[c.pathway]) pathwayMap[c.pathway] = {};
      if (!pathwayMap[c.pathway][c.chapter]) pathwayMap[c.pathway][c.chapter] = [];
      pathwayMap[c.pathway][c.chapter].push({
        prompt: c.prompt,
        response: c.response,
        timestamp: c.timestamp,
      });
    });

    // Also provide list of all pathways/chapters from roadmaps for the selector
    const roadmapList = (user.roadmaps || []).map(r => ({
      id: r._id,
      title: r.title,
      chapters: (r.topics || []).map(t => t.topic),
    }));

    res.json({ chatsByPathway: pathwayMap, roadmaps: roadmapList });
  } catch (error) {
    console.error('Error fetching sandbox history:', error);
    res.status(500).json({ error: 'Failed to fetch chat history.' });
  }
});

// ---------------- LEGACY CHAT HISTORY (kept for backward compatibility) ----------------
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

// ---------------- CLEAR CHAT HISTORY ----------------
router.delete('/sandbox-history', authMiddleware, async (req, res) => {
  const { pathway, chapter } = req.query;
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (pathway && chapter) {
      // Clear chat for a specific chapter in a pathway
      user.sandboxConversations = user.sandboxConversations.filter(
        c => !(c.pathway === pathway && c.chapter === chapter)
      );
    } else if (pathway) {
      // Clear all chats for a pathway
      user.sandboxConversations = user.sandboxConversations.filter(
        c => c.pathway !== pathway
      );
    }

    await user.save();
    res.json({ msg: 'Chat history cleared successfully.' });
  } catch (error) {
    console.error('Error clearing chat history:', error);
    res.status(500).json({ error: 'Failed to clear chat history.' });
  }
});

// ---------------- DEBUG ROUTE ----------------
router.post('/debug', authMiddleware, async (req, res) => {
  const { code, output, language, topic } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required for debugging.' });
  }

  try {
    const prompt = `
You are a coding debugging assistant named "Mee". 
A user is learning "${topic || 'programming'}" and writing in "${language || 'python'}".

Their code:
\`\`\`${language || ''}
${code}
\`\`\`

The terminal output/error:
\`\`\`
${output || '(No output yet)'}
\`\`\`

Your task:
1. Analyze the code and terminal output.
2. Identify any errors, bugs, or issues.
3. Provide the COMPLETE corrected code with inline comments explaining what was wrong and how you fixed it.
4. Keep explanations as comments within the corrected code (use the appropriate comment syntax for the language).
5. At the very top of the code, add a comment block summarizing all issues found and fixes applied.
6. If there are no errors, say so and suggest improvements.

Return ONLY the corrected code with comments. Do not include markdown code fences or backticks. Just return raw code.
`;

    const result = await generateContentWithRetry('models/gemini-3-flash-preview', prompt);
    let answer = result.response.text() || '';

    // Strip any markdown code fences the AI might add
    answer = answer.replace(/^```[\w]*\n?/gm, '').replace(/\n?```$/gm, '').trim();

    res.json({ correctedCode: answer });
  } catch (error) {
    console.error('AI Debug Error:', error);
    res.status(500).json({ error: 'Failed to debug code.' });
  }
});

module.exports = router;
