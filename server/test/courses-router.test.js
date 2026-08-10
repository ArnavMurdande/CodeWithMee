'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { createPostgresCourseRepository } = require('../modules/courses/postgres-repository');
const { createCourseService } = require('../modules/courses/service');
const { createCourseRouter } = require('../modules/courses/router');

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

  if (norm.includes('GROUP BY lp.status')) {
    const eid = params[0];
    const userProgress = Array.from(progressMap.values()).filter((p) => p.enrollment_id === eid);
    const completedCount = userProgress.filter((p) => p.status === 'COMPLETED').length;
    return { rows: [{ status: 'COMPLETED', count: completedCount }], rowCount: 1 };
  }

  if (norm.includes('SELECT id, course_id, version, created_at FROM course_versions')) {
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

  if (norm.includes('FROM courses')) {
    const rows = Array.from(courses.values());
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
}

function request(server, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('P1C-S5: course router endpoints process catalog, details, enrollment, and progress', async () => {
  const mockPool = createMockPool();
  const repository = createPostgresCourseRepository(mockPool);
  const service = createCourseService({ repository });

  const dummyAuth = (req, res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000002' };
    next();
  };

  const coursesRouter = createCourseRouter({ service, authMiddleware: dummyAuth });
  const app = createApp({ coursesRouter, legacyApiEnabled: false });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const orgId = '00000000-0000-4000-8000-000000000001';
    const course = await service.createCourse(orgId, {
      title: 'Web Dev Course',
      modules: [
        {
          title: 'HTML & CSS',
          contents: [{ kind: 'VIDEO', title: 'HTML Basics' }],
        },
      ],
    });

    const contentId = course.modules[0].contents[0].id;

    // GET /api/v1/courses
    const listRes = await request(server, 'GET', '/api/v1/courses');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.courses.length, 1);

    // GET /api/v1/courses/:courseId
    const detailsRes = await request(server, 'GET', `/api/v1/courses/${course.id}`);
    assert.equal(detailsRes.status, 200);
    assert.equal(detailsRes.body.title, 'Web Dev Course');

    // POST /api/v1/courses/:courseId/enroll
    const enrollRes = await request(server, 'POST', `/api/v1/courses/${course.id}/enroll`);
    assert.equal(enrollRes.status, 200);
    assert.equal(enrollRes.body.status, 'ENROLLED');

    // PATCH /api/v1/courses/:courseId/lessons/:contentId/progress
    const updateRes = await request(server, 'PATCH', `/api/v1/courses/${course.id}/lessons/${contentId}/progress`, {}, { lastPositionSec: 100 });
    assert.equal(updateRes.status, 200);

    // GET /api/v1/courses/:courseId/progress
    const progressRes = await request(server, 'GET', `/api/v1/courses/${course.id}/progress`);
    assert.equal(progressRes.status, 200);
  } finally {
    server.close();
  }
});
