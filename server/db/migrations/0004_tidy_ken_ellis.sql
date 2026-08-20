CREATE TABLE `ai_service_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`service_id` text NOT NULL,
	`name` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`secret_iv` text NOT NULL,
	`secret_tag` text NOT NULL,
	`ending` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`cooldown_until` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `ai_services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_service_keys_service_idx` ON `ai_service_keys` (`service_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `ai_service_keys_workspace_idx` ON `ai_service_keys` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `ai_services` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`endpoint` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`last_latency_ms` integer,
	`last_error` text,
	`last_tested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_services_workspace_name_unique` ON `ai_services` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `ai_services_workspace_priority_idx` ON `ai_services` (`workspace_id`,`priority`);