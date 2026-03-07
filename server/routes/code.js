const express = require("express");
const router = express.Router();
const axios = require("axios");
const authMiddleware = require("../middleware/authMiddleware");

// --- Language Mapping: Frontend value → Piston language identifier ---
const LANGUAGE_MAP = {
  python: "python",
  javascript: "javascript",
  java: "java",
  cpp: "c++",
  c: "c",
  rust: "rust",
  ruby: "ruby",
  sqlite: "sqlite3",
  go: "go",
  php: "php",
  kotlin: "kotlin",
  swift: "swift",
  scala: "scala",
  dart: "dart",
  perl: "perl",
  r: "rscript",
  elixir: "elixir",
  cobol: "cobol",
  nasm: "nasm",
  powershell: "pwsh",
  bash: "bash",
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
  /\benv\b/i, // access environment variables
  /\bexport\b/i, // set environment variables
  /\/etc\/(passwd|shadow|hosts)/i, // sensitive system files
  /\/proc\//i, // process filesystem
  /\bsudo\b/i, // privilege escalation
  /\bsu\b\s/i, // switch user
  /\bsystemctl\b/i, // service control
  /\bapt(-get)?\b/i, // package manager
  /\byum\b/i, // package manager
  /\bdnf\b/i, // package manager
  /\bpip\s+install\b/i, // python package install
  /\bnpm\s+install\b/i, // node package install
  /\b>\s*\/dev\//i, // writing to devices
  /\bmount\b/i, // mounting filesystems
  /\bumount\b/i, // unmounting filesystems
];

function isShellLanguage(lang) {
  return lang === "bash" || lang === "powershell";
}

function containsDangerousCommands(code) {
  return BLOCKED_SHELL_PATTERNS.some((pattern) => pattern.test(code));
}

// --- SQLite: Prepend sample database schema for learning ---
const SQLITE_PRELOAD = `-- Pre-loaded sample database for learning
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  age INTEGER,
  grade TEXT,
  gpa REAL
);

INSERT INTO students VALUES (1, 'Alice', 20, 'A', 3.9);
INSERT INTO students VALUES (2, 'Bob', 22, 'B', 3.2);
INSERT INTO students VALUES (3, 'Charlie', 21, 'A', 3.7);
INSERT INTO students VALUES (4, 'Diana', 23, 'C', 2.8);
INSERT INTO students VALUES (5, 'Eve', 20, 'A', 3.95);

CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  credits INTEGER,
  department TEXT
);

INSERT INTO courses VALUES (1, 'Intro to CS', 3, 'Computer Science');
INSERT INTO courses VALUES (2, 'Data Structures', 4, 'Computer Science');
INSERT INTO courses VALUES (3, 'Linear Algebra', 3, 'Mathematics');
INSERT INTO courses VALUES (4, 'Physics 101', 4, 'Physics');

CREATE TABLE enrollments (
  student_id INTEGER,
  course_id INTEGER,
  semester TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

INSERT INTO enrollments VALUES (1, 1, 'Fall 2024');
INSERT INTO enrollments VALUES (1, 3, 'Fall 2024');
INSERT INTO enrollments VALUES (2, 2, 'Fall 2024');
INSERT INTO enrollments VALUES (3, 1, 'Fall 2024');
INSERT INTO enrollments VALUES (3, 4, 'Fall 2024');
INSERT INTO enrollments VALUES (4, 2, 'Spring 2025');
INSERT INTO enrollments VALUES (5, 1, 'Fall 2024');
INSERT INTO enrollments VALUES (5, 2, 'Spring 2025');

`;

// @route   POST api/code/run
// @desc    Run user-submitted code via Piston API
// @access  Private
router.post("/run", authMiddleware, async (req, res) => {
  const { code, language } = req.body;
  const PISTON_API_URL = "http://localhost:2000/api/v2/execute";

  if (!code) {
    return res.status(400).json({ error: "No code provided." });
  }

  if (!language) {
    return res.status(400).json({ error: "No language specified." });
  }

  // Map frontend language to Piston identifier
  const pistonLanguage = LANGUAGE_MAP[language];
  if (!pistonLanguage) {
    return res
      .status(400)
      .json({ error: `Language "${language}" is not supported.` });
  }

  // Security check for shell languages
  if (isShellLanguage(language) && containsDangerousCommands(code)) {
    return res.status(400).json({
      error:
        "⚠️ Security Error: Your code contains blocked commands. Shell scripts are sandboxed and cannot access the host system, network, or perform destructive operations.",
    });
  }

  try {
    // For SQLite, prepend the sample database
    let finalCode = code;
    if (language === "sqlite") {
      finalCode = SQLITE_PRELOAD + code;
    }

    const payload = {
      language: pistonLanguage,
      version: "*",
      files: [{ content: finalCode }],
      stdin: "",
    };

    const { data: result } = await axios.post(PISTON_API_URL, payload);

    // Check for compilation errors (non-zero exit code)
    if (result.compile && result.compile.code !== 0) {
      return res.status(400).json({ error: result.compile.stderr || result.compile.output });
    }

    // Check for runtime errors (non-zero exit code)
    if (result.run.code !== 0) {
      return res.status(400).json({ error: result.run.stderr || result.run.output });
    }

    // Send back the standard output (include warnings if any)
    let output = result.run.stdout;
    if (result.run.stderr) {
      output += "\n[Warnings]\n" + result.run.stderr;
    }
    res.json({ output });
  } catch (apiError) {
    console.error(
      "Piston API Error:",
      apiError.response ? apiError.response.data : apiError.message,
    );
    res.status(500).json({
      error:
        "Error executing code via API. The service may be temporarily down.",
    });
  }
});

module.exports = router;
