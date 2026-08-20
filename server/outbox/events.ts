import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  campaignAudienceMembers,
  campaignExecutionEvents,
  campaigns,
  channelWebhookEvents,
  contactSuppressions,
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

export const isDestinationSuppressed = async (
  workspaceId: string,
  destination: string,
) =>
  Boolean(
    (await db.$first(db
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
            ))),
  );

const suppress = async (input: {
  workspaceId: string;
  destination: string;
  reason: string;
  eventId: string;
  now: number;
}) =>
  (await db
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
        }));

export const processChannelEvent = async (
  connection: { id: string; workspaceId: string },
  input: ChannelEventInput,
) => {
  const existing = (await db.$first(db
      .select()
      .from(channelWebhookEvents)
      .where(
        and(
          eq(channelWebhookEvents.connectionId, connection.id),
          eq(channelWebhookEvents.providerEventId, input.providerEventId),
        ),
      )));
  if (existing)
    return {
      duplicate: true,
      status: existing.processingStatus,
      eventId: existing.id,
    };

  const now = Date.now();
  const eventId = createId("cwe");
  await db.insert(channelWebhookEvents)
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
        });

  const job = input.externalMessageId
    ? (await db.$first(db
              .select()
              .from(outboxJobs)
              .where(
                and(
                  eq(outboxJobs.workspaceId, connection.workspaceId),
                  eq(outboxJobs.externalId, input.externalMessageId),
                ),
              )))
    : null;
  if (!job) {
    await db.update(channelWebhookEvents)
            .set({
              processingStatus: "unlinked",
              processingError: "未找到匹配的外发消息。",
              processedAt: now,
            })
            .where(eq(channelWebhookEvents.id, eventId));
    return { duplicate: false, status: "unlinked", eventId };
  }

  const message = (await db.$first(db
      .select()
      .from(messageEntries)
      .where(eq(messageEntries.id, job.messageId))));
  const thread = (await db.$first(db
      .select()
      .from(messageThreads)
      .where(eq(messageThreads.id, job.threadId))));
  if (!message || !thread) {
    await db.update(channelWebhookEvents)
            .set({
              processingStatus: "failed",
              processingError: "消息线程已不存在。",
              processedAt: now,
            })
            .where(eq(channelWebhookEvents.id, eventId));
    return { duplicate: false, status: "failed", eventId };
  }

  await db.transaction(async (tx) => {
        if (input.type === "delivered") {
          await tx.update(messageEntries)
                    .set({
                      status: "delivered",
                      deliveredAt: input.occurredAt,
                      updatedAt: now,
                    })
                    .where(eq(messageEntries.id, message.id));
        }
        if (input.type === "bounced") {
          await tx.update(messageEntries)
                    .set({ status: "failed", updatedAt: now })
                    .where(eq(messageEntries.id, message.id));
          await tx.update(outboxJobs)
                    .set({
                      status: "failed",
                      lastError: input.reason || "邮件被退回。",
                      completedAt: now,
                      updatedAt: now,
                    })
                    .where(eq(outboxJobs.id, job.id));
        }
        if (
          ["bounced", "complained", "unsubscribed"].includes(input.type) &&
          input.recipient
        )
          await suppress({
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
          await tx.insert(messageEntries)
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
                    });
          await tx.update(messageThreads)
                    .set({
                      lastMessagePreview: input.body || "（空回复）",
                      lastMessageAt: input.occurredAt,
                      lastInboundAt: input.occurredAt,
                      unreadCount: sql`${messageThreads.unreadCount} + 1`,
                      updatedAt: now,
                    })
                    .where(eq(messageThreads.id, thread.id));
          if (thread.campaignId) {
            await tx.update(campaigns)
                        .set({
                          replyCount: sql`${campaigns.replyCount} + 1`,
                          updatedAt: now,
                        })
                        .where(eq(campaigns.id, thread.campaignId));
            if (thread.customerId)
              await tx.update(campaignAudienceMembers)
                            .set({ status: "replied", lastEventAt: now, updatedAt: now })
                            .where(
                              and(
                                eq(campaignAudienceMembers.campaignId, thread.campaignId),
                                eq(campaignAudienceMembers.customerId, thread.customerId),
                              ),
                            );
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
          await tx.insert(campaignExecutionEvents)
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
                    });
        await tx.insert(messageDeliveryEvents)
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
                });
        await tx.update(channelWebhookEvents)
                .set({
                  processingStatus: "processed",
                  processingError: null,
                  processedAt: now,
                })
                .where(eq(channelWebhookEvents.id, eventId));
      });
  return {
    duplicate: false,
    status: "processed",
    eventId,
    threadId: thread.id,
  };
};

export const listRecentChannelEvents = async (workspaceId: string, limit = 50) =>
  (await db
        .select()
        .from(channelWebhookEvents)
        .where(eq(channelWebhookEvents.workspaceId, workspaceId))
        .orderBy(desc(channelWebhookEvents.createdAt))
        .limit(limit))
    .map((item) => ({
      ...item,
      payload: JSON.parse(item.payloadJson) as Record<string, unknown>,
    }));
