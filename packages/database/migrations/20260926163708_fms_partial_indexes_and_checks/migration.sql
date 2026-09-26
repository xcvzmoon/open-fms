CREATE UNIQUE INDEX "files_caller_idempotency_key_uq"
ON "fms"."files" ("caller_id", "idempotency_key")
WHERE "idempotency_key" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "caller_credentials_live_lookup_idx"
ON "fms"."caller_credentials" ("key_id", "expires_at")
WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_backends_single_default_idx"
ON "fms"."storage_backends" ((true))
WHERE "is_default" IS TRUE AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "files_retain_until_due_idx"
ON "fms"."files" ("retain_until")
WHERE "retain_until" IS NOT NULL AND "deleted_at" IS NULL AND "legal_hold" IS FALSE;
--> statement-breakpoint
CREATE INDEX "files_purge_after_due_idx"
ON "fms"."files" ("purge_after")
WHERE "purge_after" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "files_stale_upload_idx"
ON "fms"."files" ("updated_at")
WHERE "status" IN ('initiated', 'uploading') AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "upload_sessions_sweep_idx"
ON "fms"."upload_sessions" ("expires_at")
WHERE "status" IN ('initiated', 'uploading') AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "setup_codes_unredeemed_expires_idx"
ON "fms"."setup_codes" ("expires_at")
WHERE "redeemed_at" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "fms"."files"
  ADD CONSTRAINT "files_size_bytes_non_negative"
  CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  ADD CONSTRAINT "files_row_version_positive"
  CHECK ("row_version" > 0),
  ADD CONSTRAINT "files_clean_requires_integrity"
  CHECK ("status" <> 'clean' OR ("checksum_sha256" IS NOT NULL AND "size_bytes" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "fms"."upload_sessions"
  ADD CONSTRAINT "upload_sessions_part_shape"
  CHECK ("part_size_bytes" > 0 AND "part_count" >= 0 AND "received_size_bytes" >= 0),
  ADD CONSTRAINT "upload_sessions_row_version_positive"
  CHECK ("row_version" > 0),
  ADD CONSTRAINT "upload_sessions_complete_timestamp"
  CHECK ("completed_at" IS NULL OR "status" = 'completed'),
  ADD CONSTRAINT "upload_sessions_abort_timestamp"
  CHECK ("aborted_at" IS NULL OR "status" IN ('aborted', 'expired'));
--> statement-breakpoint
ALTER TABLE "fms"."upload_parts"
  ADD CONSTRAINT "upload_parts_part_number_positive"
  CHECK ("part_number" > 0),
  ADD CONSTRAINT "upload_parts_size_non_negative"
  CHECK ("size_bytes" >= 0);
--> statement-breakpoint
ALTER TABLE "fms"."scan_jobs"
  ADD CONSTRAINT "scan_jobs_attempt_shape"
  CHECK ("attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"),
  ADD CONSTRAINT "scan_jobs_row_version_positive"
  CHECK ("row_version" > 0);
--> statement-breakpoint
ALTER TABLE "fms"."caller_usage"
  ADD CONSTRAINT "caller_usage_counters_non_negative"
  CHECK ("bytes_reserved" >= 0 AND "bytes_used" >= 0 AND "file_count" >= 0),
  ADD CONSTRAINT "caller_usage_row_version_positive"
  CHECK ("row_version" > 0);
--> statement-breakpoint
ALTER TABLE "fms"."callers"
  ADD CONSTRAINT "callers_max_file_size_positive"
  CHECK ("max_file_size_bytes" > 0),
  ADD CONSTRAINT "callers_quota_non_negative"
  CHECK ("quota_bytes" IS NULL OR "quota_bytes" >= 0),
  ADD CONSTRAINT "callers_rate_limit_positive"
  CHECK ("rate_limit_per_sec" IS NULL OR "rate_limit_per_sec" > 0);
--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials"
  ADD CONSTRAINT "caller_credentials_expiry_after_created"
  CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "caller_credentials_rate_limit_positive"
  CHECK ("rate_limit_per_sec" IS NULL OR "rate_limit_per_sec" > 0);
--> statement-breakpoint
ALTER TABLE "fms"."setup_codes"
  ADD CONSTRAINT "setup_codes_expiry_after_created"
  CHECK ("expires_at" > "created_at");
