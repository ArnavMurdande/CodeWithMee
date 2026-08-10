'use strict';

const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const { SQLITE_PRELOAD, sanitizeStderr } = require('./sqlite-preload');

const LANGUAGES = new Set(['python','javascript','java','cpp','c','rust','ruby','sqlite','go','php','kotlin','swift','scala','dart','perl','r','elixir','cobol','nasm','powershell','bash']);

function createExecutionRouter({ jobQueue, runnerGateway }) {
  if (!jobQueue || !runnerGateway) throw new Error('Execution queue and gateway are required.');
  const router = express.Router();
  router.post('/run', authMiddleware, async (req, res, next) => {
    let code = req.body?.code;
    const language = String(req.body?.language || '').toLowerCase();
    const stdin = typeof req.body?.stdin === 'string' ? req.body.stdin : '';
    if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code, 'utf8') > 100_000) {
      return res.status(400).json({ error: { code: 'invalid_code' } });
    }
    if (!LANGUAGES.has(language)) return res.status(400).json({ error: { code: 'unsupported_language' } });
    if (Buffer.byteLength(stdin, 'utf8') > 64_000) return res.status(400).json({ error: { code: 'stdin_too_large' } });
    
    if (language === 'sqlite') {
      code = SQLITE_PRELOAD + code;
    }

    try {
      const result = await jobQueue.enqueueJob(
        (signal) => runnerGateway.executeJob(language, code, stdin, 10_000, { signal }),
        12_000,
        { language, operationType: 'RUN', userId: req.user.id },
      );
      const cleanStderrStr = sanitizeStderr(result.stderr);
      const output = [result.stdout, cleanStderrStr].filter(Boolean).join(result.stdout && cleanStderrStr ? '\n\n' : '');
      res.json({ exitCode: result.exitCode, output, stderr: cleanStderrStr, stdout: result.stdout || '' });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: { code: error.code || 'execution_failed' } });
      next(error);
    }
  });
  return router;
}

module.exports = { LANGUAGES, createExecutionRouter };
