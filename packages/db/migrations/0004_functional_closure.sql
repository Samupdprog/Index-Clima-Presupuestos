ALTER TABLE "clients" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deletion_source" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "holded_sync_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "holded_sync_error" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "holded_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "holded_last_synced_revision" integer;