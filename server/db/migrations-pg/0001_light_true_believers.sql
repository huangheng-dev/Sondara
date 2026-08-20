ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_host" text;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_port" bigint DEFAULT 993 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_secure" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_username" text;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_secret_iv" text;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_secret_tag" text;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD COLUMN "imap_secret_ending" text;