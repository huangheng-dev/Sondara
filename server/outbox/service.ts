import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaignExecutionEvents,
  campaigns,
  inboxContacts,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  outboxJobs,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { decryptSecret } from "../lib/secret-vault.js";
import { isDestinationSuppressed } from "./events.js";

const emailChannels = new Set(["邮件", "邮件序列", "email", "Email", "EMAIL"]);
const event = (
  job: typeof outboxJobs.$inferSelect,
  eventType: string,
  status: string,
  metadata: unknown = {},
) => {
  db.insert(messageDeliveryEvents)
    .values({
      id: createId("mde"),
      workspaceId: job.workspaceId,
      outboxJobId: job.id,
      messageId: job.messageId,
      eventType,
      status,
      metadataJson: JSON.stringify(metadata),
      createdAt: Date.now(),
    })
    .run();
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
  fromName: item.fromName,
  fromEmail: item.fromEmail,
  replyTo: item.replyTo,
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

export const getAvailableConnection = (workspaceId: string) =>
  db
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
    )
    .get();

export const enqueueConfirmedMessage = (input: {
  workspaceId: string;
  messageId: string;
  threadId: string;
  channel: string;
  scheduledAt?: number;
}) => {
  const now = Date.now();
  const thread = db
    .select()
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.id, input.threadId),
        eq(messageThreads.workspaceId, input.workspaceId),
      ),
    )
    .get();
  const contact = thread
    ? db
        .select()
        .from(inboxContacts)
        .where(
          and(
            eq(inboxContacts.id, thread.contactId),
            eq(inboxContacts.workspaceId, input.workspaceId),
          ),
        )
        .get()
    : null;
  const suppressed = Boolean(
    contact?.email && isDestinationSuppressed(input.workspaceId, contact.email),
  );
  const connection = emailChannels.has(input.channel)
    ? getAvailableConnection(input.workspaceId)
    : null;
  const status = suppressed
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
    connectionId: suppressed ? null : (connection?.id ?? null),
    status,
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: input.scheduledAt ?? now,
    startedAt: null,
    completedAt: null,
    lastError: suppressed
      ? "收件地址位于抑制名单，已阻止发送。"
      : connection
        ? null
        : emailChannels.has(input.channel)
          ? "尚未配置可用的 SMTP 服务。"
          : `暂不支持 ${input.channel} 自动发送。`,
    externalId: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(outboxJobs).values(job).run();
  event(job as typeof outboxJobs.$inferSelect, "queued", status, {
    channel: input.channel,
    connectionId: suppressed ? null : (connection?.id ?? null),
    suppressed,
  });
  return job;
};

export const testSmtpConnection = async (
  connection: typeof outboundChannelConnections.$inferSelect,
) => {
  const startedAt = Date.now();
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

export const activateWaitingJobs = (
  workspaceId: string,
  connectionId: string,
) => {
  const now = Date.now();
  return db
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
        or(
          eq(outboxJobs.channel, "邮件"),
          eq(outboxJobs.channel, "邮件序列"),
          eq(outboxJobs.channel, "email"),
          eq(outboxJobs.channel, "Email"),
        ),
      ),
    )
    .run().changes;
};

