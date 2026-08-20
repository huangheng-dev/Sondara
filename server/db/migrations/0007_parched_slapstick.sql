CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`content_type` text DEFAULT '首次触达邮件' NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`status` text DEFAULT '草稿' NOT NULL,
	`language` text DEFAULT '中文' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`target_market` text DEFAULT '待补全' NOT NULL,
	`customer_role` text DEFAULT '待补全' NOT NULL,
	`buying_stage` text DEFAULT '问题认知' NOT NULL,
	`customer_signal` text DEFAULT '待识别' NOT NULL,
	`source_method` text DEFAULT '客户信号' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`quality_score` integer DEFAULT 0 NOT NULL,
	`customer_relevance` integer DEFAULT 0 NOT NULL,
	`evidence_score` integer DEFAULT 0 NOT NULL,
	`action_clarity` integer DEFAULT 0 NOT NULL,
	`linked_campaign_ids_json` text DEFAULT '[]' NOT NULL,
	`owner_user_id` text,
	`published_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_assets_workspace_status_idx` ON `content_assets` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `content_assets_workspace_updated_idx` ON `content_assets` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `content_assets_workspace_type_idx` ON `content_assets` (`workspace_id`,`content_type`);--> statement-breakpoint
CREATE TABLE `content_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_asset_id` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`generation_mode` text DEFAULT 'local-rules' NOT NULL,
	`service_name` text,
	`model` text,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_title` text DEFAULT '' NOT NULL,
	`output_body` text DEFAULT '' NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_generation_runs_workspace_created_idx` ON `content_generation_runs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_generation_runs_asset_idx` ON `content_generation_runs` (`content_asset_id`);--> statement-breakpoint
CREATE TABLE `content_quality_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_asset_id` text NOT NULL,
	`content_version_id` text,
	`overall_score` integer NOT NULL,
	`customer_relevance` integer NOT NULL,
	`evidence_score` integer NOT NULL,
	`action_clarity` integer NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`findings_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_quality_checks_asset_idx` ON `content_quality_checks` (`content_asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_quality_checks_workspace_idx` ON `content_quality_checks` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_asset_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`change_note` text DEFAULT '保存内容' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_versions_asset_version_unique` ON `content_versions` (`content_asset_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `content_versions_workspace_idx` ON `content_versions` (`workspace_id`);