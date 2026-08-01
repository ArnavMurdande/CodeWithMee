-- CreateTable
CREATE TABLE "social_comment_reactions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "award_type" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comment_reactions_pkey" PRIMARY KEY ("comment_id","user_id","kind")
);

-- CreateTable
CREATE TABLE "social_comment_saves" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comment_saves_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- CreateTable
CREATE TABLE "idea_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idea_id" UUID NOT NULL,
    "author_user_id" UUID,
    "author_organization_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_updates_idea_created_idx" ON "idea_updates"("idea_id", "created_at");

-- AddForeignKey
ALTER TABLE "social_comment_reactions" ADD CONSTRAINT "social_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comment_reactions" ADD CONSTRAINT "social_comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comment_saves" ADD CONSTRAINT "social_comment_saves_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comment_saves" ADD CONSTRAINT "social_comment_saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_updates" ADD CONSTRAINT "idea_updates_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_updates" ADD CONSTRAINT "idea_updates_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_updates" ADD CONSTRAINT "idea_updates_author_organization_id_fkey" FOREIGN KEY ("author_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewed P0C-S4 interaction invariants.
ALTER TABLE "social_comment_reactions"
  ADD CONSTRAINT "social_comment_reactions_kind_check"
    CHECK ("kind" IN ('like', 'dislike', 'award'));
ALTER TABLE "idea_updates"
  ADD CONSTRAINT "idea_updates_exactly_one_author_check"
    CHECK (num_nonnulls("author_user_id", "author_organization_id") = 1);

