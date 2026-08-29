CREATE TABLE `external_connector_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`configuration_id` text NOT NULL,
	`connector_key` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`cursor` text,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configuration_id`) REFERENCES `external_connector_configurations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `external_connector_runs_workspace_started_idx` ON `external_connector_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `external_connector_runs_configuration_idx` ON `external_connector_runs` (`configuration_id`,`started_at`);