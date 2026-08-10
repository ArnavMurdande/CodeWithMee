ALTER TABLE "course_versions"
  ADD COLUMN "status" "course_publication_status" NOT NULL DEFAULT 'draft',
  ADD COLUMN "published_at" TIMESTAMPTZ(6);

WITH ranked AS (
  SELECT cv.id,c.publication_status,
         ROW_NUMBER() OVER (PARTITION BY cv.course_id ORDER BY cv.version DESC) AS position
  FROM course_versions cv JOIN courses c ON c.id=cv.course_id
)
UPDATE course_versions cv SET
  status = CASE
    WHEN ranked.position=1 AND ranked.publication_status='published' THEN 'published'::course_publication_status
    WHEN ranked.position=1 AND ranked.publication_status='draft' THEN 'draft'::course_publication_status
    ELSE 'retired'::course_publication_status
  END,
  published_at = CASE
    WHEN ranked.position=1 AND ranked.publication_status='published' THEN NOW()
    ELSE NULL
  END
FROM ranked WHERE ranked.id=cv.id;

CREATE INDEX "course_versions_course_status_version_idx"
  ON "course_versions"("course_id", "status", "version" DESC);

CREATE UNIQUE INDEX "course_versions_one_draft_per_course_key"
  ON "course_versions"("course_id") WHERE "status"='draft';
