ALTER TABLE "enrollments" ADD COLUMN "course_version_id" UUID;

UPDATE "enrollments" e
SET "course_version_id" = (
  SELECT cv.id FROM "course_versions" cv
  WHERE cv.course_id = e.course_id
  ORDER BY cv.version DESC
  LIMIT 1
)
WHERE "course_version_id" IS NULL;

ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_course_version_id_fkey"
    FOREIGN KEY ("course_version_id") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "enrollments_course_version_idx" ON "enrollments"("course_version_id");
