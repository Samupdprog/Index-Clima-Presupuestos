CREATE TABLE "oauth_artifacts" (
	"model" text NOT NULL,
	"id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"grant_id" text,
	"uid" text,
	"user_code" text,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "oauth_artifacts_model_id_pk" PRIMARY KEY("model","id")
);
--> statement-breakpoint
CREATE INDEX "oauth_artifacts_grant_idx" ON "oauth_artifacts" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "oauth_artifacts_uid_idx" ON "oauth_artifacts" USING btree ("model","uid");--> statement-breakpoint
CREATE INDEX "oauth_artifacts_user_code_idx" ON "oauth_artifacts" USING btree ("model","user_code");--> statement-breakpoint
CREATE INDEX "oauth_artifacts_expires_idx" ON "oauth_artifacts" USING btree ("expires_at");