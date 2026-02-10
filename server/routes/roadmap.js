const express = require('express');
const router = express.Router();
const { generateContentWithRetry } = require('../utils/geminiHelper');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

// ---------------- GENERATE & SAVE A NEW ROADMAP ----------------
router.post('/generate', authMiddleware, async (req, res) => {
  const { language, level, customPrompt } = req.body;

  let userQuery;
  let roadmapTitle = 'My New Roadmap'; // Default title

  if (customPrompt && customPrompt.trim() !== '') {
    userQuery = `A user wants a roadmap for: "${customPrompt}".`;
    roadmapTitle = customPrompt;
  } else if (language && level) {
    userQuery = `A user wants to learn ${language} at a "${level}" level.`;
    roadmapTitle = `${language} (${level})`;
  } else {
    return res
      .status(400)
      .json({ error: 'Either language and level or a custom prompt is required.' });
  }

  const prompt = `
Create a detailed, step-by-step learning roadmap. ${userQuery}
The output must be a JSON object containing a "roadmap" key, which is an array of topic objects,
and a "title" key for the roadmap's title.

Each topic object must have:
- "topic": the name of the concept or skill
- "description": a brief explanation of it
- "youtube_query": a search phrase to find relevant YouTube videos
- "completed": set to false

Example structure:
{
  "title": "${roadmapTitle}",
  "roadmap": [
    { "topic": "Introduction to Python", "description": "Learn basic syntax", "youtube_query": "Python basics tutorial", "completed": false }
  ]
}
`;

  try {
    const result = await generateContentWithRetry('models/gemini-3-flash-preview', prompt);
    const response = result.response;
    const jsonText = response.text();

    // Clean up code fences from AI response
    const cleanJsonText = jsonText.replace(/```json|```/g, '').trim();

    let jsonResponse;
    try {
      jsonResponse = JSON.parse(cleanJsonText);
    } catch (err) {
      console.error('⚠️ Gemini returned invalid JSON:', cleanJsonText);
      return res
        .status(500)
        .json({ error: 'Failed to parse AI response. Please try again.' });
    }

    const finalTitle = jsonResponse.title || roadmapTitle;

    // Save roadmap to user
    const user = await User.findById(req.user.id);
    user.roadmaps.push({ title: finalTitle, topics: jsonResponse.roadmap });
    await user.save();

    const newRoadmap = user.roadmaps[user.roadmaps.length - 1];
    res.json(newRoadmap);
  } catch (error) {
    console.error('--- ERROR Generating Roadmap (Gemini) ---', error);
    res.status(500).json({
      error: 'Failed to generate roadmap. Please check server logs.',
    });
  }
});

// ---------------- GET ALL SAVED ROADMAPS ----------------
router.get('/my-roadmaps', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('roadmaps');
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.json(user.roadmaps || []);
  } catch (error) {
    console.error('--- ERROR Fetching Roadmaps ---', error);
    res.status(500).json({ error: 'Failed to fetch saved roadmaps.' });
  }
});

// ---------------- UPDATE ROADMAP PROGRESS ----------------
router.put('/progress', authMiddleware, async (req, res) => {
  const { roadmapId, topic, completed } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const roadmap = user.roadmaps.id(roadmapId);
    if (!roadmap) {
      return res.status(404).json({ message: 'Roadmap not found.' });
    }

    const topicToUpdate = roadmap.topics.find((t) => t.topic === topic);
    if (!topicToUpdate) {
      return res.status(404).json({ message: 'Topic not found in roadmap.' });
    }

    topicToUpdate.completed = completed;
    await user.save();

    res.json({ message: 'Progress updated successfully!' });
  } catch (error) {
    console.error('--- ERROR Updating Progress ---', error);
    res.status(500).json({ error: 'Server error updating progress.' });
  }
});

// ---------------- DELETE A ROADMAP ----------------
router.delete('/:roadmapId', authMiddleware, async (req, res) => {
  try {
    const { roadmapId } = req.params;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const roadmap = user.roadmaps.id(roadmapId);
    if (!roadmap) {
      return res.status(404).json({ message: 'Roadmap not found.' });
    }

    roadmap.deleteOne();
    await user.save();

    res.json({ message: 'Roadmap deleted successfully.' });
  } catch (error) {
    console.error('--- ERROR Deleting Roadmap ---', error);
    res.status(500).json({ error: 'Failed to delete roadmap.' });
  }
});

module.exports = router;
