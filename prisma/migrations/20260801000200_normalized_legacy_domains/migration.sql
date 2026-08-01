-- CreateEnum
CREATE TYPE "challenge_difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "challenge_test_visibility" AS ENUM ('visible', 'hidden');

-- CreateEnum
CREATE TYPE "course_visibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "course_pricing" AS ENUM ('free', 'paid');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('enrolled', 'in_progress', 'completed', 'pending_payment');

-- CreateEnum
CREATE TYPE "social_relationship_status" AS ENUM ('requested', 'following');

-- CreateEnum
CREATE TYPE "idea_visibility" AS ENUM ('private', 'public');

-- CreateTable
CREATE TABLE "learning_profiles" (
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "theme_preferences" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "learning_roadmaps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_topics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roadmap_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "youtube_query" VARCHAR(500),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "learning_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "context" VARCHAR(32) NOT NULL,
    "pathway" VARCHAR(200),
    "chapter" VARCHAR(200),
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "formatting" JSONB,
    "canvas_data" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_note_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "file_id" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "legacy_url" VARCHAR(2048),
    "original_name" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_note_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "video_source_key" VARCHAR(500) NOT NULL,
    "position_seconds" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "topic" VARCHAR(200),
    "pathway" VARCHAR(200),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_simulation_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_simulation_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_profiles" (
    "user_id" UUID NOT NULL,
    "privacy_settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "social_relationships" (
    "source_user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "status" "social_relationship_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_relationships_pkey" PRIMARY KEY ("source_user_id","target_user_id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "blocker_user_id" UUID NOT NULL,
    "blocked_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_user_id","blocked_user_id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "difficulty" "challenge_difficulty" NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "score" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "legacy_successful_attempts" INTEGER NOT NULL DEFAULT 0,
    "legacy_total_attempts" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "statement" TEXT NOT NULL,
    "constraints_text" TEXT,
    "reference_solution" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_test_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "expected_output" TEXT NOT NULL,
    "visibility" "challenge_test_visibility" NOT NULL DEFAULT 'visible',

    CONSTRAINT "challenge_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_reactions" (
    "challenge_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_reactions_pkey" PRIMARY KEY ("challenge_id","user_id")
);

-- CreateTable
CREATE TABLE "challenge_comment_reactions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "award_type" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_comment_reactions_pkey" PRIMARY KEY ("comment_id","user_id","kind")
);

-- CreateTable
CREATE TABLE "challenge_bookmarks" (
    "user_id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_bookmarks_pkey" PRIMARY KEY ("user_id","challenge_id")
);

