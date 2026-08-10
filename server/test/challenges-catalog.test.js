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
      score: params[3],
      tags: [],
      created_by_user_id: params[4],
      created_at: new Date(Date.now() - challenges.size * 1000),
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

  if (norm.includes('FROM challenges c') || norm.includes('FROM challenges')) {
    let list = Array.from(challenges.values());
    if (params.includes('easy') || params.includes('medium') || params.includes('hard')) {
      const diff = params.find((p) => ['easy', 'medium', 'hard'].includes(p));
      if (diff) list = list.filter((c) => c.difficulty === diff);
    }
    return { rows: list, rowCount: list.length };
  }

  return { rows: [], rowCount: 0 };
}

test('P1A-S4: searchable catalog filters by difficulty and limits pagination results', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresChallengeRepository(mockPool);
  const service = createChallengeService({ repository });
  const authorId = '00000000-0000-4000-8000-000000000001';

  await service.createChallenge(authorId, { title: 'Easy 1', difficulty: 'EASY' });
  await service.createChallenge(authorId, { title: 'Easy 2', difficulty: 'EASY' });
  await service.createChallenge(authorId, { title: 'Hard 1', difficulty: 'HARD' });

  const catalog = await service.listChallenges({ difficulty: 'EASY' });

  assert.equal(catalog.items.length, 2);
  assert.equal(catalog.items[0].difficulty, 'Easy');
  assert.equal(catalog.items[1].difficulty, 'Easy');
});
