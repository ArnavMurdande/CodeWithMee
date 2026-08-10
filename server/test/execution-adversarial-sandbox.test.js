'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPostgresChallengeRepository } = require('../modules/challenges/postgres-repository');
const { createChallengeService } = require('../modules/challenges/service');

function createMockPool() {
  const challenges = new Map();
  const versions = new Map();
  const testCases = new Map();
  const solves = new Set();
  const submissions = [];

  return {
    async connect() {
      return {
        async query(sql, params) {
          return mockQuery(sql, params, challenges, versions, testCases, solves, submissions);
        },
        release() {},
      };
    },
    async query(sql, params) {
      return mockQuery(sql, params, challenges, versions, testCases, solves, submissions);
    },
  };
}

function mockQuery(sql, params, challenges, versions, testCases, solves, submissions) {
  const norm = sql.trim().replace(/\s+/g, ' ');

  if (norm.startsWith('BEGIN') || norm.startsWith('COMMIT') || norm.startsWith('ROLLBACK')) {
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('INSERT INTO challenges')) {
    const id = '10000000-0000-4000-8000-00000000000' + (challenges.size + 1);
    const row = { id, title: params[0], status: 'PUBLISHED', score: params[2], created_at: new Date() };
    challenges.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO challenge_versions')) {
    const id = '20000000-0000-4000-8000-00000000000' + (versions.size + 1);
    const row = { id, challenge_id: params[0], version: params[1] };
    versions.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO challenge_test_cases')) {
    const id = '30000000-0000-4000-8000-00000000000' + (testCases.size + 1);
    const row = { id, version_id: params[0], position: params[1], input: params[2], expected_output: params[3], visibility: params[4] };
    testCases.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('SELECT 1 FROM challenge_versions')) {
    const vid = params[0];
    const cid = params[1];
    const match = Array.from(versions.values()).find((v) => v.id === vid && v.challenge_id === cid);
    return { rows: match ? [{ 1: 1 }] : [], rowCount: match ? 1 : 0 };
  }

  if (norm.includes('INSERT INTO challenge_solves')) {
    solves.add(`${params[0]}:${params[1]}`);
    return { rows: [], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO challenge_submissions')) {
    const sub = {
      id: '40000000-0000-4000-8000-00000000000' + (submissions.length + 1),
      challenge_id: params[0],
      version_id: params[1],
      user_id: params[2],
      language: params[3],
      code: params[4],
      status: params[5],
      score: params[6],
      pass_count: params[7],
      total_count: params[8],
      created_at: new Date(),
    };
    submissions.push(sub);
    return { rows: [sub], rowCount: 1 };
  }

  if (norm.includes('SELECT c.id, c.title')) {
    const cid = params[0];
    const c = challenges.get(cid);
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }

  if (norm.includes('SELECT v.id, v.challenge_id')) {
    const cid = params[0];
    const match = Array.from(versions.values()).find((v) => v.challenge_id === cid);
    return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
  }

  if (norm.includes('SELECT id, version_id, position')) {
    const vid = params[0];
    const rows = Array.from(testCases.values()).filter((tc) => tc.version_id === vid);
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

test('P1B-S6: adversarial attempt trying to print environment variables or secrets fails closed without leaking server context', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresChallengeRepository(mockPool);
  const service = createChallengeService({ repository });
  const authorId = '00000000-0000-4000-8000-000000000001';
  const learnerId = '00000000-0000-4000-8000-000000000002';

  const created = await service.createChallenge(authorId, {
    title: 'Adversarial Test',
    difficulty: 'Hard',
    score: 50,
    statement: 'Adversarial attempt',
    referenceSolution: 'Pass',
    testCases: [
      { input: 'input1', expectedOutput: 'output1', visibility: 'visible' },
      { input: 'SUPER_SECRET_TOKEN_999', expectedOutput: 'CONFIDENTIAL_RESULT', visibility: 'hidden' },
    ],
  });

  const mockGateway = {
    async executeJob(lang, code, stdin) {
      if (stdin.includes('SUPER_SECRET_TOKEN_999')) {
        return {
          stdout: 'ATTEMPT_READ_SECRET',
          stderr: 'Traceback: SECRET_KEY_LEAK=super_secret_123',
          exitCode: 1,
        };
      }
      return { stdout: 'output1', stderr: '', exitCode: 0 };
    },
  };

  const res = await service.submitCodeForLearner(
    learnerId,
    created.id,
    { language: 'python', code: 'import os; print(os.environ)' },
    mockGateway
  );

  assert.equal(res.status, 'RUNTIME_ERROR');
  assert.equal(res.failedTestCaseIndex, 2);

  // Hidden test case result must NOT leak hidden input, expected output, or raw stderr
  assert.equal(res.actualOutput, null);
  assert.equal(res.errorOutput, null);
});
