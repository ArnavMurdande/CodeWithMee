'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { createPostgresLmsRepository } = require('../modules/lms/postgres-repository');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const repository = createPostgresLmsRepository(pool);
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const actorId = randomUUID();
  try {
    const structure = await repository.replaceStructure(organizationId, courseId, [{
      contents: [],
      description: '',
      title: 'SQL smoke module',
    }]);
    const quizGrade = await repository.gradeQuizAttempt(
      organizationId,
      courseId,
      randomUUID(),
      actorId,
      100,
      '',
      true,
    );
    const assignmentGrade = await repository.gradeSubmission(
      organizationId,
      courseId,
      randomUUID(),
      actorId,
      100,
      {},
      '',
      true,
    );
    if (structure !== null || quizGrade !== null || assignmentGrade !== null) {
      throw new Error('LMS isolation smoke unexpectedly matched a non-owned resource.');
    }
    console.log(JSON.stringify({ isolation: true, sql: true, transactionsReleased: true }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
