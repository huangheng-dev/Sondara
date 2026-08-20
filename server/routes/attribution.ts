import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { auditLogs, channelCosts, customers, deals, messageEntries, messageThreads, radarCandidates, tasks } from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { pickProvided } from "../lib/input.js";
import { requireAuth } from "../plugins/auth.js";

const CHANNELS = ["官网内容","邮件触达","LinkedIn","地图找客","搜索引擎","行业名录","招投标项目","展会协会","种子名单","手动录入","其他"] as const;
type Channel = (typeof CHANNELS)[number];
const CHANNEL_COLORS: Record<Channel,string> = {官网内容:"#0b5cff",邮件触达:"#6941c6",LinkedIn:"#12b76a",地图找客:"#2e90fa",搜索引擎:"#13c2c2",行业名录:"#7f56d9",招投标项目:"#f79009",展会协会:"#ef6820",种子名单:"#667085",手动录入:"#98a2b3",其他:"#d0d5dd"};

const normalizeChannel = (raw:string|null|undefined):Channel => {
  const v=(raw??"").toLowerCase();
  if(!v) return "手动录入";
  if(v.includes("官网")||v.includes("website")||v.includes("企业官网")) return "官网内容";
  if(v.includes("邮件")||v.includes("email")||v.includes("smtp")||v.includes("outbox")) return "邮件触达";
  if(v.includes("linkedin")) return "LinkedIn";
  if(v.includes("地图")||v.includes("amap")||v.includes("高德")||v.includes("places")||v.includes("google")) return "地图找客";
  if(v.includes("搜索")||v.includes("search")||v.includes("brave")||v.includes("searxng")) return "搜索引擎";
  if(v.includes("招标")||v.includes("投标")||v.includes("tender")||v.includes("bidding")) return "招投标项目";
  if(v.includes("展会")||v.includes("协会")||v.includes("expo")||v.includes("展商")) return "展会协会";
  if(v.includes("名录")||v.includes("directory")||v.includes("行业目录")) return "行业名录";
  if(v.includes("种子")||v.includes("seed")) return "种子名单";
  if(v.includes("手动")||v.includes("manual")||v.includes("客户跟进")||v.includes("商机跟进")) return "手动录入";
  return "其他";
};

type Period="month"|"quarter"|"year";
const periodRange=(p:Period,now=new Date())=>{
  const y=now.getFullYear(),m=now.getMonth();
  if(p==="year") return {start:Date.UTC(y,0,1).valueOf(),end:Date.UTC(y+1,0,1).valueOf()};
  if(p==="quarter"){const qs=Math.floor(m/3)*3;return {start:Date.UTC(y,qs,1).valueOf(),end:Date.UTC(y,qs+3,1).valueOf()};}
  return {start:Date.UTC(y,m,1).valueOf(),end:Date.UTC(y,m+1,1).valueOf()};
};

const deriveBottleneck=(v:{discovered:number;qualified:number;contacted:number;replies:number;deals:number;won:number})=>{
  if(v.discovered===0) return "获客质量" as const;
  if(v.qualified/v.discovered<0.5) return "获客质量" as const;
  if(v.contacted/Math.max(v.qualified,1)<0.5) return "有效触达" as const;
  if(v.replies/Math.max(v.contacted,1)<0.3) return "客户回复" as const;
  if(v.deals/Math.max(v.replies,1)<0.5) return "商机创建" as const;
  return "成交推进" as const;
};
const deriveAction=(b:string)=>{const m:Record<string,string>={获客质量:"收紧定位条件，提高候选有效率",有效触达:"优化触达节奏与联系人补全",客户回复:"更换首封沟通模板与价值主张",商机创建:"为高意向回复及时创建商机",成交推进:"补充案例、报价与决策链材料"};return m[b]??"持续跟踪并优化转化路径";};

const costInput=z.object({
  channel:z.string().trim().min(1).max(60),
  periodLabel:z.enum(["monthly","quarterly","yearly","custom"]).default("monthly"),
  periodStart:z.coerce.number().int(),
  periodEnd:z.coerce.number().int(),
  costAmount:z.number().int().min(0).max(1_000_000_000),
  currency:z.string().trim().min(1).max(8).default("CNY"),
  note:z.string().trim().max(500).default(""),
});
const costPatch=costInput.partial();
const optimizeInput=z.object({period:z.enum(["month","quarter","year"]).default("month"),channels:z.array(z.string().trim().min(1).max(60)).max(50).default([])});

const writeAudit=(ws:string,uid:string,action:string,et:string,eid:string,meta:Record<string,unknown>={})=>{
  db.insert(auditLogs).values({id:createId("aud"),workspaceId:ws,actorUserId:uid,action,entityType:et,entityId:eid,metadata:JSON.stringify(meta),createdAt:Date.now()}).run();
};