export const processOutboxJob = async (jobId: string) => {
  const original = db
    .select()
    .from(outboxJobs)
    .where(eq(outboxJobs.id, jobId))
    .get();
  if (!original || !["queued", "processing"].includes(original.status))
    return { processed: false, status: original?.status ?? "missing" };
  const now = Date.now();
  const claimed = db
    .update(outboxJobs)
    .set({ status: "processing", startedAt: now, updatedAt: now })
    .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.status, "queued")))
    .run().changes;
  if (!claimed && original.status !== "processing")
    return { processed: false, status: "claimed" };
  const job = db
    .select()
    .from(outboxJobs)
    .where(eq(outboxJobs.id, jobId))
    .get()!;
  const message = db
    .select()
    .from(messageEntries)
    .where(
      and(
        eq(messageEntries.id, job.messageId),
        eq(messageEntries.workspaceId, job.workspaceId),
      ),
    )
    .get();
  const thread = db
    .select()
    .from(messageThreads)
    .where(
      and(
        eq(messageThreads.id, job.threadId),
        eq(messageThreads.workspaceId, job.workspaceId),
      ),
    )
    .get();
  const contact = thread
    ? db
        .select()
        .from(inboxContacts)
        .where(
          and(
            eq(inboxContacts.id, thread.contactId),
            eq(inboxContacts.workspaceId, job.workspaceId),
          ),
        )
        .get()
    : null;
  const connection = job.connectionId
    ? db
        .select()
        .from(outboundChannelConnections)
        .where(
          and(
            eq(outboundChannelConnections.id, job.connectionId),
            eq(outboundChannelConnections.workspaceId, job.workspaceId),
            eq(outboundChannelConnections.enabled, true),
            eq(outboundChannelConnections.status, "available"),
          ),
        )
        .get()
    : getAvailableConnection(job.workspaceId);
  try {
    if (!message || message.status !== "confirmed")
      throw new Error("只有已由用户确认的消息才能发送。");
    if (!thread || !contact) throw new Error("消息联系人或线程不存在。");
    if (!emailChannels.has(job.channel))
      throw new Error(`暂不支持 ${job.channel} 自动发送。`);
    if (!contact.email) throw new Error("联系人缺少有效邮箱地址。");
    if (isDestinationSuppressed(job.workspaceId, contact.email))
      throw new Error("收件地址位于抑制名单，已阻止发送。");
    if (!connection) {
      db.update(outboxJobs)
        .set({
          status: "awaiting_configuration",
          connectionId: null,
          lastError: "尚未配置可用的 SMTP 服务。",
          updatedAt: Date.now(),
        })
        .where(eq(outboxJobs.id, job.id))
        .run();
      event(job, "configuration_required", "awaiting_configuration");
      return { processed: true, status: "awaiting_configuration" };
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
      socketTimeout: 20_000,
    });
    const result = await transport.sendMail({
      from: { name: connection.fromName, address: connection.fromEmail },
      to: contact.email,
      replyTo: connection.replyTo ?? undefined,
      subject: thread.subject,
      text: message.body,
    });
    transport.close();
    const completedAt = Date.now();
    db.transaction((tx) => {
      tx.update(outboxJobs)
        .set({
          status: "sent",
          connectionId: connection.id,
          attempts: job.attempts + 1,
          externalId: result.messageId,
          lastError: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(outboxJobs.id, job.id))
        .run();
      tx.update(messageEntries)
        .set({
          status: "sent",
          externalId: result.messageId,
          sentAt: completedAt,
          updatedAt: completedAt,
          metadataJson: JSON.stringify({
            deliveryMode: "smtp",
            connectionId: connection.id,
          }),
        })
        .where(eq(messageEntries.id, message.id))
        .run();
      if (thread.campaignId) {
        const messageMetadata = (() => {
          try {
            return JSON.parse(message.metadataJson) as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        tx.update(campaigns)
          .set({
            sentCount: sql`${campaigns.sentCount} + 1`,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(campaigns.id, thread.campaignId),
              eq(campaigns.workspaceId, job.workspaceId),
            ),
          )
          .run();
        if (thread.customerId)
          tx.update(campaignAudienceMembers)
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
            )
            .run();
        tx.insert(campaignExecutionEvents)
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
          })
          .run();
      }
    });
    event(job, "sent", "sent", {
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
      !error.includes("暂不支持");
    const status = retryable ? "queued" : "failed";
    const updatedAt = Date.now();
    const scheduledAt = retryable
      ? updatedAt + Math.min(60_000, 5_000 * 2 ** (attempts - 1))
      : job.scheduledAt;
    db.update(outboxJobs)
      .set({
        status,
        attempts,
        lastError: error,
        scheduledAt,
        completedAt: retryable ? null : updatedAt,
        updatedAt,
      })
      .where(eq(outboxJobs.id, job.id))
      .run();
    event(job, retryable ? "retry_scheduled" : "failed", status, {
      attempts,
      error,
      scheduledAt,
    });
    return { processed: true, status, error };
  }
};

export const processDueOutboxJobs = async (limit = 5) => {
  const due = db
    .select({ id: outboxJobs.id })
    .from(outboxJobs)
    .where(
      and(
        eq(outboxJobs.status, "queued"),
        lte(outboxJobs.scheduledAt, Date.now()),
      ),
    )
    .orderBy(asc(outboxJobs.scheduledAt))
    .limit(limit)
    .all();
  for (const job of due) await processOutboxJob(job.id);
  return due.length;
};

export const recoverStuckOutboxJobs = (olderThanMs = 5 * 60_000) =>
  db
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
    )
    .run().changes;
