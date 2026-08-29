CREATE TABLE `acquisition_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_user_id` text,
	`name` text NOT NULL,
	`icp` text NOT NULL,
	`mode` text DEFAULT '智能多渠道' NOT NULL,
	`strategy` text DEFAULT '目标企业发现' NOT NULL,
	`data_sources_json` text DEFAULT '[]' NOT NULL,
	`intent_signals_json` text DEFAULT '[]' NOT NULL,
	`depth` text DEFAULT '标准研究' NOT NULL,
	`candidate_limit` integer DEFAULT 100 NOT NULL,
	`daily_candidate_limit` integer DEFAULT 100 NOT NULL,
	`knowledge_scope` text DEFAULT '全部资料' NOT NULL,
	`target_region` text DEFAULT '全球' NOT NULL,
	`research_language` text DEFAULT '自动识别' NOT NULL,
	`input_source` text DEFAULT 'AI 获客' NOT NULL,
	`seed_urls_json` text DEFAULT '[]' NOT NULL,
	`schedule_type` text DEFAULT 'daily' NOT NULL,
	`run_time_local` text DEFAULT '08:00' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`weekdays_json` text DEFAULT '[1,2,3,4,5]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`require_ai` integer DEFAULT true NOT NULL,
	`automation_mode` text DEFAULT 'research_only' NOT NULL,
	`min_auto_score` integer DEFAULT 90 NOT NULL,
	`auto_promote_enabled` integer DEFAULT false NOT NULL,
	`auto_outreach_enabled` integer DEFAULT false NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`total_runs` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `acquisition_plans_workspace_status_idx` ON `acquisition_plans` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `acquisition_plans_due_idx` ON `acquisition_plans` (`enabled`,`next_run_at`);--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `acquisition_plan_id` text REFERENCES acquisition_plans(id);--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `run_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `radar_tasks` ADD `trigger_type` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE INDEX `radar_tasks_plan_created_idx` ON `radar_tasks` (`acquisition_plan_id`,`created_at`);