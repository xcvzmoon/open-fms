CREATE TABLE "fms"."upload_passes" (
	"id" uuid PRIMARY KEY,
	"file_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"token_hash" bytea NOT NULL,
	"pepper_version" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE INDEX "upload_passes_file_id_idx" ON "fms"."upload_passes" ("file_id");--> statement-breakpoint
CREATE INDEX "upload_passes_caller_expires_idx" ON "fms"."upload_passes" ("caller_id","expires_at");--> statement-breakpoint
CREATE INDEX "upload_passes_expires_at_idx" ON "fms"."upload_passes" ("expires_at");--> statement-breakpoint
ALTER TABLE "fms"."upload_passes" ADD CONSTRAINT "upload_passes_file_id_files_id_fkey" FOREIGN KEY ("file_id") REFERENCES "fms"."files"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."upload_passes" ADD CONSTRAINT "upload_passes_caller_id_callers_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "fms"."callers"("id") ON DELETE CASCADE;