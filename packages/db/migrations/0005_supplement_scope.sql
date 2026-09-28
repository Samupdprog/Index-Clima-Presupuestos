ALTER TABLE "employee_supplements" ADD COLUMN "installation_id" uuid;--> statement-breakpoint
UPDATE "employee_supplements" s SET "installation_id" = e."installation_id" FROM "employees" e WHERE s."employee_id" = e."id";--> statement-breakpoint
-- Global supplements belonged to the sole installation in existing single-installation deployments.
UPDATE "employee_supplements" SET "installation_id" = (SELECT "id" FROM "installations" LIMIT 1) WHERE "installation_id" IS NULL AND (SELECT count(*) FROM "installations") = 1;--> statement-breakpoint
-- Ambiguous legacy ownership fails safely for operator reconciliation instead of guessing.
ALTER TABLE "employee_supplements" ALTER COLUMN "installation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_supplements" ADD CONSTRAINT "employee_supplements_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE no action ON UPDATE no action;
