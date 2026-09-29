ALTER TABLE "quotes" ADD COLUMN "holded_synced_reference" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "deleted_at" timestamp with time zone;