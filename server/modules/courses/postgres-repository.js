'use strict';

const { isUuid } = require('../challenges/postgres-repository');

function createPostgresCourseRepository(pool) {
  if (!pool) throw new Error('PostgreSQL database pool is required.');

  async function createCourse(organizationId, payload) {
    if (!isUuid(organizationId)) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const courseRes = await client.query(
        `INSERT INTO courses (organization_id, title, description, visibility, pricing, price_minor, currency, category, tags, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, true, NOW(), NOW())
         RETURNING id, organization_id, title, description, visibility, pricing, price_minor, currency, category, tags, active, publication_status, published_at, created_at, updated_at`,
        [
          organizationId,
          payload.title,
          payload.description || null,
          String(payload.visibility || 'public').toLowerCase(),
          String(payload.pricing || 'free').toLowerCase(),
          payload.priceMinor || null,
          payload.currency || null,
          payload.category || null,
          JSON.stringify(payload.tags || []),
        ]
      );
      const course = courseRes.rows[0];

      const versionRes = await client.query(
        `INSERT INTO course_versions (course_id, version, status, created_at)
         VALUES ($1, 1, 'draft', NOW())
         RETURNING id, course_id, version, status, published_at, created_at`,
        [course.id]
      );
      const version = versionRes.rows[0];

      const createdModules = [];
      if (Array.isArray(payload.modules)) {
        for (let mIdx = 0; mIdx < payload.modules.length; mIdx++) {
          const mod = payload.modules[mIdx];
          const modRes = await client.query(
            `INSERT INTO course_modules (version_id, title, description, position)
             VALUES ($1, $2, $3, $4)
             RETURNING id, version_id, title, description, position`,
            [version.id, mod.title, mod.description || null, mod.position !== undefined ? mod.position : mIdx]
          );
          const moduleRow = modRes.rows[0];
          moduleRow.contents = [];

          if (Array.isArray(mod.contents)) {
            for (let cIdx = 0; cIdx < mod.contents.length; cIdx++) {
              const item = mod.contents[cIdx];
              const contentRes = await client.query(
                `INSERT INTO course_contents (module_id, kind, title, legacy_url, body, allow_download, position, duration_seconds, challenge_id, media_file_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING id, module_id, kind, title, legacy_url, body, allow_download, position, duration_seconds, challenge_id, media_file_id`,
                [
                  moduleRow.id,
                  item.kind || 'ARTICLE',
                  item.title,
                  item.legacyUrl || null,
                  item.body || null,
                  !!item.allowDownload,
                  item.position !== undefined ? item.position : cIdx,
                  Number.isInteger(item.durationSeconds) && item.durationSeconds > 0
                    ? item.durationSeconds
                    : null,
                  item.challengeId || null,
                  item.mediaFileId || null,
                ]
              );
              moduleRow.contents.push(contentRes.rows[0]);
            }
          }
          createdModules.push(moduleRow);
        }
      }

      await client.query('COMMIT');

      return {
        course,
        version,
        modules: createdModules,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function getCourseById(courseId) {
    if (!isUuid(courseId)) return null;

    const res = await pool.query(
      `SELECT id, organization_id, title, description, visibility, pricing, price_minor, currency, category, tags, active, publication_status, published_at, created_at, updated_at
       FROM courses
       WHERE id = $1 AND active = true AND publication_status = 'published'`,
      [courseId]
    );
    return res.rows[0] || null;
  }

  async function getLatestVersion(courseId) {
    if (!isUuid(courseId)) return null;

    const res = await pool.query(
      `SELECT id, course_id, version, status, published_at, created_at
       FROM course_versions
       WHERE course_id = $1 AND status='published'
       ORDER BY version DESC
       LIMIT 1`,
      [courseId]
    );
    return res.rows[0] || null;
  }

  async function getVersionById(versionId) {
    if (!isUuid(versionId)) return null;
    const result = await pool.query(
      'SELECT id, course_id, version, status, published_at, created_at FROM course_versions WHERE id = $1',
      [versionId],
    );
    return result.rows[0] || null;
  }

  async function getModulesForVersion(versionId) {
    if (!isUuid(versionId)) return [];

    const modRes = await pool.query(
      `SELECT id, version_id, title, description, position
       FROM course_modules
       WHERE version_id = $1
       ORDER BY position ASC`,
      [versionId]
    );

    const modules = modRes.rows;
    for (const mod of modules) {
      const contentRes = await pool.query(
        `SELECT id, module_id, kind, title, legacy_url, body, allow_download, position, duration_seconds, challenge_id, media_file_id
         FROM course_contents
         WHERE module_id = $1
         ORDER BY position ASC`,
        [mod.id]
      );
      mod.contents = contentRes.rows;
      for (const content of mod.contents) {
        if (content.kind === 'RESOURCE') {
          const resource = await pool.query(
            `SELECT id,file_id,external_url,notes,allow_download FROM course_resources WHERE content_id=$1`,
            [content.id],
          );
          content.resource = resource.rows[0] || null;
        }
        if (content.kind === 'QUIZ') {
          const quiz = await pool.query(
            `SELECT id,title,instructions,attempts_allowed,passing_score FROM course_quizzes WHERE content_id=$1`,
            [content.id],
          );
          if (quiz.rows[0]) {
            const questions = await pool.query(
              `SELECT id,position,kind,prompt,options,points FROM course_quiz_questions WHERE quiz_id=$1 ORDER BY position`,
              [quiz.rows[0].id],
            );
            content.quiz = { ...quiz.rows[0], questions: questions.rows };
          }
        }
        if (content.kind === 'ASSIGNMENT') {
          const assignment = await pool.query(
            `SELECT id,title,instructions,due_at,max_attempts,max_score,rubric FROM course_assignments WHERE content_id=$1`,
            [content.id],
          );
          content.assignment = assignment.rows[0] || null;
        }
      }
    }

    return modules;
  }

  async function verifyContentBelongsToCourse(courseId, contentId, courseVersionId = null) {
    if (!isUuid(courseId) || !isUuid(contentId)) return false;

    const res = await pool.query(
      `SELECT 1
       FROM course_contents cc
       JOIN course_modules cm ON cc.module_id = cm.id
       JOIN course_versions cv ON cm.version_id = cv.id
       WHERE cv.course_id = $1 AND cc.id = $2
         AND ($3::uuid IS NULL OR cv.id = $3)`,
      [courseId, contentId, courseVersionId]
    );
    return res.rows.length > 0;
  }

  async function getCourseContentById(contentId) {
    if (!isUuid(contentId)) return null;

    const res = await pool.query(
      `SELECT id, module_id, kind, title, legacy_url, body, allow_download, position, duration_seconds, challenge_id, media_file_id
       FROM course_contents
       WHERE id = $1`,
      [contentId]
    );
    return res.rows[0] || null;
  }

  async function findContentByChallengeId(challengeId) {
    if (!challengeId) return [];

    const res = await pool.query(
      `SELECT cc.id, cm.version_id, cv.course_id
       FROM course_contents cc
       JOIN course_modules cm ON cc.module_id = cm.id
       JOIN course_versions cv ON cm.version_id = cv.id
       WHERE cc.challenge_id = $1`,
      [challengeId]
    );
    return res.rows;
  }

  async function enrollUser(userId, courseId) {
    if (!isUuid(userId) || !isUuid(courseId)) return null;

    const res = await pool.query(
      `INSERT INTO enrollments (user_id, course_id, course_version_id, status, enrolled_at, created_at, updated_at)
       SELECT $1, $2, cv.id, 'enrolled', NOW(), NOW(), NOW()
       FROM course_versions cv
       WHERE cv.course_id = $2 AND cv.status='published'
       ORDER BY cv.version DESC
       LIMIT 1
       ON CONFLICT (user_id, course_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, user_id, course_id, course_version_id, status, enrolled_at, completed_at, created_at, updated_at`,
      [userId, courseId]
    );
    return res.rows[0];
  }

  async function getEnrollment(userId, courseId) {
    if (!isUuid(userId) || !isUuid(courseId)) return null;

    const res = await pool.query(
      `SELECT id, user_id, course_id, status, course_version_id, enrolled_at, completed_at, created_at, updated_at
       FROM enrollments
       WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId]
    );
    return res.rows[0] || null;
  }

  async function listEnrollmentsForUser(userId) {
    if (!isUuid(userId)) return [];
    const result = await pool.query(
      `SELECT e.id AS enrollment_id, e.status AS enrollment_status, e.enrolled_at, e.completed_at,
              c.id, c.organization_id, c.title, c.description, c.visibility, c.pricing,
              c.price_minor, c.currency, c.category, c.tags, c.published_at
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id AND c.active = true
       WHERE e.user_id = $1
       ORDER BY e.updated_at DESC, e.id DESC`,
      [userId],
    );
    return result.rows;
  }

  async function listCourses({ category, limit = 20, cursor = null } = {}) {
    const params = [];
    const conditions = ["active = true AND visibility = 'public' AND publication_status = 'published'"];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (cursor && isUuid(cursor)) {
      params.push(cursor);
      conditions.push(`created_at < (SELECT created_at FROM courses WHERE id = $${params.length})`);
    }

    params.push(limit + 1);

    const res = await pool.query(
      `SELECT id, organization_id, title, description, visibility, pricing, price_minor, currency, category, tags, created_at
       FROM courses
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    const hasMore = res.rows.length > limit;
    const items = hasMore ? res.rows.slice(0, limit) : res.rows;

    return { items, hasMore };
  }

  async function listCoursesForOrganization(organizationId) {
    if (!isUuid(organizationId)) return [];
    const result = await pool.query(
      `SELECT c.id, c.organization_id, c.title, c.description, c.visibility, c.pricing, c.price_minor,
              c.currency, c.category, c.tags, c.active, c.publication_status, c.published_at, c.created_at, c.updated_at,
              EXISTS (SELECT 1 FROM course_versions cv WHERE cv.course_id=c.id AND cv.status='draft') AS has_draft
       FROM courses c
       WHERE c.organization_id = $1 AND c.active = true
       ORDER BY c.updated_at DESC, c.id DESC`,
      [organizationId],
    );
    return result.rows;
  }

  async function getOrganizationVerificationStatus(organizationId) {
    if (!isUuid(organizationId)) return null;
    const result = await pool.query(
      'SELECT verification_status FROM organizations WHERE id = $1 AND deleted_at IS NULL',
      [organizationId],
    );
    return result.rows[0]?.verification_status || null;
  }

  async function publishCourse(organizationId, courseId) {
    if (!isUuid(organizationId) || !isUuid(courseId)) return null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const draft = await client.query(
        `SELECT cv.id FROM course_versions cv JOIN courses c ON c.id=cv.course_id
         WHERE c.id=$1 AND c.organization_id=$2 AND c.active=true AND cv.status='draft'
         ORDER BY cv.version DESC LIMIT 1 FOR UPDATE OF cv,c`,
        [courseId, organizationId],
      );
      if (!draft.rowCount) { await client.query('ROLLBACK'); return null; }
      await client.query(
        `UPDATE course_versions SET status='retired'
         WHERE course_id=$1 AND status='published'`,
        [courseId],
      );
      await client.query(
        `UPDATE course_versions SET status='published',published_at=NOW() WHERE id=$1`,
        [draft.rows[0].id],
      );
      const result = await client.query(
        `UPDATE courses SET publication_status='published',published_at=COALESCE(published_at,NOW()),updated_at=NOW()
         WHERE id=$1 AND organization_id=$2
         RETURNING id,organization_id,title,description,visibility,pricing,price_minor,currency,category,tags,
           active,publication_status,published_at,created_at,updated_at`,
        [courseId, organizationId],
      );
      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function validateCourseForPublish(organizationId, courseId) {
    const result = await pool.query(
      `WITH latest AS (SELECT id FROM course_versions WHERE course_id=$2 AND status='draft' ORDER BY version DESC LIMIT 1)
       SELECT COUNT(DISTINCT cm.id)::int AS modules,COUNT(DISTINCT cc.id)::int AS contents,
         COUNT(DISTINCT cc.id) FILTER (WHERE cc.kind='QUIZ' AND NOT EXISTS (SELECT 1 FROM course_quizzes q JOIN course_quiz_questions qq ON qq.quiz_id=q.id WHERE q.content_id=cc.id))::int AS invalid_quizzes,
         COUNT(DISTINCT cc.id) FILTER (WHERE cc.kind='ASSIGNMENT' AND NOT EXISTS (SELECT 1 FROM course_assignments a WHERE a.content_id=cc.id))::int AS invalid_assignments,
         COUNT(DISTINCT cc.id) FILTER (WHERE cc.kind='RESOURCE' AND NOT EXISTS (SELECT 1 FROM course_resources r WHERE r.content_id=cc.id))::int AS invalid_resources,
         COUNT(DISTINCT cc.id) FILTER (WHERE cc.kind='VIDEO' AND
           ((cc.legacy_url IS NULL AND cc.media_file_id IS NULL) OR
            (cc.legacy_url IS NOT NULL AND cc.media_file_id IS NOT NULL) OR
            (cc.legacy_url IS NOT NULL AND cc.legacy_url !~ '^https://') OR
            (cc.media_file_id IS NOT NULL AND ((cc.duration_seconds IS NULL OR cc.duration_seconds < 1) OR
              NOT EXISTS (SELECT 1 FROM files f WHERE f.id=cc.media_file_id
                AND f.owner_organization_id=c.organization_id AND f.purpose='course_video'
                AND f.state='ready' AND f.scan_status='clean')))))::int AS invalid_videos,
         COUNT(DISTINCT cc.id) FILTER (WHERE cc.kind='CHALLENGE' AND cc.challenge_id IS NULL)::int AS invalid_challenges
       FROM courses c JOIN latest ON true LEFT JOIN course_modules cm ON cm.version_id=latest.id
       LEFT JOIN course_contents cc ON cc.module_id=cm.id WHERE c.id=$2 AND c.organization_id=$1`,
      [organizationId, courseId],
    );
    return result.rows[0] || null;
  }

  async function retireCourse(organizationId, courseId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE courses SET publication_status='retired',active=false,updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 RETURNING *`, [courseId, organizationId]);
      if (result.rowCount) await client.query("UPDATE course_versions SET status='retired' WHERE course_id=$1", [courseId]);
      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function upsertLessonProgress(enrollmentId, contentId, { status = 'IN_PROGRESS', lastPositionSec = 0, watchedIntervals = [] }) {
    if (!isUuid(enrollmentId) || !isUuid(contentId)) return null;

    const res = await pool.query(
      `INSERT INTO lesson_progress (enrollment_id, content_id, status, last_position_sec, watched_intervals, completed_at, updated_at)
       VALUES ($1, $2, $3::"progress_status", $4, $5::jsonb, CASE WHEN $3::"progress_status" = 'COMPLETED' THEN NOW() ELSE NULL END, NOW())
       ON CONFLICT (enrollment_id, content_id) DO UPDATE SET
         status = CASE WHEN lesson_progress.status = 'COMPLETED' THEN 'COMPLETED'::"progress_status" ELSE EXCLUDED.status END,
         last_position_sec = GREATEST(lesson_progress.last_position_sec, EXCLUDED.last_position_sec),
         watched_intervals = EXCLUDED.watched_intervals,
         completed_at = CASE WHEN lesson_progress.completed_at IS NOT NULL THEN lesson_progress.completed_at ELSE EXCLUDED.completed_at END,
         updated_at = NOW()
       RETURNING id, enrollment_id, content_id, status, last_position_sec, watched_intervals, completed_at, updated_at`,
      [enrollmentId, contentId, status, lastPositionSec, JSON.stringify(watchedIntervals)]
    );

    await pool.query(
      `INSERT INTO course_learning_events (organization_id,course_id,user_id,event_type,source_id,event_data,occurred_at)
       SELECT c.organization_id,c.id,e.user_id,'lesson_progress_updated',$2,jsonb_build_object('status',$3,'positionSeconds',$4),NOW()
       FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.id=$1`,
      [enrollmentId, contentId, status, lastPositionSec],
    );

    return res.rows[0];
  }

  async function getLessonProgress(enrollmentId, contentId) {
    if (!isUuid(enrollmentId) || !isUuid(contentId)) return null;

    const res = await pool.query(
      `SELECT id, enrollment_id, content_id, status, last_position_sec, watched_intervals, completed_at, updated_at
       FROM lesson_progress
       WHERE enrollment_id = $1 AND content_id = $2`,
      [enrollmentId, contentId]
    );
    return res.rows[0] || null;
  }

  async function getCourseProgressOverview(enrollmentId) {
    if (!isUuid(enrollmentId)) return null;

    const res = await pool.query(
      `WITH target AS (
         SELECT e.id,e.course_version_id FROM enrollments e WHERE e.id=$1
       ), totals AS (
         SELECT COUNT(cc.id)::int AS total_lessons,
                COUNT(lp.id) FILTER (WHERE lp.status='COMPLETED')::int AS completed_lessons,
                COALESCE(array_agg(cc.id) FILTER (WHERE lp.status='COMPLETED'),'{}'::uuid[]) AS completed_content_ids
         FROM target t JOIN course_modules cm ON cm.version_id=t.course_version_id
         JOIN course_contents cc ON cc.module_id=cm.id
         LEFT JOIN lesson_progress lp ON lp.content_id=cc.id AND lp.enrollment_id=t.id
       )
       SELECT total_lessons,completed_lessons,completed_content_ids,
              CASE WHEN total_lessons=0 THEN 0 ELSE FLOOR(100.0*completed_lessons/total_lessons)::int END AS percent
       FROM totals`,
      [enrollmentId]
    );
    const overview = res.rows[0] || { total_lessons: 0, completed_lessons: 0, completed_content_ids: [], percent: 0 };
    if (overview.total_lessons > 0 && overview.completed_lessons === overview.total_lessons) {
      await pool.query(
        `UPDATE enrollments SET status='completed',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW() WHERE id=$1`,
        [enrollmentId],
      );
      overview.enrollment_status = 'completed';
      overview.completed_at = new Date();
    }
    return overview;
  }

  return {
    createCourse,
    getCourseById,
    getLatestVersion,
    getVersionById,
    getModulesForVersion,
    verifyContentBelongsToCourse,
    getCourseContentById,
    findContentByChallengeId,
    enrollUser,
    getEnrollment,
    listEnrollmentsForUser,
    listCourses,
    listCoursesForOrganization,
    getOrganizationVerificationStatus,
    publishCourse,
    validateCourseForPublish,
    retireCourse,
    upsertLessonProgress,
    getLessonProgress,
    getCourseProgressOverview,
  };
}

module.exports = { createPostgresCourseRepository };
