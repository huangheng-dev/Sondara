CREATE TABLE `channel_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel` text NOT NULL,
	`period_label` text DEFAULT 'monthly' NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`cost_amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `channel_costs_workspace_period_idx` ON `channel_costs` (`workspace_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `channel_costs_workspace_channel_idx` ON `channel_costs` (`workspace_id`,`channel`);