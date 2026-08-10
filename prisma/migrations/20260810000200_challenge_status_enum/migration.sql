-- CreateEnum
CREATE TYPE "challenge_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED');

-- AlterTable
ALTER TABLE "challenges" ADD COLUMN "status" "challenge_status" NOT NULL DEFAULT 'DRAFT';
