CREATE TABLE `business_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`products` text DEFAULT '' NOT NULL,
	`regions` text DEFAULT '' NOT NULL,
	`customers` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`selected_market` text DEFAULT '德国食品设备' NOT NULL,
	`analysis_status` text DEFAULT 'idle' NOT NULL,
	`analysis_summary` text DEFAULT '' NOT NULL,
	`analyzed_at` integer,
	`analysis_mode` text DEFAULT 'idle' NOT NULL,
	`analysis_error` text,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_profiles_workspace_id_unique` ON `business_profiles` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `business_profiles_workspace_idx` ON `business_profiles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`item_type` text DEFAULT '市场知识' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '手动录入' NOT NULL,
	`source_url` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT '待复核' NOT NULL,
	`reference_count` integer DEFAULT 0 NOT NULL,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `knowledge_items_workspace_updated_idx` ON `knowledge_items` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `knowledge_items_workspace_status_idx` ON `knowledge_items` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `knowledge_items_workspace_type_idx` ON `knowledge_items` (`workspace_id`,`item_type`);