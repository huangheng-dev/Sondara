import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  auditLogs,
  approvalRequests,
  campaignAudienceMembers,
  campaignContentLinks,
  campaignExecutionEvents,
  campaigns,
  campaignSteps,
  contentAssets,
  customers,
  inboxContacts,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  tasks,
  users,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { pickProvided } from "../lib/input.js";
import { requireAuth } from "../plugins/auth.js";
import { enqueueConfirmedMessage } from "../outbox/service.js";

const campaignStatuses = [
  "草稿",
  "运行中",
  "已暂停",
  "已完成",
  "已归档",
] as const;
const campaignInput = z.object({
  name: z.string().trim().min(1).max(180),
  market: z.string().trim().max(160).default("待补全"),
  audienceLabel: z.string().trim().max(180).default("待确认名单"),
  status: z.enum(campaignStatuses).default("草稿"),
  channel: z.string().trim().max(100).default("邮件"),
  stopRule: z.string().trim().max(160).default("收到回复"),
  timezone: z.string().trim().max(80).default("Asia/Shanghai"),
  startAt: z.number().int().nullable().optional(),
  nextRunAt: z.number().int().nullable().optional(),
  nextAction: z.string().trim().max(240).default("完善受众、内容与发送设置"),
  contentAssetId: z.string().trim().min(1).nullable().optional(),
  audienceCustomerIds: z.array(z.string().trim().min(1)).max(500).default([]),
});
const campaignPatch = campaignInput
  .omit({ contentAssetId: true, audienceCustomerIds: true })
  .partial()
  .extend({
    progress: z.number().int().min(0).max(100).optional(),
    sentCount: z.number().int().min(0).optional(),
    replyCount: z.number().int().min(0).optional(),
    opportunityCount: z.number().int().min(0).optional(),
    revenueAmount: z.number().int().min(0).optional(),
  });
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(campaignStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum([
      "progress_desc",
      "name_asc",
      "name_desc",
      "sent_desc",
      "opportunities_desc",
      "updated_desc",
    ])
    .default("progress_desc"),
});
const stepInput = z.object({
  name: z.string().trim().min(1).max(180),
  channel: z.string().trim().max(100).default("邮件"),
  contentAssetId: z.string().trim().min(1).nullable().optional(),
  scheduledAt: z.number().int().nullable().optional(),
  status: z
    .enum(["draft", "scheduled", "running", "completed", "cancelled"])
    .default("scheduled"),
  position: z.number().int().min(1).optional(),
  note: z.string().trim().max(500).optional(),
});

const writeAudit = async (
  workspaceId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  metadata: unknown = {},
) => {
  await db.insert(auditLogs)
        .values({
          id: createId("aud"),
          workspaceId,
          actorUserId,
          action,
          entityType: "campaign",
          entityId,
          metadata: JSON.stringify(metadata),
          createdAt: Date.now(),
        });
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const serializeCampaign = async (campaign: typeof campaigns.$inferSelect) => {
  const steps = (await db
      .select()
      .from(campaignSteps)
      .where(
        and(
          eq(campaignSteps.campaignId, campaign.id),
          eq(campaignSteps.workspaceId, campaign.workspaceId),
        ),
      )
      .orderBy(asc(campaignSteps.position)))
    .map((step) => ({ ...step, config: parseJson(step.configJson, {}) }));
  const links = (await db
      .select({
        id: campaignContentLinks.id,
        contentAssetId: campaignContentLinks.contentAssetId,
        position: campaignContentLinks.position,
        purpose: campaignContentLinks.purpose,
        title: contentAssets.title,
        contentType: contentAssets.contentType,
        status: contentAssets.status,
      })
      .from(campaignContentLinks)
      .innerJoin(
        contentAssets,
        eq(contentAssets.id, campaignContentLinks.contentAssetId),
      )
      .where(
        and(
          eq(campaignContentLinks.campaignId, campaign.id),
          eq(campaignContentLinks.workspaceId, campaign.workspaceId),
        ),
      )
      .orderBy(asc(campaignContentLinks.position)));
  const audienceCount =
    (await db.$first(db
            .select({ count: sql<number>`count(*)` })
            .from(campaignAudienceMembers)
            .where(
              and(
                eq(campaignAudienceMembers.campaignId, campaign.id),
                eq(campaignAudienceMembers.workspaceId, campaign.workspaceId),
              ),
            )))?.count ?? 0;
  const nextStep = steps.find(
    (step) => step.status === "scheduled" || step.status === "draft",
  );
  return {
    ...campaign,
    steps,
    contentItems: links,
    contentIds: links.map((link) => link.contentAssetId),
    audienceCount,
    replyRate:
      campaign.sentCount > 0
        ? Number(((campaign.replyCount / campaign.sentCount) * 100).toFixed(1))
        : null,
    nextStep: nextStep
      ? {
          id: nextStep.id,
          name: nextStep.name,
          scheduledAt: nextStep.scheduledAt,
          status: nextStep.status,
        }
      : null,
  };
};

const requireCampaign = async (workspaceId: string, id: string) =>
  (await db.$first(db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.id, id), eq(campaigns.workspaceId, workspaceId)))));

