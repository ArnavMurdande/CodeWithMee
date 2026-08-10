-- CreateEnum
CREATE TYPE "progress_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enrollment_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "status" "progress_status" NOT NULL DEFAULT 'NOT_STARTED',
    "last_position_sec" INTEGER NOT NULL DEFAULT 0,
    "watched_intervals" JSONB NOT NULL DEFAULT '[]',
    "completed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lesson_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lesson_progress_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "course_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lesson_progress_last_position_check" CHECK ("last_position_sec" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_enrollment_content_key" ON "lesson_progress"("enrollment_id", "content_id");
