import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, like, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  auditLogs,
  campaignExecutionEvents,
  campaigns,
  customers,
  inboxContacts,
  messageEntries,
  messageThreadReads,
  messageThreads,
  users,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { pickProvided } from "../lib/input.js";
import { requireAuth } from "../plugins/auth.js";
import { enqueueConfirmedMessage } from "../outbox/service.js";

const threadFilters = ["all", "unread", "high_intent", "follow_up"] as const;
const threadListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  channel: z.string().trim().max(80).optional(),
  filter: z.enum(threadFilters).default("all"),
  cursor: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const messageListQuery = z.object({
  cursor: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const contactInput = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(160),
  jobTitle: z.string().trim().max(120).default("待补全"),
  region: z.string().trim().max(120).default("待补全"),
  source: z.string().trim().max(160).default("客户消息"),
  primaryChannel: z.string().trim().max(80).default("邮件"),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  externalRef: z.string().trim().max(240).nullable().optional(),
});
const threadInput = z.object({
  customerId: z.string().trim().min(1).nullable().optional(),
  campaignId: z.string().trim().min(1).nullable().optional(),
  subject: z.string().trim().min(1).max(200).default("客户对话"),
  channel: z.string().trim().min(1).max(80).default("邮件"),
  intent: z.enum(["高意向", "待判断", "待跟进"]).default("待判断"),
  initialMessage: z.string().trim().min(1).max(4000).optional(),
  contact: contactInput,
});
const threadPatch = z.object({
  intent: z.enum(["高意向", "待判断", "待跟进"]).optional(),
  status: z.enum(["open", "archived"]).optional(),
});
const replyInput = z.object({
  body: z.string().trim().min(1).max(4000),
  confirmation: z.literal(true),
});

type Cursor = { timestamp: number; id: string };
const encodeCursor = (timestamp: number, id: string) =>
  Buffer.from(JSON.stringify({ timestamp, id }), "utf8").toString("base64url");
const decodeCursor = (value?: string): Cursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Cursor;
    return Number.isFinite(parsed.timestamp) && typeof parsed.id === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};
const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const writeAudit = async (
  workspaceId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown = {},
) => {
  await db.insert(auditLogs)
        .values({
          id: createId("aud"),
          workspaceId,
          actorUserId,
          action,
          entityType,
          entityId,
          metadata: JSON.stringify(metadata),
          createdAt: Date.now(),
        });
};
const requireThread = async (workspaceId: string, id: string) =>
  (await db.$first(db
        .select()
        .from(messageThreads)
        .where(
          and(
            eq(messageThreads.id, id),
            eq(messageThreads.workspaceId, workspaceId),
          ),
        )));
