'use strict';

const EXECUTION_MODE = Object.freeze({
  STDIN_STDOUT: 'stdin_stdout',
  FUNCTION_HARNESS: 'function_harness',
  CUSTOM_CHECKER: 'custom_checker',
});

/**
 * Builds code execution payload wrapping user code with language/mode-specific drivers.
 */
function buildExecutionHarness(language, mode = EXECUTION_MODE.STDIN_STDOUT, userCode = '', testCase = {}, entryFunctionName = 'solution') {
  const input = testCase.input || '';

  if (mode === EXECUTION_MODE.STDIN_STDOUT) {
    return {
      code: userCode,
      stdin: input,
    };
  }

  if (mode === EXECUTION_MODE.FUNCTION_HARNESS) {
    if (language === 'python') {
      const driver = `
${userCode}

import sys, json

try:
    raw_input = """${input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"""
    args = json.loads("[" + raw_input + "]") if raw_input.strip() else []
    result = ${entryFunctionName}(*args)
    print(json.dumps(result))
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;
      return { code: driver, stdin: '' };
    }

    if (language === 'javascript') {
      const driver = `
${userCode}

try {
  const rawInput = \`${input.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
  const args = rawInput.trim() ? JSON.parse("[" + rawInput + "]") : [];
  const result = ${entryFunctionName}(...args);
  console.log(JSON.stringify(result));
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
`;
      return { code: driver, stdin: '' };
    }
  }

  // Fallback for custom or direct execution
  return {
    code: userCode,
    stdin: input,
  };
}

/**
 * Evaluates whether test output matches expectedOutput according to mode.
 */
function evaluateTestResult(mode, stdout = '', stderr = '', exitCode = 0, expectedOutput = '') {
  const cleanStdout = (stdout || '').trim();
  const cleanExpected = (expectedOutput || '').trim();

  if (exitCode !== 0) {
    return {
      passed: false,
      status: 'RUNTIME_ERROR',
      actualOutput: cleanStdout,
      errorOutput: (stderr || '').trim() || 'Process exited with non-zero exit code.',
    };
  }

  if (mode === EXECUTION_MODE.FUNCTION_HARNESS) {
    let normalizedActual = cleanStdout;
    let normalizedExpected = cleanExpected;
    try {
      normalizedActual = JSON.stringify(JSON.parse(cleanStdout));
      normalizedExpected = JSON.stringify(JSON.parse(cleanExpected));
    } catch {
      // Fallback to direct string compare if not valid JSON
    }
    const passed = normalizedActual === normalizedExpected;
    return {
      passed,
      status: passed ? 'PASSED' : 'WRONG_ANSWER',
      actualOutput: cleanStdout,
      errorOutput: stderr ? stderr.trim() : null,
    };
  }

  const passed = cleanStdout === cleanExpected;
  return {
    passed,
    status: passed ? 'PASSED' : 'WRONG_ANSWER',
    actualOutput: cleanStdout,
    errorOutput: stderr ? stderr.trim() : null,
  };
}

module.exports = {
  EXECUTION_MODE,
  buildExecutionHarness,
  evaluateTestResult,
};
