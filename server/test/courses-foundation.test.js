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

  return {
    async connect() {
      return {
        async query(sql, params) {
          return mockQuery(sql, params, courses, versions, modules, contents, enrollments);
        },
        release() {},
      };
    },
    async query(sql, params) {
      return mockQuery(sql, params, courses, versions, modules, contents, enrollments);
    },
  };
}

function mockQuery(sql, params, courses, versions, modules, contents, enrollments) {
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
      price_minor: params[5],
      currency: params[6],
      category: params[7],
      tags: JSON.parse(params[8]),
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
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
    const row = { id, module_id: params[0], kind: params[1], title: params[2], legacy_url: params[3], body: params[4], allow_download: params[5], position: params[6] };
    contents.set(id, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('INSERT INTO enrollments')) {
    const id = '50000000-0000-4000-8000-00000000000' + (enrollments.size + 1);
    const row = { id, user_id: params[0], course_id: params[1], status: 'ENROLLED', enrolled_at: new Date() };
    enrollments.set(`${params[0]}:${params[1]}`, row);
    return { rows: [row], rowCount: 1 };
  }

  if (norm.includes('SELECT id, organization_id, title, description, visibility')) {
    const cid = params[0];
    const c = courses.get(cid);
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
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

  if (norm.includes('SELECT id, user_id, course_id, status')) {
    const key = `${params[0]}:${params[1]}`;
    const enr = enrollments.get(key);
    return { rows: enr ? [enr] : [], rowCount: enr ? 1 : 0 };
  }

  if (norm.includes('SELECT id, organization_id, title, description, visibility, pricing, price_minor, currency, category, tags, created_at FROM courses')) {
    const rows = Array.from(courses.values());
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

test('P1C-S1: course service creates versioned course with modules, lessons, and handles enrollment', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresCourseRepository(mockPool);
  const service = createCourseService({ repository });
  const orgId = '00000000-0000-4000-8000-000000000001';
  const userId = '00000000-0000-4000-8000-000000000002';

  const created = await service.createCourse(orgId, {
    title: 'Intro to Python',
    description: 'Learn Python basics',
    visibility: 'PUBLIC',
    pricing: 'FREE',
    category: 'Programming',
    tags: ['python', 'basics'],
    modules: [
      {
        title: 'Module 1: Variables',
        contents: [
          { kind: 'VIDEO', title: 'Lesson 1.1: Syntax', legacyUrl: 'https://example.com/v1.mp4' },
          { kind: 'ARTICLE', title: 'Lesson 1.2: Reading', body: 'Read about types.' },
        ],
      },
    ],
  });

  assert.equal(created.title, 'Intro to Python');
  assert.equal(created.modules.length, 1);
  assert.equal(created.modules[0].contents.length, 2);

  const enrollment = await service.enrollInCourse(userId, created.id);
  assert.equal(enrollment.status, 'ENROLLED');

  const details = await service.getCourseDetails(created.id, userId);
  assert.equal(details.isEnrolled, true);
  assert.equal(details.enrollmentStatus, 'ENROLLED');
});
