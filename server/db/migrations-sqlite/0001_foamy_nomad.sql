DROP INDEX `radar_candidates_workspace_company_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `radar_candidates_workspace_task_company_unique` ON `radar_candidates` (`workspace_id`,`radar_task_id`,`company`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_business_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`products` text DEFAULT '' NOT NULL,
	`regions` text DEFAULT '' NOT NULL,
	`customers` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`selected_market` text DEFAULT '待验证细分市场' NOT NULL,
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
INSERT INTO `__new_business_profiles`("id", "workspace_id", "company", "website", "products", "regions", "customers", "exclusions", "selected_market", "analysis_status", "analysis_summary", "analyzed_at", "analysis_mode", "analysis_error", "owner_user_id", "created_at", "updated_at") SELECT "id", "workspace_id", "company", "website", "products", "regions", "customers", "exclusions", "selected_market", "analysis_status", "analysis_summary", "analyzed_at", "analysis_mode", "analysis_error", "owner_user_id", "created_at", "updated_at" FROM `business_profiles`;--> statement-breakpoint
DROP TABLE `business_profiles`;--> statement-breakpoint
ALTER TABLE `__new_business_profiles` RENAME TO `business_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `business_profiles_workspace_id_unique` ON `business_profiles` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `business_profiles_workspace_idx` ON `business_profiles` (`workspace_id`);