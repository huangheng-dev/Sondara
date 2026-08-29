CREATE TABLE `whatsapp_message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`category` text DEFAULT 'UNKNOWN' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`quality_score` text,
	`rejected_reason` text,
	`components_json` text DEFAULT '[]' NOT NULL,
	`last_synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `outbound_channel_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_templates_connection_name_language_unique` ON `whatsapp_message_templates` (`connection_id`,`name`,`language`);--> statement-breakpoint
CREATE INDEX `whatsapp_templates_workspace_status_idx` ON `whatsapp_message_templates` (`workspace_id`,`status`);--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `whatsapp_business_account_id` text;--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `whatsapp_default_template_name` text;--> statement-breakpoint
ALTER TABLE `outbound_channel_connections` ADD `whatsapp_default_template_language` text;