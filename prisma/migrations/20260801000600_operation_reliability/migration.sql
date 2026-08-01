-- Add lease ownership needed for crash-safe, durable idempotency execution.
-- Existing completed rows remain valid; an old incomplete row has no lease and is recoverable.
ALTER TABLE "idempotency_keys"
  ADD COLUMN "lease_id" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "idempotency_keys_lease_pair_check"
    CHECK (("lease_id" IS NULL) = ("lease_expires_at" IS NULL)),
  ADD CONSTRAINT "idempotency_keys_completion_lease_check"
    CHECK ("response_status" IS NULL OR "lease_id" IS NULL);

CREATE INDEX "idempotency_keys_lease_expires_at_idx"
  ON "idempotency_keys"("lease_expires_at");
