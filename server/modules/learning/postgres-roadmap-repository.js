'use strict';

const { requirePostgresPool, withPostgresTransaction } = require('../persistence/postgres-helpers');

function isUuid(str) {
  return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function createPostgresRoadmapRepository(pool) {
  requirePostgresPool(pool);

  async function createRoadmap(userId, { title, topics = [] }) {
    if (!isUuid(userId)) throw new Error('Invalid user ID UUID.');
    if (!title || typeof title !== 'string') throw new Error('Roadmap title is required.');

    const cleanTitle = title.trim().substring(0, 200);

    return withPostgresTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO users (id, email_normalized, email_display, display_name)
         VALUES ($1::uuid, $1 || '@local.dev', $1 || '@local.dev', 'Learner')
         ON CONFLICT (id) DO NOTHING`,
        [userId]
      );

      const roadmapRes = await client.query(
        `INSERT INTO learning_roadmaps (user_id, title, position, created_at, updated_at)
         VALUES ($1::uuid, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM learning_roadmaps WHERE user_id = $1::uuid), NOW(), NOW())
         RETURNING id, user_id, title, position, created_at, updated_at`,
        [userId, cleanTitle]
      );
      const roadmapRow = roadmapRes.rows[0];

      const formattedTopics = [];
      for (let i = 0; i < topics.length; i++) {
        const t = topics[i];
        const rawTopicTitle = (typeof t === 'string' ? t : t.topic || t.title || `Topic ${i + 1}`).trim();
        const topicTitle = rawTopicTitle.substring(0, 200);
        const description = (typeof t === 'object' && t.description) ? String(t.description) : '';
        const rawYoutubeQuery = (typeof t === 'object' && (t.youtube_query || t.youtubeQuery)) ? String(t.youtube_query || t.youtubeQuery) : '';
        const youtubeQuery = rawYoutubeQuery.substring(0, 500);
        const completed = Boolean(typeof t === 'object' && t.completed);

        const topicRes = await client.query(
          `INSERT INTO learning_topics (roadmap_id, title, description, youtube_query, completed, position)
           VALUES ($1::uuid, $2, $3, $4, $5, $6)
           RETURNING id, roadmap_id, title, description, youtube_query, completed, position`,
          [roadmapRow.id, topicTitle, description, youtubeQuery, completed, i]
        );
        const row = topicRes.rows[0];
        formattedTopics.push({
          id: row.id,
          topic: row.title,
          title: row.title,
          description: row.description,
          youtube_query: row.youtube_query,
          youtubeQuery: row.youtube_query,
          completed: row.completed,
          position: row.position,
        });
      }

      return {
        _id: roadmapRow.id,
        id: roadmapRow.id,
        title: roadmapRow.title,
        topics: formattedTopics,
        createdAt: roadmapRow.created_at,
        updatedAt: roadmapRow.updated_at,
      };
    });
  }

  async function getRoadmaps(userId) {
    if (!isUuid(userId)) return [];

    const res = await pool.query(
      `SELECT r.id AS roadmap_id, r.title AS roadmap_title, r.created_at, r.updated_at,
              t.id AS topic_id, t.title AS topic_title, t.description, t.youtube_query, t.completed, t.position
       FROM learning_roadmaps r
       LEFT JOIN learning_topics t ON t.roadmap_id = r.id
       WHERE r.user_id = $1::uuid
       ORDER BY r.created_at DESC, t.position ASC`,
      [userId]
    );

    const map = new Map();
    for (const row of res.rows) {
      if (!map.has(row.roadmap_id)) {
        map.set(row.roadmap_id, {
          _id: row.roadmap_id,
          id: row.roadmap_id,
          title: row.roadmap_title,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          topics: [],
        });
      }
      if (row.topic_id) {
        map.get(row.roadmap_id).topics.push({
          id: row.topic_id,
          topic: row.topic_title,
          title: row.topic_title,
          description: row.description,
          youtube_query: row.youtube_query,
          youtubeQuery: row.youtube_query,
          completed: row.completed,
          position: row.position,
        });
      }
    }
    return Array.from(map.values());
  }

  async function getRoadmapById(userId, roadmapId) {
    if (!isUuid(userId) || !isUuid(roadmapId)) return null;

    const res = await pool.query(
      `SELECT r.id AS roadmap_id, r.title AS roadmap_title, r.created_at, r.updated_at,
              t.id AS topic_id, t.title AS topic_title, t.description, t.youtube_query, t.completed, t.position
       FROM learning_roadmaps r
       LEFT JOIN learning_topics t ON t.roadmap_id = r.id
       WHERE r.id = $1::uuid AND r.user_id = $2::uuid
       ORDER BY t.position ASC`,
      [roadmapId, userId]
    );

    if (res.rows.length === 0) return null;

    const first = res.rows[0];
    const roadmap = {
      _id: first.roadmap_id,
      id: first.roadmap_id,
      title: first.roadmap_title,
      createdAt: first.created_at,
      updatedAt: first.updated_at,
      topics: [],
    };

    for (const row of res.rows) {
      if (row.topic_id) {
        roadmap.topics.push({
          id: row.topic_id,
          topic: row.topic_title,
          title: row.topic_title,
          description: row.description,
          youtube_query: row.youtube_query,
          youtubeQuery: row.youtube_query,
          completed: row.completed,
          position: row.position,
        });
      }
    }

    return roadmap;
  }

  async function updateTopicProgress(userId, { roadmapId, topicId, topicTitle, completed }) {
    if (!isUuid(userId)) return null;

    const isCompleted = Boolean(completed);

    if (topicId && isUuid(topicId)) {
      const res = await pool.query(
        `UPDATE learning_topics t
         SET completed = $1
         FROM learning_roadmaps r
         WHERE t.roadmap_id = r.id
           AND t.id = $2::uuid
           AND r.user_id = $3::uuid
           ${isUuid(roadmapId) ? 'AND t.roadmap_id = $4::uuid' : ''}
         RETURNING t.id, t.roadmap_id, t.title, t.description, t.youtube_query, t.completed, t.position`,
        isUuid(roadmapId) ? [isCompleted, topicId, userId, roadmapId] : [isCompleted, topicId, userId]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        id: row.id,
        topic: row.title,
        title: row.title,
        description: row.description,
        youtubeQuery: row.youtube_query,
        completed: row.completed,
      };
    }

    if (!isUuid(roadmapId) || !topicTitle) return null;

    const res = await pool.query(
      `UPDATE learning_topics t
       SET completed = $1
       FROM learning_roadmaps r
       WHERE t.roadmap_id = r.id
         AND t.roadmap_id = $2::uuid
         AND (t.title = $3 OR t.youtube_query = $3)
         AND r.user_id = $4::uuid
       RETURNING t.id, t.roadmap_id, t.title, t.description, t.youtube_query, t.completed, t.position`,
      [isCompleted, roadmapId, topicTitle, userId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      topic: row.title,
      title: row.title,
      description: row.description,
      youtubeQuery: row.youtube_query,
      completed: row.completed,
    };
  }

  async function deleteRoadmap(userId, roadmapId) {
    if (!isUuid(userId) || !isUuid(roadmapId)) return false;

    const res = await pool.query(
      `DELETE FROM learning_roadmaps WHERE id = $1::uuid AND user_id = $2::uuid`,
      [roadmapId, userId]
    );
    return res.rowCount > 0;
  }

  return {
    createRoadmap,
    getRoadmaps,
    getRoadmapById,
    updateTopicProgress,
    deleteRoadmap,
  };
}

module.exports = { createPostgresRoadmapRepository, isUuid };
