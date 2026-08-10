ALTER TYPE "enrollment_status" ADD VALUE IF NOT EXISTS 'suspended';

CREATE TABLE IF NOT EXISTS "course_staff_assignments" (
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" VARCHAR(32) NOT NULL CHECK ("role" IN ('manager','instructor','grader','analyst','payment_reviewer')),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("course_id", "user_id")
);

CREATE TABLE "course_resources" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_id" UUID NOT NULL REFERENCES "course_contents"("id") ON DELETE CASCADE,
  "file_id" UUID REFERENCES "files"("id") ON DELETE RESTRICT,
  "external_url" VARCHAR(2048),
  "notes" TEXT,
  "allow_download" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("file_id" IS NOT NULL)::int + ("external_url" IS NOT NULL)::int = 1)
);
CREATE INDEX "course_resources_content_idx" ON "course_resources"("content_id");

CREATE TABLE "course_quizzes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_id" UUID NOT NULL UNIQUE REFERENCES "course_contents"("id") ON DELETE CASCADE,
  "title" VARCHAR(255) NOT NULL,
  "instructions" TEXT,
  "attempts_allowed" INTEGER NOT NULL DEFAULT 1 CHECK ("attempts_allowed" BETWEEN 1 AND 100),
  "passing_score" INTEGER NOT NULL DEFAULT 70 CHECK ("passing_score" BETWEEN 0 AND 100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "course_quiz_questions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "quiz_id" UUID NOT NULL REFERENCES "course_quizzes"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL,
  "kind" VARCHAR(32) NOT NULL CHECK ("kind" IN ('single_choice','multiple_choice','true_false','written')),
  "prompt" TEXT NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "answer_key" JSONB,
  "points" INTEGER NOT NULL DEFAULT 1 CHECK ("points" BETWEEN 1 AND 1000),
  UNIQUE ("quiz_id", "position")
);

CREATE TABLE "course_quiz_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "quiz_id" UUID NOT NULL REFERENCES "course_quizzes"("id") ON DELETE CASCADE,
  "enrollment_id" UUID NOT NULL REFERENCES "enrollments"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "attempt_number" INTEGER NOT NULL CHECK ("attempt_number" > 0),
  "answers" JSONB NOT NULL DEFAULT '{}',
  "score" NUMERIC(7,2),
  "status" VARCHAR(24) NOT NULL DEFAULT 'submitted' CHECK ("status" IN ('draft','submitted','pending_grading','graded')),
  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "graded_at" TIMESTAMPTZ,
  UNIQUE ("quiz_id", "enrollment_id", "attempt_number")
);

CREATE TABLE "course_assignments" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "content_id" UUID NOT NULL UNIQUE REFERENCES "course_contents"("id") ON DELETE CASCADE,
  "title" VARCHAR(255) NOT NULL,
  "instructions" TEXT NOT NULL,
  "due_at" TIMESTAMPTZ,
  "max_attempts" INTEGER NOT NULL DEFAULT 1 CHECK ("max_attempts" BETWEEN 1 AND 100),
  "max_score" INTEGER NOT NULL DEFAULT 100 CHECK ("max_score" BETWEEN 1 AND 10000),
  "rubric" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "course_assignment_submissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assignment_id" UUID NOT NULL REFERENCES "course_assignments"("id") ON DELETE CASCADE,
  "enrollment_id" UUID NOT NULL REFERENCES "enrollments"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "attempt_number" INTEGER NOT NULL CHECK ("attempt_number" > 0),
  "written_answer" TEXT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'submitted' CHECK ("status" IN ('draft','submitted','graded','returned')),
  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("assignment_id", "enrollment_id", "attempt_number")
);

CREATE TABLE "course_assignment_submission_files" (
  "submission_id" UUID NOT NULL REFERENCES "course_assignment_submissions"("id") ON DELETE CASCADE,
  "file_id" UUID NOT NULL REFERENCES "files"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("submission_id", "file_id")
);

CREATE TABLE "course_grades" (
  "submission_id" UUID PRIMARY KEY REFERENCES "course_assignment_submissions"("id") ON DELETE CASCADE,
  "grader_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "score" NUMERIC(10,2) NOT NULL CHECK ("score" >= 0),
  "rubric_scores" JSONB NOT NULL DEFAULT '{}',
  "feedback" TEXT,
  "released_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "course_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "email_normalized" VARCHAR(320) NOT NULL,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "status" VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','accepted','revoked','expired')),
  "invited_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "accepted_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "course_invitations_course_status_idx" ON "course_invitations"("course_id", "status");

CREATE TABLE "course_payment_orders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE RESTRICT,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" >= 0),
  "currency" CHAR(3) NOT NULL,
  "qr_instructions" TEXT NOT NULL,
  "proof_file_id" UUID REFERENCES "files"("id") ON DELETE RESTRICT,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending_payment' CHECK ("status" IN ('pending_payment','pending_review','approved','rejected','more_information')),
  "reviewer_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "review_note" TEXT,
  "reviewed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "course_payment_orders_active_user_course_key" ON "course_payment_orders"("user_id", "course_id") WHERE "status" <> 'rejected';

CREATE TABLE "course_learning_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE CASCADE,
  "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "source_id" UUID,
  "event_data" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "course_learning_events_course_time_idx" ON "course_learning_events"("course_id", "occurred_at");
CREATE INDEX "course_learning_events_org_time_idx" ON "course_learning_events"("organization_id", "occurred_at");
