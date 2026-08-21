ALTER TABLE "inbox_contacts" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_contacts" ADD COLUMN "verified_at" bigint;--> statement-breakpoint
ALTER TABLE "inbox_contacts" ADD COLUMN "verification_source" text;
