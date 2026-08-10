ALTER TABLE "execution_jobs" DROP CONSTRAINT "execution_jobs_user_id_fkey";
ALTER TABLE "execution_jobs" DROP CONSTRAINT "execution_jobs_challenge_id_fkey";
ALTER TABLE "execution_jobs" DROP CONSTRAINT "execution_jobs_version_id_fkey";

ALTER TABLE "execution_jobs"
  ADD CONSTRAINT "execution_jobs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_jobs_challenge_id_fkey"
    FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "execution_jobs_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "challenge_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
