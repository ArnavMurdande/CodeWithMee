-- P0C-S5 adds lossless runtime audit metadata needed by the PostgreSQL authority adapter.
-- Audit rows remain append-only; no source record or feature flag is activated by this migration.
ALTER TABLE "audit_events"
  ADD COLUMN "actor_session_id" UUID,
  ADD COLUMN "request_id" VARCHAR(100),
  ADD COLUMN "occurred_at" TIMESTAMPTZ(6);

UPDATE "audit_events"
   SET "occurred_at" = "created_at"
 WHERE "occurred_at" IS NULL;

ALTER TABLE "audit_events"
  ALTER COLUMN "occurred_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurred_at" SET NOT NULL;

CREATE INDEX "audit_events_occurred_id_idx"
  ON "audit_events"("occurred_at", "id");
