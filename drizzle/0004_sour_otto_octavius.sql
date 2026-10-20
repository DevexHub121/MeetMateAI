ALTER TABLE "meetings" ADD COLUMN "processing_stage" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "processing_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "processing_total" integer DEFAULT 0 NOT NULL;