-- CreateTable
CREATE TABLE "challenge_solves" (
    "user_id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "solved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_solves_pkey" PRIMARY KEY ("user_id","challenge_id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "thumbnail_legacy_url" VARCHAR(2048),
    "visibility" "course_visibility" NOT NULL DEFAULT 'public',
    "pricing" "course_pricing" NOT NULL DEFAULT 'free',
    "price_minor" INTEGER,
    "currency" CHAR(3),
    "category" VARCHAR(120),
    "tags" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_contents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "legacy_url" VARCHAR(2048),
    "body" TEXT,
    "allow_download" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "course_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'enrolled',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_progress_import_snapshots" (
    "enrollment_id" UUID NOT NULL,
    "progress_percent" INTEGER NOT NULL,
    "completed_source_ids" JSONB NOT NULL,
    "authoritative" BOOLEAN NOT NULL DEFAULT false,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_progress_import_snapshots_pkey" PRIMARY KEY ("enrollment_id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "author_user_id" UUID,
    "author_organization_id" UUID,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "file_id" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "legacy_url" VARCHAR(2048),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "social_post_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID,
    "author_organization_id" UUID,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post_reactions" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "award_type" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_post_reactions_pkey" PRIMARY KEY ("post_id","user_id","kind")
);

-- CreateTable
CREATE TABLE "social_post_saves" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_post_saves_pkey" PRIMARY KEY ("post_id","user_id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "author_user_id" UUID,
    "author_organization_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "tech_stack" JSONB NOT NULL DEFAULT '[]',
    "visibility" "idea_visibility" NOT NULL DEFAULT 'public',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idea_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(6),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "idea_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_reactions" (
    "idea_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL DEFAULT 'like',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_reactions_pkey" PRIMARY KEY ("idea_id","user_id")
);

-- CreateTable
CREATE TABLE "integration_cache" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(40) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_roadmaps_user_updated_idx" ON "learning_roadmaps"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "learning_roadmaps_user_position_key" ON "learning_roadmaps"("user_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "learning_topics_roadmap_position_key" ON "learning_topics"("roadmap_id", "position");

-- CreateIndex
CREATE INDEX "learning_conversations_user_occurred_idx" ON "learning_conversations"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "learning_notes_user_updated_idx" ON "learning_notes"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "learning_note_attachments_note_idx" ON "learning_note_attachments"("note_id");

-- CreateIndex
CREATE INDEX "learning_note_attachments_file_idx" ON "learning_note_attachments"("file_id");

-- CreateIndex
CREATE INDEX "video_progress_user_updated_idx" ON "video_progress"("user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_progress_user_source_key" ON "video_progress"("user_id", "video_source_key");

-- CreateIndex
CREATE UNIQUE INDEX "job_simulation_progress_user_position_key" ON "job_simulation_progress"("user_id", "position");

-- CreateIndex
CREATE INDEX "social_relationships_target_status_idx" ON "social_relationships"("target_user_id", "status");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks"("blocked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenges_title_key" ON "challenges"("title");

-- CreateIndex
CREATE INDEX "challenges_difficulty_created_idx" ON "challenges"("difficulty", "created_at");

-- CreateIndex
CREATE INDEX "challenges_creator_idx" ON "challenges"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_versions_challenge_version_key" ON "challenge_versions"("challenge_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_test_cases_version_position_key" ON "challenge_test_cases"("version_id", "position");

-- CreateIndex
CREATE INDEX "challenge_comments_challenge_created_idx" ON "challenge_comments"("challenge_id", "created_at");

-- CreateIndex
CREATE INDEX "challenge_comments_parent_idx" ON "challenge_comments"("parent_id");

-- CreateIndex
CREATE INDEX "courses_organization_active_idx" ON "courses"("organization_id", "active");

-- CreateIndex
CREATE INDEX "courses_visibility_created_idx" ON "courses"("visibility", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "course_versions_course_version_key" ON "course_versions"("course_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "course_modules_version_position_key" ON "course_modules"("version_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "course_contents_module_position_key" ON "course_contents"("module_id", "position");

-- CreateIndex
CREATE INDEX "enrollments_course_status_idx" ON "enrollments"("course_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_user_course_key" ON "enrollments"("user_id", "course_id");

-- CreateIndex
CREATE INDEX "social_posts_created_idx" ON "social_posts"("created_at", "id");

-- CreateIndex
CREATE INDEX "social_posts_user_created_idx" ON "social_posts"("author_user_id", "created_at");

-- CreateIndex
CREATE INDEX "social_posts_org_created_idx" ON "social_posts"("author_organization_id", "created_at");

-- CreateIndex
CREATE INDEX "social_post_media_file_idx" ON "social_post_media"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_media_post_position_key" ON "social_post_media"("post_id", "position");

-- CreateIndex
CREATE INDEX "social_comments_post_created_idx" ON "social_comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "social_comments_parent_idx" ON "social_comments"("parent_id");

-- CreateIndex
CREATE INDEX "ideas_visibility_created_idx" ON "ideas"("visibility", "created_at");

-- CreateIndex
CREATE INDEX "ideas_user_created_idx" ON "ideas"("author_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ideas_org_created_idx" ON "ideas"("author_organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idea_milestones_idea_position_key" ON "idea_milestones"("idea_id", "position");

-- CreateIndex
CREATE INDEX "integration_cache_expires_idx" ON "integration_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_cache_provider_key_hash_key" ON "integration_cache"("provider", "key_hash");

-- AddForeignKey
ALTER TABLE "learning_profiles" ADD CONSTRAINT "learning_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_roadmaps" ADD CONSTRAINT "learning_roadmaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_topics" ADD CONSTRAINT "learning_topics_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "learning_roadmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_conversations" ADD CONSTRAINT "learning_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_notes" ADD CONSTRAINT "learning_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_note_attachments" ADD CONSTRAINT "learning_note_attachments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "learning_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_note_attachments" ADD CONSTRAINT "learning_note_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_simulation_progress" ADD CONSTRAINT "job_simulation_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_relationships" ADD CONSTRAINT "social_relationships_source_user_id_fkey" FOREIGN KEY ("source_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_relationships" ADD CONSTRAINT "social_relationships_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_fkey" FOREIGN KEY ("blocker_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_fkey" FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_versions" ADD CONSTRAINT "challenge_versions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_test_cases" ADD CONSTRAINT "challenge_test_cases_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "challenge_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_comments" ADD CONSTRAINT "challenge_comments_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_comments" ADD CONSTRAINT "challenge_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "challenge_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_comments" ADD CONSTRAINT "challenge_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_reactions" ADD CONSTRAINT "challenge_reactions_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_reactions" ADD CONSTRAINT "challenge_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_comment_reactions" ADD CONSTRAINT "challenge_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "challenge_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_comment_reactions" ADD CONSTRAINT "challenge_comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_bookmarks" ADD CONSTRAINT "challenge_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_bookmarks" ADD CONSTRAINT "challenge_bookmarks_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_solves" ADD CONSTRAINT "challenge_solves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_solves" ADD CONSTRAINT "challenge_solves_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "course_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_contents" ADD CONSTRAINT "course_contents_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_progress_import_snapshots" ADD CONSTRAINT "course_progress_import_snapshots_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_author_organization_id_fkey" FOREIGN KEY ("author_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_media" ADD CONSTRAINT "social_post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_media" ADD CONSTRAINT "social_post_media_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_author_organization_id_fkey" FOREIGN KEY ("author_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_reactions" ADD CONSTRAINT "social_post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_reactions" ADD CONSTRAINT "social_post_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_saves" ADD CONSTRAINT "social_post_saves_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_saves" ADD CONSTRAINT "social_post_saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_author_organization_id_fkey" FOREIGN KEY ("author_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_milestones" ADD CONSTRAINT "idea_milestones_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_reactions" ADD CONSTRAINT "idea_reactions_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_reactions" ADD CONSTRAINT "idea_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reviewed P0C-S4 invariants not expressible in Prisma.
ALTER TABLE "learning_profiles"
  ADD CONSTRAINT "learning_profiles_scores_check" CHECK ("score" >= 0 AND "points" >= 0),
  ADD CONSTRAINT "learning_profiles_theme_object_check"
    CHECK ("theme_preferences" IS NULL OR jsonb_typeof("theme_preferences") = 'object');

ALTER TABLE "learning_roadmaps"
  ADD CONSTRAINT "learning_roadmaps_position_check" CHECK ("position" >= 0);
ALTER TABLE "learning_topics"
  ADD CONSTRAINT "learning_topics_position_check" CHECK ("position" >= 0);
ALTER TABLE "learning_conversations"
  ADD CONSTRAINT "learning_conversations_context_check" CHECK ("context" IN ('general', 'sandbox'));
ALTER TABLE "learning_notes"
  ADD CONSTRAINT "learning_notes_formatting_object_check"
    CHECK ("formatting" IS NULL OR jsonb_typeof("formatting") = 'object');
ALTER TABLE "learning_note_attachments"
  ADD CONSTRAINT "learning_note_attachments_source_check"
    CHECK (num_nonnulls("file_id", "legacy_url") >= 1),
  ADD CONSTRAINT "learning_note_attachments_kind_check"
    CHECK ("kind" IN ('image', 'audio', 'video', 'document', 'text'));
ALTER TABLE "video_progress"
  ADD CONSTRAINT "video_progress_time_check"
    CHECK ("position_seconds" >= 0 AND "duration_seconds" >= 0 AND ("duration_seconds" = 0 OR "position_seconds" <= "duration_seconds"));
ALTER TABLE "job_simulation_progress"
  ADD CONSTRAINT "job_simulation_progress_bounds_check" CHECK ("progress" BETWEEN 0 AND 100 AND "position" >= 0);
ALTER TABLE "social_profiles"
  ADD CONSTRAINT "social_profiles_privacy_object_check" CHECK (jsonb_typeof("privacy_settings") = 'object');
ALTER TABLE "social_relationships"
  ADD CONSTRAINT "social_relationships_not_self_check" CHECK ("source_user_id" <> "target_user_id");
ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_not_self_check" CHECK ("blocker_user_id" <> "blocked_user_id");

ALTER TABLE "challenges"
  ADD CONSTRAINT "challenges_score_attempts_check"
    CHECK ("score" BETWEEN 1 AND 10 AND "legacy_successful_attempts" >= 0 AND "legacy_total_attempts" >= "legacy_successful_attempts"),
  ADD CONSTRAINT "challenges_tags_array_check" CHECK (jsonb_typeof("tags") = 'array');
ALTER TABLE "challenge_versions"
  ADD CONSTRAINT "challenge_versions_version_check" CHECK ("version" > 0);
ALTER TABLE "challenge_test_cases"
  ADD CONSTRAINT "challenge_test_cases_position_check" CHECK ("position" >= 0);
ALTER TABLE "challenge_reactions"
  ADD CONSTRAINT "challenge_reactions_kind_check" CHECK ("kind" IN ('like', 'dislike'));
ALTER TABLE "challenge_comment_reactions"
  ADD CONSTRAINT "challenge_comment_reactions_kind_check" CHECK ("kind" IN ('like', 'dislike', 'award'));

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_price_check"
    CHECK (
      ("pricing" = 'free' AND COALESCE("price_minor", 0) = 0 AND "currency" IS NULL)
      OR ("pricing" = 'paid' AND "price_minor" > 0 AND "currency" ~ '^[A-Z]{3}$')
    ),
  ADD CONSTRAINT "courses_tags_array_check" CHECK (jsonb_typeof("tags") = 'array');
ALTER TABLE "course_versions"
  ADD CONSTRAINT "course_versions_version_check" CHECK ("version" > 0);
ALTER TABLE "course_modules"
  ADD CONSTRAINT "course_modules_position_check" CHECK ("position" >= 0);
ALTER TABLE "course_contents"
  ADD CONSTRAINT "course_contents_position_kind_check"
    CHECK ("position" >= 0 AND "kind" IN ('video', 'note', 'link', 'resource', 'practice', 'test'));
ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_completion_check"
    CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL));
ALTER TABLE "course_progress_import_snapshots"
  ADD CONSTRAINT "course_progress_import_snapshots_check"
    CHECK ("progress_percent" BETWEEN 0 AND 100 AND "authoritative" = false AND jsonb_typeof("completed_source_ids") = 'array');

ALTER TABLE "social_posts"
  ADD CONSTRAINT "social_posts_exactly_one_author_check"
    CHECK (num_nonnulls("author_user_id", "author_organization_id") = 1);
ALTER TABLE "social_post_media"
  ADD CONSTRAINT "social_post_media_source_kind_check"
    CHECK (num_nonnulls("file_id", "legacy_url") >= 1 AND "kind" IN ('image', 'video', 'audio', 'document'));
ALTER TABLE "social_comments"
  ADD CONSTRAINT "social_comments_exactly_one_author_check"
    CHECK (num_nonnulls("author_user_id", "author_organization_id") = 1);
ALTER TABLE "social_post_reactions"
  ADD CONSTRAINT "social_post_reactions_kind_check"
    CHECK ("kind" IN ('like', 'dislike', 'award'));

ALTER TABLE "ideas"
  ADD CONSTRAINT "ideas_exactly_one_author_check"
    CHECK (num_nonnulls("author_user_id", "author_organization_id") = 1),
  ADD CONSTRAINT "ideas_tech_stack_array_check" CHECK (jsonb_typeof("tech_stack") = 'array');
ALTER TABLE "idea_milestones"
  ADD CONSTRAINT "idea_milestones_position_completion_check"
    CHECK ("position" >= 0 AND ("completed" = ("completed_at" IS NOT NULL)));
ALTER TABLE "idea_reactions"
  ADD CONSTRAINT "idea_reactions_kind_check" CHECK ("kind" IN ('like', 'dislike'));
ALTER TABLE "integration_cache"
  ADD CONSTRAINT "integration_cache_key_value_check"
    CHECK ("key_hash" ~ '^[0-9a-f]{64}$' AND jsonb_typeof("value") = 'object' AND "created_at" < "expires_at");

CREATE INDEX "challenges_tags_gin_idx" ON "challenges" USING GIN ("tags");
CREATE INDEX "courses_tags_gin_idx" ON "courses" USING GIN ("tags");
CREATE INDEX "ideas_tech_stack_gin_idx" ON "ideas" USING GIN ("tech_stack");