const linkContent = async (
  workspaceId: string,
  campaignId: string,
  contentAssetId: string,
  purpose = "触达内容",
) => {
  const asset = (await db.$first(db
      .select()
      .from(contentAssets)
      .where(
        and(
          eq(contentAssets.id, contentAssetId),
          eq(contentAssets.workspaceId, workspaceId),
        ),
      )));
  if (!asset)
    throw Object.assign(new Error("所选内容资产不存在。"), { statusCode: 404 });
  const existing = (await db.$first(db
      .select()
      .from(campaignContentLinks)
      .where(
        and(
          eq(campaignContentLinks.campaignId, campaignId),
          eq(campaignContentLinks.contentAssetId, contentAssetId),
        ),
      )));
  if (!existing) {
    const position =
      ((await db.$first(db
                .select({
                  max: sql<number>`coalesce(max(${campaignContentLinks.position}), 0)`,
                })
                .from(campaignContentLinks)
                .where(eq(campaignContentLinks.campaignId, campaignId))))?.max ?? 0) + 1;
    await db.insert(campaignContentLinks)
            .values({
              id: createId("ccl"),
              workspaceId,
              campaignId,
              contentAssetId,
              position,
              purpose,
              createdAt: Date.now(),
            });
  }
  const linked = [
    ...new Set([
      ...parseJson<string[]>(asset.linkedCampaignIdsJson, []),
      campaignId,
    ]),
  ];
  await db.update(contentAssets)
        .set({
          linkedCampaignIdsJson: JSON.stringify(linked),
          updatedAt: Date.now(),
        })
        .where(eq(contentAssets.id, contentAssetId));
};

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message,
      });
    const query = parsed.data;
    const conditions = [eq(campaigns.workspaceId, request.auth.workspaceId)];
    if (query.q)
      conditions.push(
        or(
          like(campaigns.name, `%${query.q}%`),
          like(campaigns.market, `%${query.q}%`),
          like(campaigns.audienceLabel, `%${query.q}%`),
        )!,
      );
    if (query.status) conditions.push(eq(campaigns.status, query.status));
    const where = and(...conditions);
    const orderBy =
      query.sort === "name_asc"
        ? asc(campaigns.name)
        : query.sort === "name_desc"
          ? desc(campaigns.name)
          : query.sort === "sent_desc"
            ? desc(campaigns.sentCount)
            : query.sort === "opportunities_desc"
              ? desc(campaigns.opportunityCount)
              : query.sort === "updated_desc"
                ? desc(campaigns.updatedAt)
                : desc(campaigns.progress);
    const total =
      (await db.$first(db
                .select({ count: sql<number>`count(*)` })
                .from(campaigns)
                .where(where)))?.count ?? 0;
    const items = await Promise.all((await db
          .select()
          .from(campaigns)
          .where(where)
          .orderBy(orderBy)
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize))
      .map(serializeCampaign));
    return { items, page: query.page, pageSize: query.pageSize, total };
  });

  app.get("/schedule", async (request) => {
    const items = (await db
          .select({
            id: campaignSteps.id,
            campaignId: campaignSteps.campaignId,
            campaignName: campaigns.name,
            name: campaignSteps.name,
            channel: campaignSteps.channel,
            status: campaignSteps.status,
            scheduledAt: campaignSteps.scheduledAt,
            position: campaignSteps.position,
          })
          .from(campaignSteps)
          .innerJoin(campaigns, eq(campaigns.id, campaignSteps.campaignId))
          .where(eq(campaignSteps.workspaceId, request.auth.workspaceId))
          .orderBy(asc(campaignSteps.scheduledAt)));
    return { items, total: items.length };
  });

  app.post("/", async (request, reply) => {
    const parsed = campaignInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message,
      });
    const input = parsed.data;
    const now = Date.now();
    const campaignId = createId("cmp");
    if (input.contentAssetId) {
      const asset = (await db.$first(db
              .select({ id: contentAssets.id })
              .from(contentAssets)
              .where(
                and(
                  eq(contentAssets.id, input.contentAssetId),
                  eq(contentAssets.workspaceId, request.auth.workspaceId),
                ),
              )));
      if (!asset)
        return reply.code(404).send({
          error: "CONTENT_NOT_FOUND",
          message: "所选内容资产不存在。",
        });
    }
    const audience = input.audienceCustomerIds.length
      ? (await db
                  .select()
                  .from(customers)
                  .where(
                    and(
                      eq(customers.workspaceId, request.auth.workspaceId),
                      inArray(customers.id, input.audienceCustomerIds),
                    ),
                  ))
      : [];
    if (audience.length !== input.audienceCustomerIds.length)
      return reply.code(400).send({
        error: "INVALID_AUDIENCE",
        message: "目标名单包含不存在的客户。",
      });
    const {
      contentAssetId,
      audienceCustomerIds: _audienceCustomerIds,
      ...campaignValues
    } = input;
    await db.transaction(async (tx) => {
            await tx.insert(campaigns)
                      .values({
                        id: campaignId,
                        workspaceId: request.auth.workspaceId,
                        ownerUserId: request.auth.userId,
                        ...campaignValues,
                        startAt: input.startAt ?? null,
                        nextRunAt: input.nextRunAt ?? input.startAt ?? null,
                        createdAt: now,
                        updatedAt: now,
                      });
            if (audience.length) {
              await tx.insert(campaignAudienceMembers).values(audience.map(customer => ({
                id: createId("cam"),
                workspaceId: request.auth.workspaceId,
                campaignId,
                customerId: customer.id,
                company: customer.company,
                status: "pending",
                createdAt: now,
                updatedAt: now,
              })));
            }
            if (input.startAt || contentAssetId)
              await tx.insert(campaignSteps)
                          .values({
                            id: createId("cst"),
                            workspaceId: request.auth.workspaceId,
                            campaignId,
                            position: 1,
                            name: "首次触达",
                            channel: input.channel,
                            contentAssetId: contentAssetId ?? null,
                            status: input.startAt ? "scheduled" : "draft",
                            scheduledAt: input.startAt ?? null,
                            configJson: JSON.stringify({ stopRule: input.stopRule }),
                            createdAt: now,
                            updatedAt: now,
                          });
          });
    if (contentAssetId)
      await linkContent(
        request.auth.workspaceId,
        campaignId,
        contentAssetId,
        "首次触达",
      );
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "campaign.created",
      campaignId,
      { name: input.name, audienceCount: audience.length, contentAssetId },
    );
    return reply
      .code(201)
      .send(
        await serializeCampaign(
          (await requireCampaign(request.auth.workspaceId, campaignId))!,
        ),
      );
  });

  app.get("/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const campaign = (await requireCampaign(request.auth.workspaceId, id));
    if (!campaign)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    const events = (await db
          .select()
          .from(campaignExecutionEvents)
          .where(
            and(
              eq(campaignExecutionEvents.campaignId, id),
              eq(campaignExecutionEvents.workspaceId, request.auth.workspaceId),
            ),
          )
          .orderBy(desc(campaignExecutionEvents.createdAt))
          .limit(100))
      .map((event) => ({
        ...event,
        metadata: parseJson(event.metadataJson, {}),
      }));
    return { ...(await serializeCampaign(campaign)), events };
  });

  app.patch("/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = campaignPatch.safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", message: "没有可更新的字段。" });
    const campaign = (await requireCampaign(request.auth.workspaceId, id));
    if (!campaign)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    const now = Date.now();
    const changes = pickProvided(request.body, parsed.data);
    if (!Object.keys(changes).length)
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", message: "没有可更新的字段。" });
    await db.update(campaigns)
            .set({
              ...changes,
              ...(changes.status === "已完成"
                ? { completedAt: now, progress: 100 }
                : {}),
              updatedAt: now,
            })
            .where(
              and(
                eq(campaigns.id, id),
                eq(campaigns.workspaceId, request.auth.workspaceId),
              ),
            );
    await db.insert(campaignExecutionEvents)
            .values({
              id: createId("cev"),
              workspaceId: request.auth.workspaceId,
              campaignId: id,
              eventType: changes.status ? "status_changed" : "campaign_updated",
              status: "completed",
              metadataJson: JSON.stringify({
                fields: Object.keys(changes),
                status: changes.status,
              }),
              createdAt: now,
            });
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "campaign.updated",
      id,
      { fields: Object.keys(changes) },
    );
    return await serializeCampaign((await requireCampaign(request.auth.workspaceId, id))!);
  });

  app.post("/:id/steps", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = stepInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message,
      });
    const campaign = (await requireCampaign(request.auth.workspaceId, id));
    if (!campaign)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    if (
      parsed.data.contentAssetId &&
      !(await db.$first(db
                .select({ id: contentAssets.id })
                .from(contentAssets)
                .where(
                  and(
                    eq(contentAssets.id, parsed.data.contentAssetId),
                    eq(contentAssets.workspaceId, request.auth.workspaceId),
                  ),
                )))
    )
      return reply
        .code(404)
        .send({ error: "CONTENT_NOT_FOUND", message: "所选内容资产不存在。" });
    const now = Date.now();
    const position =
      parsed.data.position ??
      ((await db.$first(db
                .select({
                  max: sql<number>`coalesce(max(${campaignSteps.position}), 0)`,
                })
                .from(campaignSteps)
                .where(eq(campaignSteps.campaignId, id))))?.max ?? 0) + 1;
    const stepId = createId("cst");
    await db.insert(campaignSteps)
            .values({
              id: stepId,
              workspaceId: request.auth.workspaceId,
              campaignId: id,
              position,
              name: parsed.data.name,
              channel: parsed.data.channel,
              contentAssetId: parsed.data.contentAssetId ?? null,
              status: parsed.data.status,
              scheduledAt: parsed.data.scheduledAt ?? null,
              configJson: JSON.stringify({ note: parsed.data.note ?? "" }),
              createdAt: now,
              updatedAt: now,
            });
    if (parsed.data.contentAssetId)
      await linkContent(
        request.auth.workspaceId,
        id,
        parsed.data.contentAssetId,
        parsed.data.name,
      );
    const nextRunAt =
      parsed.data.scheduledAt &&
      (!campaign.nextRunAt || parsed.data.scheduledAt < campaign.nextRunAt)
        ? parsed.data.scheduledAt
        : campaign.nextRunAt;
    await db.update(campaigns)
            .set({ nextRunAt, nextAction: parsed.data.name, updatedAt: now })
            .where(eq(campaigns.id, id));
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "campaign.step_created",
      id,
      { stepId, position },
    );
    return reply
      .code(201)
      .send(await serializeCampaign((await requireCampaign(request.auth.workspaceId, id))!));
  });

  app.get("/:id/steps/:stepId/readiness", async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const campaign = await requireCampaign(request.auth.workspaceId, id);
    if (!campaign) return reply.code(404).send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    const step = await db.$first(db.select().from(campaignSteps).where(and(eq(campaignSteps.id, stepId), eq(campaignSteps.campaignId, id), eq(campaignSteps.workspaceId, request.auth.workspaceId))));
    if (!step) return reply.code(404).send({ error: "STEP_NOT_FOUND", message: "活动步骤不存在。" });
    const emailChannel = ["邮件", "邮件序列", "email", "Email"].includes(step.channel);
    const audience = await db.select().from(campaignAudienceMembers).where(and(eq(campaignAudienceMembers.campaignId, id), eq(campaignAudienceMembers.workspaceId, request.auth.workspaceId), inArray(campaignAudienceMembers.status, ["pending", "sent"])));
    const asset = step.contentAssetId ? await db.$first(db.select().from(contentAssets).where(and(eq(contentAssets.id, step.contentAssetId), eq(contentAssets.workspaceId, request.auth.workspaceId)))) : null;
    const reachable = (await Promise.all(audience.map(async member => {
      if (!member.customerId) return false;
      return Boolean(await db.$first(db.select({ id: inboxContacts.id }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, member.customerId), emailChannel ? sql`${inboxContacts.email} IS NOT NULL` : sql`1 = 1`))));
    }))).filter(Boolean).length;
    const smtpReady = !emailChannel || Boolean(await db.$first(db.select({ id: outboundChannelConnections.id }).from(outboundChannelConnections).where(and(eq(outboundChannelConnections.workspaceId, request.auth.workspaceId), eq(outboundChannelConnections.provider, 'smtp'), eq(outboundChannelConnections.enabled, true), eq(outboundChannelConnections.status, 'available')))));
    const executable = ["draft", "scheduled"].includes(step.status);
    const checks = [
      { key: 'step', label: '步骤状态', status: executable ? 'pass' : 'block', detail: executable ? '可以进入执行流程' : '该步骤已执行、运行或取消' },
      { key: 'audience', label: '目标受众', status: audience.length ? 'pass' : 'block', detail: audience.length ? `${audience.length} 位客户在当前名单中` : '尚未添加目标客户' },
      { key: 'contacts', label: emailChannel ? '可发送邮箱' : '可执行客户', status: reachable ? (reachable === audience.length ? 'pass' : 'warning') : 'block', detail: `${reachable}/${audience.length} 位客户具备当前渠道所需联系方式` },
      { key: 'content', label: '触达内容', status: !emailChannel || Boolean(asset?.body.trim()) ? 'pass' : 'block', detail: !emailChannel ? '该渠道将创建人工触达任务' : asset?.body.trim() ? `已关联：${asset.title}` : '尚未关联可发送内容' },
      { key: 'sender', label: '发送服务', status: smtpReady ? 'pass' : 'block', detail: smtpReady ? (emailChannel ? 'SMTP 已配置并通过测试' : '当前渠道无需 SMTP') : '请先配置并测试可用的 SMTP 服务' },
      { key: 'schedule', label: '执行时间', status: 'pass', detail: step.scheduledAt ? new Date(step.scheduledAt).toLocaleString('zh-CN', { timeZone: campaign.timezone }) : '确认后立即执行' },
    ] as const;
    return { campaignId: id, stepId, channel: step.channel, audienceCount: audience.length, reachableCount: reachable, canExecute: checks.every(check => check.status !== 'block'), checks };
  });

  app.post("/:id/steps/:stepId/execute", async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const parsed = z
      .object({ confirmation: z.literal(true) })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "CONFIRMATION_REQUIRED",
        message: "执行活动前必须明确确认发送内容和受众。",
      });
    const campaign = (await requireCampaign(request.auth.workspaceId, id));
    if (!campaign)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    const step = (await db.$first(db
          .select()
          .from(campaignSteps)
          .where(
            and(
              eq(campaignSteps.id, stepId),
              eq(campaignSteps.campaignId, id),
              eq(campaignSteps.workspaceId, request.auth.workspaceId),
            ),
          )));
    if (!step)
      return reply
        .code(404)
        .send({ error: "STEP_NOT_FOUND", message: "活动步骤不存在。" });
    if (!["draft", "scheduled"].includes(step.status))
      return reply.code(409).send({
        error: "INVALID_STATUS",
        message: "该步骤已执行或已取消，不能重复入队。",
      });
    const approvalAudience = await db.select({ id: campaignAudienceMembers.id }).from(campaignAudienceMembers).where(and(
      eq(campaignAudienceMembers.campaignId, id),
      eq(campaignAudienceMembers.workspaceId, request.auth.workspaceId),
      inArray(campaignAudienceMembers.status, ["pending", "sent"]),
    ));
    if (approvalAudience.length >= 100) {
      const approvalAction = "campaign.bulk_execute";
      const approved = await db.$first(db.select({ id: approvalRequests.id }).from(approvalRequests).where(and(
        eq(approvalRequests.workspaceId, request.auth.workspaceId), eq(approvalRequests.entityType, "campaign_step"),
        eq(approvalRequests.entityId, stepId), eq(approvalRequests.action, approvalAction), eq(approvalRequests.status, "approved"),
      )));
      if (!approved) {
        const pending = await db.$first(db.select({ id: approvalRequests.id }).from(approvalRequests).where(and(
          eq(approvalRequests.workspaceId, request.auth.workspaceId), eq(approvalRequests.entityType, "campaign_step"),
          eq(approvalRequests.entityId, stepId), eq(approvalRequests.action, approvalAction), eq(approvalRequests.status, "pending"),
        )));
        const approvalId = pending?.id ?? createId("apr");
        if (!pending) {
          const now = Date.now();
          await db.insert(approvalRequests).values({ id: approvalId, workspaceId: request.auth.workspaceId, entityType: "campaign_step", entityId: stepId, action: approvalAction, note: `活动「${campaign.name}」步骤「${step.name}」将触达 ${approvalAudience.length} 位客户。`, requestedByUserId: request.auth.userId, status: "pending", createdAt: now, updatedAt: now });
          await writeAudit(request.auth.workspaceId, request.auth.userId, "approval.requested", id, { approvalId, action: approvalAction, stepId, recipientCount: approvalAudience.length });
        }
        return reply.code(409).send({ error: "APPROVAL_REQUIRED", message: `该步骤将触达 ${approvalAudience.length} 位客户，已提交审批。审批通过后请重新执行。`, approvalId });
      }
    }
    const emailChannel = ["邮件", "邮件序列", "email", "Email"].includes(step.channel);
    if (emailChannel) {
      const smtpReady = await db.$first(db.select({ id: outboundChannelConnections.id }).from(outboundChannelConnections).where(and(
        eq(outboundChannelConnections.workspaceId, request.auth.workspaceId),
        eq(outboundChannelConnections.provider, 'smtp'),
        eq(outboundChannelConnections.enabled, true),
        eq(outboundChannelConnections.status, 'available'),
      )));
      if (!smtpReady) return reply.code(409).send({ error: "SMTP_REQUIRED", message: "请先配置并测试可用的 SMTP 服务，再执行邮件触达。" });
    }
    if (!emailChannel) {
      const audience = (await db.select().from(campaignAudienceMembers).where(and(
              eq(campaignAudienceMembers.campaignId, id),
              eq(campaignAudienceMembers.workspaceId, request.auth.workspaceId),
              inArray(campaignAudienceMembers.status, ["pending", "sent"]),
            ))).filter(member => Boolean(member.customerId));
      if (!audience.length) return reply.code(409).send({ error: "NO_ELIGIBLE_RECIPIENTS", message: "目标名单中没有可创建人工触达任务的客户。" });
      const now = Date.now();
      const createdTaskIds: string[] = [];
      await db.transaction(async tx => {
                for (const member of audience) {
                  const customer = (await db.$first(tx.select().from(customers).where(and(eq(customers.id, member.customerId!), eq(customers.workspaceId, request.auth.workspaceId)))));
                  if (!customer) continue;
                  const taskId = createId("tsk");
                  createdTaskIds.push(taskId);
                  await tx.insert(tasks).values({
                                id: taskId,
                                workspaceId: request.auth.workspaceId,
                                customerId: customer.id,
                                title: `${step.channel} · ${step.name}`,
                                priority: "中",
                                dueAt: step.scheduledAt ?? now,
                                dueLabel: step.scheduledAt ? new Date(step.scheduledAt).toISOString().slice(0, 10) : "今天",
                                company: customer.company,
                                nextAction: `按活动「${campaign.name}」完成${step.channel}触达并记录结果`,
                                impact: customer.estimatedValue > 0 ? `${customer.estimatedValue} CNY` : "待评估",
                                source: `营销活动 · ${id} · ${stepId}`,
                                status: "open",
                                ownerUserId: request.auth.userId,
                                createdAt: now,
                                updatedAt: now,
                              });
                  await tx.update(campaignAudienceMembers).set({ status: "sent", lastEventAt: now, updatedAt: now }).where(eq(campaignAudienceMembers.id, member.id));
                }
                await tx.update(campaignSteps).set({ status: "running", updatedAt: now }).where(eq(campaignSteps.id, stepId));
                await tx.update(campaigns).set({ status: "运行中", nextAction: `完成 ${createdTaskIds.length} 项${step.channel}人工触达任务`, updatedAt: now }).where(eq(campaigns.id, id));
                await tx.insert(campaignExecutionEvents).values({
                            id: createId("cev"), workspaceId: request.auth.workspaceId, campaignId: id, campaignStepId: stepId,
                            eventType: "manual_tasks_created", status: "completed", recipientCount: createdTaskIds.length,
                            metadataJson: JSON.stringify({ channel: step.channel, taskIds: createdTaskIds, confirmedByUserId: request.auth.userId }), createdAt: now,
                          });
              });
      await writeAudit(request.auth.workspaceId, request.auth.userId, "campaign.step_executed", id, { stepId, channel: step.channel, manualTasks: createdTaskIds.length });
      return reply.code(202).send({ campaignId: id, stepId, recipientCount: createdTaskIds.length, queued: 0, awaitingConfiguration: 0, suppressed: 0, manualTasks: createdTaskIds.length, jobIds: [], taskIds: createdTaskIds });
    }
    const asset = step.contentAssetId
      ? (await db.$first(db
                  .select()
                  .from(contentAssets)
                  .where(
                    and(
                      eq(contentAssets.id, step.contentAssetId),
                      eq(contentAssets.workspaceId, request.auth.workspaceId),
                    ),
                  )))
      : null;
    if (!asset || !asset.body.trim())
      return reply.code(409).send({
        error: "CONTENT_REQUIRED",
        message: "请先为该步骤关联可发送的内容资产。",
      });
    const audience = (await db
          .select()
          .from(campaignAudienceMembers)
          .where(
            and(
              eq(campaignAudienceMembers.campaignId, id),
              eq(campaignAudienceMembers.workspaceId, request.auth.workspaceId),
              inArray(campaignAudienceMembers.status, ["pending", "sent"]),
            ),
          ));
    const recipients = (await Promise.all(audience.map(async (member) => {
      if (!member.customerId) return [];
      const contact = (await db.$first(db
              .select()
              .from(inboxContacts)
              .where(
                and(
                  eq(inboxContacts.workspaceId, request.auth.workspaceId),
                  eq(inboxContacts.customerId, member.customerId),
                ),
              )));
      return contact?.email ? [{ member, contact }] : [];
    }))).flat();
    if (!recipients.length)
      return reply.code(409).send({
        error: "NO_ELIGIBLE_RECIPIENTS",
        message: "目标名单中没有已核验邮箱的联系人。",
      });
    const now = Date.now();
    const sender =
      (await db.$first(db
                .select({ displayName: users.displayName })
                .from(users)
                .where(eq(users.id, request.auth.userId))))?.displayName ?? "我";
    const prepared = await Promise.all(recipients.map(async ({ member, contact }) => {
      const existingThread = (await db.$first(db
              .select()
              .from(messageThreads)
              .where(
                and(
                  eq(messageThreads.workspaceId, request.auth.workspaceId),
                  eq(messageThreads.campaignId, id),
                  eq(messageThreads.contactId, contact.id),
                ),
              )));
      return {
        member,
        contact,
        threadId: existingThread?.id ?? createId("mth"),
        createThread: !existingThread,
        messageId: createId("msg"),
      };
    }));
    await db.transaction(async (tx) => {
            for (const item of prepared) {
              if (item.createThread)
                await tx.insert(messageThreads)
                              .values({
                                id: item.threadId,
                                workspaceId: request.auth.workspaceId,
                                contactId: item.contact.id,
                                customerId: item.member.customerId,
                                campaignId: id,
                                subject: `${campaign.name} · ${step.name}`,
                                channel: step.channel,
                                intent: "待判断",
                                status: "open",
                                assigneeUserId: request.auth.userId,
                                lastMessagePreview: asset.body,
                                lastMessageAt: now,
                                lastInboundAt: null,
                                unreadCount: 0,
                                createdAt: now,
                                updatedAt: now,
                              });
              else
                await tx.update(messageThreads)
                              .set({
                                lastMessagePreview: asset.body,
                                lastMessageAt: now,
                                updatedAt: now,
                              })
                              .where(eq(messageThreads.id, item.threadId));
              await tx.insert(messageEntries)
                          .values({
                            id: item.messageId,
                            workspaceId: request.auth.workspaceId,
                            threadId: item.threadId,
                            direction: "outbound",
                            messageType: "text",
                            body: asset.body,
                            status: "confirmed",
                            channel: step.channel,
                            senderLabel: sender,
                            confirmedByUserId: request.auth.userId,
                            confirmedAt: now,
                            metadataJson: JSON.stringify({
                              deliveryMode: "outbox",
                              userConfirmed: true,
                              campaignId: id,
                              campaignStepId: stepId,
                              contentAssetId: asset.id,
                            }),
                            createdAt: now,
                            updatedAt: now,
                          });
              await tx.update(campaignAudienceMembers)
                          .set({ status: "queued", lastEventAt: now, updatedAt: now })
                          .where(eq(campaignAudienceMembers.id, item.member.id));
            }
            await tx.update(campaignSteps)
                      .set({ status: "running", updatedAt: now })
                      .where(eq(campaignSteps.id, stepId));
            await tx.update(campaigns)
                      .set({
                        status: "运行中",
                        nextAction: "监控发送队列与客户回复",
                        updatedAt: now,
                      })
                      .where(eq(campaigns.id, id));
            await tx.insert(campaignExecutionEvents)
                      .values({
                        id: createId("cev"),
                        workspaceId: request.auth.workspaceId,
                        campaignId: id,
                        campaignStepId: stepId,
                        eventType: "messages_queued",
                        status: "completed",
                        recipientCount: prepared.length,
                        metadataJson: JSON.stringify({
                          contentAssetId: asset.id,
                          confirmedByUserId: request.auth.userId,
                        }),
                        createdAt: now,
                      });
          });
    const jobs = await Promise.all(prepared.map(async (item) =>
      await enqueueConfirmedMessage({
        workspaceId: request.auth.workspaceId,
        messageId: item.messageId,
        threadId: item.threadId,
        channel: step.channel,
        scheduledAt: step.scheduledAt ?? now,
      }),
    ));
    const queued = jobs.filter((job) => job.status === "queued").length;
    const suppressed = jobs.filter((job) => job.status === "cancelled").length;
    const awaitingConfiguration = jobs.filter(
      (job) => job.status === "awaiting_configuration",
    ).length;
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "campaign.step_executed",
      id,
      {
        stepId,
        recipientCount: jobs.length,
        queued,
        awaitingConfiguration,
        suppressed,
      },
    );
    return reply.code(202).send({
      campaignId: id,
      stepId,
      recipientCount: jobs.length,
      queued,
      awaitingConfiguration,
      suppressed,
      jobIds: jobs.map((job) => job.id),
    });
  });

  app.post("/:id/content", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = z
      .object({
        contentAssetId: z.string().trim().min(1),
        purpose: z.string().trim().max(120).default("触达内容"),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", message: "请选择内容资产。" });
    if (!(await requireCampaign(request.auth.workspaceId, id)))
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    await linkContent(
      request.auth.workspaceId,
      id,
      parsed.data.contentAssetId,
      parsed.data.purpose,
    );
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "campaign.content_linked",
      id,
      parsed.data,
    );
    return await serializeCampaign((await requireCampaign(request.auth.workspaceId, id))!);
  });

  app.post("/:id/audience", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = z
      .object({
        customerIds: z.array(z.string().trim().min(1)).min(1).max(500),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "INVALID_INPUT", message: "请选择至少一个客户。" });
    if (!(await requireCampaign(request.auth.workspaceId, id)))
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "营销活动不存在。" });
    const members = (await db
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.workspaceId, request.auth.workspaceId),
              inArray(customers.id, parsed.data.customerIds),
            ),
          ));
    if (members.length !== parsed.data.customerIds.length)
      return reply.code(400).send({
        error: "INVALID_AUDIENCE",
        message: "目标名单包含不存在的客户。",
      });
    const now = Date.now();
    await Promise.all(members.map(async (customer) => {
      const exists = (await db.$first(db
              .select({ id: campaignAudienceMembers.id })
              .from(campaignAudienceMembers)
              .where(
                and(
                  eq(campaignAudienceMembers.campaignId, id),
                  eq(campaignAudienceMembers.company, customer.company),
                ),
              )));
      if (!exists)
        await db.insert(campaignAudienceMembers)
                    .values({
                      id: createId("cam"),
                      workspaceId: request.auth.workspaceId,
                      campaignId: id,
                      customerId: customer.id,
                      company: customer.company,
                      status: "pending",
                      createdAt: now,
                      updatedAt: now,
                    });
    }));
    await writeAudit(
      request.auth.workspaceId,
      request.auth.userId,
      "campaign.audience_added",
      id,
      { count: members.length },
    );
    return await serializeCampaign((await requireCampaign(request.auth.workspaceId, id))!);
  });
};
