import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import {
  acquisitionPlans,
  campaignAudienceMembers,
  campaignExecutionEvents,
  campaigns,
  inboxContacts,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  outboxJobs,
  whatsappMessageTemplates,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { decryptSecret } from "../lib/secret-vault.js";
import { assertSafeOutboundUrl } from "../lib/url-safety.js";
import { config } from "../config.js";
import { isDestinationSuppressed } from "./events.js";
import { buildWhatsappMessagePayload } from "./whatsapp-templates.js";
import { enforceAutomationCircuitBreaker } from "../radar/production-control.js";

const emailChannels = new Set(["邮件", "邮件序列", "email", "Email", "EMAIL"]);
const emailChannelList = [...emailChannels];
const emailProviders = new Set(["smtp", "sendgrid", "mailgun"]);
const whatsappChannels = new Set(["WhatsApp", "whatsapp", "WhatsApp 消息"]);
export const isWhatsappConversationOpen = (lastInboundAt: number | null, now = Date.now()) =>
  Boolean(lastInboundAt && lastInboundAt >= now - 24 * 60 * 60_000);
const event = async (
  job: typeof outboxJobs.$inferSelect,
  eventType: string,
  status: string,
  metadata: unknown = {},
) => {
  await db.insert(messageDeliveryEvents)
        .values({
          id: createId("mde"),
          workspaceId: job.workspaceId,
          outboxJobId: job.id,
          messageId: job.messageId,
          eventType,
          status,
          metadataJson: JSON.stringify(metadata),
          createdAt: Date.now(),
        });
};

export const serializeOutboundConnection = (
  item: typeof outboundChannelConnections.$inferSelect,
) => ({
  id: item.id,
  workspaceId: item.workspaceId,
  name: item.name,
  provider: item.provider,
  host: item.host,
  port: item.port,
  secure: item.secure,
  username: item.username,
  whatsappBusinessAccountId: item.whatsappBusinessAccountId,
  whatsappDefaultTemplateName: item.whatsappDefaultTemplateName,
  whatsappDefaultTemplateLanguage: item.whatsappDefaultTemplateLanguage,
  fromName: item.fromName,
  fromEmail: item.fromEmail,
  replyTo: item.replyTo,
  imapEnabled: item.imapEnabled,
  imapHost: item.imapHost,
  imapPort: item.imapPort,
  imapSecure: item.imapSecure,
  imapUsername: item.imapUsername,
  hasImapSecret: Boolean(item.imapSecretCiphertext),
  imapSecretEnding: item.imapSecretEnding,
  priority: item.priority,
  enabled: item.enabled,
  status: item.status,
  hasSecret: Boolean(item.secretCiphertext),
  secretEnding: item.secretEnding,
  hasWebhookSecret: Boolean(item.webhookSecretCiphertext),
  webhookSecretEnding: item.webhookSecretEnding,
  lastLatencyMs: item.lastLatencyMs,
  lastError: item.lastError,
  lastTestedAt: item.lastTestedAt,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

export const getAvailableConnection = async (workspaceId: string, channel = "邮件") => {
  const connections = await db
        .select()
        .from(outboundChannelConnections)
        .where(
          and(
            eq(outboundChannelConnections.workspaceId, workspaceId),
            eq(outboundChannelConnections.enabled, true),
            eq(outboundChannelConnections.status, "available"),
          ),
        )
        .orderBy(
          asc(outboundChannelConnections.priority),
          asc(outboundChannelConnections.createdAt),
        );
  return connections.find(connection => emailChannels.has(channel)
    ? emailProviders.has(connection.provider)
    : whatsappChannels.has(channel)
      ? connection.provider === "whatsapp-cloud"
      : connection.provider === "webhook");
};

export const enqueueConfirmedMessage = async (input: {
  workspaceId: string;
  messageId: string;
  threadId: string;
  channel: string;
  scheduledAt?: number;
}) => {
  const now = Date.now();
  const thread = (await db.$first(db
      .select()
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.id, input.threadId),
          eq(messageThreads.workspaceId, input.workspaceId),
        ),
      )));
  const contact = thread
    ? (await db.$first(db
              .select()
              .from(inboxContacts)
              .where(
                and(
                  eq(inboxContacts.id, thread.contactId),
                  eq(inboxContacts.workspaceId, input.workspaceId),
                ),
              )))
    : null;
  const suppressed = Boolean(
    contact?.email && (await isDestinationSuppressed(input.workspaceId, contact.email)),
  );
  const blockedByOptIn = whatsappChannels.has(input.channel) && !contact?.whatsappOptedInAt;
  const connection = await getAvailableConnection(input.workspaceId, input.channel);
  const status = suppressed || blockedByOptIn
    ? "cancelled"
    : connection
      ? "queued"
      : "awaiting_configuration";
  const job = {
    id: createId("out"),
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    threadId: input.threadId,
    channel: input.channel,
    connectionId: suppressed || blockedByOptIn ? null : (connection?.id ?? null),
    status,
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: input.scheduledAt ?? now,
    startedAt: null,
    completedAt: null,
    lastError: blockedByOptIn
      ? "联系人尚未记录 WhatsApp 授权，已阻止发送。"
      : suppressed
      ? "收件地址位于抑制名单，已阻止发送。"
      : connection
        ? null
        : emailChannels.has(input.channel)
          ? "尚未配置可用的邮件发送服务。"
          : `尚未配置 ${input.channel} 的 Webhook 发送服务。`,
    externalId: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(outboxJobs).values(job);
  await event(job as typeof outboxJobs.$inferSelect, "queued", status, {
    channel: input.channel,
    connectionId: suppressed || blockedByOptIn ? null : (connection?.id ?? null),
    suppressed: suppressed || blockedByOptIn,
    blockedByOptIn,
  });
  return job;
};

const secretFor = (connection: typeof outboundChannelConnections.$inferSelect) => decryptSecret({
  ciphertext: connection.secretCiphertext,
  iv: connection.secretIv,
  tag: connection.secretTag,
});

const apiBase = (connection: typeof outboundChannelConnections.$inferSelect, fallback: string) =>
  (connection.host.startsWith("http://") || connection.host.startsWith("https://") ? connection.host : fallback).replace(/\/$/, "");

export const testOutboundConnection = async (
  connection: typeof outboundChannelConnections.$inferSelect,
) => {
  const startedAt = Date.now();
  if (connection.provider !== "smtp") {
    const secret = secretFor(connection);
    const endpoint = connection.provider === "whatsapp-cloud"
      ? `${apiBase(connection, `https://graph.facebook.com/${config.metaGraphApiVersion}`)}/${encodeURIComponent(connection.username)}?fields=display_phone_number,verified_name`
      : connection.provider === "sendgrid"
      ? `${apiBase(connection, "https://api.sendgrid.com/v3")}/user/profile`
      : connection.provider === "mailgun"
        ? `${apiBase(connection, "https://api.mailgun.net")}/v3/domains/${encodeURIComponent(connection.username)}`
        : apiBase(connection, connection.host);
    await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: "发送服务地址" });
    const response = await fetch(endpoint, {
      method: connection.provider === "webhook" ? "POST" : "GET",
      headers: connection.provider === "mailgun"
        ? { authorization: `Basic ${Buffer.from(`api:${secret}`).toString("base64")}` }
        : { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: connection.provider === "webhook" ? JSON.stringify({ type: "sondara.connection_test", sentAt: new Date().toISOString() }) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`${connection.provider} 返回 HTTP ${response.status}。`);
    return { latencyMs: Date.now() - startedAt };
  }
  const transport = nodemailer.createTransport({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: {
      user: connection.username,
      pass: decryptSecret({
        ciphertext: connection.secretCiphertext,
        iv: connection.secretIv,
        tag: connection.secretTag,
      }),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.verify();
  transport.close();
  return { latencyMs: Date.now() - startedAt };
};

export const testImapConnection = async (connection: typeof outboundChannelConnections.$inferSelect) => {
  if (!connection.imapEnabled) return null;
  if (!connection.imapHost || !connection.imapUsername || !connection.imapSecretCiphertext || !connection.imapSecretIv || !connection.imapSecretTag) {
    throw new Error("IMAP 已启用但配置不完整。");
  }
  const startedAt = Date.now();
  const client = new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure: connection.imapSecure,
    auth: { user: connection.imapUsername, pass: decryptSecret({ ciphertext: connection.imapSecretCiphertext, iv: connection.imapSecretIv, tag: connection.imapSecretTag }) },
    logger: false,
    connectionTimeout: 15_000,
  });
  try {
    await client.connect();
    await client.status("INBOX", { messages: true });
    return { latencyMs: Date.now() - startedAt };
  } finally {
    await client.logout().catch(() => undefined);
  }
};

const sendWithConnection = async (
  connection: typeof outboundChannelConnections.$inferSelect,
  input: { to: string; subject: string; body: string; channel: string },
) => {
  const secret = secretFor(connection);
  if (connection.provider === "smtp") {
    const transport = nodemailer.createTransport({
      host: connection.host, port: connection.port, secure: connection.secure,
      auth: { user: connection.username, pass: secret },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
    try {
      const result = await transport.sendMail({
        from: { name: connection.fromName, address: connection.fromEmail }, to: input.to,
        replyTo: connection.replyTo ?? undefined, subject: input.subject, text: input.body,
      });
      return { messageId: result.messageId };
    } finally { transport.close(); }
  }
  if (connection.provider === "sendgrid") {
    const endpoint = `${apiBase(connection, "https://api.sendgrid.com/v3")}/mail/send`;
    await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: "SendGrid 地址" });
    const response = await fetch(endpoint, {
      method: "POST", signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: [{ email: input.to }] }], from: { email: connection.fromEmail, name: connection.fromName }, reply_to: connection.replyTo ? { email: connection.replyTo } : undefined, subject: input.subject, content: [{ type: "text/plain", value: input.body }] }),
    });
    if (!response.ok) throw new Error(`SendGrid 返回 HTTP ${response.status}。`);
    return { messageId: response.headers.get("x-message-id") ?? randomUUID() };
  }
  if (connection.provider === "mailgun") {
    const endpoint = `${apiBase(connection, "https://api.mailgun.net")}/v3/${encodeURIComponent(connection.username)}/messages`;
    await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: "Mailgun 地址" });
    const body = new FormData();
    body.set("from", `${connection.fromName} <${connection.fromEmail}>`); body.set("to", input.to); body.set("subject", input.subject); body.set("text", input.body);
    if (connection.replyTo) body.set("h:Reply-To", connection.replyTo);
    const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { authorization: `Basic ${Buffer.from(`api:${secret}`).toString("base64")}` }, body });
    if (!response.ok) throw new Error(`Mailgun 返回 HTTP ${response.status}。`);
    const result = await response.json().catch(() => ({})) as { id?: string };
    return { messageId: result.id ?? randomUUID() };
  }
  if (connection.provider === "whatsapp-cloud") {
    const endpoint = `${apiBase(connection, `https://graph.facebook.com/${config.metaGraphApiVersion}`)}/${encodeURIComponent(connection.username)}/messages`;
    await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: "WhatsApp Cloud API 地址" });
    if (connection.whatsappDefaultTemplateName) {
      const approved = await db.$first(db.select({ id: whatsappMessageTemplates.id }).from(whatsappMessageTemplates).where(and(eq(whatsappMessageTemplates.connectionId, connection.id), eq(whatsappMessageTemplates.name, connection.whatsappDefaultTemplateName), eq(whatsappMessageTemplates.language, connection.whatsappDefaultTemplateLanguage || "en_US"), eq(whatsappMessageTemplates.status, "APPROVED"))))
      if (!approved) throw new Error("默认 WhatsApp 模板尚未同步或未获批准，已阻止发送。")
    }
    const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(buildWhatsappMessagePayload({ connection, to: input.to, body: input.body })) });
    if (!response.ok) throw new Error(`WhatsApp Cloud API 返回 HTTP ${response.status}。`);
    const result = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
    return { messageId: result.messages?.[0]?.id ?? randomUUID() };
  }
  const endpoint = apiBase(connection, connection.host);
  await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: "Webhook 地址" });
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "sondara.outbound_message", channel: input.channel, recipient: input.to, subject: input.subject, body: input.body, from: { name: connection.fromName, address: connection.fromEmail } }),
  });
  if (!response.ok) throw new Error(`Webhook 返回 HTTP ${response.status}。`);
  const result = await response.json().catch(() => ({})) as { id?: string; messageId?: string };
  return { messageId: result.messageId ?? result.id ?? randomUUID() };
};

