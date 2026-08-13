'use strict';

function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

function encodeCursor(createdAt, id) {
  const json = JSON.stringify({ createdAt: new Date(createdAt).toISOString(), id });
  return Buffer.from(json).toString('base64url');
}

function decodeCursor(cursorStr) {
  try {
    const json = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed.createdAt && parsed.id) {
      return { createdAt: new Date(parsed.createdAt), id: parsed.id };
    }
  } catch {
    // Invalid cursors are treated as absent; callers receive the first page.
  }
  return null;
}

function createPostgresChallengeRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required.');

  async function createChallenge(authorUserId, { title, difficulty, score, tags, description, constraints, constraintsText, referenceSolution, solution, starterTemplates, visibleTestCases, hiddenTestCases, testCases }) {
    if (!isUuid(authorUserId)) throw new Error('Valid author user ID is required.');

    return pool.withTransaction ? pool.withTransaction(execute) : execute(pool);

    async function execute(client) {
      const challengeRes = await client.query(
        `INSERT INTO challenges (title, difficulty, status, score, tags, created_by_user_id, created_at, updated_at)
         VALUES ($1, $2::"challenge_difficulty", 'DRAFT'::"challenge_status", $3, $5::jsonb, $4, NOW(), NOW())
         RETURNING id, title, difficulty, status, score, tags, created_by_user_id, created_at, updated_at`,
        [
          title,
          String(difficulty || 'easy').toLowerCase(),
          Math.min(10, Math.max(1, Number(score) || 10)),
          authorUserId,
          JSON.stringify(Array.isArray(tags) ? tags.slice(0, 20) : []),
        ]
      );
      const challenge = challengeRes.rows[0];

      const versionRes = await client.query(
        `INSERT INTO challenge_versions (challenge_id, version, statement, constraints_text, reference_solution, starter_templates, created_at)
         VALUES ($1, 1, $2, $4, $5, $3::jsonb, NOW())
         RETURNING id, challenge_id, version, statement, constraints_text, reference_solution, starter_templates, created_at`,
        [
          challenge.id,
          description || title,
          JSON.stringify(starterTemplates || {}),
          constraintsText || constraints || '',
          referenceSolution || solution || '',
        ]
      );
      const version = versionRes.rows[0];

      const allCases = [
        ...(visibleTestCases || []).map((tc) => ({ ...tc, visibility: 'visible' })),
        ...(hiddenTestCases || []).map((tc) => ({ ...tc, visibility: 'hidden' })),
        ...(testCases || []).map((tc) => ({ ...tc, visibility: tc.visibility || 'visible' })),
      ];

      const insertedTestCases = [];
      for (let idx = 0; idx < allCases.length; idx++) {
        const tc = allCases[idx];
        const visibility = tc.visibility === 'hidden' ? 'hidden' : 'visible';
        const tcRes = await client.query(
          `INSERT INTO challenge_test_cases (version_id, position, input, expected_output, visibility)
           VALUES ($1, $2, $3, $4, $5::"challenge_test_visibility")
           RETURNING id, version_id, position, input, expected_output, visibility`,
          [version.id, idx, tc.input || '', tc.expectedOutput || tc.expected_output || '', visibility]
        );
        insertedTestCases.push(tcRes.rows[0]);
      }

      return { challenge, version, testCases: insertedTestCases };
    }
  }

  async function getChallengeById(challengeId, { forAuthor = false } = {}) {
    if (!isUuid(challengeId)) return null;

    const statusClause = forAuthor ? '' : 'AND c.status = \'PUBLISHED\'::"challenge_status"';

    const res = await pool.query(
      `SELECT c.id, c.title, c.difficulty, c.status, c.score, c.tags, c.created_by_user_id, c.created_at, c.updated_at
       FROM challenges c
       WHERE c.id = $1 AND c.archived_at IS NULL ${statusClause}`,
      [challengeId]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async function updateChallengeStatus(authorUserId, challengeId, status, currentStatus = null) {
    if (!isUuid(challengeId) || !isUuid(authorUserId)) return null;

    const params = [status, challengeId, authorUserId];
    let currentClause = '';
    if (currentStatus) {
      params.push(currentStatus);
      currentClause = `AND status = $${params.length}::"challenge_status"`;
    }

    const res = await pool.query(
      `UPDATE challenges
       SET status = $1::"challenge_status", updated_at = NOW()
       WHERE id = $2 AND created_by_user_id = $3 AND archived_at IS NULL ${currentClause}
       RETURNING id, title, difficulty, status, score, tags, created_by_user_id, created_at, updated_at`,
      params
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async function getLatestVersion(challengeId) {
    if (!isUuid(challengeId)) return null;

    const res = await pool.query(
      `SELECT v.id, v.challenge_id, v.version, v.statement, v.constraints_text, v.reference_solution, v.starter_templates, v.created_at
       FROM challenge_versions v
       WHERE v.challenge_id = $1
       ORDER BY v.version DESC
       LIMIT 1`,
      [challengeId]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async function getTestCases(versionId, { includeHidden = false } = {}) {
    if (!isUuid(versionId)) return [];

    const res = await pool.query(
      `SELECT id, version_id, position, input, expected_output, visibility
       FROM challenge_test_cases
       WHERE version_id = $1
         ${includeHidden ? '' : "AND visibility = 'visible'"}
       ORDER BY position ASC`,
      [versionId]
    );
    return res.rows;
  }

  async function listChallenges({ difficulty, tag, search, status = 'PUBLISHED', userId = null, limit = 20, cursor = null } = {}) {
    const params = [];
    const conditions = ['c.archived_at IS NULL'];

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}::"challenge_status"`);
    }

    if (difficulty) {
      params.push(String(difficulty).toLowerCase());
      conditions.push(`c.difficulty = $${params.length}::"challenge_difficulty"`);
    }

    if (tag) {
      params.push(JSON.stringify([tag]));
      conditions.push(`c.tags @> $${params.length}::jsonb`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(c.title ILIKE $${params.length} OR EXISTS (
          SELECT 1 FROM challenge_versions search_version
          WHERE search_version.challenge_id = c.id
            AND search_version.statement ILIKE $${params.length}
        ))`,
      );
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        params.push(decoded.createdAt, decoded.id);
        conditions.push(`(c.created_at, c.id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    params.push(limit + 1);
    const limitIndex = params.length;

    let solvedJoin = '';
    let solvedSelect = 'false AS solved_status, false AS saved_status';
    if (userId && isUuid(userId)) {
      params.push(userId);
      const userParamIdx = params.length;
      solvedJoin = `LEFT JOIN challenge_solves cs ON cs.challenge_id = c.id AND cs.user_id = $${userParamIdx}`;
      solvedSelect = `CASE WHEN cs.user_id IS NOT NULL THEN true ELSE false END AS solved_status,
        EXISTS (SELECT 1 FROM challenge_bookmarks cb WHERE cb.challenge_id = c.id AND cb.user_id = $${userParamIdx}) AS saved_status`;
    }

    const res = await pool.query(
      `SELECT c.id, c.title, c.difficulty, c.score, c.tags, c.created_by_user_id, c.created_at, c.updated_at,
              ${solvedSelect},
              COALESCE((SELECT jsonb_agg(cr.user_id) FROM challenge_reactions cr WHERE cr.challenge_id = c.id AND cr.kind = 'like'), '[]'::jsonb) AS likes,
              COALESCE((SELECT jsonb_agg(cr.user_id) FROM challenge_reactions cr WHERE cr.challenge_id = c.id AND cr.kind = 'dislike'), '[]'::jsonb) AS dislikes
       FROM challenges c
       ${solvedJoin}
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $${limitIndex}`,
      params
    );

    const hasMore = res.rows.length > limit;
    const items = hasMore ? res.rows.slice(0, limit) : res.rows;
    let nextCursor = null;

    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
    }

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  async function recordSubmission({ challengeId, versionId, userId, language, code, status, score, passCount, totalCount, failedTestCase, errorMessage }) {
    if (!isUuid(challengeId) || !isUuid(versionId) || !isUuid(userId)) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const versionCheck = await client.query(
        'SELECT 1 FROM challenge_versions WHERE id = $1 AND challenge_id = $2',
        [versionId, challengeId]
      );
      if (versionCheck.rows.length === 0) {
        throw new Error('Specified version does not belong to the challenge.');
      }

      const res = await client.query(
        `INSERT INTO challenge_submissions (challenge_id, version_id, user_id, language, code, status, score, pass_count, total_count, failed_test_case, error_message, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::"submission_status", $7, $8, $9, $10, $11, NOW())
         RETURNING id, challenge_id, version_id, user_id, language, status, score, pass_count, total_count, failed_test_case, error_message, created_at`,
        [challengeId, versionId, userId, language, code, status, score, passCount, totalCount, failedTestCase, errorMessage]
      );

      if (status === 'ACCEPTED') {
        await client.query(
          `INSERT INTO challenge_solves (challenge_id, user_id, solved_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (challenge_id, user_id) DO NOTHING`,
          [challengeId, userId]
        );
      }

      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function recordSolve(challengeId, userId) {
    if (!isUuid(challengeId) || !isUuid(userId)) return null;

    const res = await pool.query(
      `INSERT INTO challenge_solves (challenge_id, user_id, solved_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (challenge_id, user_id) DO NOTHING
       RETURNING challenge_id, user_id, solved_at`,
      [challengeId, userId]
    );
    return res.rows[0];
  }

  async function listSubmissions(userId, { challengeId = null, limit = 20, cursor = null } = {}) {
    if (!isUuid(userId)) return { items: [], nextCursor: null, hasMore: false };

    const params = [userId];
    const conditions = ['user_id = $1'];

    if (challengeId) {
      if (!isUuid(challengeId)) return { items: [], nextCursor: null, hasMore: false };
      params.push(challengeId);
      conditions.push(`challenge_id = $${params.length}`);
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        params.push(decoded.createdAt, decoded.id);
        conditions.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
      }
    }

    params.push(limit + 1);
    const limitIndex = params.length;

    const res = await pool.query(
      `SELECT id, challenge_id, version_id, user_id, language, status, score, pass_count, total_count, created_at
       FROM challenge_submissions
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitIndex}`,
      params
    );

    const hasMore = res.rows.length > limit;
    const items = hasMore ? res.rows.slice(0, limit) : res.rows;
    let nextCursor = null;

    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
    }

    return { items, nextCursor, hasMore };
  }

  async function getSubmissionById(userId, submissionId) {
    if (!isUuid(userId) || !isUuid(submissionId)) return null;
    const result = await pool.query(
      `SELECT id, challenge_id, version_id, user_id, language, code, status, score,
              pass_count, total_count, failed_test_case, error_message, created_at
       FROM challenge_submissions
       WHERE id = $1 AND user_id = $2`,
      [submissionId, userId],
    );
    return result.rows[0] || null;
  }

  async function getEngagement(challengeId, userId = null) {
    if (!isUuid(challengeId)) return null;
    const result = await pool.query(
      `SELECT
         COALESCE((SELECT jsonb_agg(user_id) FROM challenge_reactions WHERE challenge_id = $1 AND kind = 'like'), '[]'::jsonb) AS likes,
         COALESCE((SELECT jsonb_agg(user_id) FROM challenge_reactions WHERE challenge_id = $1 AND kind = 'dislike'), '[]'::jsonb) AS dislikes,
         CASE WHEN $2::uuid IS NULL THEN false ELSE EXISTS (
           SELECT 1 FROM challenge_bookmarks WHERE challenge_id = $1 AND user_id = $2
         ) END AS saved_status`,
      [challengeId, isUuid(userId) ? userId : null],
    );
    return result.rows[0];
  }

  async function toggleBookmark(userId, challengeId) {
    if (!isUuid(userId) || !isUuid(challengeId)) return null;
    return (pool.withTransaction ? pool.withTransaction(execute) : execute(pool));
    async function execute(client) {
      const removed = await client.query(
        'DELETE FROM challenge_bookmarks WHERE user_id = $1 AND challenge_id = $2 RETURNING challenge_id',
        [userId, challengeId],
      );
      if (!removed.rowCount) {
        await client.query(
          `INSERT INTO challenge_bookmarks (user_id, challenge_id, created_at)
           SELECT $1, id, NOW() FROM challenges
           WHERE id = $2 AND status = 'PUBLISHED'::"challenge_status" AND archived_at IS NULL`,
          [userId, challengeId],
        );
      }
      const saved = await client.query(
        'SELECT challenge_id FROM challenge_bookmarks WHERE user_id = $1 ORDER BY created_at DESC',
        [userId],
      );
      return saved.rows.map((row) => row.challenge_id);
    }
  }

  async function setReaction(userId, challengeId, kind) {
    if (!isUuid(userId) || !isUuid(challengeId) || !['like', 'dislike'].includes(kind)) return null;
    await (pool.withTransaction ? pool.withTransaction(execute) : execute(pool));
    async function execute(client) {
      const removed = await client.query(
        'DELETE FROM challenge_reactions WHERE challenge_id = $1 AND user_id = $2 AND kind = $3 RETURNING challenge_id',
        [challengeId, userId, kind],
      );
      if (removed.rowCount) return;
      await client.query('DELETE FROM challenge_reactions WHERE challenge_id = $1 AND user_id = $2', [challengeId, userId]);
      await client.query(
        `INSERT INTO challenge_reactions (challenge_id, user_id, kind, created_at)
         SELECT id, $1, $3, NOW() FROM challenges
         WHERE id = $2 AND status = 'PUBLISHED'::"challenge_status" AND archived_at IS NULL`,
        [userId, challengeId, kind],
      );
    }
    return getEngagement(challengeId, userId);
  }

  async function archiveChallenge(userId, challengeId) {
    if (!isUuid(userId) || !isUuid(challengeId)) return false;
    const result = await pool.query(
      `UPDATE challenges SET archived_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL RETURNING id`,
      [challengeId, userId],
    );
    return result.rowCount === 1;
  }

  async function listComments(challengeId) {
    if (!isUuid(challengeId)) return [];
    const result = await pool.query(
      `SELECT cc.id, cc.parent_id, cc.author_user_id, cc.text, cc.created_at,
              u.display_name, u.username, u.avatar_url,
              COALESCE((SELECT jsonb_agg(user_id) FROM challenge_comment_reactions r WHERE r.comment_id = cc.id AND r.kind = 'like'), '[]'::jsonb) AS likes,
              COALESCE((SELECT jsonb_agg(user_id) FROM challenge_comment_reactions r WHERE r.comment_id = cc.id AND r.kind = 'dislike'), '[]'::jsonb) AS dislikes,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'type', award_type)) FROM challenge_comment_reactions r WHERE r.comment_id = cc.id AND r.kind = 'award'), '[]'::jsonb) AS awards
       FROM challenge_comments cc
       JOIN users u ON u.id = cc.author_user_id
       WHERE cc.challenge_id = $1
       ORDER BY cc.created_at ASC`,
      [challengeId],
    );
    return result.rows;
  }

  async function createComment(userId, challengeId, text, parentId = null) {
    if (!isUuid(userId) || !isUuid(challengeId) || (parentId && !isUuid(parentId))) return null;
    const result = await pool.query(
      `INSERT INTO challenge_comments (challenge_id, parent_id, author_user_id, text, created_at)
       SELECT $1, $2, $3, $4, NOW()
       WHERE EXISTS (SELECT 1 FROM challenges WHERE id = $1 AND status = 'PUBLISHED'::"challenge_status" AND archived_at IS NULL)
         AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM challenge_comments WHERE id = $2 AND challenge_id = $1))
       RETURNING id`,
      [challengeId, parentId, userId, text],
    );
    return result.rows[0] || null;
  }

  async function setCommentReaction(userId, challengeId, commentId, kind, awardType = null) {
    if (!isUuid(userId) || !isUuid(challengeId) || !isUuid(commentId)) return false;
    if (!['like', 'dislike', 'award'].includes(kind)) return false;
    if (kind === 'award' && !['star', 'fire', 'heart', 'rocket', 'diamond'].includes(awardType)) return false;
    if (kind !== 'award') {
      const removed = await pool.query(
        'DELETE FROM challenge_comment_reactions WHERE comment_id = $1 AND user_id = $2 AND kind = $3 RETURNING comment_id',
        [commentId, userId, kind],
      );
      if (removed.rowCount) return true;
      await pool.query('DELETE FROM challenge_comment_reactions WHERE comment_id = $1 AND user_id = $2 AND kind IN (\'like\', \'dislike\')', [commentId, userId]);
    }
    const result = await pool.query(
      `INSERT INTO challenge_comment_reactions (comment_id, user_id, kind, award_type, created_at)
       SELECT id, $2, $3, $4, NOW() FROM challenge_comments WHERE id = $1 AND challenge_id = $5
       ON CONFLICT (comment_id, user_id, kind) DO UPDATE SET award_type = EXCLUDED.award_type, created_at = NOW()
       RETURNING comment_id`,
      [commentId, userId, kind, awardType, challengeId],
    );
    return result.rowCount === 1;
  }

  async function deleteComment(userId, challengeId, commentId, canModerate = false) {
    if (!isUuid(userId) || !isUuid(challengeId) || !isUuid(commentId)) return false;
    const result = await pool.query(
      `DELETE FROM challenge_comments
       WHERE id = $1 AND challenge_id = $2 AND (author_user_id = $3 OR $4::boolean)
       RETURNING id`,
      [commentId, challengeId, userId, canModerate],
    );
    return result.rowCount === 1;
  }

  async function getLeaderboard(limit = 50) {
    const result = await pool.query(
      `SELECT u.id, u.display_name, u.username, u.avatar_url,
              COUNT(cs.challenge_id)::int AS solved_count,
              COALESCE(SUM(c.score), 0)::int AS score
       FROM users u
       JOIN challenge_solves cs ON cs.user_id = u.id
       JOIN challenges c ON c.id = cs.challenge_id AND c.archived_at IS NULL
       WHERE u.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY score DESC, solved_count DESC, u.id ASC
       LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows;
  }

  return {
    createChallenge,
    getChallengeById,
    updateChallengeStatus,
    getLatestVersion,
    getTestCases,
    listChallenges,
    recordSubmission,
    recordSolve,
    listSubmissions,
    getSubmissionById,
    getEngagement,
    toggleBookmark,
    setReaction,
    archiveChallenge,
    listComments,
    createComment,
    setCommentReaction,
    deleteComment,
    getLeaderboard,
    getSubmissionsForLearner: listSubmissions,
  };
}

module.exports = { createPostgresChallengeRepository, isUuid };
