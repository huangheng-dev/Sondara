CREATE TABLE `customer_touchpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`contact_id` text,
	`event_type` text NOT NULL,
	`source` text NOT NULL,
	`medium` text,
	`campaign` text,
	`content` text,
	`term` text,
	`referrer` text,
	`landing_page` text,
	`external_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `inbox_contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_touchpoints_workspace_external_unique` ON `customer_touchpoints` (`workspace_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `customer_touchpoints_customer_time_idx` ON `customer_touchpoints` (`customer_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `customer_touchpoints_workspace_source_idx` ON `customer_touchpoints` (`workspace_id`,`source`,`occurred_at`);