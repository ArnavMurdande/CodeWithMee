'use strict';

const express = require('express');
const router = express.Router();
const { generateContentWithRetry } = require('../utils/geminiHelper');
const authMiddleware = require('../middleware/authMiddleware');
const { createLegacyLogger } = require('../utils/legacyLogger');
const { getPgPool } = require('../db/postgres');
const { createPostgresRoadmapRepository, isUuid } = require('../modules/learning/postgres-roadmap-repository');
const { createRoadmapService } = require('../modules/learning/roadmap-service');

const legacyLogger = createLegacyLogger('roadmap');

function getService() {
  const pool = getPgPool();
  if (!pool) return null;
  const repository = createPostgresRoadmapRepository(pool);
  return createRoadmapService({ repository });
}

// ---------------- GENERATE & SAVE A NEW ROADMAP ----------------
router.post('/generate', authMiddleware, async (req, res) => {
  const service = getService();
  if (!service) {
    return res.status(503).json({ error: { code: 'service_unavailable', message: 'Roadmap database service is unavailable.' } });
  }

  const userId = req.user?.id;
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Valid user authentication required.' });
  }

  const { language, level, customPrompt } = req.body;

  let userQuery;
  let defaultTitle = 'My New Roadmap';

  if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim() !== '') {
    userQuery = `A user wants a roadmap for: "${customPrompt.trim()}".`;
    defaultTitle = customPrompt.trim();
  } else if (language && level) {
    userQuery = `A user wants to learn ${language} at a "${level}" level.`;
    defaultTitle = `${language} (${level})`;
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
- "youtube_query": a specific YouTube search phrase that ALWAYS includes the target subject (e.g. "Java JDK setup tutorial", "Python list slicing tutorial"). Unless a specific spoken language like Hindi or Spanish is explicitly requested by the user, ALWAYS specify "in English" at the end of the query. MUST NOT be generic like "Setup" or "Introduction".
- "completed": set to false

Example structure:
{
  "title": "${defaultTitle}",
  "roadmap": [
    { "topic": "Introduction to Python", "description": "Learn basic syntax", "youtube_query": "Python basics tutorial in English", "completed": false }
  ]
}
`;

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fenced or embedded JSON extraction.
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue with embedded JSON extraction.
    }
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
    } catch {
      // Invalid model output is handled by the caller's safe fallback.
    }
  }

  return null;
}

  let finalTitle = defaultTitle;
  let topicsList = [];

  try {
    const candidateModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-flash-latest'];
    let lastGenError = null;
    for (const m of candidateModels) {
      try {
        const result = await generateContentWithRetry(m, prompt);
        if (result && result.response) {
          const rawText = result.response.text();
          const parsed = extractJson(rawText);
          if (parsed) {
            finalTitle = parsed.title || defaultTitle;
            topicsList = Array.isArray(parsed.roadmap)
              ? parsed.roadmap
              : Array.isArray(parsed.topics)
              ? parsed.topics
              : Array.isArray(parsed.chapters)
              ? parsed.chapters
              : Array.isArray(parsed)
              ? parsed
              : [];
            if (topicsList.length > 0) break;
          }
        }
      } catch (e) {
        lastGenError = e;
      }
    }

    if (topicsList.length === 0 && lastGenError) {
      legacyLogger.warn('ai_generation_model_fallback_triggered', lastGenError);
    }
  } catch (error) {
    legacyLogger.warn('ai_generation_fallback_used', error);
    finalTitle = defaultTitle;
    topicsList = generateFallbackTopics(customPrompt, language, level);
  }

  if (!topicsList || topicsList.length === 0) {
    topicsList = generateFallbackTopics(customPrompt, language, level);
  }

  try {
    const newRoadmap = await service.createRoadmap(userId, { title: finalTitle, topics: topicsList });
    return res.json(newRoadmap);
  } catch (dbErr) {
    legacyLogger.error('roadmap_save_failed', dbErr);
    const fallbackId = 'rdm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    return res.json({
      id: fallbackId,
      _id: fallbackId,
      title: finalTitle,
      topics: topicsList.map((t, idx) => ({
        id: `tpc_${idx}_${Date.now()}`,
        topic: typeof t === 'string' ? t : t.topic || t.title,
        title: typeof t === 'string' ? t : t.topic || t.title,
        description: t.description || '',
        youtube_query: t.youtube_query || t.youtubeQuery || '',
        completed: false,
      })),
      roadmap: topicsList,
    });
  }
});

function generateFallbackTopics(promptStr, lang, lvl) {
  const queryText = (promptStr || `${lang || 'Programming'} ${lvl || 'Beginner'}`).trim();
  const subject = lang || queryText.replace(/make me a plan for|create a roadmap for|i want to learn|how to learn|learning|roadmap|plan for/gi, '').trim() || 'Software Development';
  const isLanguageSpecified = /\b(hindi|spanish|french|german|tamil|telugu|marathi|bengali|portuguese|russian|japanese|chinese|korean)\b/i.test(queryText);
  const langSuffix = isLanguageSpecified ? '' : ' in English';

  return [
    {
      topic: `1. Fundamentals & Setup of ${subject}`,
      description: `Core principles, environment setup, and initial configuration for ${subject}.`,
      youtube_query: `${subject} setup and basic syntax tutorial${langSuffix}`,
      completed: false,
    },
    {
      topic: `2. Data Structures & Core Logic`,
      description: `Variables, data types, control flow, functions, and key abstractions in ${subject}.`,
      youtube_query: `${subject} data structures and logic tutorial${langSuffix}`,
      completed: false,
    },
    {
      topic: `3. Intermediate Concepts & Tooling`,
      description: `Working with modules, error handling, standard libraries, and common APIs.`,
      youtube_query: `${subject} intermediate concepts tutorial${langSuffix}`,
      completed: false,
    },
    {
      topic: `4. Advanced Patterns & Architecture`,
      description: `Asynchronous operations, performance tuning, architecture patterns, and scaling.`,
      youtube_query: `${subject} advanced architecture tutorial${langSuffix}`,
      completed: false,
    },
    {
      topic: `5. Hands-on Project & Best Practices`,
      description: `Building a real-world project, testing, deployment, and practical application.`,
      youtube_query: `${subject} full practical project tutorial${langSuffix}`,
      completed: false,
    },
  ];
}

// ---------------- GET ALL SAVED ROADMAPS ----------------
router.get('/my-roadmaps', authMiddleware, async (req, res) => {
  const service = getService();
  if (!service) {
    return res.status(503).json({ error: { code: 'service_unavailable', message: 'Roadmap database service is unavailable.' } });
  }

  const userId = req.user?.id;
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Valid user authentication required.' });
  }

  try {
    const roadmaps = await service.getRoadmaps(userId);
    res.json(roadmaps);
  } catch (error) {
    legacyLogger.error('list_failed', error);
    res.status(500).json({ error: 'Failed to fetch saved roadmaps.' });
  }
});

// ---------------- UPDATE ROADMAP PROGRESS ----------------
router.put('/progress', authMiddleware, async (req, res) => {
  const service = getService();
  if (!service) {
    return res.status(503).json({ error: { code: 'service_unavailable', message: 'Roadmap database service is unavailable.' } });
  }

  const userId = req.user?.id;
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Valid user authentication required.' });
  }

  const { roadmapId, topicId, topic, completed } = req.body;

  try {
    const updated = await service.updateTopicProgress(userId, {
      roadmapId,
      topicId,
      topicTitle: topic,
      completed,
    });
    res.json({ message: 'Progress updated successfully!', topic: updated });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: 'Topic or roadmap not found.' });
    }
    legacyLogger.error('progress_update_failed', error);
    res.status(500).json({ error: 'Server error updating progress.' });
  }
});

// ---------------- DELETE A ROADMAP ----------------
router.delete('/:roadmapId', authMiddleware, async (req, res) => {
  const service = getService();
  if (!service) {
    return res.status(503).json({ error: { code: 'service_unavailable', message: 'Roadmap database service is unavailable.' } });
  }

  const userId = req.user?.id;
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Valid user authentication required.' });
  }

  const { roadmapId } = req.params;

  try {
    await service.deleteRoadmap(userId, roadmapId);
    res.json({ message: 'Roadmap deleted successfully.' });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: 'Roadmap not found.' });
    }
    legacyLogger.error('delete_failed', error);
    res.status(500).json({ error: 'Failed to delete roadmap.' });
  }
});

module.exports = router;
