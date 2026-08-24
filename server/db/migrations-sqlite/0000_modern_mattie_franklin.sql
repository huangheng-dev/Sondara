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
CREATE INDEX `ai_services_workspace_priority_idx` ON `ai_services` (`workspace_id`,`priority`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`requested_by_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `approval_requests_workspace_status_idx` ON `approval_requests` (`workspace_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `approval_requests_entity_idx` ON `approval_requests` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip_address` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_workspace_created_idx` ON `audit_logs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text DEFAULT 'login_2fa' NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_challenges_token_hash_unique` ON `auth_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_challenges_user_idx` ON `auth_challenges` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `business_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`products` text DEFAULT '' NOT NULL,
	`regions` text DEFAULT '' NOT NULL,
	`customers` text DEFAULT '' NOT NULL,
	`exclusions` text DEFAULT '' NOT NULL,
	`selected_market` text DEFAULT '德国食品设备' NOT NULL,
	`analysis_status` text DEFAULT 'idle' NOT NULL,
	`analysis_summary` text DEFAULT '' NOT NULL,
	`analyzed_at` integer,
	`analysis_mode` text DEFAULT 'idle' NOT NULL,
	`analysis_error` text,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_profiles_workspace_id_unique` ON `business_profiles` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `business_profiles_workspace_idx` ON `business_profiles` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `campaign_audience_members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`customer_id` text,
	`company` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stop_reason` text,
	`last_event_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_audience_campaign_company_unique` ON `campaign_audience_members` (`campaign_id`,`company`);--> statement-breakpoint
CREATE INDEX `campaign_audience_workspace_status_idx` ON `campaign_audience_members` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaign_audience_customer_idx` ON `campaign_audience_members` (`customer_id`);--> statement-breakpoint
CREATE TABLE `campaign_content_links` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`content_asset_id` text NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`purpose` text DEFAULT '触达内容' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_content_campaign_asset_unique` ON `campaign_content_links` (`campaign_id`,`content_asset_id`);--> statement-breakpoint
CREATE INDEX `campaign_content_workspace_idx` ON `campaign_content_links` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `campaign_execution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_step_id` text,
	`event_type` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_step_id`) REFERENCES `campaign_steps`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `campaign_events_campaign_created_idx` ON `campaign_execution_events` (`campaign_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `campaign_events_workspace_idx` ON `campaign_execution_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `campaign_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`position` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`content_asset_id` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scheduled_at` integer,
	`executed_at` integer,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_steps_campaign_position_unique` ON `campaign_steps` (`campaign_id`,`position`);--> statement-breakpoint
CREATE INDEX `campaign_steps_workspace_schedule_idx` ON `campaign_steps` (`workspace_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`market` text DEFAULT '待补全' NOT NULL,
	`audience_label` text DEFAULT '待确认名单' NOT NULL,
	`status` text DEFAULT '草稿' NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`stop_rule` text DEFAULT '收到回复' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`opportunity_count` integer DEFAULT 0 NOT NULL,
	`revenue_amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`next_action` text DEFAULT '完善受众、内容与发送设置' NOT NULL,
	`start_at` integer,
	`next_run_at` integer,
	`owner_user_id` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `campaigns_workspace_status_idx` ON `campaigns` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `campaigns_workspace_updated_idx` ON `campaigns` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `campaigns_workspace_next_run_idx` ON `campaigns` (`workspace_id`,`next_run_at`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `candidate_contacts_candidate_source_unique` ON `candidate_contacts` (`candidate_id`,`email`,`phone`,`social_url`);--> statement-breakpoint
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
CREATE INDEX `channel_costs_workspace_channel_idx` ON `channel_costs` (`workspace_id`,`channel`);--> statement-breakpoint
CREATE TABLE `channel_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`external_message_id` text,
	`sender` text,
	`recipient` text,
	`subject` text,
	`body` text,
	`reason` text,
	`occurred_at` integer NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`processing_error` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`processed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `outbound_channel_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_webhook_connection_event_unique` ON `channel_webhook_events` (`connection_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `channel_webhook_workspace_created_idx` ON `channel_webhook_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `channel_webhook_external_message_idx` ON `channel_webhook_events` (`external_message_id`);--> statement-breakpoint
CREATE TABLE `contact_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`destination` text NOT NULL,
	`reason` text NOT NULL,
	`source` text DEFAULT 'channel_event' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_event_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_event_id`) REFERENCES `channel_webhook_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_suppressions_workspace_channel_destination_unique` ON `contact_suppressions` (`workspace_id`,`channel`,`destination`);--> statement-breakpoint
CREATE INDEX `contact_suppressions_workspace_active_idx` ON `contact_suppressions` (`workspace_id`,`active`);--> statement-breakpoint
CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`content_type` text DEFAULT '首次触达邮件' NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`status` text DEFAULT '草稿' NOT NULL,
	`language` text DEFAULT '中文' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`target_market` text DEFAULT '待补全' NOT NULL,
	`customer_role` text DEFAULT '待补全' NOT NULL,
	`buying_stage` text DEFAULT '问题认知' NOT NULL,
	`customer_signal` text DEFAULT '待识别' NOT NULL,
	`source_method` text DEFAULT '客户信号' NOT NULL,
	`current_version` integer DEFAULT 1 NOT NULL,
	`quality_score` integer DEFAULT 0 NOT NULL,
	`customer_relevance` integer DEFAULT 0 NOT NULL,
	`evidence_score` integer DEFAULT 0 NOT NULL,
	`action_clarity` integer DEFAULT 0 NOT NULL,
	`linked_campaign_ids_json` text DEFAULT '[]' NOT NULL,
	`owner_user_id` text,
	`published_at` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_assets_workspace_status_idx` ON `content_assets` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `content_assets_workspace_updated_idx` ON `content_assets` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `content_assets_workspace_type_idx` ON `content_assets` (`workspace_id`,`content_type`);--> statement-breakpoint
CREATE TABLE `content_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_asset_id` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`generation_mode` text DEFAULT 'local-rules' NOT NULL,
	`service_name` text,
	`model` text,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_title` text DEFAULT '' NOT NULL,
	`output_body` text DEFAULT '' NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_generation_runs_workspace_created_idx` ON `content_generation_runs` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_generation_runs_asset_idx` ON `content_generation_runs` (`content_asset_id`);--> statement-breakpoint
CREATE TABLE `content_quality_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_asset_id` text NOT NULL,
	`content_version_id` text,
	`overall_score` integer NOT NULL,
	`customer_relevance` integer NOT NULL,
	`evidence_score` integer NOT NULL,
	`action_clarity` integer NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`findings_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_version_id`) REFERENCES `content_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_quality_checks_asset_idx` ON `content_quality_checks` (`content_asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `content_quality_checks_workspace_idx` ON `content_quality_checks` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`content_asset_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`change_note` text DEFAULT '保存内容' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_versions_asset_version_unique` ON `content_versions` (`content_asset_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `content_versions_workspace_idx` ON `content_versions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `customer_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_tags_customer_name_unique` ON `customer_tags` (`customer_id`,`name`);--> statement-breakpoint
CREATE INDEX `customer_tags_workspace_idx` ON `customer_tags` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company` text NOT NULL,
	`region` text DEFAULT '待补全' NOT NULL,
	`industry` text DEFAULT '待补全' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`signal` text DEFAULT '待识别' NOT NULL,
	`source` text DEFAULT '手动录入' NOT NULL,
	`estimated_value` integer DEFAULT 0 NOT NULL,
	`size` text DEFAULT '待补全' NOT NULL,
	`stage` text DEFAULT '待补全' NOT NULL,
	`contacts` integer DEFAULT 0 NOT NULL,
	`valid_contacts` integer DEFAULT 0 NOT NULL,
	`interaction` text DEFAULT '尚无互动' NOT NULL,
	`next_action` text DEFAULT '补全企业档案' NOT NULL,
	`due_at` integer,
	`archived_at` integer,
	`score_override` integer,
	`score_override_reason` text,
	`score_override_by_user_id` text,
	`score_override_at` integer,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`score_override_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_workspace_company_unique` ON `customers` (`workspace_id`,`company`);--> statement-breakpoint
CREATE INDEX `customers_workspace_idx` ON `customers` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `customers_workspace_score_idx` ON `customers` (`workspace_id`,`score`);--> statement-breakpoint
CREATE INDEX `customers_workspace_stage_idx` ON `customers` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`company` text NOT NULL,
	`stage` text DEFAULT '线索确认' NOT NULL,
	`probability` integer DEFAULT 20 NOT NULL,
	`value_amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`owner_label` text DEFAULT '我' NOT NULL,
	`next_action` text DEFAULT '确认需求和决策链' NOT NULL,
	`expected_close_at` integer,
	`risk` text DEFAULT '等待首次复核' NOT NULL,
	`source` text DEFAULT '商机跟进' NOT NULL,
	`stage_entered_at` integer NOT NULL,
	`archived_at` integer,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deals_workspace_company_unique` ON `deals` (`workspace_id`,`company`);--> statement-breakpoint
CREATE INDEX `deals_workspace_stage_idx` ON `deals` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `deals_workspace_close_idx` ON `deals` (`workspace_id`,`expected_close_at`);--> statement-breakpoint
CREATE INDEX `deals_customer_idx` ON `deals` (`customer_id`);--> statement-breakpoint
CREATE TABLE `inbox_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`name` text NOT NULL,
	`company` text NOT NULL,
	`job_title` text DEFAULT '待补全' NOT NULL,
	`region` text DEFAULT '待补全' NOT NULL,
	`source` text DEFAULT '客户消息' NOT NULL,
	`primary_channel` text DEFAULT '邮件' NOT NULL,
	`email` text,
	`phone` text,
	`external_ref` text,
	`whatsapp_opted_in_at` integer,
	`whatsapp_opt_in_source` text,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`verified_at` integer,
	`verification_source` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_contacts_workspace_company_name_unique` ON `inbox_contacts` (`workspace_id`,`company`,`name`);--> statement-breakpoint
CREATE INDEX `inbox_contacts_workspace_company_idx` ON `inbox_contacts` (`workspace_id`,`company`);--> statement-breakpoint
CREATE INDEX `inbox_contacts_customer_idx` ON `inbox_contacts` (`customer_id`);--> statement-breakpoint
CREATE TABLE `integration_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`secret_ciphertext` text,
	`secret_iv` text,
	`secret_tag` text,
	`secret_ending` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`last_latency_ms` integer,
	`last_error` text,
	`last_tested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connections_workspace_name_unique` ON `integration_connections` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `integration_connections_workspace_category_idx` ON `integration_connections` (`workspace_id`,`category`,`priority`);--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`item_type` text DEFAULT '市场知识' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '手动录入' NOT NULL,
	`source_url` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT '待复核' NOT NULL,
	`reference_count` integer DEFAULT 0 NOT NULL,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `knowledge_items_workspace_updated_idx` ON `knowledge_items` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `knowledge_items_workspace_status_idx` ON `knowledge_items` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `knowledge_items_workspace_type_idx` ON `knowledge_items` (`workspace_id`,`item_type`);--> statement-breakpoint
CREATE TABLE `lead_source_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`account_ref` text,
	`form_ref` text,
	`client_id` text,
	`access_token_ciphertext` text,
	`access_token_iv` text,
	`access_token_tag` text,
	`access_token_ending` text,
	`webhook_token_hash` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'not_configured' NOT NULL,
	`last_error` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_source_connections_workspace_name_unique` ON `lead_source_connections` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `lead_source_connections_workspace_provider_idx` ON `lead_source_connections` (`workspace_id`,`provider`,`enabled`);--> statement-breakpoint
CREATE TABLE `lead_source_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`processing_status` text DEFAULT 'received' NOT NULL,
	`processing_error` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `lead_source_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_source_events_connection_event_unique` ON `lead_source_events` (`connection_id`,`provider_event_id`);--> statement-breakpoint
CREATE INDEX `lead_source_events_workspace_received_idx` ON `lead_source_events` (`workspace_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `message_delivery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`outbox_job_id` text NOT NULL,
	`message_id` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outbox_job_id`) REFERENCES `outbox_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `message_delivery_events_job_created_idx` ON `message_delivery_events` (`outbox_job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_delivery_events_workspace_idx` ON `message_delivery_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `message_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`channel` text NOT NULL,
	`sender_label` text DEFAULT '' NOT NULL,
	`external_id` text,
	`confirmed_by_user_id` text,
	`confirmed_at` integer,
	`sent_at` integer,
	`delivered_at` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_entries_thread_created_idx` ON `message_entries` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_entries_workspace_status_idx` ON `message_entries` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `message_thread_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_read_message_id` text,
	`last_read_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_read_message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_thread_reads_thread_user_unique` ON `message_thread_reads` (`thread_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `message_thread_reads_workspace_idx` ON `message_thread_reads` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `message_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`customer_id` text,
	`campaign_id` text,
	`subject` text DEFAULT '客户对话' NOT NULL,
	`channel` text DEFAULT '邮件' NOT NULL,
	`intent` text DEFAULT '待判断' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`assignee_user_id` text,
	`last_message_preview` text DEFAULT '' NOT NULL,
	`last_message_at` integer NOT NULL,
	`last_inbound_at` integer,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `inbox_contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `message_threads_workspace_last_idx` ON `message_threads` (`workspace_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `message_threads_workspace_status_idx` ON `message_threads` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `message_threads_workspace_channel_idx` ON `message_threads` (`workspace_id`,`channel`);--> statement-breakpoint
CREATE INDEX `message_threads_contact_idx` ON `message_threads` (`contact_id`);--> statement-breakpoint
CREATE INDEX `message_threads_customer_idx` ON `message_threads` (`customer_id`);--> statement-breakpoint
CREATE TABLE `outbound_channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text DEFAULT 'smtp' NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 587 NOT NULL,
	`secure` integer DEFAULT false NOT NULL,
	`username` text NOT NULL,
	`from_name` text NOT NULL,
	`from_email` text NOT NULL,
	`reply_to` text,
	`imap_enabled` integer DEFAULT false NOT NULL,
	`imap_host` text,
	`imap_port` integer DEFAULT 993 NOT NULL,
	`imap_secure` integer DEFAULT true NOT NULL,
	`imap_username` text,
	`imap_secret_ciphertext` text,
	`imap_secret_iv` text,
	`imap_secret_tag` text,
	`imap_secret_ending` text,
	`priority` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'untested' NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`secret_iv` text NOT NULL,
	`secret_tag` text NOT NULL,
	`secret_ending` text NOT NULL,
	`webhook_secret_ciphertext` text,
	`webhook_secret_iv` text,
	`webhook_secret_tag` text,
	`webhook_secret_ending` text,
	`last_latency_ms` integer,
	`last_error` text,
	`last_tested_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_connections_workspace_name_unique` ON `outbound_channel_connections` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `outbound_connections_workspace_priority_idx` ON `outbound_channel_connections` (`workspace_id`,`enabled`,`priority`);--> statement-breakpoint
CREATE TABLE `outbox_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`message_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`channel` text NOT NULL,
	`connection_id` text,
	`status` text DEFAULT 'awaiting_configuration' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`scheduled_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`last_error` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `message_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `message_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `outbound_channel_connections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_jobs_message_unique` ON `outbox_jobs` (`message_id`);--> statement-breakpoint
CREATE INDEX `outbox_jobs_workspace_status_schedule_idx` ON `outbox_jobs` (`workspace_id`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `outbox_jobs_thread_idx` ON `outbox_jobs` (`thread_id`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_hash_unique` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_expiry_idx` ON `password_reset_tokens` (`expires_at`);--> statement-breakpoint
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
	`archived_at` integer,
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
CREATE TABLE `radar_job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`radar_task_id` text NOT NULL,
	`queue_item_id` text,
	`level` text DEFAULT 'info' NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`radar_task_id`) REFERENCES `radar_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`queue_item_id`) REFERENCES `radar_queue_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `radar_job_events_task_created_idx` ON `radar_job_events` (`radar_task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `radar_job_events_workspace_idx` ON `radar_job_events` (`workspace_id`);--> statement-breakpoint
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
	`seed_urls_json` text DEFAULT '[]' NOT NULL,
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
CREATE INDEX `radar_tasks_workspace_created_idx` ON `radar_tasks` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`user_agent` text,
	`ip_address` text,
	`last_seen_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`customer_id` text,
	`title` text NOT NULL,
	`priority` text DEFAULT '中' NOT NULL,
	`due_at` integer,
	`due_label` text DEFAULT '待安排' NOT NULL,
	`company` text DEFAULT '个人事项' NOT NULL,
	`next_action` text DEFAULT '按计划执行' NOT NULL,
	`impact` text DEFAULT '待评估' NOT NULL,
	`source` text DEFAULT '客户' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`archived_at` integer,
	`owner_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_workspace_status_idx` ON `tasks` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_workspace_due_idx` ON `tasks` (`workspace_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_customer_idx` ON `tasks` (`customer_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`locale` text DEFAULT 'zh-CN' NOT NULL,
	`timezone` text DEFAULT 'Asia/Shanghai' NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`totp_secret_ciphertext` text,
	`totp_secret_iv` text,
	`totp_secret_tag` text,
	`totp_enabled` integer DEFAULT false NOT NULL,
	`totp_verified_at` integer,
	`totp_recovery_codes_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace_ai_policies` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`rotation_strategy` text DEFAULT 'failover' NOT NULL,
	`retry_count` integer DEFAULT 2 NOT NULL,
	`retry_backoff` text DEFAULT 'exponential' NOT NULL,
	`retry_delay_ms` integer DEFAULT 1000 NOT NULL,
	`cooldown_ms` integer DEFAULT 300000 NOT NULL,
	`failover_enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_user_id` text,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_invitations_token_hash_unique` ON `workspace_invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_workspace_idx` ON `workspace_invitations` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_email_idx` ON `workspace_invitations` (`workspace_id`,`email`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_members_unique` ON `workspace_members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspaces_owner_idx` ON `workspaces` (`owner_user_id`);