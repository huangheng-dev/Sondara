import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
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
    totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
    totpVerifiedAt: integer("totp_verified_at"),
    totpRecoveryCodesJson: text("totp_recovery_codes_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("workspaces_owner_idx").on(table.ownerUserId)],
);

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_members_unique").on(table.workspaceId, table.userId),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    lastSeenAt: integer("last_seen_at"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("login_2fa"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("auth_challenges_token_hash_unique").on(table.tokenHash),
    index("auth_challenges_user_idx").on(table.userId),
    index("auth_challenges_expiry_idx").on(table.expiresAt),
  ],
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
    index("password_reset_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    company: text("company").notNull(),
    region: text("region").notNull().default("待补全"),
    industry: text("industry").notNull().default("待补全"),
    score: integer("score").notNull().default(0),
    confidence: integer("confidence").notNull().default(0),
    signal: text("signal").notNull().default("待识别"),
    source: text("source").notNull().default("手动录入"),
    estimatedValue: integer("estimated_value").notNull().default(0),
    size: text("size").notNull().default("待补全"),
    stage: text("stage").notNull().default("待补全"),
    contacts: integer("contacts").notNull().default(0),
    validContacts: integer("valid_contacts").notNull().default(0),
    interaction: text("interaction").notNull().default("尚无互动"),
    nextAction: text("next_action").notNull().default("补全企业档案"),
    dueAt: integer("due_at"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const tasks = sqliteTable(
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
    dueAt: integer("due_at"),
    dueLabel: text("due_label").notNull().default("待安排"),
    company: text("company").notNull().default("个人事项"),
    nextAction: text("next_action").notNull().default("按计划执行"),
    impact: text("impact").notNull().default("待评估"),
    source: text("source").notNull().default("客户"),
    status: text("status").notNull().default("open"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("tasks_workspace_status_idx").on(table.workspaceId, table.status),
    index("tasks_workspace_due_idx").on(table.workspaceId, table.dueAt),
    index("tasks_customer_idx").on(table.customerId),
  ],
);

export const deals = sqliteTable(
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
    probability: integer("probability").notNull().default(20),
    valueAmount: integer("value_amount").notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    ownerLabel: text("owner_label").notNull().default("我"),
    nextAction: text("next_action").notNull().default("确认需求和决策链"),
    expectedCloseAt: integer("expected_close_at"),
    risk: text("risk").notNull().default("等待首次复核"),
    source: text("source").notNull().default("商机跟进"),
    stageEnteredAt: integer("stage_entered_at").notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const contentAssets = sqliteTable(
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
    currentVersion: integer("current_version").notNull().default(1),
    qualityScore: integer("quality_score").notNull().default(0),
    customerRelevance: integer("customer_relevance").notNull().default(0),
    evidenceScore: integer("evidence_score").notNull().default(0),
    actionClarity: integer("action_clarity").notNull().default(0),
    linkedCampaignIdsJson: text("linked_campaign_ids_json")
      .notNull()
      .default("[]"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: integer("published_at"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const contentVersions = sqliteTable(
  "content_versions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contentAssetId: text("content_asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    changeNote: text("change_note").notNull().default("保存内容"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("content_versions_asset_version_unique").on(
      table.contentAssetId,
      table.versionNumber,
    ),
    index("content_versions_workspace_idx").on(table.workspaceId),
  ],
);

export const contentQualityChecks = sqliteTable(
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
    overallScore: integer("overall_score").notNull(),
    customerRelevance: integer("customer_relevance").notNull(),
    evidenceScore: integer("evidence_score").notNull(),
    actionClarity: integer("action_clarity").notNull(),
    status: text("status").notNull().default("completed"),
    findingsJson: text("findings_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("content_quality_checks_asset_idx").on(
      table.contentAssetId,
      table.createdAt,
    ),
    index("content_quality_checks_workspace_idx").on(table.workspaceId),
  ],
);

export const contentGenerationRuns = sqliteTable(
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
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("content_generation_runs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("content_generation_runs_asset_idx").on(table.contentAssetId),
  ],
);

export const campaigns = sqliteTable(
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
    progress: integer("progress").notNull().default(0),
    sentCount: integer("sent_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    opportunityCount: integer("opportunity_count").notNull().default(0),
    revenueAmount: integer("revenue_amount").notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    nextAction: text("next_action")
      .notNull()
      .default("完善受众、内容与发送设置"),
    startAt: integer("start_at"),
    nextRunAt: integer("next_run_at"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const campaignSteps = sqliteTable(
  "campaign_steps",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(1),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("邮件"),
    contentAssetId: text("content_asset_id").references(
      () => contentAssets.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("scheduled"),
    scheduledAt: integer("scheduled_at"),
    executedAt: integer("executed_at"),
    recipientCount: integer("recipient_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const campaignAudienceMembers = sqliteTable(
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
    lastEventAt: integer("last_event_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const campaignContentLinks = sqliteTable(
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
    position: integer("position").notNull().default(1),
    purpose: text("purpose").notNull().default("触达内容"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("campaign_content_campaign_asset_unique").on(
      table.campaignId,
      table.contentAssetId,
    ),
    index("campaign_content_workspace_idx").on(table.workspaceId),
  ],
);

export const campaignExecutionEvents = sqliteTable(
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
    recipientCount: integer("recipient_count").notNull().default(0),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("campaign_events_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
    index("campaign_events_workspace_idx").on(table.workspaceId),
  ],
);

export const inboxContacts = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const messageThreads = sqliteTable(
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
    lastMessageAt: integer("last_message_at").notNull(),
    lastInboundAt: integer("last_inbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const messageEntries = sqliteTable(
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
    confirmedAt: integer("confirmed_at"),
    sentAt: integer("sent_at"),
    deliveredAt: integer("delivered_at"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const messageThreadReads = sqliteTable(
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
    lastReadAt: integer("last_read_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("message_thread_reads_thread_user_unique").on(
      table.threadId,
      table.userId,
    ),
    index("message_thread_reads_workspace_idx").on(table.workspaceId),
  ],
);

export const outboundChannelConnections = sqliteTable(
  "outbound_channel_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("smtp"),
    host: text("host").notNull(),
    port: integer("port").notNull().default(587),
    secure: integer("secure", { mode: "boolean" }).notNull().default(false),
    username: text("username").notNull(),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    priority: integer("priority").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("untested"),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    secretEnding: text("secret_ending").notNull(),
    webhookSecretCiphertext: text("webhook_secret_ciphertext"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    webhookSecretEnding: text("webhook_secret_ending"),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    lastTestedAt: integer("last_tested_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const outboxJobs = sqliteTable(
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
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: integer("scheduled_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    lastError: text("last_error"),
    externalId: text("external_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const messageDeliveryEvents = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("message_delivery_events_job_created_idx").on(
      table.outboxJobId,
      table.createdAt,
    ),
    index("message_delivery_events_workspace_idx").on(table.workspaceId),
  ],
);

export const channelWebhookEvents = sqliteTable(
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
    occurredAt: integer("occurred_at").notNull(),
    processingStatus: text("processing_status").notNull().default("pending"),
    processingError: text("processing_error"),
    payloadJson: text("payload_json").notNull().default("{}"),
    processedAt: integer("processed_at"),
    createdAt: integer("created_at").notNull(),
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

export const contactSuppressions = sqliteTable(
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
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    lastEventId: text("last_event_id").references(
      () => channelWebhookEvents.id,
      {
        onDelete: "set null",
      },
    ),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const radarTasks = sqliteTable(
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
    candidateLimit: integer("candidate_limit").notNull().default(100),
    knowledgeScope: text("knowledge_scope").notNull().default("全部资料"),
    targetRegion: text("target_region").notNull().default("全球"),
    researchLanguage: text("research_language").notNull().default("自动识别"),
    inputSource: text("input_source").notNull().default("AI 获客"),
    seedUrlsJson: text("seed_urls_json").notNull().default("[]"),
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    currentStage: text("current_stage").notNull().default("等待执行"),
    candidatesFound: integer("candidates_found").notNull().default(0),
    highMatchCount: integer("high_match_count").notNull().default(0),
    lastError: text("last_error"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const radarCandidates = sqliteTable(
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
    score: integer("score").notNull().default(0),
    signal: text("signal").notNull().default("待识别"),
    source: text("source").notNull().default("数据源"),
    estimatedValue: integer("estimated_value").notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    confidence: integer("confidence").notNull().default(0),
    status: text("status").notNull().default("candidate"),
    reason: text("reason").notNull().default("等待补充研究结论"),
    dimensionsJson: text("dimensions_json").notNull().default("[]"),
    committeeJson: text("committee_json").notNull().default("[]"),
    relationshipsJson: text("relationships_json").notNull().default("[]"),
    discoveredAt: integer("discovered_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const candidateEvidence = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("candidate_evidence_candidate_idx").on(table.candidateId),
    index("candidate_evidence_workspace_idx").on(table.workspaceId),
  ],
);

export const candidateContacts = sqliteTable(
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
    confidence: integer("confidence").notNull().default(50),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const radarQueueItems = sqliteTable(
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
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    scheduledAt: integer("scheduled_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    lastError: text("last_error"),
    payload: text("payload").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const radarJobEvents = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("radar_job_events_task_created_idx").on(
      table.radarTaskId,
      table.createdAt,
    ),
    index("radar_job_events_workspace_idx").on(table.workspaceId),
  ],
);

export const aiServices = sqliteTable(
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
    priority: integer("priority").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("untested"),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    lastTestedAt: integer("last_tested_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const aiServiceKeys = sqliteTable(
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
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    cooldownUntil: integer("cooldown_until"),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("ai_service_keys_service_idx").on(table.serviceId, table.enabled),
    index("ai_service_keys_workspace_idx").on(table.workspaceId),
  ],
);

export const integrationConnections = sqliteTable(
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
    priority: integer("priority").notNull().default(1),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("untested"),
    secretCiphertext: text("secret_ciphertext"),
    secretIv: text("secret_iv"),
    secretTag: text("secret_tag"),
    secretEnding: text("secret_ending"),
    configJson: text("config_json").notNull().default("{}"),
    lastLatencyMs: integer("last_latency_ms"),
    lastError: text("last_error"),
    lastTestedAt: integer("last_tested_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const businessProfiles = sqliteTable(
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
    analyzedAt: integer("analyzed_at"),
    analysisMode: text("analysis_mode").notNull().default("idle"),
    analysisError: text("analysis_error"),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("business_profiles_workspace_idx").on(table.workspaceId),
  ],
);

export const knowledgeItems = sqliteTable(
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
    referenceCount: integer("reference_count").notNull().default(0),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const channelCosts = sqliteTable(
  "channel_costs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    periodLabel: text("period_label").notNull().default("monthly"),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    costAmount: integer("cost_amount").notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    note: text("note").notNull().default(""),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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

export const auditLogs = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("audit_logs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const customerTags = sqliteTable(
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("customer_tags_customer_name_unique").on(table.customerId, table.name),
    index("customer_tags_workspace_idx").on(table.workspaceId),
  ],
);

export const workspaceAiPolicies = sqliteTable(
  "workspace_ai_policies",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rotationStrategy: text("rotation_strategy").notNull().default("failover"),
    retryCount: integer("retry_count").notNull().default(2),
    retryBackoff: text("retry_backoff").notNull().default("exponential"),
    retryDelayMs: integer("retry_delay_ms").notNull().default(1000),
    cooldownMs: integer("cooldown_ms").notNull().default(300000),
    failoverEnabled: integer("failover_enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at").notNull(),
  },
);
