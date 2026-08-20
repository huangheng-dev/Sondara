import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaignExecutionEvents,
  campaigns,
  channelWebhookEvents,
  contactSuppressions,
  inboxContacts,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboxJobs,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";

export type ChannelEventInput = {
  providerEventId: string;
  type:
    | "delivered"
    | "bounced"
    | "complained"
    | "unsubscribed"
    | "inbound_reply";
  externalMessageId?: string;
  sender?: string;
  recipient?: string;
  subject?: string;
  body?: string;
  reason?: string;
  occurredAt: number;
};

const normalizeDestination = (value: string) => value.trim().toLowerCase();

export const isDestinationSuppressed = (
  workspaceId: string,
  destination: string,
) =>
  Boolean(
    db
      .select({ id: contactSuppressions.id })
      .from(contactSuppressions)
      .where(
        and(
          eq(contactSuppressions.workspaceId, workspaceId),
          eq(contactSuppressions.channel, "email"),
          eq(
            contactSuppressions.destination,
            normalizeDestination(destination),
          ),
          eq(contactSuppressions.active, true),
        ),
      )
      .get(),
  );

const suppress = (input: {
  workspaceId: string;
  destination: string;
  reason: string;
  eventId: string;
  now: number;
}) =>
  db
    .insert(contactSuppressions)
    .values({
      id: createId("sup"),
      workspaceId: input.workspaceId,
      channel: "email",
      destination: normalizeDestination(input.destination),
      reason: input.reason,
      source: "channel_event",
      active: true,
      lastEventId: input.eventId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        contactSuppressions.workspaceId,
        contactSuppressions.channel,
        contactSuppressions.destination,
      ],
      set: {
        reason: input.reason,
        source: "channel_event",
        active: true,
        lastEventId: input.eventId,
        updatedAt: input.now,
      },
    })
    .run();

