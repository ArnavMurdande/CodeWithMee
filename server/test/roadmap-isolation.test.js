'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPostgresRoadmapRepository } = require('../modules/learning/postgres-roadmap-repository');
const { createRoadmapService } = require('../modules/learning/roadmap-service');

function createMockPool() {
  const roadmaps = new Map(); // id -> { id, user_id, title }
  const topics = new Map();   // id -> { id, roadmap_id, title, description, youtube_query, completed, position }

  return {
    async connect() {
      return {
        async query(sql, params) {
          return mockQuery(sql, params, roadmaps, topics);
        },
        release() {},
      };
    },
    async query(sql, params) {
      return mockQuery(sql, params, roadmaps, topics);
    },
  };
}

function mockQuery(sql, params, roadmaps, topics) {
  const norm = sql.trim().replace(/\s+/g, ' ');

  if (norm.startsWith('BEGIN') || norm.startsWith('COMMIT') || norm.startsWith('ROLLBACK')) {
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('INSERT INTO learning_roadmaps')) {
    const id = (roadmaps.size + 1).toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';
    const row = { id, user_id: params[0], title: params[1], position: params[2] || 0, created_at: new Date(), updated_at: new Date() };
    roadmaps.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO learning_topics')) {
    const id = (topics.size + 1).toString(16).padStart(8, '0') + '-0000-4000-9000-000000000000';
    const row = { id, roadmap_id: params[0], title: params[1], description: params[2], youtube_query: params[3], completed: Boolean(params[4]), position: params[5] };
    topics.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('FROM learning_roadmaps r LEFT JOIN learning_topics t')) {
    const isSingle = norm.includes('WHERE r.id = $1 AND r.user_id = $2');
    const userId = isSingle ? params[1] : params[0];
    const roadmapId = isSingle ? params[0] : null;

    const rows = [];
    for (const r of roadmaps.values()) {
      if (r.user_id === userId && (!roadmapId || r.id === roadmapId)) {
        let topicFound = false;
        for (const t of topics.values()) {
          if (t.roadmap_id === r.id) {
            topicFound = true;
            rows.push({
              roadmap_id: r.id,
              roadmap_title: r.title,
              created_at: r.created_at,
              updated_at: r.updated_at,
              topic_id: t.id,
              topic_title: t.title,
              description: t.description,
              youtube_query: t.youtube_query,
              completed: t.completed,
              position: t.position,
            });
          }
        }
        if (!topicFound) {
          rows.push({
            roadmap_id: r.id,
            roadmap_title: r.title,
            created_at: r.created_at,
            updated_at: r.updated_at,
            topic_id: null,
            topic_title: null,
          });
        }
      }
    }
    return { rows, rowCount: rows.length };
  }

  if (norm.includes('UPDATE learning_topics t SET completed = $1 FROM learning_roadmaps r')) {
    const isCompleted = params[0];

    const matchByTopicId = norm.includes('AND t.id = $2');
    let topicId = null;
    let userId = null;
    let targetRoadmapId = null;
    let topicTitle = null;

    if (matchByTopicId) {
      topicId = params[1];
      userId = params[2];
      targetRoadmapId = params[3];
    } else {
      targetRoadmapId = params[1];
      topicTitle = params[2];
      userId = params[3];
    }

    const updatedRows = [];
    for (const t of topics.values()) {
      const r = roadmaps.get(t.roadmap_id);
      if (r && r.user_id === userId) {
        if (matchByTopicId) {
          if (t.id === topicId && (!targetRoadmapId || t.roadmap_id === targetRoadmapId)) {
            t.completed = isCompleted;
            updatedRows.push(t);
          }
        } else {
          if (t.roadmap_id === targetRoadmapId && (t.title === topicTitle || t.youtube_query === topicTitle)) {
            t.completed = isCompleted;
            updatedRows.push(t);
          }
        }
      }
    }
    return { rows: updatedRows, rowCount: updatedRows.length };
  }

  if (norm.includes('DELETE FROM learning_roadmaps WHERE id = $1 AND user_id = $2')) {
    const targetId = params[0];
    const targetUserId = params[1];
    const r = roadmaps.get(targetId);
    if (r && r.user_id === targetUserId) {
      roadmaps.delete(targetId);
      for (const [tid, t] of topics.entries()) {
        if (t.roadmap_id === targetId) topics.delete(tid);
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  return { rows: [], rowCount: 0 };
}

test('Roadmap PostgreSQL service enforces strict cross-user data isolation', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresRoadmapRepository(mockPool);
  const service = createRoadmapService({ repository });

  const userA = '11111111-1111-1111-1111-111111111111';
  const userB = '22222222-2222-2222-2222-222222222222';

  // 1. User A and User B create roadmaps with IDENTICAL topic titles
  const roadmapA = await service.createRoadmap(userA, {
    title: 'Python Mastery',
    topics: [{ topic: 'Variables & Data Types', youtube_query: 'python vars' }],
  });

  const roadmapB = await service.createRoadmap(userB, {
    title: 'Python Mastery',
    topics: [{ topic: 'Variables & Data Types', youtube_query: 'python vars' }],
  });

  assert.notEqual(roadmapA.id, roadmapB.id);
  assert.equal(roadmapA.topics[0].completed, false);
  assert.equal(roadmapB.topics[0].completed, false);

  // 2. User A gets their own roadmaps
  const roadmapsForA = await service.getRoadmaps(userA);
  assert.equal(roadmapsForA.length, 1);
  assert.equal(roadmapsForA[0].id, roadmapA.id);

  // 3. User A cannot read User B's roadmap by ID
  const readAttempt = await service.getRoadmapById(userA, roadmapB.id);
  assert.equal(readAttempt, null);

  // 4. User A updates their own topic progress
  const updateA = await service.updateTopicProgress(userA, {
    roadmapId: roadmapA.id,
    topicId: roadmapA.topics[0].id,
    completed: true,
  });
  assert.equal(updateA.completed, true);

  // 5. Verify User B's progress remains UNCHANGED (still false!)
  const roadmapsForB = await service.getRoadmaps(userB);
  assert.equal(roadmapsForB[0].topics[0].completed, false);

  // 6. User A attempts to update User B's topic -> fails with 404
  await assert.rejects(
    service.updateTopicProgress(userA, {
      roadmapId: roadmapB.id,
      topicId: roadmapB.topics[0].id,
      completed: true,
    }),
    (err) => err.status === 404
  );

  // 7. User B's progress is still false
  const verifyB = await service.getRoadmaps(userB);
  assert.equal(verifyB[0].topics[0].completed, false);

  // 8. User A attempts to delete User B's roadmap -> fails with 404
  await assert.rejects(
    service.deleteRoadmap(userA, roadmapB.id),
    (err) => err.status === 404
  );

  // User B's roadmap is intact
  const verifyBIntact = await service.getRoadmaps(userB);
  assert.equal(verifyBIntact.length, 1);
});
