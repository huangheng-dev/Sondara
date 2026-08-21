type ApiErrorBody = { error?: string; message?: string };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? "请求处理失败。");
    this.name = "ApiError";
    this.status = status;
    this.code = body.error;
  }
}

export type AuthSession = {
  user: { id: string; email: string; displayName: string; locale?: string; timezone?: string; currency?: string };
  workspace: { id: string; name: string; role: string };
};

type AuthTwoFactorRequired = {
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
type CampaignStepApiRecord = {
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

type ListResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const authApi = {
  login: (input: { email: string; password: string; remember: boolean }) =>
    request<AuthLoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  register: (input: { displayName: string; email: string; password: string }) =>
    request<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  session: () => request<AuthSession>("/auth/session"),
  forgotPassword: (email: string) => request<{ ok: boolean; delivery: "email" | "manual" | "accepted"; resetUrl?: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (input: { token: string; newPassword: string }) => request<{ ok: boolean }>("/auth/reset-password", { method: "POST", body: JSON.stringify(input) }),
  updateProfile: (input: { displayName: string; email: string; locale: "zh-CN" | "en"; timezone: string; currency: "CNY" | "EUR" | "USD"; businessName: string }) => request<AuthSession>("/auth/profile", { method: "PATCH", body: JSON.stringify(input) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listSessions: () => request<{ items: Array<{ id: string; current: boolean; userAgent: string | null; ipAddress: string | null; lastSeenAt: number | null; createdAt: number; expiresAt: number }> }>("/auth/sessions"),
  listWorkspaceMembers: () => request<{ items: Array<{ id: string; displayName: string; email: string; role: string }> }>("/auth/workspace-members"),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeOtherSessions: () => request<{ removed: number }>("/auth/sessions", { method: "DELETE" }),
  deleteAccount: (input: { currentPassword: string; confirmation: "DELETE" }) => request<void>("/auth/account", { method: "DELETE", body: JSON.stringify(input) }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  twoFactorStatus: () => request<TwoFactorStatus>("/auth/2fa/status"),
  setup2fa: () =>
    request<TwoFactorSetup | TwoFactorStatus>("/auth/2fa/setup", { method: "POST" }),
  enable2fa: (input: {
    currentPassword: string;
    secret: string;
    code: string;
  }) =>
    request<{
      enabled: true;
      verifiedAt: number;
      recoveryCodes: string[];
    }>("/auth/2fa/enable", { method: "POST", body: JSON.stringify(input) }),
  disable2fa: (input: { currentPassword: string; code: string }) =>
    request<{ enabled: boolean }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  verify2fa: (input: { code: string; remember: boolean }) =>
    request<AuthSession & { usedRecovery?: boolean }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify(input),
    }),
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

export const adminApi = {
  listMembers: () => request<{ items: AdminMemberApiRecord[] }>("/admin/members"),
  createMember: (input: { displayName: string; email: string; password: string; role: "admin" | "member" | "viewer" }) =>
    request<AdminMemberApiRecord>("/admin/members", { method: "POST", body: JSON.stringify(input) }),
  updateMember: (id: string, input: { role?: "admin" | "member" | "viewer"; status?: "active" | "disabled" }) =>
    request<AdminMemberApiRecord>(`/admin/members/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  removeMember: (id: string) => request<void>(`/admin/members/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listRoles: () => request<{ items: AdminRoleApiRecord[] }>("/admin/roles"),
  listAuditLogs: () => request<{ items: AdminAuditLogApiRecord[] }>("/admin/audit-logs"),
  listInvitations: () => request<{ items: AdminInvitationApiRecord[] }>("/admin/invitations"),
  createInvitation: (input: { displayName: string; email: string; role: "admin" | "member" | "viewer" }) => request<AdminInvitationApiRecord>("/admin/invitations", { method: "POST", body: JSON.stringify(input) }),
  revokeInvitation: (id: string) => request<{ ok: boolean }>(`/admin/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
};

export const approvalApi = {
  list: () => request<{ items: ApprovalApiRecord[] }>("/approvals"),
  create: (input: { entityType: string; entityId: string; action: string; note?: string }) => request<ApprovalApiRecord>("/approvals", { method: "POST", body: JSON.stringify(input) }),
  review: (id: string, input: { status: "approved" | "rejected" | "cancelled"; note?: string }) => request<ApprovalApiRecord>(`/approvals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
};

export const customerApi = {
  list: (
    params: {
      q?: string;
      region?: string;
      stage?: string;
      minScore?: number;
      includeArchived?: boolean;
      archivedOnly?: boolean;
      page?: number;
      pageSize?: number;
      sort?:
        | "updated_desc"
        | "updated_asc"
        | "score_desc"
        | "score_asc"
        | "company_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<CustomerListResponse>(
      `/customers${query.size ? `?${query}` : ""}`,
    );
  },
  create: (input: CustomerApiInput) =>
    request<CustomerApiRecord>("/customers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  import: (input: { sourceName: string; sourceType: "行业目录" | "展会名单" | "历史客户" | "其他"; sourceUrl?: string; rows: CustomerImportRow[] }) =>
    request<CustomerImportResult>("/customers/import", { method: "POST", body: JSON.stringify(input) }),
  listImports: () => request<{ items: CustomerImportHistory[] }>("/customers/imports"),
  mergePreview: (primaryCustomerId: string, duplicateCustomerId: string) => request<{ primary: CustomerApiRecord; duplicate: CustomerApiRecord; contacts: { primary: number; duplicate: number; duplicateNames: string[] }; transfers: { tasks: number; deals: number; threads: number; campaignMembers: number } }>("/customers/merge-preview", { method: "POST", body: JSON.stringify({ primaryCustomerId, duplicateCustomerId }) }),
  merge: (primaryCustomerId: string, duplicateCustomerId: string) => request<{ primaryCustomerId: string; archivedCustomerId: string; transferredContacts: number }>("/customers/merge", { method: "POST", body: JSON.stringify({ primaryCustomerId, duplicateCustomerId }) }),
  update: (id: string, input: Partial<CustomerApiInput>) =>
    request<CustomerApiRecord>(`/customers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/customers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  archive: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/customers/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  addTags: (customerIds: string[], name: string, color: "blue" | "green" | "orange" | "gray") =>
    request<{ updated: number }>("/customers/tags/bulk", { method: "POST", body: JSON.stringify({ customerIds, name, color }) }),
  listContacts: (customerId: string) =>
    request<{ items: InboxContactApiRecord[] }>(`/customers/${encodeURIComponent(customerId)}/contacts`),
  addContact: (customerId: string, input: { name: string; jobTitle?: string; email?: string | null; phone?: string | null; primaryChannel?: string }) =>
    request<InboxContactApiRecord>(`/customers/${encodeURIComponent(customerId)}/contacts`, { method: "POST", body: JSON.stringify(input) }),
  setWhatsappOptIn: (customerId: string, contactId: string, optedIn: boolean, source = "人工确认") => request<InboxContactApiRecord>(`/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}/whatsapp-opt-in`, { method: "POST", body: JSON.stringify({ optedIn, source }) }),
};

export const leadSourceApi = {
  listConnections: () => request<{ items: LeadSourceConnection[] }>('/lead-sources/connections'),
  createConnection: (input: { name: string; provider: 'linkedin-lead-gen' | 'meta-lead-ads'; accountRef?: string; formRef?: string; clientId?: string; accessToken?: string; enabled?: boolean }) => request<LeadSourceConnection & { webhookUrl: string; webhookToken: string }>('/lead-sources/connections', { method: 'POST', body: JSON.stringify(input) }),
  updateConnection: (id: string, input: Partial<{ name: string; provider: 'linkedin-lead-gen' | 'meta-lead-ads'; accountRef: string; formRef: string; clientId: string; accessToken: string; enabled: boolean }>) => request<LeadSourceConnection>(`/lead-sources/connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  regenerateWebhook: (id: string) => request<{ webhookUrl: string; webhookToken: string }>(`/lead-sources/connections/${encodeURIComponent(id)}/regenerate-webhook`, { method: 'POST' }),
  listEvents: () => request<{ items: LeadSourceEvent[] }>('/lead-sources/events'),
};

export const taskApi = {
  list: (
    params: {
      q?: string;
      status?: "open" | "completed";
      page?: number;
      pageSize?: number;
      sort?: "created_desc" | "due_asc" | "priority_desc";
      includeArchived?: boolean;
      archivedOnly?: boolean;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<ListResponse<TaskApiRecord>>(
      `/tasks${query.size ? `?${query}` : ""}`,
    );
  },
  create: (input: TaskApiInput) =>
    request<TaskApiRecord>("/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<TaskApiInput> & { status?: "open" | "completed" },
  ) =>
    request<TaskApiRecord>(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  archive: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/tasks/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
};

export const dealApi = {
  list: (
    params: {
      q?: string;
      stage?: DealApiRecord["stage"];
      page?: number;
      pageSize?: number;
      sort?: "updated_desc" | "value_desc" | "probability_desc" | "close_asc";
      includeArchived?: boolean;
      archivedOnly?: boolean;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<ListResponse<DealApiRecord>>(
      `/deals${query.size ? `?${query}` : ""}`,
    );
  },
  create: (input: DealApiInput) =>
    request<DealApiRecord>("/deals", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<DealApiInput>) =>
    request<DealApiRecord>(`/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  archive: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/deals/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
};

export const radarApi = {
  listTasks: (
    params: { status?: RadarTaskStatus; page?: number; pageSize?: number } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<ListResponse<RadarTaskApiRecord>>(
      `/radar/tasks${query.size ? `?${query}` : ""}`,
    );
  },
  createTask: (input: RadarTaskApiInput) =>
    request<RadarTaskApiRecord & { queueItem: RadarQueueApiRecord }>(
      "/radar/tasks",
      { method: "POST", body: JSON.stringify(input) },
    ),
  taskAction: (id: string, action: "pause" | "resume" | "cancel" | "retry") =>
    request<RadarTaskApiRecord>(`/radar/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),
  listTaskEvents: (id: string) =>
    request<{ items: RadarJobEventApiRecord[]; total: number }>(
      `/radar/tasks/${encodeURIComponent(id)}/events`,
    ),
  listCandidates: (
    params: {
      q?: string;
      status?: RadarCandidateStatus;
      taskId?: string;
      minScore?: number;
      page?: number;
      pageSize?: number;
      sort?: "updated_desc" | "score_desc" | "score_asc" | "company_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<RadarCandidateApiRecord>>(
      `/radar/candidates${query.size ? `?${query}` : ""}`,
    );
  },
  createCandidate: (input: RadarCandidateApiInput) =>
    request<RadarCandidateApiRecord>("/radar/candidates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCandidate: (id: string, status: RadarCandidateStatus) =>
    request<RadarCandidateApiRecord>(
      `/radar/candidates/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  archiveCandidate: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/radar/candidates/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  promoteCandidate: (id: string) =>
    request<{
      customer: CustomerApiRecord;
      contact: { email: string | null; phone: string | null; name: string } | null;
      contactCreated: boolean;
      created: boolean;
      reachable: boolean;
    }>(`/radar/candidates/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    }),
  enrichCandidateContacts: (id: string) =>
    request<{
      contacts: RadarCandidateApiRecord["contacts"];
      discovered: number;
      pagesScanned: number;
      errors: string[];
      message: string;
    }>(`/radar/candidates/${encodeURIComponent(id)}/enrich-contacts`, {
      method: "POST",
    }),
  listQueue: (
    params: {
      taskId?: string;
      status?: RadarTaskStatus;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<RadarQueueApiRecord>>(
      `/radar/queue${query.size ? `?${query}` : ""}`,
    );
  },
};

export const aiApi = {
  listServices: () => request<{ items: AiServiceApiRecord[] }>("/ai/services"),
  getPolicy: () => request<AiPolicyApiRecord>("/ai/policy"),
  updatePolicy: (input: Omit<AiPolicyApiRecord, "workspaceId" | "updatedAt">) =>
    request<AiPolicyApiRecord>("/ai/policy", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  createService: (input: {
    name: string;
    provider: AiServiceApiRecord["provider"];
    model?: string;
    endpoint?: string;
    priority?: number;
  }) =>
    request<AiServiceApiRecord>("/ai/services", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateService: (
    id: string,
    input: Partial<
      Pick<
        AiServiceApiRecord,
        "name" | "model" | "endpoint" | "priority" | "enabled"
      >
    >,
  ) =>
    request<AiServiceApiRecord>(`/ai/services/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  listKeys: (serviceId: string) =>
    request<{ items: AiServiceKeyApiRecord[] }>(
      `/ai/services/${encodeURIComponent(serviceId)}/keys`,
    ),
  addKey: (serviceId: string, input: { name: string; secret: string }) =>
    request<AiServiceKeyApiRecord>(
      `/ai/services/${encodeURIComponent(serviceId)}/keys`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  updateKey: (id: string, enabled: boolean) =>
    request<{ id: string; enabled: boolean }>(
      `/ai/keys/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    ),
  deleteKey: (id: string) =>
    request<void>(`/ai/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testService: (id: string) =>
    request<{ ok: true; latencyMs: number }>(
      `/ai/services/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
};

export const integrationApi = {
  list: () =>
    request<{ items: IntegrationConnectionApiRecord[] }>(
      "/integrations/connections",
    ),
  create: (input: {
    category?: IntegrationConnectionApiRecord["category"];
    name?: string;
    provider: IntegrationConnectionApiRecord["provider"];
    endpoint?: string;
    secret?: string;
    priority?: number;
    resultLimit?: number;
  }) =>
    request<IntegrationConnectionApiRecord>("/integrations/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: {
      name?: string;
      endpoint?: string;
      secret?: string;
      priority?: number;
      enabled?: boolean;
      resultLimit?: number;
    },
  ) =>
    request<IntegrationConnectionApiRecord>(
      `/integrations/connections/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  test: (id: string) =>
    request<{ ok: true; latencyMs: number; resultCount: number }>(
      `/integrations/connections/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  remove: (id: string) =>
    request<void>(`/integrations/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

export const outboxApi = {
  listConnections: () =>
    request<{ items: OutboundConnectionApiRecord[] }>("/outbox/connections"),
  createConnection: (input: {
    name: string;
    provider: "smtp" | "sendgrid" | "mailgun" | "webhook" | "whatsapp-cloud";
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
    replyTo?: string | null;
    imapEnabled?: boolean;
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    imapUsername?: string | null;
    imapPassword?: string;
    priority?: number;
    enabled?: boolean;
  }) =>
    request<OutboundConnectionApiRecord & { webhookSecret: string }>(
      "/outbox/connections",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  updateConnection: (
    id: string,
    input: Partial<{
      name: string;
      provider: "smtp" | "sendgrid" | "mailgun" | "webhook" | "whatsapp-cloud";
      host: string;
      port: number;
      secure: boolean;
      username: string;
      password: string;
      fromName: string;
      fromEmail: string;
      replyTo: string | null;
      imapEnabled: boolean;
      imapHost: string | null;
      imapPort: number;
      imapSecure: boolean;
      imapUsername: string | null;
      imapPassword: string;
      priority: number;
      enabled: boolean;
    }>,
  ) =>
    request<OutboundConnectionApiRecord>(
      `/outbox/connections/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  testConnection: (id: string) =>
    request<{ ok: true; latencyMs: number; imapLatencyMs: number | null; activatedJobs: number }>(
      `/outbox/connections/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  removeConnection: (id: string) =>
    request<void>(`/outbox/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listJobs: (
    params: {
      q?: string;
      status?: OutboxJobApiRecord["status"] | "all";
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<OutboxJobApiRecord> & { pageCount: number }>(
      `/outbox/jobs${query.size ? `?${query}` : ""}`,
    );
  },
  retryJob: (id: string) =>
    request<{ id: string; status: "queued" }>(
      `/outbox/jobs/${encodeURIComponent(id)}/retry`,
      { method: "POST", body: JSON.stringify({ confirmation: true }) },
    ),
  rotateWebhookSecret: (id: string) =>
    request<{
      id: string;
      webhookSecret: string;
      webhookSecretEnding: string;
      webhookUrl: string;
    }>(`/outbox/connections/${encodeURIComponent(id)}/webhook-secret/rotate`, {
      method: "POST",
      body: JSON.stringify({ confirmation: true }),
    }),
  listEvents: () =>
    request<{ items: ChannelWebhookEventApiRecord[] }>("/outbox/events"),
  listSuppressions: (
    params: {
      q?: string;
      status?: "active" | "restored" | "all";
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<
      ListResponse<ContactSuppressionApiRecord> & { pageCount: number }
    >(`/outbox/suppressions${query.size ? `?${query}` : ""}`);
  },
  restoreSuppression: (id: string) =>
    request<{ id: string; active: false }>(
      `/outbox/suppressions/${encodeURIComponent(id)}/restore`,
      { method: "POST", body: JSON.stringify({ confirmation: true }) },
    ),
};

export const contentApi = {
  list: (
    params: {
      q?: string;
      status?: ContentAssetStatus;
      contentType?: string;
      page?: number;
      pageSize?: number;
      sort?:
        | "updated_desc"
        | "updated_asc"
        | "title_asc"
        | "title_desc"
        | "market_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<ContentAssetApiRecord>>(
      `/content/assets${query.size ? `?${query}` : ""}`,
    );
  },
  get: (id: string) =>
    request<
      ContentAssetApiRecord & {
        latestQualityCheck:
          | (ContentQualityResult & { id: string; createdAt: number })
          | null;
      }
    >(`/content/assets/${encodeURIComponent(id)}`),
  create: (input: ContentAssetApiInput) =>
    request<ContentAssetApiRecord>("/content/assets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<ContentAssetApiInput> & { changeNote?: string },
  ) =>
    request<ContentAssetApiRecord>(
      `/content/assets/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  duplicate: (id: string) =>
    request<ContentAssetApiRecord>(
      `/content/assets/${encodeURIComponent(id)}/duplicate`,
      { method: "POST" },
    ),
  versions: (id: string) =>
    request<{
      items: {
        id: string;
        versionNumber: number;
        title: string;
        body: string;
        changeNote: string;
        createdAt: number;
      }[];
    }>(`/content/assets/${encodeURIComponent(id)}/versions`),
  qualityCheck: (id: string) =>
    request<ContentQualityResult>(
      `/content/assets/${encodeURIComponent(id)}/quality-check`,
      { method: "POST" },
    ),
  linkCampaign: (id: string, campaignId: string) =>
    request<ContentAssetApiRecord>(
      `/content/assets/${encodeURIComponent(id)}/link-campaign`,
      { method: "POST", body: JSON.stringify({ campaignId }) },
    ),
  analyze: (input: {
    title?: string;
    contentType?: string;
    language?: string;
    body: string;
    targetMarket?: string;
    customerRole?: string;
    buyingStage?: string;
    customerSignal?: string;
    sourceMethod?: string;
  }) =>
    request<ContentAnalysisResult>("/content/analyze", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  generate: (
    input: Required<
      Pick<
        ContentAssetApiInput,
        | "title"
        | "contentType"
        | "channel"
        | "language"
        | "targetMarket"
        | "customerRole"
        | "buyingStage"
        | "customerSignal"
        | "sourceMethod"
      >
    > & { saveAsAsset?: boolean; existingBody?: string },
  ) =>
    request<ContentGenerationResult>("/content/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export const campaignApi = {
  list: (
    params: {
      q?: string;
      status?: CampaignStatus;
      page?: number;
      pageSize?: number;
      sort?:
        | "progress_desc"
        | "name_asc"
        | "name_desc"
        | "sent_desc"
        | "opportunities_desc"
        | "updated_desc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<CampaignApiRecord>>(
      `/campaigns${query.size ? `?${query}` : ""}`,
    );
  },
  get: (id: string) =>
    request<
      CampaignApiRecord & {
        events: {
          id: string;
          eventType: string;
          status: string;
          recipientCount: number;
          metadata: Record<string, unknown>;
          createdAt: number;
        }[];
      }
    >(`/campaigns/${encodeURIComponent(id)}`),
  create: (input: CampaignApiInput) =>
    request<CampaignApiRecord>("/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<
      Omit<CampaignApiInput, "contentAssetId" | "audienceCustomerIds">
    > & {
      progress?: number;
      sentCount?: number;
      replyCount?: number;
      opportunityCount?: number;
      revenueAmount?: number;
    },
  ) =>
    request<CampaignApiRecord>(`/campaigns/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  schedule: () =>
    request<{
      items: {
        id: string;
        campaignId: string;
        campaignName: string;
        name: string;
        channel: string;
        status: string;
        scheduledAt: number | null;
        position: number;
      }[];
      total: number;
    }>("/campaigns/schedule"),
  addStep: (
    id: string,
    input: {
      name: string;
      channel?: string;
      contentAssetId?: string | null;
      scheduledAt?: number | null;
      status?: "draft" | "scheduled" | "running" | "completed" | "cancelled";
      position?: number;
      note?: string;
    },
  ) =>
    request<CampaignApiRecord>(`/campaigns/${encodeURIComponent(id)}/steps`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  executeStep: (id: string, stepId: string) =>
    request<{
      campaignId: string;
      stepId: string;
      recipientCount: number;
      queued: number;
      awaitingConfiguration: number;
      suppressed: number;
      manualTasks?: number;
      jobIds: string[];
      taskIds?: string[];
    }>(
      `/campaigns/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/execute`,
      { method: "POST", body: JSON.stringify({ confirmation: true }) },
    ),
  linkContent: (id: string, contentAssetId: string, purpose?: string) =>
    request<CampaignApiRecord>(`/campaigns/${encodeURIComponent(id)}/content`, {
      method: "POST",
      body: JSON.stringify({ contentAssetId, purpose }),
    }),
  addAudience: (id: string, customerIds: string[]) =>
    request<CampaignApiRecord>(
      `/campaigns/${encodeURIComponent(id)}/audience`,
      { method: "POST", body: JSON.stringify({ customerIds }) },
    ),
};

export const inboxApi = {
  listThreads: (
    params: {
      q?: string;
      channel?: string;
      filter?: "all" | "unread" | "high_intent" | "follow_up";
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<{
      items: InboxThreadApiRecord[];
      total: number;
      unreadTotal: number;
      channels: string[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(`/inbox/threads${query.size ? `?${query}` : ""}`);
  },
  createThread: (input: {
    customerId?: string | null;
    campaignId?: string | null;
    subject?: string;
    channel?: string;
    intent?: InboxThreadApiRecord["intent"];
    initialMessage?: string;
    contact: {
      name: string;
      company: string;
      jobTitle?: string;
      region?: string;
      source?: string;
      primaryChannel?: string;
      email?: string | null;
      phone?: string | null;
    };
  }) =>
    request<InboxThreadApiRecord>("/inbox/threads", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listMessages: (
    threadId: string,
    params: { cursor?: string; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<{
      items: InboxMessageApiRecord[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(
      `/inbox/threads/${encodeURIComponent(threadId)}/messages${query.size ? `?${query}` : ""}`,
    );
  },
  markRead: (threadId: string) =>
    request<{ id: string; unreadCount: number; lastReadAt: number }>(
      `/inbox/threads/${encodeURIComponent(threadId)}/read`,
      { method: "POST" },
    ),
  markAllRead: () =>
    request<{ updated: number; unreadTotal: number }>(
      "/inbox/threads/read-all",
      { method: "POST" },
    ),
  confirmReply: (threadId: string, body: string) =>
    request<{
      message: InboxMessageApiRecord;
      delivery: {
        mode: "outbox";
        status: OutboxJobApiRecord["status"];
        jobId: string;
        label: string;
      };
    }>(`/inbox/threads/${encodeURIComponent(threadId)}/replies/confirm`, {
      method: "POST",
      body: JSON.stringify({ body, confirmation: true }),
    }),
  updateThread: (
    threadId: string,
    input: {
      intent?: InboxThreadApiRecord["intent"];
      status?: InboxThreadApiRecord["status"];
    },
  ) =>
    request<InboxThreadApiRecord>(
      `/inbox/threads/${encodeURIComponent(threadId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
};

export const icpApi = {
  getProfile: () =>
    request<BusinessProfileApiRecord>("/icp/profile"),
  updateProfile: (input: BusinessProfileApiInput) =>
    request<BusinessProfileApiRecord>("/icp/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  analyzeProfile: () =>
    request<BusinessProfileApiRecord & { analysis: IcpAnalysisResult; mode: "ai" | "local-rules" }>(
      "/icp/profile/analyze",
      { method: "POST" },
    ),
  listKnowledge: (
    params: {
      q?: string;
      itemType?: KnowledgeItemType;
      status?: KnowledgeItemStatus;
      page?: number;
      pageSize?: number;
      sort?:
        | "updated_desc"
        | "updated_asc"
        | "title_asc"
        | "title_desc"
        | "references_desc"
        | "references_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<KnowledgeItemApiRecord>>(
      `/icp/knowledge${query.size ? `?${query}` : ""}`,
    );
  },
  createKnowledge: (input: KnowledgeItemApiInput) =>
    request<KnowledgeItemApiRecord>("/icp/knowledge", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateKnowledge: (id: string, input: Partial<KnowledgeItemApiInput>) =>
    request<KnowledgeItemApiRecord>(
      `/icp/knowledge/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  setKnowledgeStatus: (id: string, status: KnowledgeItemStatus) =>
    request<KnowledgeItemApiRecord>(
      `/icp/knowledge/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  removeKnowledge: (id: string) =>
    request<void>(`/icp/knowledge/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

// ── Attribution / Conversion ──────────────────────────────────────

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

type AttributionFunnelStage = {
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

export const attributionApi = {
  overview: (params: { period?: AttributionPeriod; currency?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.period) query.set("period", params.period);
    if (params.currency) query.set("currency", params.currency);
    return request<AttributionOverview>(
      `/attribution/overview${query.size ? `?${query}` : ""}`,
    );
  },
  listCosts: (
    params: {
      channel?: string;
      start?: number;
      end?: number;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") query.set(k, String(v));
    });
    return request<ListResponse<ChannelCostApiRecord>>(
      `/attribution/costs${query.size ? `?${query}` : ""}`,
    );
  },
  createCost: (input: ChannelCostApiInput) =>
    request<ChannelCostApiRecord>("/attribution/costs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCost: (id: string, input: Partial<ChannelCostApiInput>) =>
    request<ChannelCostApiRecord>(
      `/attribution/costs/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  removeCost: (id: string) =>
    request<void>(`/attribution/costs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  createOptimizeTasks: (input: {
    period?: AttributionPeriod;
    channels?: string[];
  }) =>
    request<{ created: number; taskIds: string[] }>(
      "/attribution/optimize-tasks",
      { method: "POST", body: JSON.stringify(input) },
    ),
  quality: () =>
    request<{
      items: { label: string; pct: number; detail: string }[];
    }>("/attribution/quality"),
};

const downloadFile = async (path: string, defaultFilename: string) => {
  const response = await fetch(`/api${path}`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body as ApiErrorBody);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? defaultFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const systemApi = {
  exportData: () => downloadFile("/system/export", `sondara-export-${new Date().toISOString().slice(0, 10)}.json`),
  backupDatabase: () => downloadFile("/system/backup", `sondara-backup-${new Date().toISOString().slice(0, 10)}.dump`),
  listBackups: () => request<{ items: Array<{ fileName: string; createdAt: number; size: number; verifiedAt: number | null }>; automatic: boolean; retentionCount: number }>("/system/backups"),
  validateBackup: (fileName: string) => request<{ fileName: string; verifiedAt: number }>(`/system/backups/${encodeURIComponent(fileName)}/validate`, { method: "POST" }),
  operations: () => request<{ generatedAt: number; workers: { backup: "enabled" | "disabled" }; counts: { customers: number; tasks: number; deals: number; radarTasks: number; queuedOutbound: number }; latestBackup: { fileName: string; createdAt: number; size: number; verifiedAt: number | null } | null }>("/system/operations"),
};
