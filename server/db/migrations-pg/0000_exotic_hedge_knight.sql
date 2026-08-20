CREATE TABLE "ai_service_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"service_id" text NOT NULL,
	"name" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"ending" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failure_count" bigint DEFAULT 0 NOT NULL,
	"cooldown_until" bigint,
	"last_used_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_services" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"endpoint" text NOT NULL,
	"priority" bigint DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"last_latency_ms" bigint,
	"last_error" text,
	"last_tested_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"ip_address" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text DEFAULT 'login_2fa' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"products" text DEFAULT '' NOT NULL,
	"regions" text DEFAULT '' NOT NULL,
	"customers" text DEFAULT '' NOT NULL,
	"exclusions" text DEFAULT '' NOT NULL,
	"selected_market" text DEFAULT '德国食品设备' NOT NULL,
	"analysis_status" text DEFAULT 'idle' NOT NULL,
	"analysis_summary" text DEFAULT '' NOT NULL,
	"analyzed_at" bigint,
	"analysis_mode" text DEFAULT 'idle' NOT NULL,
	"analysis_error" text,
	"owner_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "business_profiles_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_audience_members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"customer_id" text,
	"company" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stop_reason" text,
	"last_event_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_content_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"content_asset_id" text NOT NULL,
	"position" bigint DEFAULT 1 NOT NULL,
	"purpose" text DEFAULT '触达内容' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_execution_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_step_id" text,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"recipient_count" bigint DEFAULT 0 NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"position" bigint DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT '邮件' NOT NULL,
	"content_asset_id" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" bigint,
	"executed_at" bigint,
	"recipient_count" bigint DEFAULT 0 NOT NULL,
	"reply_count" bigint DEFAULT 0 NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"market" text DEFAULT '待补全' NOT NULL,
	"audience_label" text DEFAULT '待确认名单' NOT NULL,
	"status" text DEFAULT '草稿' NOT NULL,
	"channel" text DEFAULT '邮件' NOT NULL,
	"stop_rule" text DEFAULT '收到回复' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"sent_count" bigint DEFAULT 0 NOT NULL,
	"reply_count" bigint DEFAULT 0 NOT NULL,
	"opportunity_count" bigint DEFAULT 0 NOT NULL,
	"revenue_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"next_action" text DEFAULT '完善受众、内容与发送设置' NOT NULL,
	"start_at" bigint,
	"next_run_at" bigint,
	"owner_user_id" text,
	"completed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"name" text DEFAULT '公开联系人' NOT NULL,
	"role" text DEFAULT '企业公开联系方式' NOT NULL,
	"email" text,
	"phone" text,
	"social_url" text,
	"source_url" text NOT NULL,
	"verification_status" text DEFAULT 'public' NOT NULL,
	"confidence" bigint DEFAULT 50 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"observed_label" text DEFAULT '待确认' NOT NULL,
	"strength" text DEFAULT '中' NOT NULL,
	"source_url" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel" text NOT NULL,
	"period_label" text DEFAULT 'monthly' NOT NULL,
	"period_start" bigint NOT NULL,
	"period_end" bigint NOT NULL,
	"cost_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"owner_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"external_message_id" text,
	"sender" text,
	"recipient" text,
	"subject" text,
	"body" text,
	"reason" text,
	"occurred_at" bigint NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"processed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"destination" text NOT NULL,
	"reason" text NOT NULL,
	"source" text DEFAULT 'channel_event' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_event_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"content_type" text DEFAULT '首次触达邮件' NOT NULL,
	"channel" text DEFAULT '邮件' NOT NULL,
	"status" text DEFAULT '草稿' NOT NULL,
	"language" text DEFAULT '中文' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"target_market" text DEFAULT '待补全' NOT NULL,
	"customer_role" text DEFAULT '待补全' NOT NULL,
	"buying_stage" text DEFAULT '问题认知' NOT NULL,
	"customer_signal" text DEFAULT '待识别' NOT NULL,
	"source_method" text DEFAULT '客户信号' NOT NULL,
	"current_version" bigint DEFAULT 1 NOT NULL,
	"quality_score" bigint DEFAULT 0 NOT NULL,
	"customer_relevance" bigint DEFAULT 0 NOT NULL,
	"evidence_score" bigint DEFAULT 0 NOT NULL,
	"action_clarity" bigint DEFAULT 0 NOT NULL,
	"linked_campaign_ids_json" text DEFAULT '[]' NOT NULL,
	"owner_user_id" text,
	"published_at" bigint,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"content_asset_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"generation_mode" text DEFAULT 'local-rules' NOT NULL,
	"service_name" text,
	"model" text,
	"input_json" text DEFAULT '{}' NOT NULL,
	"output_title" text DEFAULT '' NOT NULL,
	"output_body" text DEFAULT '' NOT NULL,
	"error" text,
	"started_at" bigint NOT NULL,
	"completed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_quality_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"content_asset_id" text NOT NULL,
	"content_version_id" text,
	"overall_score" bigint NOT NULL,
	"customer_relevance" bigint NOT NULL,
	"evidence_score" bigint NOT NULL,
	"action_clarity" bigint NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"findings_json" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"content_asset_id" text NOT NULL,
	"version_number" bigint NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"change_note" text DEFAULT '保存内容' NOT NULL,
	"created_by_user_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"company" text NOT NULL,
	"region" text DEFAULT '待补全' NOT NULL,
	"industry" text DEFAULT '待补全' NOT NULL,
	"score" bigint DEFAULT 0 NOT NULL,
	"confidence" bigint DEFAULT 0 NOT NULL,
	"signal" text DEFAULT '待识别' NOT NULL,
	"source" text DEFAULT '手动录入' NOT NULL,
	"estimated_value" bigint DEFAULT 0 NOT NULL,
	"size" text DEFAULT '待补全' NOT NULL,
	"stage" text DEFAULT '待补全' NOT NULL,
	"contacts" bigint DEFAULT 0 NOT NULL,
	"valid_contacts" bigint DEFAULT 0 NOT NULL,
	"interaction" text DEFAULT '尚无互动' NOT NULL,
	"next_action" text DEFAULT '补全企业档案' NOT NULL,
	"due_at" bigint,
	"owner_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_id" text,
	"company" text NOT NULL,
	"stage" text DEFAULT '线索确认' NOT NULL,
	"probability" bigint DEFAULT 20 NOT NULL,
	"value_amount" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"owner_label" text DEFAULT '我' NOT NULL,
	"next_action" text DEFAULT '确认需求和决策链' NOT NULL,
	"expected_close_at" bigint,
	"risk" text DEFAULT '等待首次复核' NOT NULL,
	"source" text DEFAULT '商机跟进' NOT NULL,
	"stage_entered_at" bigint NOT NULL,
	"owner_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_id" text,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"job_title" text DEFAULT '待补全' NOT NULL,
	"region" text DEFAULT '待补全' NOT NULL,
	"source" text DEFAULT '客户消息' NOT NULL,
	"primary_channel" text DEFAULT '邮件' NOT NULL,
	"email" text,
	"phone" text,
	"external_ref" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"priority" bigint DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"secret_ciphertext" text,
	"secret_iv" text,
	"secret_tag" text,
	"secret_ending" text,
	"config_json" text DEFAULT '{}' NOT NULL,
	"last_latency_ms" bigint,
	"last_error" text,
	"last_tested_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"title" text NOT NULL,
	"item_type" text DEFAULT '市场知识' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '手动录入' NOT NULL,
	"source_url" text,
	"tags_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT '待复核' NOT NULL,
	"reference_count" bigint DEFAULT 0 NOT NULL,
	"owner_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_delivery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"outbox_job_id" text NOT NULL,
	"message_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"direction" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"channel" text NOT NULL,
	"sender_label" text DEFAULT '' NOT NULL,
	"external_id" text,
	"confirmed_by_user_id" text,
	"confirmed_at" bigint,
	"sent_at" bigint,
	"delivered_at" bigint,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_thread_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" text,
	"last_read_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"customer_id" text,
	"campaign_id" text,
	"subject" text DEFAULT '客户对话' NOT NULL,
	"channel" text DEFAULT '邮件' NOT NULL,
	"intent" text DEFAULT '待判断' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_user_id" text,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"last_message_at" bigint NOT NULL,
	"last_inbound_at" bigint,
	"unread_count" bigint DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_channel_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'smtp' NOT NULL,
	"host" text NOT NULL,
	"port" bigint DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT false NOT NULL,
	"username" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text,
	"priority" bigint DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"secret_ending" text NOT NULL,
	"webhook_secret_ciphertext" text,
	"webhook_secret_iv" text,
	"webhook_secret_tag" text,
	"webhook_secret_ending" text,
	"last_latency_ms" bigint,
	"last_error" text,
	"last_tested_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"channel" text NOT NULL,
	"connection_id" text,
	"status" text DEFAULT 'awaiting_configuration' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"max_attempts" bigint DEFAULT 3 NOT NULL,
	"scheduled_at" bigint NOT NULL,
	"started_at" bigint,
	"completed_at" bigint,
	"last_error" text,
	"external_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"radar_task_id" text,
	"company" text NOT NULL,
	"region" text DEFAULT '待补全' NOT NULL,
	"industry" text DEFAULT '待补全' NOT NULL,
	"size" text DEFAULT '待补全' NOT NULL,
	"score" bigint DEFAULT 0 NOT NULL,
	"signal" text DEFAULT '待识别' NOT NULL,
	"source" text DEFAULT '数据源' NOT NULL,
	"estimated_value" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"confidence" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"reason" text DEFAULT '等待补充研究结论' NOT NULL,
	"dimensions_json" text DEFAULT '[]' NOT NULL,
	"committee_json" text DEFAULT '[]' NOT NULL,
	"relationships_json" text DEFAULT '[]' NOT NULL,
	"discovered_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"radar_task_id" text NOT NULL,
	"queue_item_id" text,
	"level" text DEFAULT 'info' NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_queue_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"radar_task_id" text NOT NULL,
	"job_type" text DEFAULT 'discover' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"max_attempts" bigint DEFAULT 3 NOT NULL,
	"scheduled_at" bigint NOT NULL,
	"started_at" bigint,
	"completed_at" bigint,
	"last_error" text,
	"payload" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"icp" text NOT NULL,
	"mode" text DEFAULT '智能多渠道' NOT NULL,
	"depth" text DEFAULT '标准研究' NOT NULL,
	"candidate_limit" bigint DEFAULT 100 NOT NULL,
	"knowledge_scope" text DEFAULT '全部资料' NOT NULL,
	"target_region" text DEFAULT '全球' NOT NULL,
	"research_language" text DEFAULT '自动识别' NOT NULL,
	"input_source" text DEFAULT 'AI 获客' NOT NULL,
	"seed_urls_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"current_stage" text DEFAULT '等待执行' NOT NULL,
	"candidates_found" bigint DEFAULT 0 NOT NULL,
	"high_match_count" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"owner_user_id" text,
	"started_at" bigint,
	"completed_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"last_seen_at" bigint,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_id" text,
	"title" text NOT NULL,
	"priority" text DEFAULT '中' NOT NULL,
	"due_at" bigint,
	"due_label" text DEFAULT '待安排' NOT NULL,
	"company" text DEFAULT '个人事项' NOT NULL,
	"next_action" text DEFAULT '按计划执行' NOT NULL,
	"impact" text DEFAULT '待评估' NOT NULL,
	"source" text DEFAULT '客户' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_user_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"totp_secret_ciphertext" text,
	"totp_secret_iv" text,
	"totp_secret_tag" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_verified_at" bigint,
	"totp_recovery_codes_json" text DEFAULT '[]' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_ai_policies" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"rotation_strategy" text DEFAULT 'failover' NOT NULL,
	"retry_count" bigint DEFAULT 2 NOT NULL,
	"retry_backoff" text DEFAULT 'exponential' NOT NULL,
	"retry_delay_ms" bigint DEFAULT 1000 NOT NULL,
	"cooldown_ms" bigint DEFAULT 300000 NOT NULL,
	"failover_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_service_keys" ADD CONSTRAINT "ai_service_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_service_keys" ADD CONSTRAINT "ai_service_keys_service_id_ai_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."ai_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_services" ADD CONSTRAINT "ai_services_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_links" ADD CONSTRAINT "campaign_content_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_links" ADD CONSTRAINT "campaign_content_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content_links" ADD CONSTRAINT "campaign_content_links_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_execution_events" ADD CONSTRAINT "campaign_execution_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_execution_events" ADD CONSTRAINT "campaign_execution_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_execution_events" ADD CONSTRAINT "campaign_execution_events_campaign_step_id_campaign_steps_id_fk" FOREIGN KEY ("campaign_step_id") REFERENCES "public"."campaign_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_candidate_id_radar_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."radar_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_evidence" ADD CONSTRAINT "candidate_evidence_candidate_id_radar_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."radar_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_costs" ADD CONSTRAINT "channel_costs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_costs" ADD CONSTRAINT "channel_costs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_webhook_events" ADD CONSTRAINT "channel_webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_webhook_events" ADD CONSTRAINT "channel_webhook_events_connection_id_outbound_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."outbound_channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_last_event_id_channel_webhook_events_id_fk" FOREIGN KEY ("last_event_id") REFERENCES "public"."channel_webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generation_runs" ADD CONSTRAINT "content_generation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generation_runs" ADD CONSTRAINT "content_generation_runs_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_quality_checks" ADD CONSTRAINT "content_quality_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_quality_checks" ADD CONSTRAINT "content_quality_checks_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_quality_checks" ADD CONSTRAINT "content_quality_checks_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_asset_id_content_assets_id_fk" FOREIGN KEY ("content_asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_contacts" ADD CONSTRAINT "inbox_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_contacts" ADD CONSTRAINT "inbox_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_events" ADD CONSTRAINT "message_delivery_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_events" ADD CONSTRAINT "message_delivery_events_outbox_job_id_outbox_jobs_id_fk" FOREIGN KEY ("outbox_job_id") REFERENCES "public"."outbox_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_delivery_events" ADD CONSTRAINT "message_delivery_events_message_id_message_entries_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_entries" ADD CONSTRAINT "message_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_entries" ADD CONSTRAINT "message_entries_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_entries" ADD CONSTRAINT "message_entries_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread_reads" ADD CONSTRAINT "message_thread_reads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread_reads" ADD CONSTRAINT "message_thread_reads_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread_reads" ADD CONSTRAINT "message_thread_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread_reads" ADD CONSTRAINT "message_thread_reads_last_read_message_id_message_entries_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."message_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_contact_id_inbox_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."inbox_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_channel_connections" ADD CONSTRAINT "outbound_channel_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_message_id_message_entries_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_connection_id_outbound_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."outbound_channel_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_candidates" ADD CONSTRAINT "radar_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_candidates" ADD CONSTRAINT "radar_candidates_radar_task_id_radar_tasks_id_fk" FOREIGN KEY ("radar_task_id") REFERENCES "public"."radar_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_job_events" ADD CONSTRAINT "radar_job_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_job_events" ADD CONSTRAINT "radar_job_events_radar_task_id_radar_tasks_id_fk" FOREIGN KEY ("radar_task_id") REFERENCES "public"."radar_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_job_events" ADD CONSTRAINT "radar_job_events_queue_item_id_radar_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."radar_queue_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_queue_items" ADD CONSTRAINT "radar_queue_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_queue_items" ADD CONSTRAINT "radar_queue_items_radar_task_id_radar_tasks_id_fk" FOREIGN KEY ("radar_task_id") REFERENCES "public"."radar_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_tasks" ADD CONSTRAINT "radar_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_tasks" ADD CONSTRAINT "radar_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_ai_policies" ADD CONSTRAINT "workspace_ai_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_service_keys_service_idx" ON "ai_service_keys" USING btree ("service_id","enabled");--> statement-breakpoint
CREATE INDEX "ai_service_keys_workspace_idx" ON "ai_service_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_services_workspace_name_unique" ON "ai_services" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "ai_services_workspace_priority_idx" ON "ai_services" USING btree ("workspace_id","priority");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_created_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_token_hash_unique" ON "auth_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_challenges_user_idx" ON "auth_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "business_profiles_workspace_idx" ON "business_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_audience_campaign_company_unique" ON "campaign_audience_members" USING btree ("campaign_id","company");--> statement-breakpoint
CREATE INDEX "campaign_audience_workspace_status_idx" ON "campaign_audience_members" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaign_audience_customer_idx" ON "campaign_audience_members" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_content_campaign_asset_unique" ON "campaign_content_links" USING btree ("campaign_id","content_asset_id");--> statement-breakpoint
CREATE INDEX "campaign_content_workspace_idx" ON "campaign_content_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaign_events_campaign_created_idx" ON "campaign_execution_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "campaign_events_workspace_idx" ON "campaign_execution_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_steps_campaign_position_unique" ON "campaign_steps" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "campaign_steps_workspace_schedule_idx" ON "campaign_steps" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_status_idx" ON "campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_updated_idx" ON "campaigns" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_next_run_idx" ON "campaigns" USING btree ("workspace_id","next_run_at");--> statement-breakpoint
CREATE INDEX "candidate_contacts_candidate_idx" ON "candidate_contacts" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_contacts_workspace_idx" ON "candidate_contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_contacts_candidate_source_unique" ON "candidate_contacts" USING btree ("candidate_id","email","phone","social_url");--> statement-breakpoint
CREATE INDEX "candidate_evidence_candidate_idx" ON "candidate_evidence" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_evidence_workspace_idx" ON "candidate_evidence" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channel_costs_workspace_period_idx" ON "channel_costs" USING btree ("workspace_id","period_start");--> statement-breakpoint
CREATE INDEX "channel_costs_workspace_channel_idx" ON "channel_costs" USING btree ("workspace_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_webhook_connection_event_unique" ON "channel_webhook_events" USING btree ("connection_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "channel_webhook_workspace_created_idx" ON "channel_webhook_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_webhook_external_message_idx" ON "channel_webhook_events" USING btree ("external_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suppressions_workspace_channel_destination_unique" ON "contact_suppressions" USING btree ("workspace_id","channel","destination");--> statement-breakpoint
CREATE INDEX "contact_suppressions_workspace_active_idx" ON "contact_suppressions" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE INDEX "content_assets_workspace_status_idx" ON "content_assets" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "content_assets_workspace_updated_idx" ON "content_assets" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "content_assets_workspace_type_idx" ON "content_assets" USING btree ("workspace_id","content_type");--> statement-breakpoint
CREATE INDEX "content_generation_runs_workspace_created_idx" ON "content_generation_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "content_generation_runs_asset_idx" ON "content_generation_runs" USING btree ("content_asset_id");--> statement-breakpoint
CREATE INDEX "content_quality_checks_asset_idx" ON "content_quality_checks" USING btree ("content_asset_id","created_at");--> statement-breakpoint
CREATE INDEX "content_quality_checks_workspace_idx" ON "content_quality_checks" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_asset_version_unique" ON "content_versions" USING btree ("content_asset_id","version_number");--> statement-breakpoint
CREATE INDEX "content_versions_workspace_idx" ON "content_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_tags_customer_name_unique" ON "customer_tags" USING btree ("customer_id","name");--> statement-breakpoint
CREATE INDEX "customer_tags_workspace_idx" ON "customer_tags" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_workspace_company_unique" ON "customers" USING btree ("workspace_id","company");--> statement-breakpoint
CREATE INDEX "customers_workspace_idx" ON "customers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "customers_workspace_score_idx" ON "customers" USING btree ("workspace_id","score");--> statement-breakpoint
CREATE INDEX "customers_workspace_stage_idx" ON "customers" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_workspace_company_unique" ON "deals" USING btree ("workspace_id","company");--> statement-breakpoint
CREATE INDEX "deals_workspace_stage_idx" ON "deals" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE INDEX "deals_workspace_close_idx" ON "deals" USING btree ("workspace_id","expected_close_at");--> statement-breakpoint
CREATE INDEX "deals_customer_idx" ON "deals" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_contacts_workspace_company_name_unique" ON "inbox_contacts" USING btree ("workspace_id","company","name");--> statement-breakpoint
CREATE INDEX "inbox_contacts_workspace_company_idx" ON "inbox_contacts" USING btree ("workspace_id","company");--> statement-breakpoint
CREATE INDEX "inbox_contacts_customer_idx" ON "inbox_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_workspace_name_unique" ON "integration_connections" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "integration_connections_workspace_category_idx" ON "integration_connections" USING btree ("workspace_id","category","priority");--> statement-breakpoint
CREATE INDEX "knowledge_items_workspace_updated_idx" ON "knowledge_items" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "knowledge_items_workspace_status_idx" ON "knowledge_items" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_items_workspace_type_idx" ON "knowledge_items" USING btree ("workspace_id","item_type");--> statement-breakpoint
CREATE INDEX "message_delivery_events_job_created_idx" ON "message_delivery_events" USING btree ("outbox_job_id","created_at");--> statement-breakpoint
CREATE INDEX "message_delivery_events_workspace_idx" ON "message_delivery_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "message_entries_thread_created_idx" ON "message_entries" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "message_entries_workspace_status_idx" ON "message_entries" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "message_thread_reads_thread_user_unique" ON "message_thread_reads" USING btree ("thread_id","user_id");--> statement-breakpoint
CREATE INDEX "message_thread_reads_workspace_idx" ON "message_thread_reads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "message_threads_workspace_last_idx" ON "message_threads" USING btree ("workspace_id","last_message_at");--> statement-breakpoint
CREATE INDEX "message_threads_workspace_status_idx" ON "message_threads" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "message_threads_workspace_channel_idx" ON "message_threads" USING btree ("workspace_id","channel");--> statement-breakpoint
CREATE INDEX "message_threads_contact_idx" ON "message_threads" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "message_threads_customer_idx" ON "message_threads" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_connections_workspace_name_unique" ON "outbound_channel_connections" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "outbound_connections_workspace_priority_idx" ON "outbound_channel_connections" USING btree ("workspace_id","enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_message_unique" ON "outbox_jobs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "outbox_jobs_workspace_status_schedule_idx" ON "outbox_jobs" USING btree ("workspace_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "outbox_jobs_thread_idx" ON "outbox_jobs" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expiry_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_candidates_workspace_company_unique" ON "radar_candidates" USING btree ("workspace_id","company");--> statement-breakpoint
CREATE INDEX "radar_candidates_workspace_status_idx" ON "radar_candidates" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "radar_candidates_task_idx" ON "radar_candidates" USING btree ("radar_task_id");--> statement-breakpoint
CREATE INDEX "radar_candidates_workspace_score_idx" ON "radar_candidates" USING btree ("workspace_id","score");--> statement-breakpoint
CREATE INDEX "radar_job_events_task_created_idx" ON "radar_job_events" USING btree ("radar_task_id","created_at");--> statement-breakpoint
CREATE INDEX "radar_job_events_workspace_idx" ON "radar_job_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "radar_queue_workspace_status_idx" ON "radar_queue_items" USING btree ("workspace_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "radar_queue_task_idx" ON "radar_queue_items" USING btree ("radar_task_id");--> statement-breakpoint
CREATE INDEX "radar_tasks_workspace_status_idx" ON "radar_tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "radar_tasks_workspace_created_idx" ON "radar_tasks" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tasks_workspace_status_idx" ON "tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "tasks_workspace_due_idx" ON "tasks" USING btree ("workspace_id","due_at");--> statement-breakpoint
CREATE INDEX "tasks_customer_idx" ON "tasks" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_unique" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_user_id");