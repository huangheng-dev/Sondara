CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`secret_ciphertext` text,
	`secret_iv` text,
	`secret_tag` text,
	`secret_ending` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`last_latency_ms` integer,
	`last_error` text,
	`last_tested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_name_unique` ON `integration_connections` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `integration_connections_workspace_category_idx` ON `integration_connections` (`workspace_id`,`category`,`priority`);