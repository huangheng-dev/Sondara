CREATE TABLE `automation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step_key` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`action_path` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_events_run_created_idx` ON `automation_events` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_events_workspace_created_idx` ON `automation_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`plan_id` text,
	`run_type` text DEFAULT 'live' NOT NULL,
	`trigger_type` text DEFAULT 'system' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`trace_id` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_trace_unique` ON `automation_runs` (`trace_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_workspace_created_idx` ON `automation_runs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_plan_idx` ON `automation_runs` (`plan_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customer_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`deal_id` text,
	`thread_id` text,
	`outcome` text NOT NULL,
	`reason_code` text,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`actor_user_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `customer_outcomes_workspace_time_idx` ON `customer_outcomes` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `customer_outcomes_customer_idx` ON `customer_outcomes` (`customer_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `customer_outcomes_deal_idx` ON `customer_outcomes` (`deal_id`);--> statement-breakpoint
CREATE TABLE `learning_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`positive_rate` integer DEFAULT 0 NOT NULL,
	`model_json` text DEFAULT '{}' NOT NULL,
	`activated_at` integer,
	`frozen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_snapshots_plan_version_unique` ON `learning_snapshots` (`plan_id`,`version`);--> statement-breakpoint
CREATE INDEX `learning_snapshots_plan_status_idx` ON `learning_snapshots` (`plan_id`,`status`);--> statement-breakpoint
CREATE TABLE `reply_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`inbound_message_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'rule' NOT NULL,
	`draft` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`missing_information_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`language` text DEFAULT '中文' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`model_label` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`superseded_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inbound_message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reply_suggestions_message_version_unique` ON `reply_suggestions` (`inbound_message_id`,`version`);--> statement-breakpoint
CREATE INDEX `reply_suggestions_thread_updated_idx` ON `reply_suggestions` (`thread_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `reply_suggestions_workspace_status_idx` ON `reply_suggestions` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `sales_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`deal_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`recommendation_type` text DEFAULT 'next_best_action' NOT NULL,
	`title` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`next_action` text NOT NULL,
	`suggested_stage` text,
	`missing_information_json` text DEFAULT '[]' NOT NULL,
	`risk_level` text DEFAULT 'medium' NOT NULL,
	`source` text DEFAULT 'rule' NOT NULL,
	`accepted_by_user_id` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `sales_recommendations_deal_status_idx` ON `sales_recommendations` (`deal_id`,`status`);--> statement-breakpoint
CREATE INDEX `sales_recommendations_workspace_created_idx` ON `sales_recommendations` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`notification_type` text NOT NULL,
	`tone` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`action_path` text,
	`dedupe_key` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_notifications_dedupe_unique` ON `workspace_notifications` (`workspace_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `workspace_notifications_workspace_read_idx` ON `workspace_notifications` (`workspace_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_notifications_user_idx` ON `workspace_notifications` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `deals` ADD `outcome_reason` text;--> statement-breakpoint
ALTER TABLE `deals` ADD `closed_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `entity_type` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `entity_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `action_path` text;