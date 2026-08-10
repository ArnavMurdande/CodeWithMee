'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { EXECUTION_MODE, buildExecutionHarness, evaluateTestResult } = require('../modules/challenges/harness');

test('P1A-S2: buildExecutionHarness STDIN_STDOUT passes user code and stdin directly', () => {
  const userCode = 'print(input())';
  const testCase = { input: 'hello world' };

  const harness = buildExecutionHarness('python', EXECUTION_MODE.STDIN_STDOUT, userCode, testCase);

  assert.equal(harness.code, 'print(input())');
  assert.equal(harness.stdin, 'hello world');
});

test('P1A-S2: buildExecutionHarness FUNCTION_HARNESS generates driver for Python', () => {
  const userCode = 'def add(a, b):\n    return a + b';
  const testCase = { input: '1, 2' };

  const harness = buildExecutionHarness('python', EXECUTION_MODE.FUNCTION_HARNESS, userCode, testCase, 'add');

  assert.ok(harness.code.includes('def add(a, b):'));
  assert.ok(harness.code.includes('result = add(*args)'));
  assert.ok(harness.code.includes('print(json.dumps(result))'));
});

test('P1A-S2: buildExecutionHarness FUNCTION_HARNESS generates driver for JavaScript', () => {
  const userCode = 'function add(a, b) { return a + b; }';
  const testCase = { input: '1, 2' };

  const harness = buildExecutionHarness('javascript', EXECUTION_MODE.FUNCTION_HARNESS, userCode, testCase, 'add');

  assert.ok(harness.code.includes('function add(a, b)'));
  assert.ok(harness.code.includes('const result = add(...args);'));
  assert.ok(harness.code.includes('console.log(JSON.stringify(result));'));
});

test('P1A-S2: evaluateTestResult handles PASSED, WRONG_ANSWER, and RUNTIME_ERROR correctly', () => {
  const passRes = evaluateTestResult(EXECUTION_MODE.STDIN_STDOUT, 'hello\n', '', 0, 'hello');
  assert.equal(passRes.passed, true);
  assert.equal(passRes.status, 'PASSED');

  const failRes = evaluateTestResult(EXECUTION_MODE.STDIN_STDOUT, 'wrong\n', '', 0, 'hello');
  assert.equal(failRes.passed, false);
  assert.equal(failRes.status, 'WRONG_ANSWER');

  const errRes = evaluateTestResult(EXECUTION_MODE.STDIN_STDOUT, '', 'IndexError: out of bounds', 1, 'hello');
  assert.equal(errRes.passed, false);
  assert.equal(errRes.status, 'RUNTIME_ERROR');
  assert.ok(errRes.errorOutput.includes('IndexError'));
});
