ALTER TABLE "course_quiz_attempts"
  ADD COLUMN "grader_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD COLUMN "feedback" TEXT,
  ADD COLUMN "released_at" TIMESTAMPTZ;

CREATE INDEX "course_quiz_attempts_pending_idx"
  ON "course_quiz_attempts"("status", "submitted_at");

ALTER TABLE "course_contents"
  ADD COLUMN "challenge_id" UUID REFERENCES "challenges"("id") ON DELETE RESTRICT;
CREATE INDEX "course_contents_challenge_idx" ON "course_contents"("challenge_id");
