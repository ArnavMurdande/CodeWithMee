-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'banned', 'deletion_pending');

-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('learner', 'moderator', 'support', 'superadmin');

-- CreateEnum
CREATE TYPE "authorization_scope" AS ENUM ('platform', 'organization', 'course');

-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('local', 'google');

-- CreateEnum
CREATE TYPE "session_client" AS ENUM ('web', 'extension');

-- CreateEnum
CREATE TYPE "refresh_token_state" AS ENUM ('current', 'consumed');

-- CreateEnum
CREATE TYPE "identity_token_kind" AS ENUM ('email_verification', 'password_reset');

-- CreateEnum
CREATE TYPE "pkce_method" AS ENUM ('S256');

-- CreateEnum
CREATE TYPE "organization_verification_status" AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "organization_role" AS ENUM ('owner', 'admin', 'instructor', 'grader', 'analyst');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'suspended', 'revoked');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "verification_review_status" AS ENUM ('pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "file_scan_status" AS ENUM ('pending', 'clean', 'infected', 'unscannable', 'failed');

-- CreateEnum
CREATE TYPE "file_visibility" AS ENUM ('private', 'organization', 'enrolled', 'public');

-- CreateEnum
CREATE TYPE "file_state" AS ENUM ('upload_pending', 'quarantined', 'ready', 'deleted');

-- CreateEnum
CREATE TYPE "job_state" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "import_run_state" AS ENUM ('inventory', 'dry_run', 'importing', 'reconciled', 'failed');

-- CreateEnum
CREATE TYPE "import_record_state" AS ENUM ('planned', 'imported', 'quarantined', 'skipped');

-- CreateTable
CREATE TABLE "permission_definitions" (
    "key" VARCHAR(120) NOT NULL,
    "scope" "authorization_scope" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "permission_definitions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_definitions" (
    "key" VARCHAR(120) NOT NULL,
    "scope" "authorization_scope" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_definitions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_key" VARCHAR(120) NOT NULL,
    "permission_key" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_key","permission_key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_normalized" VARCHAR(320) NOT NULL,
    "email_display" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "username" VARCHAR(64),
    "status" "user_status" NOT NULL DEFAULT 'active',
    "platform_role" "platform_role" NOT NULL DEFAULT 'learner',
    "authority_revision" INTEGER NOT NULL DEFAULT 1,
    "email_verified_at" TIMESTAMPTZ(6),
    "avatar_file_id" UUID,
    "deletion_requested_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "provider_subject" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "client" "session_client" NOT NULL,
    "family_id" UUID NOT NULL,
    "authenticated_at" TIMESTAMPTZ(6) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "compromised_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6) NOT NULL,
    "device_label" VARCHAR(120),
    "user_agent_hash" CHAR(64),
    "ip_prefix" VARCHAR(80),
    "csrf_secret_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "state" "refresh_token_state" NOT NULL DEFAULT 'current',
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "replaced_by_token_id" UUID,

    CONSTRAINT "session_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_one_time_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "identity_token_kind" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "public_client" BOOLEAN NOT NULL DEFAULT true,
    "redirect_uris" JSONB NOT NULL,
    "allowed_scopes" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_hash" CHAR(64) NOT NULL,
    "client_id" VARCHAR(128) NOT NULL,
    "user_id" UUID NOT NULL,
    "redirect_uri" VARCHAR(2048) NOT NULL,
    "scopes" JSONB NOT NULL,
    "pkce_challenge" VARCHAR(128) NOT NULL,
    "pkce_method" "pkce_method" NOT NULL DEFAULT 'S256',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "industry" VARCHAR(120),
    "owner_user_id" UUID NOT NULL,
    "logo_file_id" UUID,
    "verification_status" "organization_verification_status" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "organization_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "role" "organization_role" NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "token_hash" CHAR(64) NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "accepted_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_verification_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "reviewer_user_id" UUID,
    "statement" VARCHAR(2000) NOT NULL,
    "status" "verification_review_status" NOT NULL DEFAULT 'pending_review',
    "decision_reason" VARCHAR(2000),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_verification_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_verification_evidence" (
    "review_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_verification_evidence_pkey" PRIMARY KEY ("review_id","file_id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID,
    "owner_organization_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "storage_provider" VARCHAR(32) NOT NULL DEFAULT 's3',
    "storage_bucket" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "declared_mime" VARCHAR(255) NOT NULL,
    "detected_mime" VARCHAR(255),
    "byte_size" BIGINT NOT NULL,
    "sha256" CHAR(64),
    "etag" VARCHAR(255),
    "state" "file_state" NOT NULL DEFAULT 'upload_pending',
    "scan_status" "file_scan_status" NOT NULL DEFAULT 'pending',
    "visibility" "file_visibility" NOT NULL DEFAULT 'private',
    "uploaded_at" TIMESTAMPTZ(6),
    "scanned_at" TIMESTAMPTZ(6),
    "quarantine_reason" VARCHAR(500),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authority_controls" (
    "key" VARCHAR(120) NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "operator_ref" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "authority_controls_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "organization_id" UUID,
    "action" VARCHAR(160) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(255) NOT NULL,
    "correlation_id" UUID,
    "reason" VARCHAR(500),
    "source" VARCHAR(80) NOT NULL,
    "operator_ref" VARCHAR(255),
    "before_state" JSONB,
    "after_state" JSONB,
    "operation_key" VARCHAR(160),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID NOT NULL,
    "action" VARCHAR(160) NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_type" VARCHAR(80),
    "resource_id" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "outbox_event_id" UUID,
    "job_type" VARCHAR(120) NOT NULL,
    "source_key" VARCHAR(255) NOT NULL,
    "state" "job_state" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leased_until" TIMESTAMPTZ(6),
    "worker_id" VARCHAR(160),
    "error_code" VARCHAR(120),
    "error_summary" VARCHAR(1000),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" VARCHAR(160) NOT NULL,
    "environment" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "rollout_rules" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key","environment")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_system" VARCHAR(80) NOT NULL,
    "source_snapshot" VARCHAR(1024) NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "configuration_hash" CHAR(64) NOT NULL,
    "state" "import_run_state" NOT NULL DEFAULT 'inventory',
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "started_by_user_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_run_id" UUID NOT NULL,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "source_checksum" CHAR(64) NOT NULL,
    "target_type" VARCHAR(80),
    "target_id" VARCHAR(255),
    "state" "import_record_state" NOT NULL DEFAULT 'planned',
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_run_id" UUID NOT NULL,
    "source_type" VARCHAR(80) NOT NULL,
    "source_id" VARCHAR(255),
    "code" VARCHAR(120) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "details" JSONB,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_avatar_file_id_key" ON "users"("avatar_file_id");

-- CreateIndex
CREATE INDEX "users_status_platform_role_idx" ON "users"("status", "platform_role");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_user_provider_key" ON "auth_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_family_id_key" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "sessions_user_active_expiry_idx" ON "sessions"("user_id", "revoked_at", "idle_expires_at");

-- CreateIndex
CREATE INDEX "sessions_absolute_expiry_idx" ON "sessions"("absolute_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_refresh_tokens_hash_key" ON "session_refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "session_refresh_tokens_replaced_by_key" ON "session_refresh_tokens"("replaced_by_token_id");

-- CreateIndex
CREATE INDEX "session_refresh_tokens_session_state_expiry_idx" ON "session_refresh_tokens"("session_id", "state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "identity_one_time_tokens_hash_key" ON "identity_one_time_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "identity_one_time_tokens_user_kind_expiry_idx" ON "identity_one_time_tokens"("user_id", "kind", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_hash_key" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_client_expiry_idx" ON "oauth_authorization_codes"("client_id", "expires_at");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_user_expiry_idx" ON "oauth_authorization_codes"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_logo_file_id_key" ON "organizations"("logo_file_id");

-- CreateIndex
CREATE INDEX "organizations_verification_created_idx" ON "organizations"("verification_status", "created_at");

-- CreateIndex
CREATE INDEX "organizations_owner_user_id_idx" ON "organizations"("owner_user_id");

-- CreateIndex
CREATE INDEX "organization_memberships_user_status_idx" ON "organization_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "organization_memberships_org_role_status_idx" ON "organization_memberships"("organization_id", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_org_user_key" ON "organization_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_hash_key" ON "organization_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "organization_invitations_org_status_expiry_idx" ON "organization_invitations"("organization_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "organization_invitations_email_status_idx" ON "organization_invitations"("email_normalized", "status");

-- CreateIndex
CREATE INDEX "provider_verification_reviews_status_submitted_idx" ON "provider_verification_reviews"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "provider_verification_reviews_org_created_idx" ON "provider_verification_reviews"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_verification_evidence_file_id_idx" ON "provider_verification_evidence"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_owner_user_purpose_scan_idx" ON "files"("owner_user_id", "purpose", "scan_status");

-- CreateIndex
CREATE INDEX "files_owner_org_purpose_scan_idx" ON "files"("owner_organization_id", "purpose", "scan_status");

-- CreateIndex
CREATE INDEX "files_sha256_idx" ON "files"("sha256");

-- CreateIndex
CREATE INDEX "files_state_created_idx" ON "files"("state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_operation_key_key" ON "audit_events"("operation_key");

-- CreateIndex
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_org_created_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_action_created_idx" ON "audit_events"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_created_idx" ON "audit_events"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_actor_action_key" ON "idempotency_keys"("actor_user_id", "action", "key");

-- CreateIndex
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events"("processed_at", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "job_runs_state_lease_idx" ON "job_runs"("state", "leased_until", "created_at");

-- CreateIndex
CREATE INDEX "job_runs_outbox_event_id_idx" ON "job_runs"("outbox_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_type_source_attempt_key" ON "job_runs"("job_type", "source_key", "attempt");

-- CreateIndex
CREATE INDEX "feature_flags_environment_updated_idx" ON "feature_flags"("environment", "updated_at");

-- CreateIndex
CREATE INDEX "import_runs_state_started_idx" ON "import_runs"("state", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_source_config_mode_key" ON "import_runs"("source_system", "source_checksum", "configuration_hash", "dry_run");

-- CreateIndex
CREATE INDEX "import_records_state_source_type_idx" ON "import_records"("state", "source_type");

-- CreateIndex
CREATE UNIQUE INDEX "import_records_run_source_key" ON "import_records"("import_run_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "import_exceptions_run_severity_idx" ON "import_exceptions"("import_run_id", "severity", "created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "role_definitions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission_definitions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_fkey" FOREIGN KEY ("avatar_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_refresh_tokens" ADD CONSTRAINT "session_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_refresh_tokens" ADD CONSTRAINT "session_refresh_tokens_replaced_by_token_id_fkey" FOREIGN KEY ("replaced_by_token_id") REFERENCES "session_refresh_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_one_time_tokens" ADD CONSTRAINT "identity_one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_reviews" ADD CONSTRAINT "provider_verification_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_reviews" ADD CONSTRAINT "provider_verification_reviews_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_reviews" ADD CONSTRAINT "provider_verification_reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_evidence" ADD CONSTRAINT "provider_verification_evidence_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "provider_verification_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_evidence" ADD CONSTRAINT "provider_verification_evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_organization_id_fkey" FOREIGN KEY ("owner_organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_exceptions" ADD CONSTRAINT "import_exceptions_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma does not model PostgreSQL partial indexes or CHECK/constraint triggers.
-- Keep this section deterministic and covered by database integration tests.

-- `@updatedAt` is application-managed, but a database default keeps raw seed,
-- migration, and operational inserts consistent with Prisma-created rows.
ALTER TABLE "permission_definitions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "role_definitions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "auth_identities" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sessions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "oauth_clients" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "organizations" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "organization_memberships" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "organization_invitations" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "provider_verification_reviews" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "files" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "authority_controls" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "idempotency_keys" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "job_runs" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "feature_flags" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "import_records" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Normalization, revision, and credential invariants.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check"
    CHECK ("email_normalized" = lower(btrim("email_normalized")) AND length("email_normalized") BETWEEN 3 AND 320),
  ADD CONSTRAINT "users_username_normalized_check"
    CHECK ("username" IS NULL OR "username" ~ '^[a-z0-9](?:[a-z0-9_.-]{1,62}[a-z0-9])?$'),
  ADD CONSTRAINT "users_authority_revision_check" CHECK ("authority_revision" > 0);

ALTER TABLE "auth_identities"
  ADD CONSTRAINT "auth_identities_password_provider_check"
    CHECK (
      ("provider" = 'local' AND "password_hash" IS NOT NULL)
      OR ("provider" <> 'local' AND "password_hash" IS NULL)
    );

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_order_check"
    CHECK (
      "authenticated_at" <= "last_used_at"
      AND "last_used_at" <= "idle_expires_at"
      AND "idle_expires_at" <= "absolute_expires_at"
    ),
  ADD CONSTRAINT "sessions_csrf_hash_check" CHECK ("csrf_secret_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "sessions_user_agent_hash_check"
    CHECK ("user_agent_hash" IS NULL OR "user_agent_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "session_refresh_tokens"
  ADD CONSTRAINT "session_refresh_tokens_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "session_refresh_tokens_expiry_check" CHECK ("issued_at" < "expires_at"),
  ADD CONSTRAINT "session_refresh_tokens_state_check"
    CHECK (
      ("state" = 'current' AND "consumed_at" IS NULL AND "replaced_by_token_id" IS NULL)
      OR ("state" = 'consumed' AND "consumed_at" IS NOT NULL)
    );

CREATE UNIQUE INDEX "session_refresh_tokens_one_current_per_session"
  ON "session_refresh_tokens" ("session_id")
  WHERE "state" = 'current';

ALTER TABLE "identity_one_time_tokens"
  ADD CONSTRAINT "identity_one_time_tokens_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "identity_one_time_tokens_expiry_check" CHECK ("created_at" < "expires_at");

CREATE UNIQUE INDEX "identity_one_time_tokens_one_unconsumed_per_kind"
  ON "identity_one_time_tokens" ("user_id", "kind")
  WHERE "consumed_at" IS NULL;

ALTER TABLE "oauth_clients"
  ADD CONSTRAINT "oauth_clients_redirect_uris_array_check" CHECK (jsonb_typeof("redirect_uris") = 'array'),
  ADD CONSTRAINT "oauth_clients_allowed_scopes_array_check" CHECK (jsonb_typeof("allowed_scopes") = 'array');

ALTER TABLE "oauth_authorization_codes"
  ADD CONSTRAINT "oauth_authorization_codes_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "oauth_authorization_codes_pkce_check" CHECK (length("pkce_challenge") BETWEEN 43 AND 128),
  ADD CONSTRAINT "oauth_authorization_codes_scopes_array_check" CHECK (jsonb_typeof("scopes") = 'array'),
  ADD CONSTRAINT "oauth_authorization_codes_expiry_check" CHECK ("created_at" < "expires_at");

-- Organization lifecycle and exactly-one-owner invariants.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_normalized_check" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$'),
  ADD CONSTRAINT "organizations_revision_check" CHECK ("revision" > 0);

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "organization_memberships_status_timestamps_check"
    CHECK (
      ("status" = 'active' AND "suspended_at" IS NULL AND "revoked_at" IS NULL)
      OR ("status" = 'suspended' AND "suspended_at" IS NOT NULL AND "revoked_at" IS NULL)
      OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    );

CREATE UNIQUE INDEX "organization_memberships_one_active_owner"
  ON "organization_memberships" ("organization_id")
  WHERE "role" = 'owner' AND "status" = 'active';

ALTER TABLE "organization_invitations"
  ADD CONSTRAINT "organization_invitations_email_normalized_check"
    CHECK ("email_normalized" = lower(btrim("email_normalized"))),
  ADD CONSTRAINT "organization_invitations_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "organization_invitations_expiry_check" CHECK ("created_at" < "expires_at"),
  ADD CONSTRAINT "organization_invitations_status_timestamps_check"
    CHECK (
      ("status" = 'pending' AND "accepted_at" IS NULL AND "accepted_by_user_id" IS NULL AND "revoked_at" IS NULL)
      OR ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "accepted_by_user_id" IS NOT NULL AND "revoked_at" IS NULL)
      OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL AND "accepted_at" IS NULL)
      OR ("status" = 'expired' AND "accepted_at" IS NULL AND "revoked_at" IS NULL)
    );

CREATE UNIQUE INDEX "organization_invitations_one_pending_per_role"
  ON "organization_invitations" ("organization_id", "email_normalized", "role")
  WHERE "status" = 'pending';

ALTER TABLE "provider_verification_reviews"
  ADD CONSTRAINT "provider_verification_reviews_decision_check"
    CHECK (
      ("status" = 'pending_review' AND "reviewed_at" IS NULL AND "reviewer_user_id" IS NULL AND "decision_reason" IS NULL)
      OR ("status" = 'approved' AND "reviewed_at" IS NOT NULL AND "reviewer_user_id" IS NOT NULL)
      OR ("status" = 'rejected' AND "reviewed_at" IS NOT NULL AND "reviewer_user_id" IS NOT NULL AND length("decision_reason") >= 10)
    );

CREATE UNIQUE INDEX "provider_verification_reviews_one_pending_per_org"
  ON "provider_verification_reviews" ("organization_id")
  WHERE "status" = 'pending_review';

CREATE OR REPLACE FUNCTION enforce_organization_owner_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_organization_id uuid;
  stored_owner_id uuid;
  active_owner_id uuid;
  active_owner_count integer;
  changed_row jsonb;
BEGIN
  changed_row := COALESCE(to_jsonb(NEW), to_jsonb(OLD));
  checked_organization_id := CASE
    WHEN TG_TABLE_NAME = 'organizations' THEN (changed_row ->> 'id')::uuid
    ELSE (changed_row ->> 'organization_id')::uuid
  END;

  SELECT "owner_user_id"
    INTO stored_owner_id
    FROM "organizations"
    WHERE "id" = checked_organization_id AND "deleted_at" IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), min("user_id"::text)::uuid
    INTO active_owner_count, active_owner_id
    FROM "organization_memberships"
    WHERE "organization_id" = checked_organization_id
      AND "role" = 'owner'
      AND "status" = 'active';

  IF active_owner_count <> 1 OR active_owner_id IS DISTINCT FROM stored_owner_id THEN
    RAISE EXCEPTION 'organization_owner_invariant_violation for %', checked_organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "organizations_owner_invariant"
AFTER INSERT OR UPDATE ON "organizations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_organization_owner_invariant();

CREATE CONSTRAINT TRIGGER "organization_memberships_owner_invariant"
AFTER INSERT OR UPDATE OR DELETE ON "organization_memberships"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_organization_owner_invariant();

-- Files never derive authorization from a path. Exactly one owner is required,
-- and public/ready material must have a verified clean hash.
ALTER TABLE "files"
  ADD CONSTRAINT "files_exactly_one_owner_check"
    CHECK (num_nonnulls("owner_user_id", "owner_organization_id") = 1),
  ADD CONSTRAINT "files_byte_size_check" CHECK ("byte_size" > 0 AND "byte_size" <= 5368709120),
  ADD CONSTRAINT "files_sha256_check" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "files_storage_key_check"
    CHECK (
      "storage_key" !~ '(^|/)\.\.(/|$)'
      AND position(chr(92) in "storage_key") = 0
      AND "storage_key" !~ '^/'
    ),
  ADD CONSTRAINT "files_ready_state_check"
    CHECK (
      "state" <> 'ready'
      OR ("scan_status" = 'clean' AND "sha256" IS NOT NULL AND "uploaded_at" IS NOT NULL AND "scanned_at" IS NOT NULL)
    ),
  ADD CONSTRAINT "files_public_state_check"
    CHECK ("visibility" <> 'public' OR "state" = 'ready'),
  ADD CONSTRAINT "files_quarantine_state_check"
    CHECK (
      "state" <> 'quarantined'
      OR ("scan_status" IN ('infected', 'unscannable', 'failed') AND "quarantine_reason" IS NOT NULL)
    );

-- Operations tables are bounded, append-only where required, and retry-safe.
ALTER TABLE "authority_controls"
  ADD CONSTRAINT "authority_controls_revision_check" CHECK ("revision" >= 0);

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_source_check"
    CHECK ("actor_user_id" IS NOT NULL OR "operator_ref" IS NOT NULL),
  ADD CONSTRAINT "audit_events_before_object_check"
    CHECK ("before_state" IS NULL OR jsonb_typeof("before_state") = 'object'),
  ADD CONSTRAINT "audit_events_after_object_check"
    CHECK ("after_state" IS NULL OR jsonb_typeof("after_state") = 'object');

CREATE OR REPLACE FUNCTION reject_immutable_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_change();

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_keys_response_status_check"
    CHECK ("response_status" IS NULL OR "response_status" BETWEEN 100 AND 599),
  ADD CONSTRAINT "idempotency_keys_expiry_check" CHECK ("created_at" < "expires_at");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_version_attempt_check" CHECK ("event_version" > 0 AND "attempt_count" >= 0),
  ADD CONSTRAINT "outbox_events_payload_object_check" CHECK (jsonb_typeof("payload") = 'object');

ALTER TABLE "job_runs"
  ADD CONSTRAINT "job_runs_attempt_check" CHECK ("attempt" >= 0),
  ADD CONSTRAINT "job_runs_finished_state_check"
    CHECK (
      ("state" IN ('pending', 'running') AND "finished_at" IS NULL)
      OR ("state" IN ('succeeded', 'failed', 'dead') AND "finished_at" IS NOT NULL)
    );

ALTER TABLE "feature_flags"
  ADD CONSTRAINT "feature_flags_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "feature_flags_environment_check" CHECK ("environment" IN ('development', 'test', 'staging', 'production'));

ALTER TABLE "import_runs"
  ADD CONSTRAINT "import_runs_source_checksum_check" CHECK ("source_checksum" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "import_runs_configuration_hash_check" CHECK ("configuration_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "import_runs_completion_check"
    CHECK (("state" IN ('reconciled', 'failed')) = ("completed_at" IS NOT NULL));

ALTER TABLE "import_records"
  ADD CONSTRAINT "import_records_source_checksum_check" CHECK ("source_checksum" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "import_records_target_check"
    CHECK (("target_type" IS NULL) = ("target_id" IS NULL));

ALTER TABLE "import_exceptions"
  ADD CONSTRAINT "import_exceptions_severity_check" CHECK ("severity" IN ('warning', 'error', 'fatal')),
  ADD CONSTRAINT "import_exceptions_resolution_check"
    CHECK (("resolved_at" IS NULL AND "resolution" IS NULL) OR ("resolved_at" IS NOT NULL AND "resolution" IS NOT NULL));

-- Fixed coordination rows contain no user identity or credential. The
-- superadmin marker starts unconsumed; promotion still requires the audited CLI.
INSERT INTO "authority_controls" ("key", "revision")
VALUES ('platform_authority', 0), ('superadmin_bootstrap_v1', 0);