export const activateWaitingJobs = async (
  workspaceId: string,
  connectionId: string,
) => {
  const now = Date.now();
  const connection = await db.$first(db
    .select({ provider: outboundChannelConnections.provider })
    .from(outboundChannelConnections)
    .where(and(
      eq(outboundChannelConnections.id, connectionId),
      eq(outboundChannelConnections.workspaceId, workspaceId),
    )));
  if (!connection) return 0;
  const channelCondition = connection.provider === "webhook"
    ? notInArray(outboxJobs.channel, [...emailChannelList, ...whatsappChannels])
    : connection.provider === "whatsapp-cloud"
      ? inArray(outboxJobs.channel, [...whatsappChannels])
      : inArray(outboxJobs.channel, emailChannelList);
  return (await db
      .update(outboxJobs)
      .set({
        status: "queued",
        connectionId,
        lastError: null,
        scheduledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(outboxJobs.workspaceId, workspaceId),
          eq(outboxJobs.status, "awaiting_configuration"),
          channelCondition,
        ),
      )).rowsAffected ?? 0;
};

export const processOutboxJob = async (jobId: string) => {
  const original = (await db.$first(db
      .select()
      .from(outboxJobs)
      .where(eq(outboxJobs.id, jobId))));
  if (!original || !["queued", "processing"].includes(original.status))
    return { processed: false, status: original?.status ?? "missing" };
  const now = Date.now();
  const claimed = (await db
      .update(outboxJobs)
      .set({ status: "processing", startedAt: now, updatedAt: now })
      .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.status, "queued")))).rowsAffected ?? 0;
  if (!claimed && original.status !== "processing")
    return { processed: false, status: "claimed" };
  const job = (await db.$first(db
      .select()
      .from(outboxJobs)
      .where(eq(outboxJobs.id, jobId))))!;
  const message = (await db.$first(db
      .select()
      .from(messageEntries)
      .where(
        and(
          eq(messageEntries.id, job.messageId),
          eq(messageEntries.workspaceId, job.workspaceId),
        ),
      )));
  const thread = (await db.$first(db
      .select()
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.id, job.threadId),
          eq(messageThreads.workspaceId, job.workspaceId),
        ),
      )));
  const contact = thread
    ? (await db.$first(db
              .select()
              .from(inboxContacts)
              .where(
                and(
                  eq(inboxContacts.id, thread.contactId),
                  eq(inboxContacts.workspaceId, job.workspaceId),
                ),
              )))
    : null;
  const connection = job.connectionId
    ? (await db.$first(db
              .select()
              .from(outboundChannelConnections)
              .where(
                and(
                  eq(outboundChannelConnections.id, job.connectionId),
                  eq(outboundChannelConnections.workspaceId, job.workspaceId),
                  eq(outboundChannelConnections.enabled, true),
                  eq(outboundChannelConnections.status, "available"),
                ),
              )))
    : (await getAvailableConnection(job.workspaceId, job.channel));
  const messageMetadata = (() => {
    try {
      return JSON.parse(message?.metadataJson ?? "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  try {
    if (!message || message.status !== "confirmed")
      throw new Error("只有已由用户确认的消息才能发送。");
    if (!thread || !contact) throw new Error("消息联系人或线程不存在。");
    if (messageMetadata.automationApprovedByPlan === true && thread.lastInboundAt && thread.lastInboundAt > message.createdAt) {
      const cancelledAt = Date.now();
      await db.transaction(async tx => {
        await tx.update(outboxJobs).set({ status: "cancelled", lastError: "客户已回复，自动取消剩余跟进。", completedAt: cancelledAt, updatedAt: cancelledAt }).where(eq(outboxJobs.id, job.id));
        await tx.update(messageEntries).set({ status: "cancelled", updatedAt: cancelledAt }).where(eq(messageEntries.id, message.id));
      });
      await event(job, "cancelled_after_reply", "cancelled", { threadId: thread.id });
      return { processed: true, status: "cancelled" };
    }
    if (messageMetadata.automationApprovedByPlan === true) {
      const planId = typeof messageMetadata.acquisitionPlanId === "string" ? messageMetadata.acquisitionPlanId : "";
      const plan = planId ? await db.$first(db.select({ enabled: acquisitionPlans.enabled, status: acquisitionPlans.status }).from(acquisitionPlans).where(and(
        eq(acquisitionPlans.id, planId), eq(acquisitionPlans.workspaceId, job.workspaceId),
      ))) : null;
      if (!plan || !plan.enabled || plan.status !== "active") {
        const cancelledAt = Date.now();
        const reason = "全自动计划已暂停，消息已在发送前取消。";
        await db.transaction(async tx => {
          await tx.update(outboxJobs).set({ status: "cancelled", lastError: reason, completedAt: cancelledAt, updatedAt: cancelledAt }).where(eq(outboxJobs.id, job.id));
          await tx.update(messageEntries).set({ status: "cancelled", updatedAt: cancelledAt }).where(eq(messageEntries.id, message.id));
        });
        await event(job, "cancelled_by_plan_pause", "cancelled", { planId });
        return { processed: true, status: "cancelled" };
      }
      const safety = await enforceAutomationCircuitBreaker(job.workspaceId);
      if (!safety.safe) {
        const cancelledAt = Date.now();
        const reason = `自动触达已熔断：${safety.reasons.join("；")}`;
        await db.transaction(async tx => {
          await tx.update(outboxJobs).set({ status: "cancelled", lastError: reason, completedAt: cancelledAt, updatedAt: cancelledAt }).where(eq(outboxJobs.id, job.id));
          await tx.update(messageEntries).set({ status: "cancelled", updatedAt: cancelledAt }).where(eq(messageEntries.id, message.id));
        });
        await event(job, "cancelled_by_circuit_breaker", "cancelled", { reasons: safety.reasons });
        return { processed: true, status: "cancelled" };
      }
    }
    const destination = emailChannels.has(job.channel)
      ? contact.email
      : whatsappChannels.has(job.channel)
        ? contact.phone
        : contact.externalRef || contact.email;
    if (!destination) throw new Error("联系人缺少当前渠道的有效接收地址。");
    if (emailChannels.has(job.channel) && contact.email && (await isDestinationSuppressed(job.workspaceId, contact.email)))
      throw new Error("收件地址位于抑制名单，已阻止发送。");
    if (!connection) {
      await db.update(outboxJobs)
                .set({
                  status: "awaiting_configuration",
                  connectionId: null,
                  lastError: "尚未配置可用的当前渠道发送服务。",
                  updatedAt: Date.now(),
                })
                .where(eq(outboxJobs.id, job.id));
      await event(job, "configuration_required", "awaiting_configuration");
      return { processed: true, status: "awaiting_configuration" };
    }
    if (whatsappChannels.has(job.channel) && connection.provider === "whatsapp-cloud" && !connection.whatsappDefaultTemplateName && !isWhatsappConversationOpen(thread.lastInboundAt)) {
      throw new Error("WhatsApp 24 小时会话窗口已关闭；请配置并使用已批准的消息模板。")
    }
    const result = await sendWithConnection(connection, { to: destination, subject: thread.subject, body: message.body, channel: job.channel });
    const completedAt = Date.now();
    await db.transaction(async (tx) => {
            await tx.update(outboxJobs)
                      .set({
                        status: "sent",
                        connectionId: connection.id,
                        attempts: job.attempts + 1,
                        externalId: result.messageId,
                        lastError: null,
                        completedAt,
                        updatedAt: completedAt,
                      })
                      .where(eq(outboxJobs.id, job.id));
            await tx.update(messageEntries)
                      .set({
                        status: "sent",
                        externalId: result.messageId,
                        sentAt: completedAt,
                        updatedAt: completedAt,
                        metadataJson: JSON.stringify({
                          ...messageMetadata,
                          deliveryMode: connection.provider,
                          connectionId: connection.id,
                        }),
                      })
                      .where(eq(messageEntries.id, message.id));
            if (thread.campaignId) {
              await tx.update(campaigns)
                          .set({
                            sentCount: sql`${campaigns.sentCount} + 1`,
                            updatedAt: completedAt,
                          })
                          .where(
                            and(
                              eq(campaigns.id, thread.campaignId),
                              eq(campaigns.workspaceId, job.workspaceId),
                            ),
                          );
              if (thread.customerId)
                await tx.update(campaignAudienceMembers)
                              .set({
                                status: "sent",
                                lastEventAt: completedAt,
                                updatedAt: completedAt,
                              })
                              .where(
                                and(
                                  eq(campaignAudienceMembers.campaignId, thread.campaignId),
                                  eq(campaignAudienceMembers.customerId, thread.customerId),
                                  eq(campaignAudienceMembers.workspaceId, job.workspaceId),
                                ),
                              );
              await tx.insert(campaignExecutionEvents)
                          .values({
                            id: createId("cev"),
                            workspaceId: job.workspaceId,
                            campaignId: thread.campaignId,
                            campaignStepId:
                              typeof messageMetadata.campaignStepId === "string"
                                ? messageMetadata.campaignStepId
                                : null,
                            eventType: "message_sent",
                            status: "completed",
                            recipientCount: 1,
                            metadataJson: JSON.stringify({
                              outboxJobId: job.id,
                              messageId: message.id,
                              externalId: result.messageId,
                            }),
                            createdAt: completedAt,
                          });
            }
          });
    await event(job, "sent", "sent", {
      connectionId: connection.id,
      externalId: result.messageId,
      recipient: contact.email,
    });
    return { processed: true, status: "sent", externalId: result.messageId };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "发送失败。";
    const attempts = job.attempts + 1;
    const retryable =
      attempts < job.maxAttempts &&
      !error.includes("只有已由用户确认") &&
      !error.includes("缺少有效邮箱") &&
      !error.includes("抑制名单") &&
      !error.includes("24 小时会话窗口") &&
      !error.includes("尚未同步或未获批准") &&
      !error.includes("暂不支持");
    const status = retryable ? "queued" : "failed";
    const updatedAt = Date.now();
    const scheduledAt = retryable
      ? updatedAt + Math.min(60_000, 5_000 * 2 ** (attempts - 1))
      : job.scheduledAt;
    await db.update(outboxJobs)
            .set({
              status,
              attempts,
              lastError: error,
              scheduledAt,
              completedAt: retryable ? null : updatedAt,
              updatedAt,
            })
            .where(eq(outboxJobs.id, job.id));
    await event(job, retryable ? "retry_scheduled" : "failed", status, {
      attempts,
      error,
      scheduledAt,
    });
    return { processed: true, status, error };
  }
};

export const processDueOutboxJobs = async (limit = 5) => {
  const due = (await db
      .select({ id: outboxJobs.id })
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.status, "queued"),
          lte(outboxJobs.scheduledAt, Date.now()),
        ),
      )
      .orderBy(asc(outboxJobs.scheduledAt))
      .limit(limit));
  for (const job of due) await processOutboxJob(job.id);
  return due.length;
};

export const recoverStuckOutboxJobs = async (olderThanMs = 5 * 60_000) =>
  (await db
        .update(outboxJobs)
        .set({
          status: "queued",
          lastError: "发送进程中断，任务已自动恢复。",
          scheduledAt: Date.now(),
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(outboxJobs.status, "processing"),
            lte(outboxJobs.startedAt, Date.now() - olderThanMs),
          ),
        )).rowsAffected ?? 0;
