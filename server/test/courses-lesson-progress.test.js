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
    const row = {
      id,
      enrollment_id: params[0],
      content_id: params[1],
      status: params[2],
      last_position_sec: params[3],
      watched_intervals: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4] || [],
      completed_at: params[2] === 'COMPLETED' ? new Date() : null,
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

test('P1C-S2: updateLessonProgress tracks video playback position, watched intervals, and enables resume', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresCourseRepository(mockPool);
  const service = createCourseService({ repository });
  const orgId = '00000000-0000-4000-8000-000000000001';
  const userId = '00000000-0000-4000-8000-000000000002';

  const course = await service.createCourse(orgId, {
    title: 'Progress Course',
    modules: [
      {
        title: 'Module 1',
        contents: [{ kind: 'VIDEO', title: 'Video 1', legacyUrl: 'http://video1' }],
      },
    ],
  });

  const contentId = course.modules[0].contents[0].id;
  await service.enrollInCourse(userId, course.id);

  // Initial progress update at 120s
  const p1 = await service.updateLessonProgress(userId, course.id, contentId, {
    lastPositionSec: 120,
    watchedIntervals: [{ start: 0, end: 120 }],
  });

  assert.equal(p1.lastPositionSec, 120);
  assert.equal(p1.status, 'IN_PROGRESS');

  // Resume progress at 240s
  const p2 = await service.updateLessonProgress(userId, course.id, contentId, {
    lastPositionSec: 240,
    watchedIntervals: [{ start: 0, end: 120 }, { start: 120, end: 240 }],
  });

  assert.equal(p2.lastPositionSec, 240);

  // Fetch progress
  const fetched = await service.getLessonProgress(userId, course.id, contentId);
  assert.equal(fetched.lastPositionSec, 240);
  assert.equal(fetched.status, 'IN_PROGRESS');
});
