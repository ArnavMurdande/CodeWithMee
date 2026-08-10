const express = require('express');
const router = express.Router();
const { generateContentWithRetry } = require('../utils/geminiHelper');
const authMiddleware = require('../middleware/authMiddleware');
const { createLegacyLogger } = require('../utils/legacyLogger');
const {
  CONTENT_FORMAT,
  createDocument,
  normalizeText,
} = require('../modules/content/restricted-content');

const legacyLogger = createLegacyLogger('ai');

const { getPgPool } = require('../db/postgres');

function isUuid(str) {
  return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ---------------- SANDBOX CHAT ROUTE (per pathway/chapter) ----------------
router.post('/chat', authMiddleware, async (req, res) => {
  const { question, code, pathway, chapter } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'A question is required.' });
  }

  const safeQuestion = normalizeText(question, {
    allowEmpty: false,
    field: 'question',
    maximumLength: 4_000,
  });
  const safeCode = normalizeText(code || '', { field: 'code', maximumLength: 100_000 });
  const pathwayKey = normalizeText(pathway || 'General', {
    allowEmpty: false,
    field: 'pathway',
    maximumLength: 255,
  });
  const chapterKey = normalizeText(chapter || 'General', {
    allowEmpty: false,
    field: 'chapter',
    maximumLength: 255,
  });

  try {
    const pool = getPgPool();
    if (!pool || !isUuid(req.user?.id)) return res.status(503).json({ error: { code: 'learning_database_unavailable' } });
    const historyResult = await pool.query(
      `SELECT prompt,response FROM learning_conversations WHERE user_id=$1 AND context='sandbox' AND pathway=$2 AND chapter=$3 ORDER BY occurred_at DESC LIMIT 5`,
      [req.user.id, pathwayKey, chapterKey],
    );
    const chapterHistory = historyResult.rows.reverse()
      .map((conv) => `User asked: "${conv.prompt}"\nMee answered: "${conv.response}"`)
      .join('\n\n');

    const prompt = `
You are a friendly and helpful coding assistant named "Mee".
A user is studying the topic "${chapterKey}" from the pathway "${pathwayKey}".

This is their current code:
\`\`\`
${safeCode || '(No code provided)'}
\`\`\`

Here is the recent conversation history for this chapter:
${chapterHistory || '(No recent history)'}

Now, they have the following new question: "${safeQuestion}"

Provide a concise, helpful, and encouraging answer. Address the user directly.
Keep answers relevant to the pathway and chapter context.
`;

    const result = await generateContentWithRetry('gemini-1.5-flash', prompt);
    const answerDocument = createDocument(
      result.response.text() || 'Sorry, I could not generate a response.',
      { format: CONTENT_FORMAT.RESTRICTED_MARKDOWN, maximumLength: 50_000 },
    );

    try {
      await pool.query(
            `INSERT INTO learning_conversations
             (user_id, context, pathway, chapter, prompt, response, response_format, occurred_at)
             VALUES ($1, 'sandbox', $2, $3, $4, $5, $6, NOW())`,
            [req.user.id, pathwayKey, chapterKey, safeQuestion, answerDocument.text, answerDocument.format]
          );
    } catch (pgErr) { legacyLogger.warn('postgres_ai_chat_save_failed', pgErr); }

    res.json({ answer: answerDocument.text, answerDocument });
  } catch (error) {
    legacyLogger.error('chat_failed', error);
    res.status(500).json({ error: 'Failed to get a response from the AI assistant.' });
  }
});

// ---------------- SANDBOX CHAT HISTORY (per pathway/chapter) ----------------
router.get('/sandbox-history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const pool = getPgPool();
    let pgConvos = [];

    if (pool && isUuid(userId)) {
      try {
        const pgRes = await pool.query(
          `SELECT pathway, chapter, prompt, response, occurred_at AS "timestamp"
           FROM learning_conversations
           WHERE user_id = $1 AND context = 'sandbox'
           ORDER BY occurred_at ASC`,
          [userId]
        );
        pgConvos = pgRes.rows || [];
      } catch (pgErr) {
        legacyLogger.warn('postgres_fetch_sandbox_history_failed', pgErr);
      }
    }

    const convos = pgConvos;
    const pathwayMap = {};

    convos.forEach((c) => {
      const pw = c.pathway || 'General';
      const ch = c.chapter || 'General';
      if (!pathwayMap[pw]) pathwayMap[pw] = {};
      if (!pathwayMap[pw][ch]) pathwayMap[pw][ch] = [];
      pathwayMap[pw][ch].push({
        prompt: c.prompt,
        response: c.response,
        responseDocument: createDocument(c.response, {
          format: CONTENT_FORMAT.RESTRICTED_MARKDOWN,
          maximumLength: 50_000,
        }),
        timestamp: c.timestamp,
      });
    });

    const roadmaps = pool && isUuid(userId) ? await pool.query(
      `SELECT r.id,r.title,COALESCE(jsonb_agg(t.title ORDER BY t.position) FILTER (WHERE t.id IS NOT NULL),'[]') AS chapters
       FROM learning_roadmaps r LEFT JOIN learning_topics t ON t.roadmap_id=r.id WHERE r.user_id=$1 GROUP BY r.id ORDER BY r.position`, [userId]) : { rows: [] };
    const roadmapList = roadmaps.rows;

    res.json({ chatsByPathway: pathwayMap, roadmaps: roadmapList });
  } catch (error) {
    legacyLogger.error('sandbox_history_failed', error);
    res.status(500).json({ error: 'Failed to fetch chat history.' });
  }
});

// ---------------- LEGACY CHAT HISTORY (kept for backward compatibility) ----------------
router.get('/chat-history', authMiddleware, async (req, res) => {
  try {
    const pool = getPgPool();
    if (!pool) return res.status(503).json({ error: { code: 'learning_database_unavailable' } });
    const result = await pool.query('SELECT prompt,response,response_format,occurred_at FROM learning_conversations WHERE user_id=$1 ORDER BY occurred_at DESC LIMIT 20', [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    legacyLogger.error('chat_history_failed', error);
    res.status(500).json({ error: 'Failed to fetch chat history.' });
  }
});

// ---------------- CLEAR CHAT HISTORY ----------------
router.delete('/sandbox-history', authMiddleware, async (req, res) => {
  const { pathway, chapter } = req.query;
  try {
    const pool = getPgPool();
    if (!pool) return res.status(503).json({ error: { code: 'learning_database_unavailable' } });
    await pool.query(
      `DELETE FROM learning_conversations WHERE user_id=$1 AND context='sandbox'
       AND ($2::text IS NULL OR pathway=$2) AND ($3::text IS NULL OR chapter=$3)`,
      [req.user.id, pathway || null, chapter || null],
    );
    res.json({ msg: 'Chat history cleared successfully.' });
  } catch (error) {
    legacyLogger.error('chat_clear_failed', error);
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

    const result = await generateContentWithRetry('gemini-1.5-flash', prompt);
    let answer = result.response.text() || '';

    // Robust extraction: strip markdown code fences or pull out the inner code block
    const codeBlockMatch = answer.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      answer = codeBlockMatch[1].trim();
    } else {
      answer = answer
        .replace(/^```[\w]*\n?/gm, '')
        .replace(/\n?```$/gm, '')
        .trim();
    }

    res.json({ correctedCode: answer });
  } catch (error) {
    legacyLogger.error('debug_failed', error);
    res.status(500).json({ error: 'Failed to debug code.' });
  }
});

module.exports = router;