type ChannelBucket = { discovered:number; qualified:number; contacted:number; replies:number; deals:number; won:number; revenue:number; cost:number };

const aggregateChannels = (ws: string, start: number, end: number, currency: string) => {
  const discoveredRows = db.select({ ch: radarCandidates.source, n: sql<number>`count(*)` })
    .from(radarCandidates)
    .where(and(eq(radarCandidates.workspaceId, ws), gte(radarCandidates.discoveredAt, start), lt(radarCandidates.discoveredAt, end)))
    .groupBy(radarCandidates.source).all() as { ch: string; n: number }[];
  const qualifiedRows = db.select({ ch: customers.source, n: sql<number>`count(*)` })
    .from(customers)
    .where(and(eq(customers.workspaceId, ws), gte(customers.createdAt, start), lt(customers.createdAt, end)))
    .groupBy(customers.source).all() as { ch: string; n: number }[];
  const contactedRows = db.select({ ch: messageThreads.channel, n: sql<number>`count(distinct ${messageEntries.threadId})` })
    .from(messageEntries).innerJoin(messageThreads, eq(messageEntries.threadId, messageThreads.id))
    .where(and(eq(messageThreads.workspaceId, ws), eq(messageEntries.direction, "outbound"), eq(messageEntries.status, "sent"), gte(messageEntries.createdAt, start), lt(messageEntries.createdAt, end)))
    .groupBy(messageThreads.channel).all() as { ch: string; n: number }[];
  const replyRows = db.select({ ch: messageThreads.channel, n: sql<number>`count(distinct ${messageEntries.threadId})` })
    .from(messageEntries).innerJoin(messageThreads, eq(messageEntries.threadId, messageThreads.id))
    .where(and(eq(messageThreads.workspaceId, ws), eq(messageEntries.direction, "inbound"), gte(messageEntries.createdAt, start), lt(messageEntries.createdAt, end)))
    .groupBy(messageThreads.channel).all() as { ch: string; n: number }[];
  const dealsRows = db.select({
    ch: deals.source,
    total: sql<number>`count(*)`,
    won: sql<number>`sum(case when ${deals.stage} = '赢单' then 1 else 0 end)`,
    revenue: sql<number>`coalesce(sum(case when ${deals.stage} = '赢单' then ${deals.valueAmount} else 0 end), 0)`,
  }).from(deals)
    .where(and(eq(deals.workspaceId, ws), gte(deals.createdAt, start), lt(deals.createdAt, end)))
    .groupBy(deals.source).all() as { ch: string; total: number; won: number; revenue: number }[];
  const costRows = db.select({ ch: channelCosts.channel, cost: sql<number>`coalesce(sum(${channelCosts.costAmount}), 0)` })
    .from(channelCosts)
    .where(and(eq(channelCosts.workspaceId, ws), eq(channelCosts.currency, currency), lt(channelCosts.periodStart, end), gte(channelCosts.periodEnd, start)))
    .groupBy(channelCosts.channel).all() as { ch: string; cost: number }[];

  const bucket = new Map<Channel, ChannelBucket>();
  const ensure = (ch: Channel): ChannelBucket => {
    let r = bucket.get(ch);
    if (!r) { r = { discovered:0, qualified:0, contacted:0, replies:0, deals:0, won:0, revenue:0, cost:0 }; bucket.set(ch, r); }
    return r;
  };
  for (const r of discoveredRows) ensure(normalizeChannel(r.ch)).discovered += Number(r.n);
  for (const r of qualifiedRows) ensure(normalizeChannel(r.ch)).qualified += Number(r.n);
  for (const r of contactedRows) ensure(normalizeChannel(r.ch)).contacted += Number(r.n);
  for (const r of replyRows) ensure(normalizeChannel(r.ch)).replies += Number(r.n);
  for (const r of dealsRows) { const b = ensure(normalizeChannel(r.ch)); b.deals += Number(r.total); b.won += Number(r.won); b.revenue += Number(r.revenue); }
  for (const r of costRows) ensure(normalizeChannel(r.ch)).cost += Number(r.cost);

  return [...bucket.entries()].map(([name, v]) => {
    const rate = v.discovered ? Number(((v.won / v.discovered) * 100).toFixed(1)) : 0;
    const bottleneck = deriveBottleneck(v);
    const action = deriveAction(bottleneck);
    const roi = v.cost > 0 ? Number(((v.revenue - v.cost) / v.cost).toFixed(2)) : null;
    const costPerWon = v.won > 0 && v.cost > 0 ? Math.round(v.cost / v.won) : null;
    return { name, color: CHANNEL_COLORS[name], ...v, conversionRate: rate, bottleneck, action, roi, costPerWon, currency };
  }).sort((a, b) => b.discovered - a.discovered);
};

