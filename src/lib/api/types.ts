export type AuthSession = {
  user: { id: string; email: string; displayName: string; locale?: string; timezone?: string; currency?: string };
  workspace: { id: string; name: string; role: string };
};

export type AuthTwoFactorRequired = {
  twoFactorRequired: true;
  maskedEmail: string;
};

export type AuthLoginResult = AuthSession | AuthTwoFactorRequired;

export type TwoFactorSetup = {
  enabled: false;
  secret: string;
  otpauth: string;
  accountName: string;
};

export type TwoFactorStatus = {
  enabled: boolean;
  verifiedAt: number | null;
};

export type CustomerApiRecord = {
  id: string;
  workspaceId: string;
  company: string;
  region: string;
  industry: string;
  score: number;
  confidence: number;
  signal: string;
  source: string;
  estimatedValue: number;
  size: string;
  stage: string;
  contacts: number;
  validContacts: number;
  interaction: string;
  nextAction: string;
  dueAt: number | null;
  ownerUserId: string | null;
  ownerName?: string;
  tags?: Array<{ id: string; name: string; color: string }>;
  scoreOverride?: number | null;
  scoreOverrideReason?: string | null;
  scoreOverrideByUserId?: string | null;
  scoreOverrideByName?: string | null;
  scoreOverrideAt?: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CustomerApiInput = {
  company: string;
  region?: string;
  industry?: string;
  score?: number;
  confidence?: number;
  signal?: string;
  source?: string;
  estimatedValue?: number;
  size?: string;
  stage?: string;
  contacts?: number;
  validContacts?: number;
  interaction?: string;
  nextAction?: string;
  dueAt?: number | null;
  ownerUserId?: string | null;
};
export type CustomerImportRow = CustomerApiInput & { contactName?: string; contactTitle?: string; contactEmail?: string; contactPhone?: string; website?: string };
export type CustomerImportResult = { total: number; created: number; duplicates: number; contactsCreated: number; invalid: number };
export type CustomerImportHistory = { id: string; createdAt: number; sourceName: string; sourceType: string; sourceUrl: string | null; total: number; created: number; duplicates: number; contactsCreated: number };
export type LeadSourceConnection = { id: string; provider: 'linkedin-lead-gen' | 'meta-lead-ads'; name: string; accountRef: string | null; formRef: string | null; clientId: string | null; enabled: boolean; status: string; hasAccessToken: boolean; accessTokenEnding: string | null; lastError: string | null; lastSyncedAt: number | null; createdAt: number; updatedAt: number; webhookPath: string };
export type LeadSourceEvent = { id: string; workspaceId: string; connectionId: string; providerEventId: string; processingStatus: string; processingError: string | null; receivedAt: number; processedAt: number | null; payload: Record<string, unknown> };

export type CustomerListResponse = {
  items: CustomerApiRecord[];
  page: number;
  pageSize: number;
  total: number;
};

export type TaskApiRecord = {
  id: string;
  workspaceId: string;
  customerId: string | null;
  title: string;
  priority: "高" | "中" | "低";
  dueAt: number | null;
  dueLabel: string;
  company: string;
  nextAction: string;
  impact: string;
  source: string;
  status: "open" | "completed";
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TaskApiInput = {
  customerId?: string | null;
  title: string;
  priority?: "高" | "中" | "低";
  dueAt?: number | null;
  dueLabel?: string;
  company?: string;
  nextAction?: string;
  impact?: string;
  source?: string;
};

export type DealApiRecord = {
  id: string;
  workspaceId: string;
  customerId: string | null;
  company: string;
  stage: "线索确认" | "需求确认" | "方案评估" | "商务谈判" | "赢单";
  probability: number;
  valueAmount: number;
  currency: "CNY" | "EUR" | "USD";
  ownerLabel: string;
  nextAction: string;
  expectedCloseAt: number | null;
  risk: string;
  source: string;
  stageEnteredAt: number;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type DealApiInput = {
  customerId?: string | null;
  company: string;
  stage?: DealApiRecord["stage"];
  probability?: number;
  valueAmount?: number;
  currency?: DealApiRecord["currency"];
  ownerLabel?: string;
  nextAction?: string;
  expectedCloseAt?: number | null;
  risk?: string;
  source?: string;
};

export type RadarTaskStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type RadarCandidateStatus =
  | "candidate"
  | "review"
  | "saved"
  | "rejected"
  | "archived";

export type RadarTaskApiRecord = {
  id: string;
  workspaceId: string;
  name: string;
  icp: string;
  mode: string;
  depth: string;
  candidateLimit: number;
  knowledgeScope: string;
  targetRegion: string;
  researchLanguage: string;
  inputSource: string;
  seedUrls: string[];
  status: RadarTaskStatus;
  progress: number;
  currentStage: string;
  candidatesFound: number;
  highMatchCount: number;
  lastError: string | null;
  ownerUserId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type RadarTaskApiInput = {
  name: string;
  icp: string;
  mode?: string;
  depth?: string;
  candidateLimit?: number;
  knowledgeScope?: string;
  targetRegion?: string;
  researchLanguage?: string;
  inputSource?: string;
  seedUrls?: string[];
};

export type RadarCandidateApiRecord = {
  id: string;
  workspaceId: string;
  radarTaskId: string | null;
  company: string;
  region: string;
  industry: string;
  size: string;
  score: number;
  signal: string;
  source: string;
  estimatedValue: number;
  currency: "CNY" | "EUR" | "USD";
  confidence: number;
  status: RadarCandidateStatus;
  reason: string;
  dimensions: { label: string; score: number }[];
  evidence: {
    id?: string;
    title: string;
    source: string;
    time: string;
    strength: "强" | "中" | "弱";
    sourceUrl?: string | null;
  }[];
  committee: {
    name: string;
    role: string;
    influence: string;
    contact: string;
  }[];
  contacts: {
    id: string;
    name: string;
    role: string;
    email: string | null;
    phone: string | null;
    socialUrl: string | null;
    sourceUrl: string;
    verificationStatus: "verified" | "public" | "needs_review";
    confidence: number;
  }[];
  relationships: { label: string; value: string }[];
  discoveredAt: number;
  updatedAt: number;
};

export type RadarCandidateApiInput = Omit<
  RadarCandidateApiRecord,
  "id" | "workspaceId" | "discoveredAt" | "updatedAt" | "evidence" | "contacts"
> & {
  evidence: Omit<RadarCandidateApiRecord["evidence"][number], "id">[];
};

export type RadarQueueApiRecord = {
  id: string;
  workspaceId: string;
  radarTaskId: string;
  jobType: string;
  status: RadarTaskStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastError: string | null;
  payload: string;
  createdAt: number;
  updatedAt: number;
};

export type RadarJobEventApiRecord = {
  id: string;
  workspaceId: string;
  radarTaskId: string;
  queueItemId: string | null;
  level: "info" | "error";
  eventType: string;
  message: string;
  metadata: string;
  createdAt: number;
};

export type AiServiceApiRecord = {
  id: string;
  workspaceId: string;
  name: string;
  provider: "deepseek" | "dashscope" | "openai-compatible";
  model: string;
  endpoint: string;
  priority: number;
  enabled: boolean;
  status: "untested" | "available" | "error";
  lastLatencyMs: number | null;
  lastError: string | null;
  lastTestedAt: number | null;
  keyCount: number;
  createdAt: number;
  updatedAt: number;
};

export type AiServiceKeyApiRecord = {
  id: string;
  serviceId: string;
  name: string;
  ending: string;
  enabled: boolean;
  failureCount: number;
  cooldownUntil: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type IntegrationConnectionApiRecord = {
  id: string;
  workspaceId: string;
  category: "search" | "map";
  name: string;
  provider: "brave" | "tavily" | "serpapi" | "google" | "bing" | "searxng" | "google-places";
  endpoint: string;
  priority: number;
  enabled: boolean;
  status: "untested" | "available" | "error";
  secretEnding: string | null;
  hasSecret: boolean;
  config: { resultLimit?: number };
  lastLatencyMs: number | null;
  lastError: string | null;
  lastTestedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type OutboundConnectionApiRecord = {
  id: string;
  workspaceId: string;
  name: string;
  provider: "smtp" | "sendgrid" | "mailgun" | "webhook" | "whatsapp-cloud";
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  imapEnabled: boolean;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string | null;
  hasImapSecret: boolean;
  imapSecretEnding: string | null;
  priority: number;
  enabled: boolean;
  status: "untested" | "available" | "error";
  hasSecret: boolean;
  secretEnding: string;
  hasWebhookSecret: boolean;
  webhookSecretEnding: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  lastTestedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ContactSuppressionApiRecord = {
  id: string;
  workspaceId: string;
  channel: "email";
  destination: string;
  reason: string;
  source: string;
  active: boolean;
  lastEventId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChannelWebhookEventApiRecord = {
  id: string;
  workspaceId: string;
  connectionId: string;
  providerEventId: string;
  eventType:
    | "delivered"
    | "bounced"
    | "complained"
    | "unsubscribed"
    | "inbound_reply";
  externalMessageId: string | null;
  sender: string | null;
  recipient: string | null;
  reason: string | null;
  occurredAt: number;
  processingStatus: "pending" | "processed" | "unlinked" | "failed";
  processingError: string | null;
  processedAt: number | null;
  createdAt: number;
};

export type OutboxJobApiRecord = {
  id: string;
  workspaceId: string;
  messageId: string;
  threadId: string;
  channel: string;
  connectionId: string | null;
  status:
    | "awaiting_configuration"
    | "queued"
    | "processing"
    | "sent"
    | "failed"
    | "cancelled";
  attempts: number;
  maxAttempts: number;
  scheduledAt: number;
  completedAt: number | null;
  lastError: string | null;
  externalId: string | null;
  message: { id: string; body: string; status: string };
  thread: { id: string; subject: string };
  contact: { name: string; company: string; email: string | null };
  connection: OutboundConnectionApiRecord | null;
  createdAt: number;
  updatedAt: number;
};

export type ContentAssetStatus =
  | "草稿"
  | "待审核"
  | "已发布"
  | "可复用"
  | "已归档";
export type ContentAssetApiRecord = {
  id: string;
  workspaceId: string;
  title: string;
  contentType: string;
  channel: string;
  status: ContentAssetStatus;
  language: string;
  body: string;
  summary: string;
  targetMarket: string;
  customerRole: string;
  buyingStage: string;
  customerSignal: string;
  sourceMethod: string;
  currentVersion: number;
  qualityScore: number;
  customerRelevance: number;
  evidenceScore: number;
  actionClarity: number;
  linkedCampaignIds: string[];
  ownerUserId: string | null;
  publishedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ContentAssetApiInput = {
  title: string;
  contentType?: string;
  channel?: string;
  status?: ContentAssetStatus;
  language?: string;
  body?: string;
  summary?: string;
  targetMarket?: string;
  customerRole?: string;
  buyingStage?: string;
  customerSignal?: string;
  sourceMethod?: string;
};

export type ContentQualityResult = {
  overallScore: number;
  customerRelevance: number;
  evidenceScore: number;
  actionClarity: number;
  findings: string[];
};

export type ContentGenerationResult = {
  id: string;
  assetId: string | null;
  title: string;
  body: string;
  generationMode: "ai" | "local-rules";
  serviceName: string | null;
  model: string | null;
  quality: ContentQualityResult;
  fallbackReason: string | null;
};

export type ContentAnalysisResult = {
  quality: ContentQualityResult;
  tips: { label: string; tone: "good" | "warning"; detail: string }[];
};

export type BusinessProfileApiRecord = {
  id: string;
  workspaceId: string;
  company: string;
  website: string;
  products: string;
  regions: string;
  customers: string;
  exclusions: string;
  selectedMarket: string;
  analysisStatus: "idle" | "running" | "complete";
  analysisSummary: string;
  analysisMode: "idle" | "ai" | "local-rules";
  analysisError: string | null;
  analyzedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type BusinessProfileApiInput = {
  company?: string;
  website?: string;
  products?: string;
  regions?: string;
  customers?: string;
  exclusions?: string;
  selectedMarket?: string;
};

export type IcpAnalysisResult = {
  summary: string;
  signals: string[];
  recommendedMarkets: { name: string; reason: string }[];
  criteria: string[];
};

export type KnowledgeItemType =
  | "产品与方案"
  | "产品知识"
  | "应用知识"
  | "合规知识"
  | "公司资料"
  | "客户案例"
  | "客户判断规则"
  | "市场知识"
  | "竞争信息";
export type KnowledgeItemStatus = "已启用" | "待复核" | "已停用";

export type KnowledgeItemApiRecord = {
  id: string;
  workspaceId: string;
  title: string;
  itemType: KnowledgeItemType;
  summary: string;
  source: string;
  sourceUrl: string | null;
  tags: string[];
  status: KnowledgeItemStatus;
  referenceCount: number;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeItemApiInput = {
  title: string;
  itemType?: KnowledgeItemType;
  summary?: string;
  source?: string;
  sourceUrl?: string;
  tags?: string[];
  status?: KnowledgeItemStatus;
};

export type CampaignStatus = "草稿" | "运行中" | "已暂停" | "已完成" | "已归档";
export type CampaignStepApiRecord = {
  id: string;
  campaignId: string;
  position: number;
  name: string;
  channel: string;
  contentAssetId: string | null;
  status: "draft" | "scheduled" | "running" | "completed" | "cancelled";
  scheduledAt: number | null;
  executedAt: number | null;
  recipientCount: number;
  replyCount: number;
  config: { note?: string; stopRule?: string };
  createdAt: number;
  updatedAt: number;
};

export type CampaignApiRecord = {
  id: string;
  workspaceId: string;
  name: string;
  market: string;
  audienceLabel: string;
  audienceCount: number;
  status: CampaignStatus;
  channel: string;
  stopRule: string;
  timezone: string;
  progress: number;
  sentCount: number;
  replyCount: number;
  opportunityCount: number;
  revenueAmount: number;
  currency: "CNY" | "EUR" | "USD";
  nextAction: string;
  startAt: number | null;
  nextRunAt: number | null;
  completedAt: number | null;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
  replyRate: number | null;
  steps: CampaignStepApiRecord[];
  contentIds: string[];
  contentItems: {
    id: string;
    contentAssetId: string;
    position: number;
    purpose: string;
    title: string;
    contentType: string;
    status: string;
  }[];
  nextStep: {
    id: string;
    name: string;
    scheduledAt: number | null;
    status: string;
  } | null;
};

export type CampaignApiInput = {
  name: string;
  market?: string;
  audienceLabel?: string;
  status?: CampaignStatus;
  channel?: string;
  stopRule?: string;
  timezone?: string;
  startAt?: number | null;
  nextRunAt?: number | null;
  nextAction?: string;
  contentAssetId?: string | null;
  audienceCustomerIds?: string[];
};

export type InboxContactApiRecord = {
  id: string;
  workspaceId: string;
  customerId: string | null;
  name: string;
  company: string;
  jobTitle: string;
  region: string;
  source: string;
  primaryChannel: string;
  email: string | null;
  phone: string | null;
  externalRef: string | null;
  whatsappOptedInAt: number | null;
  whatsappOptInSource: string | null;
  verificationStatus: "verified" | "unverified" | "invalid";
  verifiedAt: number | null;
  verificationSource: string | null;
  createdAt: number;
  updatedAt: number;
};

export type InboxThreadApiRecord = {
  id: string;
  workspaceId: string;
  contactId: string;
  customerId: string | null;
  campaignId: string | null;
  subject: string;
  channel: string;
  intent: "高意向" | "待判断" | "待跟进";
  status: "open" | "archived";
  assigneeUserId: string | null;
  lastMessagePreview: string;
  lastMessageAt: number;
  lastInboundAt: number | null;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
  contact: InboxContactApiRecord;
};

export type InboxMessageApiRecord = {
  id: string;
  workspaceId: string;
  threadId: string;
  direction: "inbound" | "outbound" | "system";
  messageType: string;
  body: string;
  status: "received" | "draft" | "confirmed" | "sent" | "delivered" | "failed";
  channel: string;
  senderLabel: string;
  externalId: string | null;
  confirmedByUserId: string | null;
  confirmedAt: number | null;
  sentAt: number | null;
  deliveredAt: number | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type AiPolicyApiRecord = {
  workspaceId: string;
  rotationStrategy: "failover" | "round-robin" | "least-used";
  retryCount: number;
  retryBackoff: "exponential" | "fixed";
  retryDelayMs: number;
  cooldownMs: number;
  failoverEnabled: boolean;
  updatedAt: number | null;
};

export type AdminMemberApiRecord = {
  id: string;
  displayName: string;
  email: string;
  status: "active" | "disabled";
  role: "owner" | "admin" | "member" | "viewer";
  roleLabel: string;
  joinedAt: number;
  createdAt: number;
  lastSeenAt: number | null;
  source: string;
};

export type AdminRoleApiRecord = {
  role: "owner" | "admin" | "member" | "viewer";
  name: string;
  members: number;
  note: string;
  permissions: string[];
};

export type AdminAuditLogApiRecord = {
  id: string;
  actorUserId: string | null;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string;
  createdAt: number;
  result: "success";
};
export type AdminInvitationApiRecord = { id: string; email: string; displayName?: string; role: "admin" | "member" | "viewer"; expiresAt: number; acceptedAt: number | null; revokedAt: number | null; createdAt: number; inviteUrl?: string };
export type ApprovalApiRecord = { id: string; workspaceId: string; entityType: string; entityId: string; action: string; requestedByUserId: string; requester?: string; status: "pending" | "approved" | "rejected" | "cancelled"; note?: string | null; createdAt: number; updatedAt: number; reviewedAt?: number | null };

export type AttributionPeriod = "month" | "quarter" | "year";
export type AttributionBottleneck =
  | "获客质量" | "有效触达" | "客户回复" | "商机创建" | "成交推进";

export type AttributionChannel = {
  name: string;
  color: string;
  discovered: number;
  qualified: number;
  contacted: number;
  replies: number;
  deals: number;
  won: number;
  revenue: number;
  cost: number;
  conversionRate: number;
  bottleneck: AttributionBottleneck;
  action: string;
  roi: number | null;
  costPerWon: number | null;
  currency: string;
};

export type AttributionFunnelStage = {
  key: string;
  label: string;
  value: number;
};

export type AttributionOverview = {
  period: { label: AttributionPeriod; start: number; end: number };
  funnel: AttributionFunnelStage[];
  channels: AttributionChannel[];
  totals: { revenue: number; cost: number; currency: string; roi: number | null };
};

export type ChannelCostApiRecord = {
  id: string;
  workspaceId: string;
  channel: string;
  periodLabel: string;
  periodStart: number;
  periodEnd: number;
  costAmount: number;
  currency: string;
  note: string;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ChannelCostApiInput = {
  channel: string;
  periodLabel?: string;
  periodStart: number;
  periodEnd: number;
  costAmount: number;
  currency?: string;
  note?: string;
};
