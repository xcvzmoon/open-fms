CREATE TABLE "fms"."auth_rate_limits" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
DROP TABLE "fms"."upload_passes";--> statement-breakpoint
ALTER TABLE "fms"."callers" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fms"."callers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fms"."callers" ADD COLUMN "rate_window_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fms"."callers" ADD COLUMN "rate_window_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fms"."files" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fms"."scan_jobs" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials" DROP COLUMN "secret_hash";--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials" DROP COLUMN "pepper_version";--> statement-breakpoint
ALTER TABLE "fms"."audit_events" ALTER COLUMN "actor_id" SET DATA TYPE text USING "actor_id"::text;--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials" ALTER COLUMN "created_by" SET DATA TYPE text USING "created_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials" ALTER COLUMN "updated_by" SET DATA TYPE text USING "updated_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."caller_credentials" ALTER COLUMN "deleted_by" SET DATA TYPE text USING "deleted_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."callers" ALTER COLUMN "created_by" SET DATA TYPE text USING "created_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."callers" ALTER COLUMN "updated_by" SET DATA TYPE text USING "updated_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."callers" ALTER COLUMN "deleted_by" SET DATA TYPE text USING "deleted_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."service_settings" ALTER COLUMN "updated_by" SET DATA TYPE text USING "updated_by"::text;--> statement-breakpoint
ALTER TABLE "fms"."callers" ADD CONSTRAINT "callers_owner_user_id_key" UNIQUE("owner_user_id");--> statement-breakpoint
CREATE INDEX "setup_codes_hash_idx" ON "fms"."setup_codes" ("code_hash");--> statement-breakpoint
ALTER TABLE "fms"."callers" ADD CONSTRAINT "callers_owner_user_id_auth_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "fms"."auth_users"("id") ON DELETE RESTRICT;