export const processChannelEvent = (
  connection: { id: string; workspaceId: string },
  input: ChannelEventInput,
) => {
  const existing = db
    .select()
    .from(channelWebhookEvents)
    .where(
      and(
        eq(channelWebhookEvents.connectionId, connection.id),
        eq(channelWebhookEvents.providerEventId, input.providerEventId),
      ),
    )
    .get();
  if (existing)
    return {
      duplicate: true,
      status: existing.processingStatus,
      eventId: existing.id,
    };

  const now = Date.now();
  const eventId = createId("cwe");
  db.insert(channelWebhookEvents)
    .values({
      id: eventId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      providerEventId: input.providerEventId,
      eventType: input.type,
      externalMessageId: input.externalMessageId ?? null,
      sender: input.sender ? normalizeDestination(input.sender) : null,
      recipient: input.recipient ? normalizeDestination(input.recipient) : null,
      subject: input.subject ?? null,
      body: input.body ?? null,
      reason: input.reason ?? null,
      occurredAt: input.occurredAt,
      processingStatus: "pending",
      processingError: null,
      payloadJson: JSON.stringify(input),
      processedAt: null,
      createdAt: now,
    })
    .run();

  const job = input.externalMessageId
    ? db
        .select()
        .from(outboxJobs)
        .where(
          and(
            eq(outboxJobs.workspaceId, connection.workspaceId),
            eq(outboxJobs.externalId, input.externalMessageId),
          ),
        )
        .get()
    : null;
  if (!job) {
    db.update(channelWebhookEvents)
      .set({
        processingStatus: "unlinked",
        processingError: "未找到匹配的外发消息。",
        processedAt: now,
      })
      .where(eq(channelWebhookEvents.id, eventId))
      .run();
    return { duplicate: false, status: "unlinked", eventId };
  }

  const message = db
    .select()
    .from(messageEntries)
    .where(eq(messageEntries.id, job.messageId))
    .get();
  const thread = db
    .select()
    .from(messageThreads)
    .where(eq(messageThreads.id, job.threadId))
    .get();
  if (!message || !thread) {
    db.update(channelWebhookEvents)
      .set({
        processingStatus: "failed",
        processingError: "消息线程已不存在。",
        processedAt: now,
      })
      .where(eq(channelWebhookEvents.id, eventId))
      .run();
    return { duplicate: false, status: "failed", eventId };
  }

  db.transaction((tx) => {
    if (input.type === "delivered") {
      tx.update(messageEntries)
        .set({
          status: "delivered",
          deliveredAt: input.occurredAt,
          updatedAt: now,
        })
        .where(eq(messageEntries.id, message.id))
        .run();
    }
    if (input.type === "bounced") {
      tx.update(messageEntries)
        .set({ status: "failed", updatedAt: now })
        .where(eq(messageEntries.id, message.id))
        .run();
      tx.update(outboxJobs)
        .set({
          status: "failed",
          lastError: input.reason || "邮件被退回。",
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(outboxJobs.id, job.id))
        .run();
    }
    if (
      ["bounced", "complained", "unsubscribed"].includes(input.type) &&
      input.recipient
    )
      suppress({
        workspaceId: connection.workspaceId,
        destination: input.recipient,
        reason:
          input.reason ||
          (input.type === "bounced"
            ? "退信"
            : input.type === "complained"
              ? "投诉"
              : "用户退订"),
        eventId,
        now,
      });

    if (input.type === "inbound_reply") {
      const inboundId = createId("msg");
      tx.insert(messageEntries)
        .values({
          id: inboundId,
          workspaceId: connection.workspaceId,
          threadId: thread.id,
          direction: "inbound",
          messageType: "text",
          body: input.body || "（空回复）",
          status: "received",
          channel: "邮件",
          senderLabel: input.sender || "客户回复",
          externalId: input.providerEventId,
          metadataJson: JSON.stringify({
            source: "channel_webhook",
            connectionId: connection.id,
            replyToExternalId: input.externalMessageId,
          }),
          createdAt: input.occurredAt,
          updatedAt: now,
        })
        .run();
      tx.update(messageThreads)
        .set({
          lastMessagePreview: input.body || "（空回复）",
          lastMessageAt: input.occurredAt,
          lastInboundAt: input.occurredAt,
          unreadCount: sql`${messageThreads.unreadCount} + 1`,
          updatedAt: now,
        })
        .where(eq(messageThreads.id, thread.id))
        .run();
      if (thread.campaignId) {
        tx.update(campaigns)
          .set({
            replyCount: sql`${campaigns.replyCount} + 1`,
            updatedAt: now,
          })
          .where(eq(campaigns.id, thread.campaignId))
          .run();
        if (thread.customerId)
          tx.update(campaignAudienceMembers)
            .set({ status: "replied", lastEventAt: now, updatedAt: now })
            .where(
              and(
                eq(campaignAudienceMembers.campaignId, thread.campaignId),
                eq(campaignAudienceMembers.customerId, thread.customerId),
              ),
            )
            .run();
      }
    }

    if (
      thread.campaignId &&
      [
        "delivered",
        "bounced",
        "complained",
        "unsubscribed",
        "inbound_reply",
      ].includes(input.type)
    )
      tx.insert(campaignExecutionEvents)
        .values({
          id: createId("cev"),
          workspaceId: connection.workspaceId,
          campaignId: thread.campaignId,
          eventType: `message_${input.type}`,
          status: input.type === "bounced" ? "failed" : "completed",
          recipientCount: 1,
          metadataJson: JSON.stringify({
            outboxJobId: job.id,
            messageId: message.id,
            channelEventId: eventId,
          }),
          createdAt: now,
        })
        .run();
    tx.insert(messageDeliveryEvents)
      .values({
        id: createId("mde"),
        workspaceId: connection.workspaceId,
        outboxJobId: job.id,
        messageId: message.id,
        eventType: input.type,
        status: input.type === "bounced" ? "failed" : "completed",
        metadataJson: JSON.stringify({
          channelEventId: eventId,
          reason: input.reason ?? null,
        }),
        createdAt: now,
      })
      .run();
    tx.update(channelWebhookEvents)
      .set({
        processingStatus: "processed",
        processingError: null,
        processedAt: now,
      })
      .where(eq(channelWebhookEvents.id, eventId))
      .run();
  });
  return {
    duplicate: false,
    status: "processed",
    eventId,
    threadId: thread.id,
  };
};

export const listRecentChannelEvents = (workspaceId: string, limit = 50) =>
  db
    .select()
    .from(channelWebhookEvents)
    .where(eq(channelWebhookEvents.workspaceId, workspaceId))
    .orderBy(desc(channelWebhookEvents.createdAt))
    .limit(limit)
    .all()
    .map((item) => ({
      ...item,
      payload: JSON.parse(item.payloadJson) as Record<string, unknown>,
    }));
