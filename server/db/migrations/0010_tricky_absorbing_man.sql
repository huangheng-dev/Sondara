CREATE TABLE `message_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`outbox_job_id` text NOT NULL,
	`message_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outbox_job_id`) REFERENCES `outbox_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_delivery_events_job_created_idx` ON `message_delivery_events` (`outbox_job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_delivery_events_workspace_idx` ON `message_delivery_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `outbound_channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text DEFAULT 'smtp' NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 587 NOT NULL,
	`secure` integer DEFAULT false NOT NULL,
	`username` text NOT NULL,
	`from_name` text NOT NULL,
	`from_email` text NOT NULL,
	`reply_to` text,
	`priority` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`secret_iv` text NOT NULL,
	`secret_tag` text NOT NULL,
	`secret_ending` text NOT NULL,
	`last_latency_ms` integer,
	`last_error` text,
	`last_tested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_connections_workspace_name_unique` ON `outbound_channel_connections` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `outbound_connections_workspace_priority_idx` ON `outbound_channel_connections` (`workspace_id`,`enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `outbox_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`channel` text NOT NULL,
	`connection_id` text,
	`status` text DEFAULT 'awaiting_configuration' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`scheduled_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`last_error` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `outbound_channel_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_jobs_message_unique` ON `outbox_jobs` (`message_id`);--> statement-breakpoint
CREATE INDEX `outbox_jobs_workspace_status_schedule_idx` ON `outbox_jobs` (`workspace_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `outbox_jobs_thread_idx` ON `outbox_jobs` (`thread_id`);