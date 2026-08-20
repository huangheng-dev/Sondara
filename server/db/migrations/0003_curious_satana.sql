CREATE TABLE `radar_job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`radar_task_id` text NOT NULL,
	`queue_item_id` text,
	`level` text DEFAULT 'info' NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`radar_task_id`) REFERENCES `radar_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`queue_item_id`) REFERENCES `radar_queue_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `radar_job_events_task_created_idx` ON `radar_job_events` (`radar_task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `radar_job_events_workspace_idx` ON `radar_job_events` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `seed_urls_json` text DEFAULT '[]' NOT NULL;