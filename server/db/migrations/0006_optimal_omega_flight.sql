CREATE TABLE `candidate_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`name` text DEFAULT '公开联系人' NOT NULL,
	`role` text DEFAULT '企业公开联系方式' NOT NULL,
	`email` text,
	`phone` text,
	`social_url` text,
	`source_url` text NOT NULL,
	`verification_status` text DEFAULT 'public' NOT NULL,
	`confidence` integer DEFAULT 50 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `radar_candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidate_contacts_candidate_idx` ON `candidate_contacts` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `candidate_contacts_workspace_idx` ON `candidate_contacts` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_contacts_candidate_source_unique` ON `candidate_contacts` (`candidate_id`,`email`,`phone`,`social_url`);