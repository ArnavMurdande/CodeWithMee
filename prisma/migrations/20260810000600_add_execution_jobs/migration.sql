CREATE TABLE "execution_jobs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "challenge_id" UUID,
  "version_id" UUID,
  "operation_type" VARCHAR(16) NOT NULL,
  "language" VARCHAR(32) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "result" JSONB,
  "error_code" VARCHAR(64),
  "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "execution_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "execution_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "execution_jobs_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL,
  CONSTRAINT "execution_jobs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "challenge_versions"("id") ON DELETE SET NULL,
  CONSTRAINT "execution_jobs_operation_check" CHECK ("operation_type" IN ('RUN', 'SUBMIT')),
  CONSTRAINT "execution_jobs_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'))
);

CREATE INDEX "execution_jobs_user_queued_idx" ON "execution_jobs"("user_id", "queued_at" DESC);
CREATE INDEX "execution_jobs_status_queued_idx" ON "execution_jobs"("status", "queued_at");
