'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPostgresChallengeRepository } = require('../modules/challenges/postgres-repository');
const { createChallengeService } = require('../modules/challenges/service');

function createMockPool() {
  const challenges = new Map();
  const versions = new Map();
  const testCases = new Map();
  const submissions = [];

  return {
    async connect() {
      return {
        async query(sql, params) {
          return mockQuery(sql, params, challenges, versions, testCases, submissions);
        },
        release() {},
      };
    },
    async query(sql, params) {
      return mockQuery(sql, params, challenges, versions, testCases, submissions);
    },
  };
}

function mockQuery(sql, params, challenges, versions, testCases, submissions) {
  const norm = sql.trim().replace(/\s+/g, ' ');

  if (norm.startsWith('BEGIN') || norm.startsWith('COMMIT') || norm.startsWith('ROLLBACK')) {
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('INSERT INTO challenges')) {
    const id = '10000000-0000-4000-8000-00000000000' + (challenges.size + 1);
    const row = { id, title: params[0], status: 'PUBLISHED', created_at: new Date() };
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

  if (norm.includes('FROM challenge_submissions')) {
    const uid = params[0];
    const rows = submissions.filter((s) => s.user_id === uid);
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

test('P1B-S5: getSubmissionsForLearner enforces strict user isolation and retrieves user submissions', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresChallengeRepository(mockPool);
  const service = createChallengeService({ repository });
  const authorId = '00000000-0000-4000-8000-000000000001';
  const learnerId1 = '00000000-0000-4000-8000-000000000002';
  const learnerId2 = '00000000-0000-4000-8000-000000000003';

  const created = await service.createChallenge(authorId, {
    title: 'History Challenge',
    difficulty: 'Easy',
    score: 100,
    statement: 'Test history',
    referenceSolution: 'Pass',
    testCases: [{ input: '1', expectedOutput: '1', visibility: 'visible' }],
  });

  const mockGateway = {
    async executeJob() {
      return { stdout: '1', stderr: '', exitCode: 0 };
    },
  };

  // Learner 1 submits
  await service.submitCodeForLearner(
    learnerId1,
    created.id,
    { language: 'python', code: 'print(1)' },
    mockGateway
  );

  // Learner 2 submits
  await service.submitCodeForLearner(
    learnerId2,
    created.id,
    { language: 'python', code: 'print(1)' },
    mockGateway
  );

  // Learner 1 gets history -> must contain only learner 1's submission
  const history1 = await service.getSubmissionsForLearner(learnerId1, created.id);
  assert.equal(history1.items.length, 1);
  assert.equal(history1.items[0].userId, learnerId1);

  // Learner 2 gets history -> must contain only learner 2's submission
  const history2 = await service.getSubmissionsForLearner(learnerId2, created.id);
  assert.equal(history2.items.length, 1);
  assert.equal(history2.items[0].userId, learnerId2);
});