export const attributionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/overview", async (request, reply) => {
    const parsed = z.object({
      period: z.enum(["month","quarter","year"]).default("month"),
      currency: z.string().trim().max(8).default("CNY"),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    const { period, currency } = parsed.data;
    const { start, end } = periodRange(period);
    const ws = request.auth.workspaceId;
    const channels = aggregateChannels(ws, start, end, currency);

    const funnel = [
      { key: "discovered", label: "发现客户", value: channels.reduce((s,c)=>s+c.discovered,0) },
      { key: "qualified", label: "有效客户", value: channels.reduce((s,c)=>s+c.qualified,0) },
      { key: "contacted", label: "已触达", value: channels.reduce((s,c)=>s+c.contacted,0) },
      { key: "replies", label: "获得回复", value: channels.reduce((s,c)=>s+c.replies,0) },
      { key: "deals", label: "创建商机", value: channels.reduce((s,c)=>s+c.deals,0) },
      { key: "won", label: "成交客户", value: channels.reduce((s,c)=>s+c.won,0) },
    ];
    const totalRevenue = channels.reduce((s,c)=>s+c.revenue,0);
    const totalCost = channels.reduce((s,c)=>s+c.cost,0);
    const totals = { revenue: totalRevenue, cost: totalCost, currency, roi: totalCost > 0 ? Number(((totalRevenue-totalCost)/totalCost).toFixed(2)) : null };
    return { period: { label: period, start, end }, funnel, channels, totals };
  });

  // COSTS CRUD
  app.get("/costs", async (request, reply) => {
    const parsed = z.object({
      channel: z.string().trim().max(60).optional(),
      start: z.coerce.number().int().optional(),
      end: z.coerce.number().int().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    const { page, pageSize, channel, start, end } = parsed.data;
    const filters = [eq(channelCosts.workspaceId, request.auth.workspaceId)];
    if (channel) filters.push(eq(channelCosts.channel, channel));
    if (start) filters.push(gte(channelCosts.periodStart, start));
    if (end) filters.push(lt(channelCosts.periodEnd, end));
    const totalRow = db.select({ n: sql<number>`count(*)` }).from(channelCosts).where(and(...filters)).get();
    const total = Number(totalRow?.n ?? 0);
    const items = db.select().from(channelCosts).where(and(...filters))
      .orderBy(desc(channelCosts.periodStart)).limit(pageSize).offset((page - 1) * pageSize).all();
    return { items, page, pageSize, total };
  });

  app.post("/costs", async (request, reply) => {
    const parsed = costInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    if (parsed.data.periodEnd <= parsed.data.periodStart) return reply.code(400).send({ error: "INVALID_INPUT", message: "结束时间必须晚于开始时间。" });
    const now = Date.now();
    const record = { id: createId("cst"), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId, createdAt: now, updatedAt: now, ...parsed.data };
    db.insert(channelCosts).values(record).run();
    writeAudit(request.auth.workspaceId, request.auth.userId, "channel_cost.created", "channel_cost", record.id, { channel: record.channel, amount: record.costAmount });
    return reply.code(201).send(record);
  });

  app.patch("/costs/:id", async (request, reply) => {
    const parsed = costPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    const existing = db.select().from(channelCosts).where(and(eq(channelCosts.id, (request.params as { id: string }).id), eq(channelCosts.workspaceId, request.auth.workspaceId))).get();
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "成本记录不存在。" });
    const updates = pickProvided(request.body, parsed.data);
    if (Object.keys(updates).length === 0) return reply.code(400).send({ error: "NO_CHANGES", message: "没有需要更新的字段。" });
    const nextStart = (updates as { periodStart?: number }).periodStart ?? existing.periodStart;
    const nextEnd = (updates as { periodEnd?: number }).periodEnd ?? existing.periodEnd;
    if (nextEnd <= nextStart) return reply.code(400).send({ error: "INVALID_INPUT", message: "结束时间必须晚于开始时间。" });
    db.update(channelCosts).set({ ...updates, updatedAt: Date.now() }).where(eq(channelCosts.id, existing.id)).run();
    const updated = db.select().from(channelCosts).where(eq(channelCosts.id, existing.id)).get()!;
    writeAudit(request.auth.workspaceId, request.auth.userId, "channel_cost.updated", "channel_cost", updated.id, { fields: Object.keys(updates) });
    return updated;
  });

  app.delete("/costs/:id", async (request, reply) => {
    const existing = db.select().from(channelCosts).where(and(eq(channelCosts.id, (request.params as { id: string }).id), eq(channelCosts.workspaceId, request.auth.workspaceId))).get();
    if (!existing) return reply.code(404).send({ error: "NOT_FOUND", message: "成本记录不存在。" });
    db.delete(channelCosts).where(eq(channelCosts.id, existing.id)).run();
    writeAudit(request.auth.workspaceId, request.auth.userId, "channel_cost.deleted", "channel_cost", existing.id, { channel: existing.channel });
    return reply.code(204).send();
  });

  // 从转化结果创建可追踪的优化任务
  app.post("/optimize-tasks", async (request, reply) => {
    const parsed = optimizeInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    const { period, channels: selected } = parsed.data;
    const { start, end } = periodRange(period);
    const ws = request.auth.workspaceId;

    const channels = aggregateChannels(ws, start, end, "CNY");
    const targets = (selected.length ? channels.filter(c => selected.includes(c.name)) : channels)
      .filter(c => c.discovered > 0 || c.qualified > 0 || c.deals > 0 || c.won > 0)
      .slice(0, 10);

    if (targets.length === 0) return reply.code(400).send({ error: "NO_DATA", message: "所选周期内没有可生成优化任务的渠道数据。" });

    const now = Date.now();
    const dueAt = now + 7 * 24 * 60 * 60 * 1000;
    const created: string[] = [];
    db.transaction((tx) => {
      for (const c of targets) {
        const id = createId("tsk");
        tx.insert(tasks).values({
          id, workspaceId: ws, ownerUserId: request.auth.userId,
          title: `转化优化 · ${c.name}（${c.bottleneck}）`,
          priority: c.won === 0 ? "高" : "中",
          dueAt, dueLabel: "7 天内",
          company: "渠道优化",
          nextAction: c.action,
          impact: c.conversionRate > 0 ? `当前转化率 ${c.conversionRate}%，目标提升至 ${Math.min(c.conversionRate * 1.3, 100).toFixed(1)}%` : "尚无成交，优先打通首单",
          source: "转化分析",
          status: "open",
          createdAt: now, updatedAt: now,
        }).run();
        created.push(id);
      }
    });

    writeAudit(ws, request.auth.userId, "attribution.optimize_tasks_created", "task_batch", created[0], { count: created.length, period, channels: targets.map(t => t.name) });
    return reply.code(201).send({ created: created.length, taskIds: created, period: { label: period, start, end } });
  });

  // 数据完整度（真实计算：客户-商机关联率、消息-渠道标识率、来源非空率）
  app.get("/quality", async (request) => {
    const ws = request.auth.workspaceId;
    const customerTotal = Number(db.select({ n: sql<number>`count(*)` }).from(customers).where(eq(customers.workspaceId, ws)).get()?.n ?? 0);
    const customerWithDeal = Number(db.select({ n: sql<number>`count(distinct ${customers.id})` }).from(customers)
      .leftJoin(deals, eq(deals.customerId, customers.id))
      .where(and(eq(customers.workspaceId, ws), sql`${deals.id} is not null`)).get()?.n ?? 0);
    const threadTotal = Number(db.select({ n: sql<number>`count(*)` }).from(messageThreads).where(eq(messageThreads.workspaceId, ws)).get()?.n ?? 0);
    const threadWithChannel = Number(db.select({ n: sql<number>`count(*)` }).from(messageThreads)
      .where(and(eq(messageThreads.workspaceId, ws), sql`${messageThreads.channel} is not null`, sql`${messageThreads.channel} != ''`)).get()?.n ?? 0);
    const customerWithSource = Number(db.select({ n: sql<number>`count(*)` }).from(customers)
      .where(and(eq(customers.workspaceId, ws), sql`${customers.source} is not null`, sql`${customers.source} != ''`, sql`${customers.source} != '手动录入'`)).get()?.n ?? 0);

    const pct = (n: number, d: number) => d ? Math.round((n / d) * 100) : 100;
    return {
      items: [
        { label: "客户与商机已关联", pct: pct(customerWithDeal, customerTotal), detail: customerTotal ? `${customerTotal - customerWithDeal} 个客户尚无关联商机` : "暂无客户数据" },
        { label: "营销触点已识别渠道", pct: pct(threadWithChannel, threadTotal), detail: threadTotal ? `${threadTotal - threadWithChannel} 个对话缺少渠道标识` : "暂无对话数据" },
        { label: "客户来源已补全", pct: pct(customerWithSource, customerTotal), detail: customerTotal ? `${customerTotal - customerWithSource} 个客户为手动录入或来源为空` : "暂无客户数据" },
      ],
    };
  });
};
