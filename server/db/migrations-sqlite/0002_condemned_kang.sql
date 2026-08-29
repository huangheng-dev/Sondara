ALTER TABLE `lead_source_connections` ADD `auto_create_customer` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `create_follow_up_task` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `lead_source_events` ADD `customer_id` text REFERENCES customers(id);--> statement-breakpoint
ALTER TABLE `lead_source_events` ADD `contact_id` text REFERENCES inbox_contacts(id);--> statement-breakpoint
ALTER TABLE `lead_source_events` ADD `task_id` text REFERENCES tasks(id);--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `strategy` text DEFAULT '目标企业发现' NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `data_sources_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `intent_signals_json` text DEFAULT '[]' NOT NULL;