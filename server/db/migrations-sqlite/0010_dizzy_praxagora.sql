CREATE TABLE `lead_source_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`workspace_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`actor_user_id` text,
	`provider` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `lead_source_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_source_oauth_states_hash_unique` ON `lead_source_oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `lead_source_oauth_states_connection_idx` ON `lead_source_oauth_states` (`connection_id`,`expires_at`);--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `access_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `refresh_token_ciphertext` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `refresh_token_iv` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `refresh_token_tag` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `refresh_token_ending` text;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `refresh_token_expires_at` integer;--> statement-breakpoint
ALTER TABLE `lead_source_connections` ADD `oauth_scopes` text;