CREATE TABLE "lead_source_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"account_ref" text,
	"form_ref" text,
	"client_id" text,
	"access_token_ciphertext" text,
	"access_token_iv" text,
	"access_token_tag" text,
	"access_token_ending" text,
	"webhook_token_hash" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"last_error" text,
	"last_synced_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_source_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"processing_error" text,
	"received_at" bigint NOT NULL,
	"processed_at" bigint
);
--> statement-breakpoint
ALTER TABLE "lead_source_connections" ADD CONSTRAINT "lead_source_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_source_events" ADD CONSTRAINT "lead_source_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_source_events" ADD CONSTRAINT "lead_source_events_connection_id_lead_source_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."lead_source_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_source_connections_workspace_name_unique" ON "lead_source_connections" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "lead_source_connections_workspace_provider_idx" ON "lead_source_connections" USING btree ("workspace_id","provider","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_source_events_connection_event_unique" ON "lead_source_events" USING btree ("connection_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "lead_source_events_workspace_received_idx" ON "lead_source_events" USING btree ("workspace_id","received_at");