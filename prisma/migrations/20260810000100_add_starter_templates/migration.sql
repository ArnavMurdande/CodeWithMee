-- Add starter_templates column to challenge_versions table
ALTER TABLE "challenge_versions" ADD COLUMN "starter_templates" JSONB NOT NULL DEFAULT '{}';
