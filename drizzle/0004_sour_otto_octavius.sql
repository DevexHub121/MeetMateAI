ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "processing_stage" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "processing_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "processing_total" integer DEFAULT 0 NOT NULL;