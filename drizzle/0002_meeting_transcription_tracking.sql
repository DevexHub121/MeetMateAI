ALTER TABLE "meetings" ADD COLUMN "transcription_request_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "transcription_started_at" timestamp with time zone;