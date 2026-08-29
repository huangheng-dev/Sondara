import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
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
import { stopCampaignAudienceForCustomer } from "../campaigns/audience-lifecycle.js";
import { cancelPendingAutomatedMessagesForThread } from "./automation-stop.js";
import { applyInboundIntentAutomation } from "../inbox/intent-automation.js";
import { enforceAutomationCircuitBreaker } from "../radar/production-control.js";
import { persistReplySuggestion, recordOutcome } from "../automation/closed-loop.js";

export type ChannelEventInput = {
  providerEventId: string;
  type:
    | "delivered"
    | "bounced"
    | "complained"
    | "unsubscribed"
    | "inbound_reply";
  channel?: "email" | "whatsapp" | "webhook";
  externalMessageId?: string;
  sender?: string;
  recipient?: string;
  subject?: string;
  body?: string;
  reason?: string;
  occurredAt: number;
};

const normalizeDestination = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/[^\d+]/g, "");

const isWhatsAppEvent = (channel?: string) =>
  channel === "whatsapp";

/**
 * For an inbound event with no matching outbox job, try to find or create a
 * contact and thread using the sender's phone number (WhatsApp) or email.
 * Returns the thread id, or null if we cannot resolve one.
 */
const resolveOrCreateInboundThread = async (tx: typeof db, workspaceId: string, input: ChannelEventInput, now: number): Promise<string | null> => {
  const channel = isWhatsAppEvent(input.channel) ? "WhatsApp" : "邮件";
  const senderValue = input.sender?.trim();
  if (!senderValue) return null;

  // Find an existing contact by email or phone
  const contactConditions = isWhatsAppEvent(input.channel)
    ? [eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.phone, normalizePhone(senderValue))]
    : [eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.email, senderValue.toLowerCase())];
  let contact: typeof inboxContacts.$inferSelect | null = (await tx.$first(tx.select().from(inboxContacts).where(and(...contactConditions)))) ?? null;

  // If no contact found and it's WhatsApp, try matching by last 10 digits of phone
  if (!contact && isWhatsAppEvent(input.channel)) {
    const digits = normalizePhone(senderValue).replace(/^\+/, "");
    const tail = digits.slice(-10);
    if (tail.length >= 8) {
      const allContacts = await tx.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, workspaceId), isNotNull(inboxContacts.phone)));
      contact = allContacts.find(c => {
        const cDigits = normalizePhone(c.phone ?? "").replace(/^\+/, "");
        return cDigits.endsWith(tail);
      }) ?? null;
    }
  }

  if (!contact) {
    // Auto-create a minimal contact from the inbound sender
    const newContactId = createId("ict");
    const company = isWhatsAppEvent(input.channel) ? senderValue : (senderValue.split("@")[1] ?? "未知企业");
    await tx.insert(inboxContacts).values({
      id: newContactId,
      workspaceId,
      customerId: null,
      name: isWhatsAppEvent(input.channel) ? `WhatsApp ${senderValue.slice(-4)}` : senderValue,
      company,
      jobTitle: "待补全",
      region: "待补全",
      source: isWhatsAppEvent(input.channel) ? "WhatsApp 入站消息" : "邮件回复",
      primaryChannel: channel,
      email: isWhatsAppEvent(input.channel) ? null : senderValue.toLowerCase(),
      phone: isWhatsAppEvent(input.channel) ? normalizePhone(senderValue) : null,
      externalRef: null,
      verificationStatus: "verified",
      verifiedAt: now,
      verificationSource: isWhatsAppEvent(input.channel) ? "WhatsApp 入站消息" : "邮件回复",
      createdAt: now,
      updatedAt: now,
    });
    contact = (await tx.$first(tx.select().from(inboxContacts).where(eq(inboxContacts.id, newContactId)))) ?? null;
    if (!contact) return null;
  } else {
    // Mark contact as verified since we received an actual message
    await tx.update(inboxContacts).set({
      verificationStatus: "verified",
      verifiedAt: now,
      verificationSource: isWhatsAppEvent(input.channel) ? "WhatsApp 入站消息" : "邮件回复",
      updatedAt: now,
    }).where(eq(inboxContacts.id, contact.id));
  }

  // Find an existing open thread for this contact
  const existingThread = await tx.$first(tx.select().from(messageThreads).where(and(
    eq(messageThreads.workspaceId, workspaceId),
    eq(messageThreads.contactId, contact.id),
  )));
  if (existingThread) return existingThread.id;

  // Create a new thread
  const threadId = createId("mth");
  const subject = input.subject
    ?? (isWhatsAppEvent(input.channel) ? `WhatsApp · ${contact.name}` : `回复 · ${contact.name}`);
  await tx.insert(messageThreads).values({
    id: threadId,
    workspaceId,
    customerId: contact.customerId,
    contactId: contact.id,
    subject,
    channel,
    lastMessagePreview: input.body ?? "",
    lastMessageAt: input.occurredAt,
    lastInboundAt: input.occurredAt,
    unreadCount: 1,
    campaignId: null,
    createdAt: now,
    updatedAt: now,
  });
  return threadId;
};

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
  channel: string;
  destination: string;
  reason: string;
  eventId: string;
  now: number;
}, executor: typeof db = db) =>
  (await executor
        .insert(contactSuppressions)
        .values({
          id: createId("sup"),
          workspaceId: input.workspaceId,
          channel: input.channel,
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
    // For inbound replies with no matching outbox job, try to resolve or create
    // a thread from the sender (WhatsApp inbound or unsolicited email reply).
    if (input.type === "inbound_reply" && input.sender) {
      let resolvedThreadId: string | null = null;
      await db.transaction(async (tx) => {
        resolvedThreadId = await resolveOrCreateInboundThread(tx as unknown as typeof db, connection.workspaceId, input, now);
      });
      if (resolvedThreadId) {
        const resolvedThread = await db.$first(db.select().from(messageThreads).where(eq(messageThreads.id, resolvedThreadId)));
        if (resolvedThread) {
          const inboundId = createId("msg");
          const channel = isWhatsAppEvent(input.channel) ? "WhatsApp" : "邮件";
          await db.insert(messageEntries).values({
            id: inboundId,
            workspaceId: connection.workspaceId,
            threadId: resolvedThread.id,
            direction: "inbound",
            messageType: "text",
            body: input.body || "(空消息)",
            status: "received",
            channel,
            senderLabel: input.sender,
            externalId: input.providerEventId,
            metadataJson: JSON.stringify({ source: "channel_webhook_unlinked", connectionId: connection.id }),
            createdAt: input.occurredAt,
            updatedAt: now,
          });
          await db.update(messageThreads).set({
            lastMessagePreview: input.body || "(空消息)",
            lastMessageAt: input.occurredAt,
            lastInboundAt: input.occurredAt,
            unreadCount: sql`${messageThreads.unreadCount} + 1`,
            updatedAt: now,
          }).where(eq(messageThreads.id, resolvedThread.id));
          await cancelPendingAutomatedMessagesForThread({
            workspaceId: connection.workspaceId,
            threadId: resolvedThread.id,
            reason: "客户已回复，自动取消剩余跟进。",
          });
          await applyInboundIntentAutomation({
            workspaceId: connection.workspaceId,
            threadId: resolvedThread.id,
            customerId: resolvedThread.customerId,
            fromAddress: input.sender,
            subject: input.subject ?? resolvedThread.subject,
            body: input.body ?? "",
            receivedAt: input.occurredAt,
          });
          void persistReplySuggestion({ workspaceId: connection.workspaceId, threadId: resolvedThread.id }).catch(() => undefined);
          await db.update(channelWebhookEvents).set({
            processingStatus: "processed",
            processingError: null,
            processedAt: now,
          }).where(eq(channelWebhookEvents.id, eventId));
          return { duplicate: false, status: "processed", eventId, threadId: resolvedThread.id, createdThread: true };
        }
      }
    }
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
        ) {
          const suppressChannel = isWhatsAppEvent(input.channel) ? "whatsapp" : "email";
          await suppress({
            workspaceId: connection.workspaceId,
            channel: suppressChannel,
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
          }, tx as unknown as typeof db);
        }

        if (input.type === "inbound_reply") {
          const inboundId = createId("msg");
          const replyChannel = isWhatsAppEvent(input.channel) ? "WhatsApp" : "邮件";
          await tx.insert(messageEntries)
                    .values({
                      id: inboundId,
                      workspaceId: connection.workspaceId,
                      threadId: thread.id,
                      direction: "inbound",
                      messageType: "text",
                      body: input.body || "（空回复）",
                      status: "received",
                      channel: replyChannel,
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
  if (thread.customerId) {
    const stopReason = input.type === "inbound_reply"
      ? "客户回复"
      : input.type === "unsubscribed"
        ? "退订"
        : input.type === "bounced"
          ? "退信"
          : input.type === "complained"
            ? "投诉"
            : null;
    if (stopReason)
      await stopCampaignAudienceForCustomer({
        workspaceId: connection.workspaceId,
        customerId: thread.customerId,
        reason: stopReason,
      });
  }
  if (["inbound_reply", "unsubscribed", "bounced", "complained"].includes(input.type)) {
    const reason = input.type === "inbound_reply"
      ? "客户已回复，自动取消剩余跟进。"
      : input.type === "unsubscribed"
        ? "客户已退订，自动取消剩余跟进。"
        : input.type === "bounced"
          ? "地址退信，自动取消剩余跟进。"
          : "客户投诉，自动取消剩余跟进。";
    await cancelPendingAutomatedMessagesForThread({ workspaceId: connection.workspaceId, threadId: thread.id, reason });
  }
  if (input.type === "inbound_reply") {
    await applyInboundIntentAutomation({
      workspaceId: connection.workspaceId,
      threadId: thread.id,
      customerId: thread.customerId,
      fromAddress: input.sender ?? "",
      subject: input.subject ?? thread.subject,
      body: input.body ?? "",
      receivedAt: input.occurredAt,
    });
    void persistReplySuggestion({ workspaceId: connection.workspaceId, threadId: thread.id }).catch(() => undefined);
  }
  if (["bounced", "complained", "unsubscribed"].includes(input.type)) {
    if (thread.customerId) await recordOutcome({ workspaceId: connection.workspaceId, customerId: thread.customerId, threadId: thread.id,
      outcome: input.type === 'bounced' ? 'bounced' : input.type === 'unsubscribed' ? 'unsubscribed' : 'disqualified', reasonCode: input.type, note: input.reason ?? '', source: 'channel_event', occurredAt: input.occurredAt })
    await enforceAutomationCircuitBreaker(connection.workspaceId);
  }
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
