ALTER TABLE `external_connector_configurations` ADD `schedule_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `schedule_interval_minutes` integer DEFAULT 1440 NOT NULL;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `schedule_query` text;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `per_run_limit` integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `daily_limit` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `next_run_at` integer;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `cursor` text;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `paused_reason` text;--> statement-breakpoint
ALTER TABLE `external_connector_configurations` ADD `last_run_at` integer;--> statement-breakpoint
CREATE INDEX `external_connector_configs_schedule_idx` ON `external_connector_configurations` (`schedule_enabled`,`next_run_at`);