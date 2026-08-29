CREATE TABLE `company_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`candidate_id` text,
	`company` text NOT NULL,
	`domain` text,
	`signal_type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`evidence_quote` text DEFAULT '' NOT NULL,
	`score_boost` integer DEFAULT 0 NOT NULL,
	`observed_at` integer NOT NULL,
	`expires_at` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `radar_candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_signals_workspace_source_url_type_unique` ON `company_signals` (`workspace_id`,`source_url`,`signal_type`);--> statement-breakpoint
CREATE INDEX `company_signals_customer_time_idx` ON `company_signals` (`customer_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `company_signals_candidate_time_idx` ON `company_signals` (`candidate_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `company_signals_workspace_type_idx` ON `company_signals` (`workspace_id`,`signal_type`,`observed_at`);--> statement-breakpoint
CREATE TABLE `procurement_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subscription_id` text,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`buyer` text DEFAULT '待确认采购方' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`country` text DEFAULT '待确认' NOT NULL,
	`notice_type` text DEFAULT '采购公告' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`published_at` integer,
	`deadline_at` integer,
	`source_url` text NOT NULL,
	`contact_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`relevance_score` integer DEFAULT 0 NOT NULL,
	`saved` integer DEFAULT false NOT NULL,
	`dismissed_at` integer,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `procurement_subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procurement_opportunities_workspace_provider_external_unique` ON `procurement_opportunities` (`workspace_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `procurement_opportunities_workspace_deadline_idx` ON `procurement_opportunities` (`workspace_id`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `procurement_opportunities_workspace_provider_idx` ON `procurement_opportunities` (`workspace_id`,`provider`,`published_at`);--> statement-breakpoint
CREATE TABLE `procurement_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_user_id` text,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`regions_json` text DEFAULT '[]' NOT NULL,
	`notice_types_json` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sync_at` integer,
	`last_sync_status` text DEFAULT 'never' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procurement_subscriptions_workspace_name_unique` ON `procurement_subscriptions` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `procurement_subscriptions_workspace_provider_idx` ON `procurement_subscriptions` (`workspace_id`,`provider`,`enabled`);