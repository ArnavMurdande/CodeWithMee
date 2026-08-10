'use strict';

function createPostgresExecutionJobRepository(pool) {
  if (!pool?.query) throw new Error('PostgreSQL pool is required for execution jobs.');

  return Object.freeze({
    async createJob(job) {
      await pool.query(
        `INSERT INTO execution_jobs
          (id, user_id, challenge_id, version_id, operation_type, language, status, queued_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', NOW(), NOW())`,
        [job.id, job.userId, job.challengeId, job.versionId, job.operationType, job.language],
      );
    },

    async updateJobStatus(jobId, update) {
      await pool.query(
        `UPDATE execution_jobs
         SET status = $2,
             result = $3::jsonb,
             error_code = $4,
             started_at = CASE WHEN $2 = 'RUNNING' THEN COALESCE(started_at, NOW()) ELSE started_at END,
             completed_at = $5,
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, update.status, update.result, update.errorCode, update.completedAt],
      );
    },
  });
}

module.exports = { createPostgresExecutionJobRepository };
