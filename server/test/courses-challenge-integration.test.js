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
    const row = {
      id,
      organization_id: params[0],
      title: params[1],
      description: params[2],
      visibility: params[3],
      pricing: params[4],
      active: true,
      created_at: new Date(),
    };
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
    const row = {
      id,
      module_id: params[0],
      kind: params[1],
      title: params[2],
      legacy_url: params[3],
      body: params[4],
      allow_download: params[5],
      position: params[6],
    };
    contents.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO enrollments')) {
    const id = '50000000-0000-4000-8000-00000000000' + (enrollments.size + 1);
    const row = {
      id,
      user_id: params[0],
      course_id: params[1],
      status: 'ENROLLED',
      enrolled_at: new Date(),
      created_at: new Date(),
    };
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
      created_at: new Date(),
    };
    progressMap.set(key, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('FROM course_contents cc')) {
    const chId = params[0];
    const match = Array.from(contents.values()).find((c) => c.body === chId || c.id === chId);
    if (match) {
      const mod = modules.get(match.module_id);
      const ver = mod ? versions.get(mod.version_id) : null;
      return { rows: [{ id: match.id, version_id: mod?.version_id, course_id: ver?.course_id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  if (norm.includes('FROM enrollments')) {
    const key = `${params[0]}:${params[1]}`;
    const enr = enrollments.get(key);
    return { rows: enr ? [enr] : [], rowCount: enr ? 1 : 0 };
  }

  if (norm.includes('FROM lesson_progress')) {
    const eid = params[0];
    const userProgress = Array.from(progressMap.values()).filter((p) => p.enrollment_id === eid);
    return { rows: userProgress, rowCount: userProgress.length };
  }

  if (norm.includes('SELECT id, course_id, version, created_at')) {
    const cid = params[0];
    const match = Array.from(versions.values()).find((v) => v.course_id === cid);
    return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
  }

  if (norm.includes('SELECT id, version_id, title, description, position FROM course_modules')) {
    const vid = params[0];
    const rows = Array.from(modules.values()).filter((m) => m.version_id === vid);
    return { rows, rowCount: rows.length };
  }

  if (norm.includes('SELECT id, module_id, kind, title, legacy_url, body, allow_download, position FROM course_contents')) {
    const mid = params[0];
    const rows = Array.from(contents.values()).filter((c) => c.module_id === mid);
    return { rows, rowCount: rows.length };
  }

  if (norm.includes('FROM courses WHERE id = $1')) {
    const cid = params[0];
    const c = courses.get(cid);
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }

  return { rows: [], rowCount: 0 };
}

test('P1C-S4: onChallengeSolved automatically marks linked challenge lesson completed and reconciles course progress', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresCourseRepository(mockPool);
  const service = createCourseService({ repository });
  const orgId = '00000000-0000-4000-8000-000000000001';
  const userId = '00000000-0000-4000-8000-000000000002';
  const targetChallengeId = '90000000-0000-4000-8000-000000000001';

  const course = await service.createCourse(orgId, {
    title: 'Challenge Course',
    modules: [
      {
        title: 'Module 1',
        contents: [{ kind: 'CHALLENGE', title: 'Two Sum Challenge', body: targetChallengeId }],
      },
    ],
  });

  const contentId = course.modules[0].contents[0].id;
  await service.enrollInCourse(userId, course.id);

  // Trigger challenge solve event
  const updatedRecords = await service.onChallengeSolved(userId, targetChallengeId);
  assert.equal(updatedRecords.length, 1);
  assert.equal(updatedRecords[0].content_id, contentId);
});
