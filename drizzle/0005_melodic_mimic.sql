CREATE TABLE "meeting_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_folders_org_name_unique" UNIQUE("org_id","name")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_folders" ADD CONSTRAINT "meeting_folders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_folder_id_meeting_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."meeting_folders"("id") ON DELETE set null ON UPDATE no action;