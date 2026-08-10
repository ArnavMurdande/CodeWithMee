CREATE TYPE "course_publication_status" AS ENUM ('draft', 'published', 'retired');

ALTER TABLE "courses"
  ADD COLUMN "publication_status" "course_publication_status" NOT NULL DEFAULT 'draft',
  ADD COLUMN "published_at" TIMESTAMPTZ(6);

CREATE INDEX "courses_organization_publication_idx"
  ON "courses"("organization_id", "publication_status", "updated_at" DESC);