const serializeMessage = (entry: typeof messageEntries.$inferSelect) => ({
  ...entry,
  metadata: parseJson<Record<string, unknown>>(entry.metadataJson, {}),
});
const serializeThread = async (thread: typeof messageThreads.$inferSelect) => {
  const contact = (await db.$first(db
      .select()
      .from(inboxContacts)
      .where(
        and(
          eq(inboxContacts.id, thread.contactId),
          eq(inboxContacts.workspaceId, thread.workspaceId),
        ),
      )));
  return { ...thread, contact };
};

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/threads", async (request, reply) => {
    const parsed = threadListQuery.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message,
      });
    const query = parsed.data;
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor)
      return reply.code(400).send({
        error: "INVALID_CURSOR",
        message: "消息游标无效，请刷新后重试。",
      });
    const baseConditions = [
      eq(messageThreads.workspaceId, request.auth.workspaceId),
    ];
    if (query.q)
      baseConditions.push(
        or(
          like(inboxContacts.name, `%${query.q}%`),
          like(inboxContacts.company, `%${query.q}%`),
          like(messageThreads.subject, `%${query.q}%`),
          like(messageThreads.lastMessagePreview, `%${query.q}%`),
        )!,
      );
    if (query.channel && query.channel !== "全部渠道")
      baseConditions.push(eq(messageThreads.channel, query.channel));
    if (query.filter === "unread")
      baseConditions.push(sql`${messageThreads.unreadCount} > 0`);
    if (query.filter === "high_intent")
      baseConditions.push(eq(messageThreads.intent, "高意向"));
    if (query.filter === "follow_up")
      baseConditions.push(
        or(
          eq(messageThreads.intent, "待跟进"),
          eq(messageThreads.intent, "待判断"),
        )!,
      );
    const total =
      (await db.$first(db
                .select({ count: sql<number>`count(*)` })
                .from(messageThreads)
                .innerJoin(
                  inboxContacts,
                  eq(inboxContacts.id, messageThreads.contactId),
                )
                .where(and(...baseConditions))))?.count ?? 0;
    const listConditions = [...baseConditions];
    if (cursor)
      listConditions.push(
        or(
          lt(messageThreads.lastMessageAt, cursor.timestamp),
          and(
            eq(messageThreads.lastMessageAt, cursor.timestamp),
            lt(messageThreads.id, cursor.id),
          ),
        )!,
      );
    const rows = (await db
          .select({ thread: messageThreads })
          .from(messageThreads)
          .innerJoin(inboxContacts, eq(inboxContacts.id, messageThreads.contactId))
          .where(and(...listConditions))
          .orderBy(desc(messageThreads.lastMessageAt), desc(messageThreads.id))
          .limit(query.limit + 1));
    const hasMore = rows.length > query.limit;
    const visible = await Promise.all(rows
      .slice(0, query.limit)
      .map(async (row) => await serializeThread(row.thread)));
    const last = visible.at(-1);
    const unreadTotal =
      (await db.$first(db
                .select({
                  count: sql<number>`coalesce(sum(${messageThreads.unreadCount}), 0)`,
                })
                .from(messageThreads)
                .where(eq(messageThreads.workspaceId, request.auth.workspaceId))))?.count ?? 0;
    const channels = (await db
          .selectDistinct({ channel: messageThreads.channel })
          .from(messageThreads)
          .where(eq(messageThreads.workspaceId, request.auth.workspaceId)))
      .map((item) => item.channel);
    return {
      items: visible,
      total,
      unreadTotal,
      channels,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor(last.lastMessageAt, last.id) : null,
    };
  });

  app.post("/threads", async (request, reply) => {
    const parsed = threadInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message,
      });
    const input = parsed.data;
    if (
      input.customerId &&
      !(await db.$first(db
                .select({ id: customers.id })
                .from(customers)
                .where(
                  and(
                    eq(customers.id, input.customerId),
                    eq(customers.workspaceId, request.auth.workspaceId),
                  ),
                )))
    )
      return reply
        .code(404)
        .send({ error: "CUSTOMER_NOT_FOUND", message: "关联客户不存在。" });
    if (
      input.campaignId &&
      !(await db.$first(db
                .select({ id: campaigns.id })
                .from(campaigns)
                .where(
                  and(
                    eq(campaigns.id, input.campaignId),
                    eq(campaigns.workspaceId, request.auth.workspaceId),
                  ),
                )))
    )
      return reply
        .code(404)
        .send({ error: "CAMPAIGN_NOT_FOUND", message: "关联营销活动不存在。" });
    const now = Date.now();
    let contact = (await db.$first(db
          .select()
          .from(inboxContacts)
          .where(
            and(
              eq(inboxContacts.workspaceId, request.auth.workspaceId),
              eq(inboxContacts.company, input.contact.company),
              eq(inboxContacts.name, input.contact.name),
            ),
          )));
    const contactId = contact?.id ?? createId("ict");
    const threadId = createId("mth");
    const entryId = input.initialMessage ? createId("msg") : null;
    await db.transaction(async (tx) => {
            if (!contact)
              await tx.insert(inboxContacts)
                          .values({
                            id: contactId,
                            workspaceId: request.auth.workspaceId,
                            customerId: input.customerId ?? null,
                            ...input.contact,
                            email: input.contact.email ?? null,
                            phone: input.contact.phone ?? null,
                            externalRef: input.contact.externalRef ?? null,
                            createdAt: now,
                            updatedAt: now,
                          });
            await tx.insert(messageThreads)
                      .values({
                        id: threadId,
                        workspaceId: request.auth.workspaceId,
                        contactId,
                        customerId: input.customerId ?? contact?.customerId ?? null,
                        campaignId: input.campaignId ?? null,
                        subject: input.subject,
                        channel: input.channel,
                        intent: input.intent,
                        status: "open",
                        assigneeUserId: request.auth.userId,
                        lastMessagePreview: input.initialMessage ?? "",
                        lastMessageAt: now,
                        lastInboundAt: input.initialMessage ? now : null,
                        unreadCount: input.initialMessage ? 1 : 0,
                        createdAt: now,
                        updatedAt: now,
                      });
            if (entryId)
              await tx.insert(messageEntries)
                          .values({
                            id: entryId,
                            workspaceId: request.auth.workspaceId,
                            threadId,
                            direction: "inbound",
                            messageType: "text",
                            body: input.initialMessage!,
                            status: "received",
                            channel: input.channel,
                            senderLabel: input.contact.name,
                            metadataJson: JSON.stringify({ source: input.contact.source }),
                            createdAt: now,
                            updatedAt: now,
                          });
            if (input.campaignId)
              await tx.insert(campaignExecutionEvents)
                          .values({
                            id: createId("cev"),
                            workspaceId: request.auth.workspaceId,
                            campaignId: input.campaignId,
                            eventType: "message_thread_created",
                            status: "completed",
                            recipientCount: 1,
                            metadataJson: JSON.stringify({
                              threadId,
                              contactId,
                              direction: input.initialMessage ? "inbound" : "unknown",
                            }),
                            createdAt: now,
                          });
          });
    contact = (await db.$first(db
          .select()
          .from(inboxContacts)
          .where(eq(inboxContacts.id, contactId))));
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "message.thread_created",
      "message_thread",
      threadId,
      { contactId, campaignId: input.campaignId ?? null },
    );
    return reply.code(201).send({
      ...(await serializeThread((await requireThread(request.auth.workspaceId, threadId))!)),
      contact,
    });
  });

  app.get("/threads/:id/messages", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!(await requireThread(request.auth.workspaceId, id)))
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "消息线程不存在。" });
    const parsed = messageListQuery.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message,
      });
    const cursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor)
      return reply.code(400).send({
        error: "INVALID_CURSOR",
        message: "消息游标无效，请刷新后重试。",
      });
    const conditions = [
      eq(messageEntries.workspaceId, request.auth.workspaceId),
      eq(messageEntries.threadId, id),
    ];
    if (cursor)
      conditions.push(
        or(
          lt(messageEntries.createdAt, cursor.timestamp),
          and(
            eq(messageEntries.createdAt, cursor.timestamp),
            lt(messageEntries.id, cursor.id),
          ),
        )!,
      );
    const rows = (await db
          .select()
          .from(messageEntries)
          .where(and(...conditions))
          .orderBy(desc(messageEntries.createdAt), desc(messageEntries.id))
          .limit(parsed.data.limit + 1));
    const hasMore = rows.length > parsed.data.limit;
    const visible = rows.slice(0, parsed.data.limit);
    const oldest = visible.at(-1);
    return {
      items: visible.reverse().map(serializeMessage),
      hasMore,
      nextCursor:
        hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  });

  app.post("/threads/:id/read", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const thread = (await requireThread(request.auth.workspaceId, id));
    if (!thread)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "消息线程不存在。" });
    const latest = (await db.$first(db
          .select({ id: messageEntries.id })
          .from(messageEntries)
          .where(
            and(
              eq(messageEntries.workspaceId, request.auth.workspaceId),
              eq(messageEntries.threadId, id),
            ),
          )
          .orderBy(desc(messageEntries.createdAt), desc(messageEntries.id))));
    const now = Date.now();
    await db.transaction(async (tx) => {
            await tx.update(messageThreads)
                      .set({ unreadCount: 0, updatedAt: now })
                      .where(eq(messageThreads.id, id));
            await tx.insert(messageThreadReads)
                      .values({
                        id: createId("mrd"),
                        workspaceId: request.auth.workspaceId,
                        threadId: id,
                        userId: request.auth.userId,
                        lastReadMessageId: latest?.id ?? null,
                        lastReadAt: now,
                        createdAt: now,
                        updatedAt: now,
                      })
                      .onConflictDoUpdate({
                        target: [messageThreadReads.threadId, messageThreadReads.userId],
                        set: {
                          lastReadMessageId: latest?.id ?? null,
                          lastReadAt: now,
                          updatedAt: now,
                        },
                      });
          });
    return { id, unreadCount: 0, lastReadAt: now };
  });

  app.post("/threads/read-all", async (request) => {
    const now = Date.now();
    const threads = (await db
          .select()
          .from(messageThreads)
          .where(eq(messageThreads.workspaceId, request.auth.workspaceId)));
    await db.transaction(async (tx) => {
            await Promise.all(threads.map(async (thread) => {
              const latest = (await db.$first(tx
                        .select({ id: messageEntries.id })
                        .from(messageEntries)
                        .where(
                          and(
                            eq(messageEntries.threadId, thread.id),
                            eq(messageEntries.workspaceId, request.auth.workspaceId),
                          ),
                        )
                        .orderBy(desc(messageEntries.createdAt), desc(messageEntries.id))));
              await tx.update(messageThreads)
                          .set({ unreadCount: 0, updatedAt: now })
                          .where(eq(messageThreads.id, thread.id));
              await tx.insert(messageThreadReads)
                          .values({
                            id: createId("mrd"),
                            workspaceId: request.auth.workspaceId,
                            threadId: thread.id,
                            userId: request.auth.userId,
                            lastReadMessageId: latest?.id ?? null,
                            lastReadAt: now,
                            createdAt: now,
                            updatedAt: now,
                          })
                          .onConflictDoUpdate({
                            target: [messageThreadReads.threadId, messageThreadReads.userId],
                            set: {
                              lastReadMessageId: latest?.id ?? null,
                              lastReadAt: now,
                              updatedAt: now,
                            },
                          });
            }));
          });
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "message.all_read",
      "message_thread",
      request.auth.workspaceId,
      { count: threads.length },
    );
    return { updated: threads.length, unreadTotal: 0 };
  });

  app.post("/threads/:id/replies/confirm", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const thread = (await requireThread(request.auth.workspaceId, id));
    if (!thread)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "消息线程不存在。" });
    const parsed = replyInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "CONFIRMATION_REQUIRED",
        message: "回复必须由当前用户预览并确认。",
      });
    const now = Date.now();
    const messageId = createId("msg");
    const sender =
      (await db.$first(db
                .select({ displayName: users.displayName })
                .from(users)
                .where(eq(users.id, request.auth.userId))))?.displayName ?? "我";
    await db.transaction(async (tx) => {
            await tx.insert(messageEntries)
                      .values({
                        id: messageId,
                        workspaceId: request.auth.workspaceId,
                        threadId: id,
                        direction: "outbound",
                        messageType: "text",
                        body: parsed.data.body,
                        status: "confirmed",
                        channel: thread.channel,
                        senderLabel: sender,
                        confirmedByUserId: request.auth.userId,
                        confirmedAt: now,
                        metadataJson: JSON.stringify({
                          deliveryMode: "outbox",
                          userConfirmed: true,
                        }),
                        createdAt: now,
                        updatedAt: now,
                      });
            await tx.update(messageThreads)
                      .set({
                        lastMessagePreview: parsed.data.body,
                        lastMessageAt: now,
                        updatedAt: now,
                      })
                      .where(eq(messageThreads.id, id));
            if (thread.customerId)
              await tx.update(customers)
                          .set({
                            interaction: "刚刚 · 已确认回复",
                            nextAction: "等待渠道发送与客户回复",
                            updatedAt: now,
                          })
                          .where(
                            and(
                              eq(customers.id, thread.customerId),
                              eq(customers.workspaceId, request.auth.workspaceId),
                            ),
                          );
          });
    const queued = (await enqueueConfirmedMessage({
      workspaceId: request.auth.workspaceId,
      messageId,
      threadId: id,
      channel: thread.channel,
    }));
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "message.reply_confirmed",
      "message",
      messageId,
      {
        threadId: id,
        channel: thread.channel,
        deliveryMode: "outbox",
        outboxJobId: queued.id,
        status: queued.status,
      },
    );
    return reply.code(201).send({
      message: serializeMessage(
        (await db.$first(db
                    .select()
                    .from(messageEntries)
                    .where(eq(messageEntries.id, messageId))))!,
      ),
      delivery: {
        mode: "outbox",
        status: queued.status,
        jobId: queued.id,
        label:
          queued.status === "queued"
            ? "已确认并进入发送队列"
            : queued.status === "cancelled"
              ? "已确认，但收件地址位于抑制名单"
              : "已确认，等待配置发送服务",
      },
    });
  });

  app.patch("/threads/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = (await requireThread(request.auth.workspaceId, id));
    if (!existing)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "消息线程不存在。" });
    const parsed = threadPatch.safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length)
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", message: "没有可更新的字段。" });
    const changes = pickProvided(request.body, parsed.data);
    await db.update(messageThreads)
            .set({ ...changes, updatedAt: Date.now() })
            .where(
              and(
                eq(messageThreads.id, id),
                eq(messageThreads.workspaceId, request.auth.workspaceId),
              ),
            );
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "message.thread_updated",
      "message_thread",
      id,
      { fields: Object.keys(changes) },
    );
    return await serializeThread((await requireThread(request.auth.workspaceId, id))!);
  });
};
