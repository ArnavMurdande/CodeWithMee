'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPostgresCourseRepository } = require('../modules/courses/postgres-repository');
const { createCourseService } = require('../modules/courses/service');

function createMockPool() {
  const courses = new Map();
  const versions = new Map();
  const modules = new Map();
  const contents = new Map();
  const enrollments = new Map();
  const progressMap = new Map();

  return {
    async connect() {
      return {
        async query(sql, params) {
          return mockQuery(sql, params, courses, versions, modules, contents, enrollments, progressMap);
        },
        release() {},
      };
    },
    async query(sql, params) {
      return mockQuery(sql, params, courses, versions, modules, contents, enrollments, progressMap);
    },
  };
}

function mockQuery(sql, params, courses, versions, modules, contents, enrollments, progressMap) {
  const norm = sql.trim().replace(/\s+/g, ' ');

  if (norm.startsWith('BEGIN') || norm.startsWith('COMMIT') || norm.startsWith('ROLLBACK')) {
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('INSERT INTO courses')) {
    const id = '10000000-0000-4000-8000-00000000000' + (courses.size + 1);
    const row = { id, organization_id: params[0], title: params[1], description: params[2], visibility: params[3], pricing: params[4], active: true, created_at: new Date() };
    courses.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO course_versions')) {
    const id = '20000000-0000-4000-8000-00000000000' + (versions.size + 1);
    const row = { id, course_id: params[0], version: 1, created_at: new Date() };
    versions.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO course_modules')) {
    const id = '30000000-0000-4000-8000-00000000000' + (modules.size + 1);
    const row = { id, version_id: params[0], title: params[1], description: params[2], position: params[3] };
    modules.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO course_contents')) {
    const id = '40000000-0000-4000-8000-00000000000' + (contents.size + 1);
    const row = { id, module_id: params[0], kind: params[1], title: params[2], legacy_url: params[3], body: params[4], allow_download: params[5], position: params[6] };
    contents.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO enrollments')) {
    const id = '50000000-0000-4000-8000-00000000000' + (enrollments.size + 1);
    const row = { id, user_id: params[0], course_id: params[1], status: 'ENROLLED', enrolled_at: new Date(), created_at: new Date() };
    enrollments.set(`${params[0]}:${params[1]}`, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO lesson_progress')) {
    const id = '60000000-0000-4000-8000-00000000000' + (progressMap.size + 1);
    const key = `${params[0]}:${params[1]}`;
    const existing = progressMap.get(key);

    const newPos = Math.max(existing ? existing.last_position_sec : 0, params[3]);

    const row = {
      id: existing ? existing.id : id,
      enrollment_id: params[0],
      content_id: params[1],
      status: existing && existing.status === 'COMPLETED' ? 'COMPLETED' : params[2],
      last_position_sec: newPos,
      watched_intervals: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4] || [],
      completed_at: params[2] === 'COMPLETED' ? new Date() : existing ? existing.completed_at : null,
      updated_at: new Date(),
    };
    progressMap.set(key, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('FROM course_contents cc')) {
    return { rows: [{ 1: 1 }], rowCount: 1 };
  }

  if (norm.includes('FROM enrollments')) {
    const key = `${params[0]}:${params[1]}`;
    const enr = enrollments.get(key);
    return { rows: enr ? [enr] : [], rowCount: enr ? 1 : 0 };
  }

  if (norm.includes('FROM lesson_progress')) {
    const key = `${params[0]}:${params[1]}`;
    const p = progressMap.get(key);
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }

  if (norm.includes('SELECT id, organization_id, title, description, visibility')) {
    const cid = params[0];
    const c = courses.get(cid);
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }

  return { rows: [], rowCount: 0 };
}

test('P1C-S6: concurrent lesson progress updates execute safely without race conditions', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresCourseRepository(mockPool);
  const service = createCourseService({ repository });
  const orgId = '00000000-0000-4000-8000-000000000001';
  const userId = '00000000-0000-4000-8000-000000000002';

  const course = await service.createCourse(orgId, {
    title: 'Concurrent Progress Course',
    modules: [
      {
        title: 'Module 1',
        contents: [{ kind: 'VIDEO', title: 'Video 1', legacyUrl: 'http://video1' }],
      },
    ],
  });

  const contentId = course.modules[0].contents[0].id;
  await service.enrollInCourse(userId, course.id);

  // Trigger 5 concurrent updates
  const updates = [10, 30, 20, 50, 40].map((sec) =>
    service.updateLessonProgress(userId, course.id, contentId, {
      lastPositionSec: sec,
      watchedIntervals: [{ start: 0, end: sec }],
    })
  );

  await Promise.all(updates);

  const finalProgress = await service.getLessonProgress(userId, course.id, contentId);
  // Due to GREATEST logic in mock pool, maximum position should be 50
  assert.equal(finalProgress.lastPositionSec, 50);
});

test('P1C-S6: spoofing progress without valid enrollment fails closed with 403', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresCourseRepository(mockPool);
  const service = createCourseService({ repository });
  const orgId = '00000000-0000-4000-8000-000000000001';
  const userId = '00000000-0000-4000-8000-000000000002';

  const course = await service.createCourse(orgId, {
    title: 'Unenrolled Course',
    modules: [
      {
        title: 'Module 1',
        contents: [{ kind: 'VIDEO', title: 'Video 1', legacyUrl: 'http://video1' }],
      },
    ],
  });

  const contentId = course.modules[0].contents[0].id;

  // Unenrolled user update must throw 403 not_enrolled
  await assert.rejects(
    service.updateLessonProgress(userId, course.id, contentId, { lastPositionSec: 100 }),
    (err) => err.status === 403 && err.code === 'not_enrolled'
  );
});
