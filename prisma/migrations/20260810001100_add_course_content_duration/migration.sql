ALTER TABLE "course_contents" ADD COLUMN "duration_seconds" INTEGER;
ALTER TABLE "course_contents"
  ADD CONSTRAINT "course_contents_duration_check"
    CHECK ("duration_seconds" IS NULL OR "duration_seconds" > 0);
