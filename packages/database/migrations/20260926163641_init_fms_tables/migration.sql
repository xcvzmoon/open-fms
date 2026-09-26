CREATE SCHEMA IF NOT EXISTS "fms";
--> statement-breakpoint
CREATE TABLE "fms"."audit_events" (
	"id" uuid PRIMARY KEY,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_key_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"caller_id" uuid,
	"request_id" text,
	"ip_address" text,
	"user_agent" text,
	"outcome" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fms"."caller_credentials" (
	"id" uuid PRIMARY KEY,
	"caller_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'standard' NOT NULL,
	"key_prefix" text NOT NULL,
	"key_id" text NOT NULL UNIQUE,
	"secret_hash" bytea NOT NULL,
	"pepper_version" smallint NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_file_size_bytes" bigint,
	"rate_limit_per_sec" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_by" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."caller_usage" (
	"caller_id" uuid PRIMARY KEY,
	"bytes_reserved" bigint DEFAULT 0 NOT NULL,
	"bytes_used" bigint DEFAULT 0 NOT NULL,
	"file_count" bigint DEFAULT 0 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."callers" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"kind" text DEFAULT 'app' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"signup_source" text DEFAULT 'admin' NOT NULL,
	"owner_email" text,
	"owner_verified_at" timestamp with time zone,
	"max_file_size_bytes" bigint DEFAULT 1073741824 NOT NULL,
	"allowed_content_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"quota_bytes" bigint,
	"rate_limit_per_sec" integer,
	"allow_direct_upload" boolean DEFAULT false NOT NULL,
	"allow_direct_download" boolean DEFAULT false NOT NULL,
	"retention_days" integer,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_by" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."files" (
	"id" uuid PRIMARY KEY,
	"caller_id" uuid NOT NULL,
	"storage_backend_id" uuid NOT NULL,
	"owner_ref" text,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"declared_content_type" text,
	"detected_content_type" text,
	"size_bytes" bigint,
	"checksum_sha256" bytea,
	"etag" text,
	"sealed_etag" text,
	"status" text DEFAULT 'initiated' NOT NULL,
	"status_reason" text,
	"scan_policy_version" text,
	"idempotency_key" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"retain_until" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"uploaded_at" timestamp with time zone,
	"scanned_at" timestamp with time zone,
	"promoted_at" timestamp with time zone,
	"purge_after" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."scan_jobs" (
	"id" uuid PRIMARY KEY,
	"file_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scan_policy_version" text,
	"claimed_at" timestamp with time zone,
	"claimed_by" text,
	"lease_expires_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."scan_results" (
	"id" uuid PRIMARY KEY,
	"scan_job_id" uuid NOT NULL CONSTRAINT "scan_results_scan_job_id_uq" UNIQUE,
	"file_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"size_bytes" bigint,
	"checksum_sha256" bytea,
	"detected_content_type" text,
	"scan_policy_version" text,
	"engine" text NOT NULL,
	"engine_version" text,
	"signatures_updated_at" timestamp with time zone,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."service_settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fms"."setup_codes" (
	"id" uuid PRIMARY KEY,
	"caller_id" uuid NOT NULL,
	"code_hash" bytea NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."storage_backends" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL UNIQUE,
	"kind" text NOT NULL,
	"endpoint" text NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"quarantine_bucket" text NOT NULL,
	"clean_bucket" text NOT NULL,
	"forensic_bucket" text,
	"credential_ref" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "fms"."upload_parts" (
	"id" uuid PRIMARY KEY,
	"upload_session_id" uuid NOT NULL,
	"part_number" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"etag" text NOT NULL,
	"checksum_sha256" bytea,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "upload_parts_session_part_uq" UNIQUE("upload_session_id","part_number")
);
--> statement-breakpoint
CREATE TABLE "fms"."upload_sessions" (
	"id" uuid PRIMARY KEY,
	"file_id" uuid NOT NULL CONSTRAINT "upload_sessions_file_id_uq" UNIQUE,
	"caller_id" uuid NOT NULL,
	"mode" text DEFAULT 'proxy_single' NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"declared_size_bytes" bigint,
	"received_size_bytes" bigint DEFAULT 0 NOT NULL,
	"part_size_bytes" integer DEFAULT 16777216 NOT NULL,
	"part_count" integer DEFAULT 0 NOT NULL,
	"declared_content_type" text,
	"create_idempotency_key" text,
	"complete_idempotency_key" text,
	"abort_idempotency_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"aborted_at" timestamp with time zone,
	"abort_reason" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "fms"."audit_events" ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "fms"."audit_events" ("actor_type","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "fms"."audit_events" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_events_caller_occurred_at_idx" ON "fms"."audit_events" ("caller_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "fms"."audit_events" ("action");--> statement-breakpoint
CREATE INDEX "caller_credentials_caller_id_idx" ON "fms"."caller_credentials" ("caller_id");--> statement-breakpoint
CREATE INDEX "caller_usage_bytes_used_idx" ON "fms"."caller_usage" ("bytes_used");--> statement-breakpoint
CREATE INDEX "callers_status_idx" ON "fms"."callers" ("status");--> statement-breakpoint
CREATE INDEX "files_caller_status_idx" ON "fms"."files" ("caller_id","status");--> statement-breakpoint
CREATE INDEX "files_status_purge_after_idx" ON "fms"."files" ("status","purge_after");--> statement-breakpoint
CREATE INDEX "files_storage_backend_id_idx" ON "fms"."files" ("storage_backend_id");--> statement-breakpoint
CREATE INDEX "files_object_key_idx" ON "fms"."files" ("object_key");--> statement-breakpoint
CREATE INDEX "scan_jobs_status_available_at_idx" ON "fms"."scan_jobs" ("status","available_at");--> statement-breakpoint
CREATE INDEX "scan_jobs_file_id_idx" ON "fms"."scan_jobs" ("file_id");--> statement-breakpoint
CREATE INDEX "scan_jobs_lease_expires_at_idx" ON "fms"."scan_jobs" ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "scan_results_file_id_idx" ON "fms"."scan_results" ("file_id");--> statement-breakpoint
CREATE INDEX "scan_results_verdict_scanned_at_idx" ON "fms"."scan_results" ("verdict","scanned_at");--> statement-breakpoint
CREATE INDEX "setup_codes_caller_id_idx" ON "fms"."setup_codes" ("caller_id");--> statement-breakpoint
CREATE INDEX "storage_backends_status_idx" ON "fms"."storage_backends" ("status");--> statement-breakpoint
CREATE INDEX "upload_parts_session_idx" ON "fms"."upload_parts" ("upload_session_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_caller_status_idx" ON "fms"."upload_sessions" ("caller_id","status");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_expires_at_idx" ON "fms"."upload_sessions" ("status","expires_at");--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials" ADD CONSTRAINT "caller_credentials_caller_id_callers_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "fms"."callers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."caller_usage" ADD CONSTRAINT "caller_usage_caller_id_callers_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "fms"."callers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."files" ADD CONSTRAINT "files_caller_id_callers_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "fms"."callers"("id");--> statement-breakpoint
ALTER TABLE "fms"."files" ADD CONSTRAINT "files_storage_backend_id_storage_backends_id_fkey" FOREIGN KEY ("storage_backend_id") REFERENCES "fms"."storage_backends"("id");--> statement-breakpoint
ALTER TABLE "fms"."scan_jobs" ADD CONSTRAINT "scan_jobs_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "fms"."files"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."scan_results" ADD CONSTRAINT "scan_results_scan_job_id_scan_jobs_id_fkey" FOREIGN KEY ("scan_job_id") REFERENCES "fms"."scan_jobs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."scan_results" ADD CONSTRAINT "scan_results_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "fms"."files"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."setup_codes" ADD CONSTRAINT "setup_codes_caller_id_callers_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "fms"."callers"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."upload_parts" ADD CONSTRAINT "upload_parts_upload_session_id_upload_sessions_id_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "fms"."upload_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."upload_sessions" ADD CONSTRAINT "upload_sessions_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "fms"."files"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."upload_sessions" ADD CONSTRAINT "upload_sessions_caller_id_callers_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "fms"."callers"("id");