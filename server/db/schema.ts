import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    locale: text("locale").notNull().default("zh-CN"),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    currency: text("currency").notNull().default("CNY"),
    totpSecretCiphertext: text("totp_secret_ciphertext"),
    totpSecretIv: text("totp_secret_iv"),
    totpSecretTag: text("totp_secret_tag"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpVerifiedAt: bigint("totp_verified_at", { mode: "number" }),
    totpRecoveryCodesJson: text("totp_recovery_codes_json").notNull().default("[]"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("workspaces_owner_idx").on(table.ownerUserId)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("workspace_members_unique").on(table.workspaceId, table.userId),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    lastSeenAt: bigint("last_seen_at", { mode: "number" }),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("login_2fa"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("auth_challenges_token_hash_unique").on(table.tokenHash),
    index("auth_challenges_user_idx").on(table.userId),
    index("auth_challenges_expiry_idx").on(table.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    usedAt: bigint("used_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
    index("password_reset_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    region: text("region").notNull().default("待补全"),
    industry: text("industry").notNull().default("待补全"),
    score: bigint("score", { mode: "number" }).notNull().default(0),
    confidence: bigint("confidence", { mode: "number" }).notNull().default(0),
    signal: text("signal").notNull().default("待识别"),
    source: text("source").notNull().default("手动录入"),
    estimatedValue: bigint("estimated_value", { mode: "number" }).notNull().default(0),
    size: text("size").notNull().default("待补全"),
    stage: text("stage").notNull().default("待补全"),
    contacts: bigint("contacts", { mode: "number" }).notNull().default(0),
    validContacts: bigint("valid_contacts", { mode: "number" }).notNull().default(0),
    interaction: text("interaction").notNull().default("尚无互动"),
    nextAction: text("next_action").notNull().default("补全企业档案"),
    dueAt: bigint("due_at", { mode: "number" }),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("customers_workspace_company_unique").on(
      table.workspaceId,
      table.company,
    ),
    index("customers_workspace_idx").on(table.workspaceId),
    index("customers_workspace_score_idx").on(table.workspaceId, table.score),
    index("customers_workspace_stage_idx").on(table.workspaceId, table.stage),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    priority: text("priority").notNull().default("中"),
    dueAt: bigint("due_at", { mode: "number" }),
    dueLabel: text("due_label").notNull().default("待安排"),
    company: text("company").notNull().default("个人事项"),
    nextAction: text("next_action").notNull().default("按计划执行"),
    impact: text("impact").notNull().default("待评估"),
    source: text("source").notNull().default("客户"),
    status: text("status").notNull().default("open"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("tasks_workspace_status_idx").on(table.workspaceId, table.status),
    index("tasks_workspace_due_idx").on(table.workspaceId, table.dueAt),
    index("tasks_customer_idx").on(table.customerId),
  ],
);

export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    stage: text("stage").notNull().default("线索确认"),
    probability: bigint("probability", { mode: "number" }).notNull().default(20),
    valueAmount: bigint("value_amount", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    ownerLabel: text("owner_label").notNull().default("我"),
    nextAction: text("next_action").notNull().default("确认需求和决策链"),
    expectedCloseAt: bigint("expected_close_at", { mode: "number" }),
    risk: text("risk").notNull().default("等待首次复核"),
    source: text("source").notNull().default("商机跟进"),
    stageEnteredAt: bigint("stage_entered_at", { mode: "number" }).notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("deals_workspace_company_unique").on(
      table.workspaceId,
      table.company,
    ),
    index("deals_workspace_stage_idx").on(table.workspaceId, table.stage),
    index("deals_workspace_close_idx").on(
      table.workspaceId,
      table.expectedCloseAt,
    ),
    index("deals_customer_idx").on(table.customerId),
  ],
);

export const contentAssets = pgTable(
  "content_assets",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentType: text("content_type").notNull().default("首次触达邮件"),
    channel: text("channel").notNull().default("邮件"),
    status: text("status").notNull().default("草稿"),
    language: text("language").notNull().default("中文"),
    body: text("body").notNull().default(""),
    summary: text("summary").notNull().default(""),
    targetMarket: text("target_market").notNull().default("待补全"),
    customerRole: text("customer_role").notNull().default("待补全"),
    buyingStage: text("buying_stage").notNull().default("问题认知"),
    customerSignal: text("customer_signal").notNull().default("待识别"),
    sourceMethod: text("source_method").notNull().default("客户信号"),
    currentVersion: bigint("current_version", { mode: "number" }).notNull().default(1),
    qualityScore: bigint("quality_score", { mode: "number" }).notNull().default(0),
    customerRelevance: bigint("customer_relevance", { mode: "number" }).notNull().default(0),
    evidenceScore: bigint("evidence_score", { mode: "number" }).notNull().default(0),
    actionClarity: bigint("action_clarity", { mode: "number" }).notNull().default(0),
    linkedCampaignIdsJson: text("linked_campaign_ids_json")
      .notNull()
      .default("[]"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: bigint("published_at", { mode: "number" }),
    archivedAt: bigint("archived_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("content_assets_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("content_assets_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    index("content_assets_workspace_type_idx").on(
      table.workspaceId,
      table.contentType,
    ),
  ],
);

export const contentVersions = pgTable(
  "content_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contentAssetId: text("content_asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    versionNumber: bigint("version_number", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    changeNote: text("change_note").notNull().default("保存内容"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_versions_asset_version_unique").on(
      table.contentAssetId,
      table.versionNumber,
    ),
    index("content_versions_workspace_idx").on(table.workspaceId),
  ],
);

export const contentQualityChecks = pgTable(
  "content_quality_checks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contentAssetId: text("content_asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    contentVersionId: text("content_version_id").references(
      () => contentVersions.id,
      { onDelete: "set null" },
    ),
    overallScore: bigint("overall_score", { mode: "number" }).notNull(),
    customerRelevance: bigint("customer_relevance", { mode: "number" }).notNull(),
    evidenceScore: bigint("evidence_score", { mode: "number" }).notNull(),
    actionClarity: bigint("action_clarity", { mode: "number" }).notNull(),
    status: text("status").notNull().default("completed"),
    findingsJson: text("findings_json").notNull().default("[]"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("content_quality_checks_asset_idx").on(
      table.contentAssetId,
      table.createdAt,
    ),
    index("content_quality_checks_workspace_idx").on(table.workspaceId),
  ],
);

export const contentGenerationRuns = pgTable(
  "content_generation_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contentAssetId: text("content_asset_id").references(
      () => contentAssets.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("completed"),
    generationMode: text("generation_mode").notNull().default("local-rules"),
    serviceName: text("service_name"),
    model: text("model"),
    inputJson: text("input_json").notNull().default("{}"),
    outputTitle: text("output_title").notNull().default(""),
    outputBody: text("output_body").notNull().default(""),
    error: text("error"),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("content_generation_runs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("content_generation_runs_asset_idx").on(table.contentAssetId),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    market: text("market").notNull().default("待补全"),
    audienceLabel: text("audience_label").notNull().default("待确认名单"),
    status: text("status").notNull().default("草稿"),
    channel: text("channel").notNull().default("邮件"),
    stopRule: text("stop_rule").notNull().default("收到回复"),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    progress: bigint("progress", { mode: "number" }).notNull().default(0),
    sentCount: bigint("sent_count", { mode: "number" }).notNull().default(0),
    replyCount: bigint("reply_count", { mode: "number" }).notNull().default(0),
    opportunityCount: bigint("opportunity_count", { mode: "number" }).notNull().default(0),
    revenueAmount: bigint("revenue_amount", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    nextAction: text("next_action")
      .notNull()
      .default("完善受众、内容与发送设置"),
    startAt: bigint("start_at", { mode: "number" }),
    nextRunAt: bigint("next_run_at", { mode: "number" }),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: bigint("completed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("campaigns_workspace_status_idx").on(table.workspaceId, table.status),
    index("campaigns_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    index("campaigns_workspace_next_run_idx").on(
      table.workspaceId,
      table.nextRunAt,
    ),
  ],
);

export const campaignSteps = pgTable(
  "campaign_steps",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    position: bigint("position", { mode: "number" }).notNull().default(1),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("邮件"),
    contentAssetId: text("content_asset_id").references(
      () => contentAssets.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("scheduled"),
    scheduledAt: bigint("scheduled_at", { mode: "number" }),
    executedAt: bigint("executed_at", { mode: "number" }),
    recipientCount: bigint("recipient_count", { mode: "number" }).notNull().default(0),
    replyCount: bigint("reply_count", { mode: "number" }).notNull().default(0),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("campaign_steps_campaign_position_unique").on(
      table.campaignId,
      table.position,
    ),
    index("campaign_steps_workspace_schedule_idx").on(
      table.workspaceId,
      table.scheduledAt,
    ),
  ],
);

export const campaignAudienceMembers = pgTable(
  "campaign_audience_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    status: text("status").notNull().default("pending"),
    stopReason: text("stop_reason"),
    lastEventAt: bigint("last_event_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("campaign_audience_campaign_company_unique").on(
      table.campaignId,
      table.company,
    ),
    index("campaign_audience_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("campaign_audience_customer_idx").on(table.customerId),
  ],
);

export const campaignContentLinks = pgTable(
  "campaign_content_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contentAssetId: text("content_asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    position: bigint("position", { mode: "number" }).notNull().default(1),
    purpose: text("purpose").notNull().default("触达内容"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("campaign_content_campaign_asset_unique").on(
      table.campaignId,
      table.contentAssetId,
    ),
    index("campaign_content_workspace_idx").on(table.workspaceId),
  ],
);

export const campaignExecutionEvents = pgTable(
  "campaign_execution_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    campaignStepId: text("campaign_step_id").references(
      () => campaignSteps.id,
      { onDelete: "set null" },
    ),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("completed"),
    recipientCount: bigint("recipient_count", { mode: "number" }).notNull().default(0),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("campaign_events_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
    index("campaign_events_workspace_idx").on(table.workspaceId),
  ],
);

export const inboxContacts = pgTable(
  "inbox_contacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    company: text("company").notNull(),
    jobTitle: text("job_title").notNull().default("待补全"),
    region: text("region").notNull().default("待补全"),
    source: text("source").notNull().default("客户消息"),
    primaryChannel: text("primary_channel").notNull().default("邮件"),
    email: text("email"),
    phone: text("phone"),
    externalRef: text("external_ref"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_contacts_workspace_company_name_unique").on(
      table.workspaceId,
      table.company,
      table.name,
    ),
    index("inbox_contacts_workspace_company_idx").on(
      table.workspaceId,
      table.company,
    ),
    index("inbox_contacts_customer_idx").on(table.customerId),
  ],
);

export const messageThreads = pgTable(
  "message_threads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => inboxContacts.id, { onDelete: "cascade" }),
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    campaignId: text("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    subject: text("subject").notNull().default("客户对话"),
    channel: text("channel").notNull().default("邮件"),
    intent: text("intent").notNull().default("待判断"),
    status: text("status").notNull().default("open"),
    assigneeUserId: text("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastMessageAt: bigint("last_message_at", { mode: "number" }).notNull(),
    lastInboundAt: bigint("last_inbound_at", { mode: "number" }),
    unreadCount: bigint("unread_count", { mode: "number" }).notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("message_threads_workspace_last_idx").on(
      table.workspaceId,
      table.lastMessageAt,
    ),
    index("message_threads_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("message_threads_workspace_channel_idx").on(
      table.workspaceId,
      table.channel,
    ),
    index("message_threads_contact_idx").on(table.contactId),
    index("message_threads_customer_idx").on(table.customerId),
  ],
);

export const messageEntries = pgTable(
  "message_entries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    messageType: text("message_type").notNull().default("text"),
    body: text("body").notNull(),
    status: text("status").notNull(),
    channel: text("channel").notNull(),
    senderLabel: text("sender_label").notNull().default(""),
    externalId: text("external_id"),
    confirmedByUserId: text("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: bigint("confirmed_at", { mode: "number" }),
    sentAt: bigint("sent_at", { mode: "number" }),
    deliveredAt: bigint("delivered_at", { mode: "number" }),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("message_entries_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
    index("message_entries_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  ],
);

export const messageThreadReads = pgTable(
  "message_thread_reads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadMessageId: text("last_read_message_id").references(
      () => messageEntries.id,
      { onDelete: "set null" },
    ),
    lastReadAt: bigint("last_read_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("message_thread_reads_thread_user_unique").on(
      table.threadId,
      table.userId,
    ),
    index("message_thread_reads_workspace_idx").on(table.workspaceId),
  ],
);

export const outboundChannelConnections = pgTable(
  "outbound_channel_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("smtp"),
    host: text("host").notNull(),
    port: bigint("port", { mode: "number" }).notNull().default(587),
    secure: boolean("secure").notNull().default(false),
    username: text("username").notNull(),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    imapEnabled: boolean("imap_enabled").notNull().default(false),
    imapHost: text("imap_host"),
    imapPort: bigint("imap_port", { mode: "number" }).notNull().default(993),
    imapSecure: boolean("imap_secure").notNull().default(true),
    imapUsername: text("imap_username"),
    imapSecretCiphertext: text("imap_secret_ciphertext"),
    imapSecretIv: text("imap_secret_iv"),
    imapSecretTag: text("imap_secret_tag"),
    imapSecretEnding: text("imap_secret_ending"),
    priority: bigint("priority", { mode: "number" }).notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("untested"),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    secretEnding: text("secret_ending").notNull(),
    webhookSecretCiphertext: text("webhook_secret_ciphertext"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    webhookSecretEnding: text("webhook_secret_ending"),
    lastLatencyMs: bigint("last_latency_ms", { mode: "number" }),
    lastError: text("last_error"),
    lastTestedAt: bigint("last_tested_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("outbound_connections_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
    index("outbound_connections_workspace_priority_idx").on(
      table.workspaceId,
      table.enabled,
      table.priority,
    ),
  ],
);

export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messageEntries.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    connectionId: text("connection_id").references(
      () => outboundChannelConnections.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("awaiting_configuration"),
    attempts: bigint("attempts", { mode: "number" }).notNull().default(0),
    maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(3),
    scheduledAt: bigint("scheduled_at", { mode: "number" }).notNull(),
    startedAt: bigint("started_at", { mode: "number" }),
    completedAt: bigint("completed_at", { mode: "number" }),
    lastError: text("last_error"),
    externalId: text("external_id"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("outbox_jobs_message_unique").on(table.messageId),
    index("outbox_jobs_workspace_status_schedule_idx").on(
      table.workspaceId,
      table.status,
      table.scheduledAt,
    ),
    index("outbox_jobs_thread_idx").on(table.threadId),
  ],
);

export const messageDeliveryEvents = pgTable(
  "message_delivery_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    outboxJobId: text("outbox_job_id")
      .notNull()
      .references(() => outboxJobs.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messageEntries.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("message_delivery_events_job_created_idx").on(
      table.outboxJobId,
      table.createdAt,
    ),
    index("message_delivery_events_workspace_idx").on(table.workspaceId),
  ],
);

export const channelWebhookEvents = pgTable(
  "channel_webhook_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => outboundChannelConnections.id, {
        onDelete: "cascade",
      }),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    externalMessageId: text("external_message_id"),
    sender: text("sender"),
    recipient: text("recipient"),
    subject: text("subject"),
    body: text("body"),
    reason: text("reason"),
    occurredAt: bigint("occurred_at", { mode: "number" }).notNull(),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingError: text("processing_error"),
    payloadJson: text("payload_json").notNull().default("{}"),
    processedAt: bigint("processed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("channel_webhook_connection_event_unique").on(
      table.connectionId,
      table.providerEventId,
    ),
    index("channel_webhook_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("channel_webhook_external_message_idx").on(table.externalMessageId),
  ],
);

export const contactSuppressions = pgTable(
  "contact_suppressions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"),
    destination: text("destination").notNull(),
    reason: text("reason").notNull(),
    source: text("source").notNull().default("channel_event"),
    active: boolean("active").notNull().default(true),
    lastEventId: text("last_event_id").references(
      () => channelWebhookEvents.id,
      {
        onDelete: "set null",
      },
    ),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("contact_suppressions_workspace_channel_destination_unique").on(
      table.workspaceId,
      table.channel,
      table.destination,
    ),
    index("contact_suppressions_workspace_active_idx").on(
      table.workspaceId,
      table.active,
    ),
  ],
);

export const radarTasks = pgTable(
  "radar_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icp: text("icp").notNull(),
    mode: text("mode").notNull().default("智能多渠道"),
    depth: text("depth").notNull().default("标准研究"),
    candidateLimit: bigint("candidate_limit", { mode: "number" }).notNull().default(100),
    knowledgeScope: text("knowledge_scope").notNull().default("全部资料"),
    targetRegion: text("target_region").notNull().default("全球"),
    researchLanguage: text("research_language").notNull().default("自动识别"),
    inputSource: text("input_source").notNull().default("AI 获客"),
    seedUrlsJson: text("seed_urls_json").notNull().default("[]"),
    status: text("status").notNull().default("queued"),
    progress: bigint("progress", { mode: "number" }).notNull().default(0),
    currentStage: text("current_stage").notNull().default("等待执行"),
    candidatesFound: bigint("candidates_found", { mode: "number" }).notNull().default(0),
    highMatchCount: bigint("high_match_count", { mode: "number" }).notNull().default(0),
    lastError: text("last_error"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: bigint("started_at", { mode: "number" }),
    completedAt: bigint("completed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("radar_tasks_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("radar_tasks_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const radarCandidates = pgTable(
  "radar_candidates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    radarTaskId: text("radar_task_id").references(() => radarTasks.id, {
      onDelete: "set null",
    }),
    company: text("company").notNull(),
    region: text("region").notNull().default("待补全"),
    industry: text("industry").notNull().default("待补全"),
    size: text("size").notNull().default("待补全"),
    score: bigint("score", { mode: "number" }).notNull().default(0),
    signal: text("signal").notNull().default("待识别"),
    source: text("source").notNull().default("数据源"),
    estimatedValue: bigint("estimated_value", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    confidence: bigint("confidence", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("candidate"),
    reason: text("reason").notNull().default("等待补充研究结论"),
    dimensionsJson: text("dimensions_json").notNull().default("[]"),
    committeeJson: text("committee_json").notNull().default("[]"),
    relationshipsJson: text("relationships_json").notNull().default("[]"),
    discoveredAt: bigint("discovered_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("radar_candidates_workspace_company_unique").on(
      table.workspaceId,
      table.company,
    ),
    index("radar_candidates_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("radar_candidates_task_idx").on(table.radarTaskId),
    index("radar_candidates_workspace_score_idx").on(
      table.workspaceId,
      table.score,
    ),
  ],
);

export const candidateEvidence = pgTable(
  "candidate_evidence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => radarCandidates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    source: text("source").notNull(),
    observedLabel: text("observed_label").notNull().default("待确认"),
    strength: text("strength").notNull().default("中"),
    sourceUrl: text("source_url"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("candidate_evidence_candidate_idx").on(table.candidateId),
    index("candidate_evidence_workspace_idx").on(table.workspaceId),
  ],
);

export const candidateContacts = pgTable(
  "candidate_contacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => radarCandidates.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("公开联系人"),
    role: text("role").notNull().default("企业公开联系方式"),
    email: text("email"),
    phone: text("phone"),
    socialUrl: text("social_url"),
    sourceUrl: text("source_url").notNull(),
    verificationStatus: text("verification_status").notNull().default("public"),
    confidence: bigint("confidence", { mode: "number" }).notNull().default(50),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("candidate_contacts_candidate_idx").on(table.candidateId),
    index("candidate_contacts_workspace_idx").on(table.workspaceId),
    uniqueIndex("candidate_contacts_candidate_source_unique").on(
      table.candidateId,
      table.email,
      table.phone,
      table.socialUrl,
    ),
  ],
);

export const radarQueueItems = pgTable(
  "radar_queue_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    radarTaskId: text("radar_task_id")
      .notNull()
      .references(() => radarTasks.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull().default("discover"),
    status: text("status").notNull().default("queued"),
    attempts: bigint("attempts", { mode: "number" }).notNull().default(0),
    maxAttempts: bigint("max_attempts", { mode: "number" }).notNull().default(3),
    scheduledAt: bigint("scheduled_at", { mode: "number" }).notNull(),
    startedAt: bigint("started_at", { mode: "number" }),
    completedAt: bigint("completed_at", { mode: "number" }),
    lastError: text("last_error"),
    payload: text("payload").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("radar_queue_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.scheduledAt,
    ),
    index("radar_queue_task_idx").on(table.radarTaskId),
  ],
);

export const radarJobEvents = pgTable(
  "radar_job_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    radarTaskId: text("radar_task_id")
      .notNull()
      .references(() => radarTasks.id, { onDelete: "cascade" }),
    queueItemId: text("queue_item_id").references(() => radarQueueItems.id, {
      onDelete: "set null",
    }),
    level: text("level").notNull().default("info"),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("radar_job_events_task_created_idx").on(
      table.radarTaskId,
      table.createdAt,
    ),
    index("radar_job_events_workspace_idx").on(table.workspaceId),
  ],
);

export const aiServices = pgTable(
  "ai_services",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    endpoint: text("endpoint").notNull(),
    priority: bigint("priority", { mode: "number" }).notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("untested"),
    lastLatencyMs: bigint("last_latency_ms", { mode: "number" }),
    lastError: text("last_error"),
    lastTestedAt: bigint("last_tested_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("ai_services_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
    index("ai_services_workspace_priority_idx").on(
      table.workspaceId,
      table.priority,
    ),
  ],
);

export const aiServiceKeys = pgTable(
  "ai_service_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    serviceId: text("service_id")
      .notNull()
      .references(() => aiServices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    ending: text("ending").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    failureCount: bigint("failure_count", { mode: "number" }).notNull().default(0),
    cooldownUntil: bigint("cooldown_until", { mode: "number" }),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("ai_service_keys_service_idx").on(table.serviceId, table.enabled),
    index("ai_service_keys_workspace_idx").on(table.workspaceId),
  ],
);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    priority: bigint("priority", { mode: "number" }).notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("untested"),
    secretCiphertext: text("secret_ciphertext"),
    secretIv: text("secret_iv"),
    secretTag: text("secret_tag"),
    secretEnding: text("secret_ending"),
    configJson: text("config_json").notNull().default("{}"),
    lastLatencyMs: bigint("last_latency_ms", { mode: "number" }),
    lastError: text("last_error"),
    lastTestedAt: bigint("last_tested_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("integration_connections_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
    index("integration_connections_workspace_category_idx").on(
      table.workspaceId,
      table.category,
      table.priority,
    ),
  ],
);

export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" })
      .unique(),
    company: text("company").notNull().default(""),
    website: text("website").notNull().default(""),
    products: text("products").notNull().default(""),
    regions: text("regions").notNull().default(""),
    customers: text("customers").notNull().default(""),
    exclusions: text("exclusions").notNull().default(""),
    selectedMarket: text("selected_market").notNull().default("德国食品设备"),
    analysisStatus: text("analysis_status").notNull().default("idle"),
    analysisSummary: text("analysis_summary").notNull().default(""),
    analyzedAt: bigint("analyzed_at", { mode: "number" }),
    analysisMode: text("analysis_mode").notNull().default("idle"),
    analysisError: text("analysis_error"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("business_profiles_workspace_idx").on(table.workspaceId),
  ],
);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    itemType: text("item_type").notNull().default("市场知识"),
    summary: text("summary").notNull().default(""),
    source: text("source").notNull().default("手动录入"),
    sourceUrl: text("source_url"),
    tagsJson: text("tags_json").notNull().default("[]"),
    status: text("status").notNull().default("待复核"),
    referenceCount: bigint("reference_count", { mode: "number" }).notNull().default(0),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("knowledge_items_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    index("knowledge_items_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("knowledge_items_workspace_type_idx").on(
      table.workspaceId,
      table.itemType,
    ),
  ],
);

export const channelCosts = pgTable(
  "channel_costs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    periodLabel: text("period_label").notNull().default("monthly"),
    periodStart: bigint("period_start", { mode: "number" }).notNull(),
    periodEnd: bigint("period_end", { mode: "number" }).notNull(),
    costAmount: bigint("cost_amount", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    note: text("note").notNull().default(""),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("channel_costs_workspace_period_idx").on(
      table.workspaceId,
      table.periodStart,
    ),
    index("channel_costs_workspace_channel_idx").on(
      table.workspaceId,
      table.channel,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: text("metadata").notNull().default("{}"),
    ipAddress: text("ip_address"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("audit_logs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const customerTags = pgTable(
  "customer_tags",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("customer_tags_customer_name_unique").on(table.customerId, table.name),
    index("customer_tags_workspace_idx").on(table.workspaceId),
  ],
);

export const workspaceAiPolicies = pgTable(
  "workspace_ai_policies",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rotationStrategy: text("rotation_strategy").notNull().default("failover"),
    retryCount: bigint("retry_count", { mode: "number" }).notNull().default(2),
    retryBackoff: text("retry_backoff").notNull().default("exponential"),
    retryDelayMs: bigint("retry_delay_ms", { mode: "number" }).notNull().default(1000),
    cooldownMs: bigint("cooldown_ms", { mode: "number" }).notNull().default(300000),
    failoverEnabled: boolean("failover_enabled").notNull().default(true),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
);
