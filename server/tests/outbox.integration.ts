import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../app.js";
import { db } from "../db/client.js";
import {
  channelWebhookEvents,
  contactSuppressions,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  outboxJobs,
  users,
} from "../db/schema.js";
import { processOutboxJob } from "../outbox/service.js";
import { signWebhookPayload } from "../outbox/webhook-signature.js";

const run = async () => {
  const received: string[] = [];
  const smtp = new SMTPServer({
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      callback(
        auth.username === "smtp-user" && auth.password === "smtp-pass"
          ? null
          : new Error("Invalid credentials"),
        { user: auth.username },
      );
    },
    onData(stream, _session, callback) {
      let body = "";
      stream.on("data", (chunk) => {
        body += chunk.toString();
      });
      stream.on("end", () => {
        received.push(body);
        callback();
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    smtp.once("error", reject);
    smtp.listen(0, "127.0.0.1", resolve);
  });
  const port = (smtp.server.address() as AddressInfo).port;
  const app = await buildApp();
  const email = `outbox-${Date.now()}@integration.local`;
  let userId = "";
  try {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { displayName: "发送队列测试", email, password: "Outbox@2026" },
    });
    assert.equal(register.statusCode, 201, register.body);
    userId = register.json().user.id;
    const workspaceId = register.json().workspace.id;
    const cookie = register.headers["set-cookie"];
    assert.ok(cookie);
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie };

    const connection = await app.inject({
      method: "POST",
      url: "/api/outbox/connections",
      headers,
      payload: {
        name: "本地 SMTP 测试",
        host: "127.0.0.1",
        port,
        secure: false,
        username: "smtp-user",
        password: "smtp-pass",
        fromName: "Sondara 测试",
        fromEmail: "sender@example.com",
        priority: 1,
      },
    });
    assert.equal(connection.statusCode, 201, connection.body);
    assert.equal(connection.json().hasSecret, true);
    assert.match(connection.json().webhookSecret, /^whsec_/);
    assert.equal("password" in connection.json(), false);
    const stored = db
      .select()
      .from(outboundChannelConnections)
      .where(eq(outboundChannelConnections.id, connection.json().id))
      .get()!;
    assert.notEqual(stored.secretCiphertext, "smtp-pass");

    const tested = await app.inject({
      method: "POST",
      url: `/api/outbox/connections/${connection.json().id}/test`,
      headers,
    });
    assert.equal(tested.statusCode, 200, tested.body);
    assert.equal(tested.json().ok, true);

    const thread = await app.inject({
      method: "POST",
      url: "/api/inbox/threads",
      headers,
      payload: {
        subject: "SMTP 闭环验证",
        channel: "邮件",
        contact: {
          name: "测试收件人",
          company: "测试客户",
          primaryChannel: "邮件",
          email: "recipient@example.com",
        },
        initialMessage: "请发送后续资料。",
      },
    });
    assert.equal(thread.statusCode, 201, thread.body);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/inbox/threads/${thread.json().id}/replies/confirm`,
      headers,
      payload: { body: "这是经过人工确认的测试邮件。", confirmation: true },
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal(confirmed.json().delivery.status, "queued");
    const jobId = confirmed.json().delivery.jobId;
    const processed = await processOutboxJob(jobId);
    assert.equal(processed.status, "sent");
    assert.equal(received.length, 1);
    assert.match(received[0], /To: recipient@example\.com/);
    assert.equal(
      db
        .select()
        .from(outboxJobs)
        .where(and(eq(outboxJobs.id, jobId), eq(outboxJobs.status, "sent")))
        .all().length,
      1,
    );
    assert.equal(
      db
        .select()
        .from(messageEntries)
        .where(
          and(
            eq(messageEntries.id, confirmed.json().message.id),
            eq(messageEntries.status, "sent"),
          ),
        )
        .all().length,
      1,
    );
    assert.ok(
      db
        .select()
        .from(messageDeliveryEvents)
        .where(
          and(
            eq(messageDeliveryEvents.outboxJobId, jobId),
            eq(messageDeliveryEvents.eventType, "sent"),
          ),
        )
        .get(),
    );

    const webhookSecret = connection.json().webhookSecret as string;
    const sendEvent = (
      payload: Record<string, unknown>,
      signatureOverride?: string,
    ) => {
      const timestamp = Date.now();
      return app.inject({
        method: "POST",
        url: `/api/outbox-webhooks/${connection.json().id}`,
        headers: {
          "x-sondara-timestamp": String(timestamp),
          "x-sondara-signature":
            signatureOverride ??
            signWebhookPayload(webhookSecret, timestamp, payload),
        },
        payload,
      });
    };
    const invalid = await sendEvent(
      {
        providerEventId: "evt-invalid",
        type: "delivered",
        externalMessageId: processed.externalId,
        recipient: "recipient@example.com",
        occurredAt: Date.now(),
      },
      "sha256=invalid",
    );
    assert.equal(invalid.statusCode, 401, invalid.body);
    const stalePayload = {
      providerEventId: "evt-stale",
      type: "delivered",
      externalMessageId: processed.externalId,
      recipient: "recipient@example.com",
      occurredAt: Date.now(),
    };
    const staleTimestamp = Date.now() - 10 * 60_000;
    const stale = await app.inject({
      method: "POST",
      url: `/api/outbox-webhooks/${connection.json().id}`,
      headers: {
        "x-sondara-timestamp": String(staleTimestamp),
        "x-sondara-signature": signWebhookPayload(
          webhookSecret,
          staleTimestamp,
          stalePayload,
        ),
      },
      payload: stalePayload,
    });
    assert.equal(stale.statusCode, 401, stale.body);
    const deliveredPayload = {
      providerEventId: "evt-delivered-1",
      type: "delivered",
      externalMessageId: processed.externalId,
      recipient: "recipient@example.com",
      occurredAt: Date.now(),
    };
    const delivered = await sendEvent(deliveredPayload);
    assert.equal(delivered.statusCode, 200, delivered.body);
    assert.equal(delivered.json().status, "processed");
    const duplicate = await sendEvent(deliveredPayload);
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(duplicate.json().duplicate, true);
    assert.equal(
      db
        .select()
        .from(messageEntries)
        .where(eq(messageEntries.id, confirmed.json().message.id))
        .get()?.status,
      "delivered",
    );

    const replyEvent = await sendEvent({
      providerEventId: "evt-reply-1",
      type: "inbound_reply",
      externalMessageId: processed.externalId,
      sender: "recipient@example.com",
      recipient: "sender@example.com",
      subject: "Re: SMTP 闭环验证",
      body: "资料已收到，请继续沟通。",
      occurredAt: Date.now(),
    });
    assert.equal(replyEvent.statusCode, 200, replyEvent.body);
    assert.equal(
      db
        .select()
        .from(messageEntries)
        .where(
          and(
            eq(messageEntries.threadId, thread.json().id),
            eq(messageEntries.direction, "inbound"),
          ),
        )
        .all().length,
      2,
    );
    assert.ok(
      (db
        .select()
        .from(messageThreads)
        .where(eq(messageThreads.id, thread.json().id))
        .get()?.unreadCount ?? 0) >= 2,
    );

    const unsubscribe = await sendEvent({
      providerEventId: "evt-unsubscribe-1",
      type: "unsubscribed",
      externalMessageId: processed.externalId,
      recipient: "recipient@example.com",
      reason: "客户点击退订",
      occurredAt: Date.now(),
    });
    assert.equal(unsubscribe.statusCode, 200, unsubscribe.body);
    const bounced = await sendEvent({
      providerEventId: "evt-bounced-1",
      type: "bounced",
      externalMessageId: processed.externalId,
      recipient: "recipient@example.com",
      reason: "mailbox disabled",
      occurredAt: Date.now(),
    });
    assert.equal(bounced.statusCode, 200, bounced.body);
    assert.equal(
      db.select().from(outboxJobs).where(eq(outboxJobs.id, jobId)).get()
        ?.status,
      "failed",
    );
    assert.equal(
      db
        .select()
        .from(contactSuppressions)
        .where(
          and(
            eq(contactSuppressions.workspaceId, workspaceId),
            eq(contactSuppressions.destination, "recipient@example.com"),
            eq(contactSuppressions.active, true),
          ),
        )
        .all().length,
      1,
    );
    assert.equal(
      db
        .select()
        .from(channelWebhookEvents)
        .where(eq(channelWebhookEvents.workspaceId, workspaceId))
        .all().length,
      4,
    );

    const blockedThread = await app.inject({
      method: "POST",
      url: "/api/inbox/threads",
      headers,
      payload: {
        subject: "抑制名单验证",
        channel: "邮件",
        contact: {
          name: "退订联系人",
          company: "另一测试客户",
          primaryChannel: "邮件",
          email: "recipient@example.com",
        },
      },
    });
    assert.equal(blockedThread.statusCode, 201, blockedThread.body);
    const blockedReply = await app.inject({
      method: "POST",
      url: `/api/inbox/threads/${blockedThread.json().id}/replies/confirm`,
      headers,
      payload: { body: "这封邮件不应被发送。", confirmation: true },
    });
    assert.equal(blockedReply.statusCode, 201, blockedReply.body);
    assert.equal(blockedReply.json().delivery.status, "cancelled");

    const suppressionList = await app.inject({
      method: "GET",
      url: "/api/outbox/suppressions?status=active",
      headers,
    });
    assert.equal(suppressionList.statusCode, 200, suppressionList.body);
    assert.equal(suppressionList.json().total, 1);
    const restored = await app.inject({
      method: "POST",
      url: `/api/outbox/suppressions/${suppressionList.json().items[0].id}/restore`,
      headers,
      payload: { confirmation: true },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().active, false);
    console.log(
      "Outbox integration passed: encrypted SMTP, signed idempotent events, inbound replies, suppression and restore verified.",
    );
  } finally {
    if (userId) db.delete(users).where(eq(users.id, userId)).run();
    await app.close();
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
