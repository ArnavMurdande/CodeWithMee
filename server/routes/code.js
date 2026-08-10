'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');
const { getRuntimeConfig } = require('../config/runtime');
const { createLegacyLogger } = require('../utils/legacyLogger');

const legacyLogger = createLegacyLogger('code');

// --- Language Mapping: Frontend value → Piston language identifier ---
const LANGUAGE_MAP = {
  python: 'python',
  javascript: 'javascript',
  java: 'java',
  cpp: 'c++',
  c: 'c',
  rust: 'rust',
  ruby: 'ruby',
  sqlite: 'sqlite3',
  go: 'go',
  php: 'php',
  kotlin: 'kotlin',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  perl: 'perl',
  r: 'rscript',
  elixir: 'elixir',
  cobol: 'cobol',
  nasm: 'nasm',
  powershell: 'pwsh',
  bash: 'bash',
};

// --- Security: Block dangerous commands in shell languages ---
const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+(-\w+\s+)*\//i, // rm with absolute paths
  /\brm\s+(-\w+\s+)*~/i, // rm home directory
  /\brm\s+-rf?\s/i, // rm -rf / rm -r
  /\bcurl\b/i, // network requests
  /\bwget\b/i, // network downloads
  /\bnc\b/i, // netcat
  /\bssh\b/i, // ssh connections
  /\bscp\b/i, // secure copy
  /\bchmod\b/i, // change permissions
  /\bchown\b/i, // change ownership
  /\bmkfs\b/i, // format filesystem
  /\bdd\b.*\bof=/i, // disk destroyer
  /\b(shutdown|reboot|halt|init)\b/i, // system control
  /\bkill(all)?\s/i, // kill processes
  /\benv\b/i, // view env
  /\bexport\b/i, // export env
  /\/etc\/(passwd|shadow|hosts)/i, // sensitive files
  /\/proc\//i, // process info
  /\bsudo\b/i, // privilege escalation
  /\bsu\b\s/i, // switch user
  /\bsystemctl\b/i, // service control
  /\bapt(-get)?\b/i, // package manager
  /\byum\b/i, // package manager
  /\bdnf\b/i, // package manager
  /\bmount\b/i, // mount
  /\bumount\b/i, // unmount
];

function isShellLanguage(lang) {
  return lang === 'bash' || lang === 'powershell';
}

function containsDangerousCommands(code) {
  return BLOCKED_SHELL_PATTERNS.some((p) => p.test(code));
}

const { SQLITE_PRELOAD, sanitizeStderr } = require('../modules/execution/sqlite-preload');

// @route   POST api/code/run
// @desc    Run user-submitted code via sandboxed execution gateway (Piston API)
// @access  Private
router.post('/run', authMiddleware, async (req, res) => {
  const { code, language } = req.body;
  const { pistonApiUrl } = getRuntimeConfig();

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'No code provided.' });
  }

  if (!language || typeof language !== 'string') {
    return res.status(400).json({ error: 'No language specified.' });
  }

  const pistonLanguage = LANGUAGE_MAP[language];
  if (!pistonLanguage) {
    return res
      .status(400)
      .json({ error: `Language "${language}" is not supported.` });
  }

  if (isShellLanguage(language) && containsDangerousCommands(code)) {
    return res.status(400).json({
      error:
        '⚠️ Security Error: Your code contains blocked commands. Shell scripts are sandboxed and cannot access the host system, network, or perform destructive operations.',
    });
  }

  try {
    let finalCode = code;
    if (language === 'sqlite') {
      finalCode = SQLITE_PRELOAD + code;
    }

    let fileName = 'script';
    if (language === 'kotlin') fileName = 'Main.kt';
    if (language === 'java') fileName = 'Main.java';
    if (language === 'cpp') fileName = 'main.cpp';
    if (language === 'c') fileName = 'main.c';
    if (language === 'r') fileName = 'script.R';
    if (language === 'rust') fileName = 'main.rs';

    const payload = {
      language: pistonLanguage,
      version: '*',
      files: [{ name: fileName, content: finalCode }],
      stdin: '',
    };

    const { data: result } = await axios.post(pistonApiUrl, payload);

    if (result.compile && result.compile.code !== 0) {
      return res.status(400).json({ error: result.compile.stderr || result.compile.output });
    }

    if (result.run && result.run.code !== 0) {
      return res.status(400).json({ error: result.run.stderr || result.run.output });
    }

    let output = (result.run && result.run.stdout) || '';
    const cleanErr = sanitizeStderr(result.run && result.run.stderr);
    if (cleanErr) {
      output += '\n[Warnings]\n' + cleanErr;
    }
    res.json({ output });
  } catch (apiError) {
    legacyLogger.error('runner_request_failed', apiError);
    res.status(503).json({
      error: {
        code: 'runner_unavailable',
        message: 'Code execution service is currently unavailable. Failing closed for secure execution.',
      },
    });
  }
});

module.exports = router;
