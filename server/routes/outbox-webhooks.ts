import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { outboundChannelConnections } from "../db/schema.js";
import { decryptSecret } from "../lib/secret-vault.js";
import { processChannelEvent } from "../outbox/events.js";
import { verifyWebhookSignature } from "../outbox/webhook-signature.js";

const eventInput = z.object({
  providerEventId: z.string().trim().min(1).max(200),
  type: z.enum([
    "delivered",
    "bounced",
    "complained",
    "unsubscribed",
    "inbound_reply",
  ]),
  externalMessageId: z.string().trim().min(1).max(500).optional(),
  sender: z.string().trim().email().optional(),
  recipient: z.string().trim().email().optional(),
  subject: z.string().trim().max(500).optional(),
  body: z.string().max(100_000).optional(),
  reason: z.string().trim().max(1000).optional(),
  occurredAt: z.number().int().positive(),
});

export const outboxWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/:connectionId", async (request, reply) => {
    const connectionId = (request.params as { connectionId: string })
      .connectionId;
    const parsed = eventInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_EVENT",
        message: parsed.error.issues[0]?.message,
      });
    const connection = (await db.$first(db
          .select()
          .from(outboundChannelConnections)
          .where(
            and(
              eq(outboundChannelConnections.id, connectionId),
              eq(outboundChannelConnections.enabled, true),
            ),
          )));
    if (
      !connection?.webhookSecretCiphertext ||
      !connection.webhookSecretIv ||
      !connection.webhookSecretTag
    )
      return reply.code(404).send({
        error: "WEBHOOK_NOT_CONFIGURED",
        message: "渠道事件接收尚未配置。",
      });
    const secret = decryptSecret({
      ciphertext: connection.webhookSecretCiphertext,
      iv: connection.webhookSecretIv,
      tag: connection.webhookSecretTag,
    });
    const verified = verifyWebhookSignature({
      secret,
      timestamp: request.headers["x-sondara-timestamp"] as string | undefined,
      signature: request.headers["x-sondara-signature"] as string | undefined,
      payload: parsed.data,
    });
    if (!verified)
      return reply.code(401).send({
        error: "INVALID_SIGNATURE",
        message: "渠道事件签名无效或已过期。",
      });
    const result = (await processChannelEvent(connection, parsed.data));
    return reply.code(result.status === "unlinked" ? 202 : 200).send(result);
  });
};
