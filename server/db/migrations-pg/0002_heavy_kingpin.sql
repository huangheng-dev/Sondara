CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" bigint,
	"note" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" text,
	"expires_at" bigint NOT NULL,
	"accepted_at" bigint,
	"revoked_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "archived_at" bigint;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "archived_at" bigint;--> statement-breakpoint
ALTER TABLE "radar_candidates" ADD COLUMN "archived_at" bigint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived_at" bigint;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_workspace_status_idx" ON "approval_requests" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_entity_idx" ON "approval_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_token_hash_unique" ON "workspace_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_idx" ON "workspace_invitations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_invitations_email_idx" ON "workspace_invitations" USING btree ("workspace_id","email");