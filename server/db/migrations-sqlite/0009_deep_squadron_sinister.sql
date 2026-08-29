CREATE TABLE `external_object_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`configuration_id` text NOT NULL,
	`object_type` text NOT NULL,
	`local_id` text NOT NULL,
	`external_id` text NOT NULL,
	`local_updated_at` integer,
	`external_updated_at` integer,
	`last_synced_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`configuration_id`) REFERENCES `external_connector_configurations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_object_mappings_local_unique` ON `external_object_mappings` (`configuration_id`,`object_type`,`local_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_object_mappings_external_unique` ON `external_object_mappings` (`configuration_id`,`object_type`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_object_mappings_workspace_idx` ON `external_object_mappings` (`workspace_id`,`object_type`);