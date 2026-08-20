CREATE TABLE `campaign_audience_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`customer_id` text,
	`company` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stop_reason` text,
	`last_event_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_audience_campaign_company_unique` ON `campaign_audience_members` (`campaign_id`,`company`);--> statement-breakpoint
CREATE INDEX `campaign_audience_workspace_status_idx` ON `campaign_audience_members` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_audience_customer_idx` ON `campaign_audience_members` (`customer_id`);--> statement-breakpoint
CREATE TABLE `campaign_content_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`content_asset_id` text NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`purpose` text DEFAULT '触达内容' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_content_campaign_asset_unique` ON `campaign_content_links` (`campaign_id`,`content_asset_id`);--> statement-breakpoint
CREATE INDEX `campaign_content_workspace_idx` ON `campaign_content_links` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `campaign_execution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_step_id` text,
	`event_type` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_step_id`) REFERENCES `campaign_steps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `campaign_events_campaign_created_idx` ON `campaign_execution_events` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `campaign_events_workspace_idx` ON `campaign_execution_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `campaign_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`content_asset_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scheduled_at` integer,
	`executed_at` integer,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_steps_campaign_position_unique` ON `campaign_steps` (`campaign_id`,`position`);--> statement-breakpoint
CREATE INDEX `campaign_steps_workspace_schedule_idx` ON `campaign_steps` (`workspace_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`market` text DEFAULT '待补全' NOT NULL,
	`audience_label` text DEFAULT '待确认名单' NOT NULL,
	`status` text DEFAULT '草稿' NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`stop_rule` text DEFAULT '收到回复' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`opportunity_count` integer DEFAULT 0 NOT NULL,
	`revenue_amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`next_action` text DEFAULT '完善受众、内容与发送设置' NOT NULL,
	`start_at` integer,
	`next_run_at` integer,
	`owner_user_id` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `campaigns_workspace_status_idx` ON `campaigns` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaigns_workspace_updated_idx` ON `campaigns` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `campaigns_workspace_next_run_idx` ON `campaigns` (`workspace_id`,`next_run_at`);