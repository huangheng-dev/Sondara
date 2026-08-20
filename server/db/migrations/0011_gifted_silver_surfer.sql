CREATE TABLE `channel_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`external_message_id` text,
	`sender` text,
	`recipient` text,
	`subject` text,
	`body` text,
	`reason` text,
	`occurred_at` integer NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`processing_error` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `outbound_channel_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_webhook_connection_event_unique` ON `channel_webhook_events` (`connection_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `channel_webhook_workspace_created_idx` ON `channel_webhook_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `channel_webhook_external_message_idx` ON `channel_webhook_events` (`external_message_id`);--> statement-breakpoint
CREATE TABLE `contact_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`destination` text NOT NULL,
	`reason` text NOT NULL,
	`source` text DEFAULT 'channel_event' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_event_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_event_id`) REFERENCES `channel_webhook_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_suppressions_workspace_channel_destination_unique` ON `contact_suppressions` (`workspace_id`,`channel`,`destination`);--> statement-breakpoint
CREATE INDEX `contact_suppressions_workspace_active_idx` ON `contact_suppressions` (`workspace_id`,`active`);--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `webhook_secret_ciphertext` text;--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `webhook_secret_iv` text;--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `webhook_secret_tag` text;--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `webhook_secret_ending` text;