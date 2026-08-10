-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('PENDING', 'ACCEPTED', 'WRONG_ANSWER', 'RUNTIME_ERROR', 'TIME_LIMIT_EXCEEDED', 'RUNNER_ERROR');

-- CreateTable
CREATE TABLE "challenge_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "language" VARCHAR(32) NOT NULL,
    "code" TEXT NOT NULL,
    "status" "submission_status" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER NOT NULL DEFAULT 0,
    "pass_count" INTEGER NOT NULL DEFAULT 0,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "failed_test_case" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "challenge_submissions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "challenge_submissions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "challenge_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "challenge_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "challenge_submissions_score_check" CHECK ("score" >= 0),
    CONSTRAINT "challenge_submissions_pass_count_check" CHECK ("pass_count" >= 0),
    CONSTRAINT "challenge_submissions_total_count_check" CHECK ("total_count" >= 0),
    CONSTRAINT "challenge_submissions_pass_leq_total_check" CHECK ("pass_count" <= "total_count")
);

-- CreateIndex
CREATE INDEX "challenge_submissions_user_challenge_idx" ON "challenge_submissions"("user_id", "challenge_id", "created_at");
