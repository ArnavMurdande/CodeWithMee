'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPostgresChallengeRepository } = require('../modules/challenges/postgres-repository');
const { createChallengeService } = require('../modules/challenges/service');

function createMockPool() {
  const challenges = new Map();
  const versions = new Map();
  const testCases = new Map();

  return {
    async connect() {
      return {
        async query(sql, params) {
          return mockQuery(sql, params, challenges, versions, testCases);
        },
        release() {},
      };
    },
    async query(sql, params) {
      return mockQuery(sql, params, challenges, versions, testCases);
    },
  };
}

function mockQuery(sql, params, challenges, versions, testCases) {
  const norm = sql.trim().replace(/\s+/g, ' ');

  if (norm.startsWith('BEGIN') || norm.startsWith('COMMIT') || norm.startsWith('ROLLBACK')) {
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('INSERT INTO challenges')) {
    const id = '10000000-0000-4000-8000-00000000000' + (challenges.size + 1);
    const row = {
      id,
      title: params[0],
      difficulty: params[2] || 'EASY',
      status: 'PUBLISHED',
      score: 100,
      tags: [],
      created_by_user_id: params[3],
      created_at: new Date(),
      updated_at: new Date(),
    };
    challenges.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO challenge_versions')) {
    const id = '20000000-0000-4000-8000-00000000000' + (versions.size + 1);
    const row = {
      id,
      challenge_id: params[0],
      version: 1,
      statement: 'Statement text',
      constraints_text: '',
      reference_solution: '',
      starter_templates: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2] || {},
      created_at: new Date(),
    };
    versions.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO challenge_test_cases')) {
    const id = '30000000-0000-4000-8000-00000000000' + (testCases.size + 1);
    const row = {
      id,
      version_id: params[0],
      position: params[1],
      input: params[2],
      expected_output: params[3],
      visibility: params[4],
    };
    testCases.set(id, row);
    return { rows: [row], rowCount: 1 };
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
    let rows = Array.from(testCases.values()).filter((tc) => tc.version_id === vid);
    if (norm.includes("AND visibility = 'visible'")) {
      rows = rows.filter((tc) => tc.visibility === 'visible');
    }
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

test('P1B-S3: runCodeForLearner evaluates code against visible test cases and returns formatted outputs', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresChallengeRepository(mockPool);
  const service = createChallengeService({ repository });
  const authorId = '00000000-0000-4000-8000-000000000001';

  const created = await service.createChallenge(authorId, {
    title: 'Run Code Challenge',
    difficulty: 'Easy',
    score: 100,
    statement: 'Run code test',
    referenceSolution: 'Pass',
    testCases: [
      { input: 'input1', expectedOutput: 'output1', visibility: 'visible' },
      { input: 'input2', expectedOutput: 'output2', visibility: 'hidden' },
    ],
  });

  const mockGateway = {
    async executeJob(lang, code, stdin) {
      if (stdin === 'input1') return { stdout: 'output1', stderr: '', exitCode: 0 };
      return { stdout: 'output2', stderr: '', exitCode: 0 };
    },
  };

  const res = await service.runCodeForLearner(
    created.id,
    { language: 'python', code: 'print("output1")' },
    mockGateway
  );

  assert.equal(res.challengeId, created.id);
  assert.equal(res.results.length, 1); // Only visible test cases executed for runCode
  assert.equal(res.results[0].passed, true);
  assert.equal(res.results[0].actualOutput, 'output1');
});

test('P1B-S3: runCodeForLearner fails closed with 503 runner_unavailable when gateway is down', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresChallengeRepository(mockPool);
  const service = createChallengeService({ repository });
  const authorId = '00000000-0000-4000-8000-000000000001';

  const created = await service.createChallenge(authorId, {
    title: 'Runner Down Challenge',
    difficulty: 'Easy',
    score: 100,
    statement: 'Run code test',
    referenceSolution: 'Pass',
    testCases: [{ input: '1', expectedOutput: '1', visibility: 'visible' }],
  });

  const mockGatewayDown = {
    async executeJob() {
      const err = new Error('Runner service unavailable');
      err.code = 'runner_unavailable';
      err.status = 503;
      throw err;
    },
  };

  await assert.rejects(
    service.runCodeForLearner(created.id, { language: 'python', code: 'print(1)' }, mockGatewayDown),
    (err) => err.status === 503 && err.code === 'runner_unavailable'
  );
});
