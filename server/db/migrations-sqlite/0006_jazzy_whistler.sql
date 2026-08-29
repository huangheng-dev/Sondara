CREATE TABLE `external_connector_configurations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connector_key` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'configured' NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`credentials_ciphertext` text,
	`credentials_iv` text,
	`credentials_tag` text,
	`credential_endings_json` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`last_validated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_connector_configs_workspace_key_unique` ON `external_connector_configurations` (`workspace_id`,`connector_key`);--> statement-breakpoint
CREATE INDEX `external_connector_configs_workspace_status_idx` ON `external_connector_configurations` (`workspace_id`,`status`,`enabled`);