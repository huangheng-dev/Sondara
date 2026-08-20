CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`company` text NOT NULL,
	`stage` text DEFAULT '线索确认' NOT NULL,
	`probability` integer DEFAULT 20 NOT NULL,
	`value_amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`owner_label` text DEFAULT '我' NOT NULL,
	`next_action` text DEFAULT '确认需求和决策链' NOT NULL,
	`expected_close_at` integer,
	`risk` text DEFAULT '等待首次复核' NOT NULL,
	`source` text DEFAULT '商机跟进' NOT NULL,
	`stage_entered_at` integer NOT NULL,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deals_workspace_company_unique` ON `deals` (`workspace_id`,`company`);--> statement-breakpoint
CREATE INDEX `deals_workspace_stage_idx` ON `deals` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `deals_workspace_close_idx` ON `deals` (`workspace_id`,`expected_close_at`);--> statement-breakpoint
CREATE INDEX `deals_customer_idx` ON `deals` (`customer_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`title` text NOT NULL,
	`priority` text DEFAULT '中' NOT NULL,
	`due_at` integer,
	`due_label` text DEFAULT '待安排' NOT NULL,
	`company` text DEFAULT '个人事项' NOT NULL,
	`next_action` text DEFAULT '按计划执行' NOT NULL,
	`impact` text DEFAULT '待评估' NOT NULL,
	`source` text DEFAULT '客户' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_workspace_status_idx` ON `tasks` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_workspace_due_idx` ON `tasks` (`workspace_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_customer_idx` ON `tasks` (`customer_id`);