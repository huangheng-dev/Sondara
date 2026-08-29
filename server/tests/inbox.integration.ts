import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import {
  campaignExecutionEvents,
  customers,
  inboxContacts,
  messageEntries,
  messageThreadReads,
  messageThreads,
  outboxJobs,
  tasks,
  users,
} from "../db/schema.js";
import { ingestMail } from "../inbox/imap-receiver.js";

const run = async () => {
  const app = await buildApp();
  const email = `inbox-${Date.now()}@integration.local`;
  let userId = "";
  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { displayName: "消息集成测试", email, password: "Inbox@2026" },
    });
    assert.equal(register.statusCode, 201, register.body);
    userId = register.json().user.id;
    const workspaceId = register.json().workspace.id;
    const cookie = register.headers["set-cookie"];
    assert.ok(cookie);
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie };

    const customer = await app.inject({
      method: "POST",
      url: "/api/customers",
      headers,
      payload: {
        company: "消息客户有限公司",
        region: "上海",
        industry: "工业设备",
        score: 90,
        signal: "主动回复",
      },
    });
    assert.equal(customer.statusCode, 201, customer.body);
    const campaign = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      headers,
      payload: {
        name: "消息联动活动",
        market: "华东工业设备",
        channel: "邮件",
      },
    });
    assert.equal(campaign.statusCode, 201, campaign.body);

    const created = await app.inject({
      method: "POST",
      url: "/api/inbox/threads",
      headers,
      payload: {
        customerId: customer.json().id,
        campaignId: campaign.json().id,
        subject: "验证资料沟通",
        channel: "邮件",
        intent: "高意向",
        contact: {
          name: "王采购",
          company: "消息客户有限公司",
          jobTitle: "采购负责人",
          region: "上海",
          source: "营销活动",
          primaryChannel: "邮件",
          email: "buyer@example.com",
        },
        initialMessage: "请发送完整验证资料目录。",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const threadId = created.json().id;
    assert.equal(created.json().unreadCount, 1);
    assert.equal(created.json().contact.name, "王采购");

    const second = await app.inject({
      method: "POST",
      url: "/api/inbox/threads",
      headers,
      payload: {
        subject: "第二条对话",
        channel: "LinkedIn",
        intent: "待跟进",
        contact: {
          name: "李工程师",
          company: "另一家企业",
          primaryChannel: "LinkedIn",
        },
        initialMessage: "下周再联系。",
      },
    });
    assert.equal(second.statusCode, 201, second.body);

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/inbox/threads?limit=1",
      headers,
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    assert.equal(firstPage.json().items.length, 1);
    assert.equal(firstPage.json().hasMore, true);
    assert.ok(firstPage.json().nextCursor);
    const nextPage = await app.inject({
      method: "GET",
      url: `/api/inbox/threads?limit=1&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`,
      headers,
    });
    assert.equal(nextPage.statusCode, 200, nextPage.body);
    assert.equal(nextPage.json().items.length, 1);
    assert.notEqual(nextPage.json().items[0].id, firstPage.json().items[0].id);

    const messages = await app.inject({
      method: "GET",
      url: `/api/inbox/threads/${threadId}/messages?limit=10`,
      headers,
    });
    assert.equal(messages.statusCode, 200, messages.body);
    assert.equal(messages.json().items.length, 1);
    assert.equal(messages.json().items[0].direction, "inbound");

    const suggestion = await app.inject({
      method: "POST",
      url: `/api/inbox/threads/${threadId}/reply-suggestion`,
      headers,
    });
    assert.equal(suggestion.statusCode, 200, suggestion.body);
    assert.equal(suggestion.json().status, "fallback");
    assert.equal(suggestion.json().source, "rule");
    assert.equal(suggestion.json().requiresHumanConfirmation, true);
    assert.match(suggestion.json().draft, /感谢您的回复/);
    assert.equal((await db.select().from(messageEntries).where(eq(messageEntries.threadId, threadId))).length, 1);

    await db.update(messageThreads).set({ status: "closed", updatedAt: Date.now() }).where(eq(messageThreads.id, second.json().id));
    const blockedSuggestion = await app.inject({ method: "POST", url: `/api/inbox/threads/${second.json().id}/reply-suggestion`, headers });
    assert.equal(blockedSuggestion.statusCode, 200, blockedSuggestion.body);
    assert.equal(blockedSuggestion.json().status, "blocked");
    const blockedReply = await app.inject({ method: "POST", url: `/api/inbox/threads/${second.json().id}/replies/confirm`, headers, payload: { body: "不应发送", confirmation: true } });
    assert.equal(blockedReply.statusCode, 409, blockedReply.body);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/inbox/threads/${threadId}/replies/confirm`,
      headers,
      payload: { body: "已收到，稍后发送资料。" },
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/inbox/threads/${threadId}/replies/confirm`,
      headers,
      payload: { body: "已收到，稍后发送资料。", confirmation: true },
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal(confirmed.json().message.status, "confirmed");
    assert.equal(confirmed.json().delivery.mode, "outbox");
    assert.equal(confirmed.json().delivery.status, "awaiting_configuration");

    const marked = await app.inject({
      method: "POST",
      url: `/api/inbox/threads/${threadId}/read`,
      headers,
    });
    assert.equal(marked.statusCode, 200, marked.body);
    assert.equal(marked.json().unreadCount, 0);
    const highIntent = await app.inject({
      method: "GET",
      url: "/api/inbox/threads?filter=high_intent",
      headers,
    });
    assert.equal(highIntent.statusCode, 200, highIntent.body);
    assert.equal(highIntent.json().total, 1);

    assert.equal(
      (await db.$first(db
                .select()
                .from(messageThreads)
                .where(
                  and(
                    eq(messageThreads.id, threadId),
                    eq(messageThreads.workspaceId, workspaceId),
                  ),
                )))?.unreadCount,
      0,
    );
    assert.equal(
      (await db
                .select()
                .from(messageEntries)
                .where(
                  and(
                    eq(messageEntries.threadId, threadId),
                    eq(messageEntries.status, "confirmed"),
                  ),
                )).length,
      1,
    );
    assert.equal(
      (await db
                .select()
                .from(outboxJobs)
                .where(
                  and(
                    eq(outboxJobs.threadId, threadId),
                    eq(outboxJobs.status, "awaiting_configuration"),
                  ),
                )).length,
      1,
    );
    assert.ok(
      (await db.$first(db
                .select()
                .from(messageThreadReads)
                .where(eq(messageThreadReads.threadId, threadId)))),
    );
    assert.ok(
      (await db.$first(db
                .select()
                .from(campaignExecutionEvents)
                .where(
                  and(
                    eq(campaignExecutionEvents.campaignId, campaign.json().id),
                    eq(campaignExecutionEvents.eventType, "message_thread_created"),
                  ),
                ))),
    );
    assert.equal(
      (await db.$first(db
                .select()
                .from(customers)
                .where(eq(customers.id, customer.json().id))))?.interaction,
      "刚刚 · 已确认回复",
    );

    const organicResult = await ingestMail({
      connectionId: 'imap-integration', workspaceId, host: 'imap.example.com', port: 993,
      secure: true, user: 'sales@example.com', password: 'unused',
    }, {
      messageId: `organic-${Date.now()}@example.com`, fromAddress: 'buyer@newco.example.com', fromName: 'Alex Buyer',
      subject: 'Request for quotation', text: 'Please send pricing, lead time and a product catalog for our project.',
      inReplyTo: null, references: [], date: Date.now(),
    });
    assert.equal(organicResult, 'ingested');
    const organicCustomer = await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, workspaceId), eq(customers.company, 'newco.example.com'))));
    assert.ok(organicCustomer);
    assert.equal(organicCustomer?.signal, '主动邮件询盘');
    assert.equal((await db.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.customerId, organicCustomer!.id)))).length, 1);
    assert.equal((await db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.customerId, organicCustomer!.id), eq(tasks.source, '邮件询盘 · IMAP')))).length, 1);
    console.log(
      "Inbox integration passed: threads, contacts, AI-safe reply suggestions, closed-thread protection, cursor loading, confirmed replies and organic inquiry auto-entry verified.",
    );
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await app.close();
  }
};

run().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
