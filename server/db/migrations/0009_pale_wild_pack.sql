CREATE TABLE `inbox_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`name` text NOT NULL,
	`company` text NOT NULL,
	`job_title` text DEFAULT '待补全' NOT NULL,
	`region` text DEFAULT '待补全' NOT NULL,
	`source` text DEFAULT '客户消息' NOT NULL,
	`primary_channel` text DEFAULT '邮件' NOT NULL,
	`email` text,
	`phone` text,
	`external_ref` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_contacts_workspace_company_name_unique` ON `inbox_contacts` (`workspace_id`,`company`,`name`);--> statement-breakpoint
CREATE INDEX `inbox_contacts_workspace_company_idx` ON `inbox_contacts` (`workspace_id`,`company`);--> statement-breakpoint
CREATE INDEX `inbox_contacts_customer_idx` ON `inbox_contacts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `message_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`channel` text NOT NULL,
	`sender_label` text DEFAULT '' NOT NULL,
	`external_id` text,
	`confirmed_by_user_id` text,
	`confirmed_at` integer,
	`sent_at` integer,
	`delivered_at` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_entries_thread_created_idx` ON `message_entries` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_entries_workspace_status_idx` ON `message_entries` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `message_thread_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_message_id` text,
	`last_read_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_read_message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_thread_reads_thread_user_unique` ON `message_thread_reads` (`thread_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `message_thread_reads_workspace_idx` ON `message_thread_reads` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `message_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`customer_id` text,
	`campaign_id` text,
	`subject` text DEFAULT '客户对话' NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`intent` text DEFAULT '待判断' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_user_id` text,
	`last_message_preview` text DEFAULT '' NOT NULL,
	`last_message_at` integer NOT NULL,
	`last_inbound_at` integer,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `inbox_contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_threads_workspace_last_idx` ON `message_threads` (`workspace_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `message_threads_workspace_status_idx` ON `message_threads` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `message_threads_workspace_channel_idx` ON `message_threads` (`workspace_id`,`channel`);--> statement-breakpoint
CREATE INDEX `message_threads_contact_idx` ON `message_threads` (`contact_id`);--> statement-breakpoint
CREATE INDEX `message_threads_customer_idx` ON `message_threads` (`customer_id`);