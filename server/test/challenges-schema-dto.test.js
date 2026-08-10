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
      status: 'DRAFT',
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
    const rows = Array.from(testCases.values()).filter((tc) => tc.version_id === vid);
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

test('P1A-S1: challenge repository creates versioned challenge with starter templates', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresChallengeRepository(mockPool);
  const service = createChallengeService({ repository });
  const authorId = '00000000-0000-4000-8000-000000000001';

  const created = await service.createChallenge(authorId, {
    title: 'Reverse String',
    difficulty: 'Easy',
    score: 100,
    statement: 'Reverse input string',
    referenceSolution: 'return s[::-1]',
    starterTemplates: { python: 'def reverse_string(s):\n    pass' },
    testCases: [{ input: 'hello', expectedOutput: 'olleh', visibility: 'visible' }],
  });

  assert.ok(created.id);
  assert.equal(created.title, 'Reverse String');
  assert.equal(created.starterTemplates.python, 'def reverse_string(s):\n    pass');
});
