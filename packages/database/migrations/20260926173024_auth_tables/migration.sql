CREATE TABLE "fms"."auth_accounts" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fms"."auth_api_keys" (
	"id" text PRIMARY KEY,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"reference_id" text NOT NULL,
	"prefix" text,
	"key" text NOT NULL CONSTRAINT "auth_api_keys_key_uq" UNIQUE,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer DEFAULT 60000 NOT NULL,
	"rate_limit_max" integer DEFAULT 100 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" jsonb,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "fms"."auth_sessions" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fms"."auth_users" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fms"."auth_verifications" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "fms"."auth_accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_api_keys_key_idx" ON "fms"."auth_api_keys" ("key");--> statement-breakpoint
CREATE INDEX "auth_api_keys_reference_id_idx" ON "fms"."auth_api_keys" ("reference_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "fms"."auth_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_users_email_idx" ON "fms"."auth_users" ("email");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "fms"."auth_verifications" ("identifier");--> statement-breakpoint
ALTER TABLE "fms"."auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "fms"."auth_users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fms"."auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "fms"."auth_users"("id") ON DELETE CASCADE;