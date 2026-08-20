CREATE TABLE `candidate_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`observed_label` text DEFAULT '待确认' NOT NULL,
	`strength` text DEFAULT '中' NOT NULL,
	`source_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `radar_candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidate_evidence_candidate_idx` ON `candidate_evidence` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `candidate_evidence_workspace_idx` ON `candidate_evidence` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `radar_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`radar_task_id` text,
	`company` text NOT NULL,
	`region` text DEFAULT '待补全' NOT NULL,
	`industry` text DEFAULT '待补全' NOT NULL,
	`size` text DEFAULT '待补全' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`signal` text DEFAULT '待识别' NOT NULL,
	`source` text DEFAULT '数据源' NOT NULL,
	`estimated_value` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`reason` text DEFAULT '等待补充研究结论' NOT NULL,
	`dimensions_json` text DEFAULT '[]' NOT NULL,
	`committee_json` text DEFAULT '[]' NOT NULL,
	`relationships_json` text DEFAULT '[]' NOT NULL,
	`discovered_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`radar_task_id`) REFERENCES `radar_tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `radar_candidates_workspace_company_unique` ON `radar_candidates` (`workspace_id`,`company`);--> statement-breakpoint
CREATE INDEX `radar_candidates_workspace_status_idx` ON `radar_candidates` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `radar_candidates_task_idx` ON `radar_candidates` (`radar_task_id`);--> statement-breakpoint
CREATE INDEX `radar_candidates_workspace_score_idx` ON `radar_candidates` (`workspace_id`,`score`);--> statement-breakpoint
CREATE TABLE `radar_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`radar_task_id` text NOT NULL,
	`job_type` text DEFAULT 'discover' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`scheduled_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`last_error` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`radar_task_id`) REFERENCES `radar_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `radar_queue_workspace_status_idx` ON `radar_queue_items` (`workspace_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `radar_queue_task_idx` ON `radar_queue_items` (`radar_task_id`);--> statement-breakpoint
CREATE TABLE `radar_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`icp` text NOT NULL,
	`mode` text DEFAULT '智能多渠道' NOT NULL,
	`depth` text DEFAULT '标准研究' NOT NULL,
	`candidate_limit` integer DEFAULT 100 NOT NULL,
	`knowledge_scope` text DEFAULT '全部资料' NOT NULL,
	`target_region` text DEFAULT '全球' NOT NULL,
	`research_language` text DEFAULT '自动识别' NOT NULL,
	`input_source` text DEFAULT 'AI 获客' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`current_stage` text DEFAULT '等待执行' NOT NULL,
	`candidates_found` integer DEFAULT 0 NOT NULL,
	`high_match_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`owner_user_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `radar_tasks_workspace_status_idx` ON `radar_tasks` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `radar_tasks_workspace_created_idx` ON `radar_tasks` (`workspace_id`,`created_at`);