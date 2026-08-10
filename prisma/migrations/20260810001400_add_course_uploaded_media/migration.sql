ALTER TABLE "course_contents"
  ADD COLUMN "media_file_id" UUID;

ALTER TABLE "course_contents"
  ADD CONSTRAINT "course_contents_media_file_id_fkey"
  FOREIGN KEY ("media_file_id") REFERENCES "files"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "course_contents_media_file_idx"
  ON "course_contents"("media_file_id");

CREATE TABLE "organization_payment_settings" (
  "organization_id" UUID PRIMARY KEY,
  "qr_file_id" UUID NOT NULL,
  "instructions" TEXT NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "organization_payment_settings_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_payment_settings_qr_file_id_fkey"
    FOREIGN KEY ("qr_file_id") REFERENCES "files"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organization_payment_settings_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organization_payment_settings_instructions_length_check"
    CHECK (char_length("instructions") BETWEEN 1 AND 5000)
);

CREATE INDEX "organization_payment_settings_qr_file_idx"
  ON "organization_payment_settings"("qr_file_id");

ALTER TABLE "course_payment_orders"
  ADD COLUMN "qr_file_id" UUID;

ALTER TABLE "course_payment_orders"
  ADD CONSTRAINT "course_payment_orders_qr_file_id_fkey"
  FOREIGN KEY ("qr_file_id") REFERENCES "files"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "course_payment_orders_qr_file_idx"
  ON "course_payment_orders"("qr_file_id");
