import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AiUnavailableError, completeWithAi, hasAiConfiguration } from '../ai/client.js'
import { db } from '../db/client.js'
import { auditLogs, campaignContentLinks, campaigns, contentAssets, contentGenerationRuns, contentQualityChecks, contentVersions } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth } from '../plugins/auth.js'

const assetStatuses = ['草稿', '待审核', '已发布', '可复用', '已归档'] as const
const assetInput = z.object({
  title: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(80).default('首次触达邮件'),
  channel: z.string().trim().min(1).max(80).default('邮件'),
  status: z.enum(assetStatuses).default('草稿'),
  language: z.string().trim().min(1).max(40).default('中文'),
  body: z.string().max(60_000).default(''),
  summary: z.string().max(500).default(''),
  targetMarket: z.string().trim().max(160).default('待补全'),
  customerRole: z.string().trim().max(100).default('待补全'),
  buyingStage: z.string().trim().max(80).default('问题认知'),
  customerSignal: z.string().trim().max(160).default('待识别'),
  sourceMethod: z.string().trim().max(80).default('客户信号'),
})
const assetPatch = assetInput.partial().extend({ changeNote: z.string().trim().max(200).optional() })
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(assetStatuses).optional(),
  contentType: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'updated_asc', 'title_asc', 'title_desc', 'market_asc']).default('updated_desc'),
})
const generateInput = assetInput.pick({
  title: true, contentType: true, channel: true, language: true, targetMarket: true,
  customerRole: true, buyingStage: true, customerSignal: true, sourceMethod: true,
}).extend({ saveAsAsset: z.boolean().default(false), existingBody: z.string().max(60_000).optional() })

type QualityResult = {
  overallScore: number
  customerRelevance: number
  evidenceScore: number
  actionClarity: number
  findings: string[]
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))
const evaluateQuality = (body: string, targetMarket: string, customerRole: string, customerSignal: string): QualityResult => {
  const compact = body.replace(/\s/g, '')
  const hasContext = [targetMarket, customerRole, customerSignal].filter(value => value && !['待补全', '待识别'].includes(value)).some(value => body.includes(value))
  const evidenceMatches = body.match(/\d+(?:\.\d+)?%|\d+\s*(?:天|小时|万元|页|个|家)|案例|数据|验证|报告|清单/g)?.length ?? 0
  const actionMatches = body.match(/回复|联系|发送|预约|沟通|评估|确认|下一步|下载|查看/g)?.length ?? 0
  const customerRelevance = clamp(58 + (hasContext ? 24 : 5) + Math.min(14, compact.length / 40))
  const evidenceScore = clamp(46 + Math.min(38, evidenceMatches * 8) + (compact.length >= 120 ? 8 : 0))
  const actionClarity = clamp(52 + Math.min(36, actionMatches * 9) + (/[？?。.]\s*$/.test(body.trim()) ? 5 : 0))
  const overallScore = clamp(customerRelevance * .38 + evidenceScore * .3 + actionClarity * .32)
  const findings: string[] = []
  if (customerRelevance < 80) findings.push('补充更具体的目标客户场景或近期信号。')
  if (evidenceScore < 80) findings.push('增加一个可核验的量化结果、案例或资料依据。')
  if (actionClarity < 80) findings.push('明确一个低阻力的下一步行动和时间预期。')
  if (!findings.length) findings.push('内容结构完整，可进入人工审核或发布流程。')
  return { overallScore, customerRelevance, evidenceScore, actionClarity, findings }
}

const serializeAsset = (asset: typeof contentAssets.$inferSelect) => ({
  ...asset,
  linkedCampaignIds: (() => { try { return JSON.parse(asset.linkedCampaignIdsJson) as string[] } catch { return [] } })(),
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'content_asset', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

const insertQuality = async (workspaceId: string, assetId: string, versionId: string | null, quality: QualityResult, now = Date.now()) => {
  const checkId = createId('cqc')
  await db.insert(contentQualityChecks).values({
        id: checkId, workspaceId, contentAssetId: assetId, contentVersionId: versionId,
        overallScore: quality.overallScore, customerRelevance: quality.customerRelevance,
        evidenceScore: quality.evidenceScore, actionClarity: quality.actionClarity,
        status: 'completed', findingsJson: JSON.stringify(quality.findings), createdAt: now,
      })
  return checkId
}

const createAsset = async (workspaceId: string, userId: string, input: z.infer<typeof assetInput>) => {
  const now = Date.now()
  const assetId = createId('cnt')
  const versionId = createId('cvn')
  const quality = evaluateQuality(input.body, input.targetMarket, input.customerRole, input.customerSignal)
  await db.transaction(async tx => {
        await tx.insert(contentAssets).values({
                id: assetId, workspaceId, ownerUserId: userId, ...input, currentVersion: 1,
                qualityScore: quality.overallScore, customerRelevance: quality.customerRelevance,
                evidenceScore: quality.evidenceScore, actionClarity: quality.actionClarity,
                linkedCampaignIdsJson: '[]', publishedAt: input.status === '已发布' ? now : null,
                archivedAt: input.status === '已归档' ? now : null, createdAt: now, updatedAt: now,
              })
        await tx.insert(contentVersions).values({ id: versionId, workspaceId, contentAssetId: assetId, versionNumber: 1, title: input.title, body: input.body, changeNote: '创建内容', createdByUserId: userId, createdAt: now })
        await tx.insert(contentQualityChecks).values({ id: createId('cqc'), workspaceId, contentAssetId: assetId, contentVersionId: versionId, overallScore: quality.overallScore, customerRelevance: quality.customerRelevance, evidenceScore: quality.evidenceScore, actionClarity: quality.actionClarity, status: 'completed', findingsJson: JSON.stringify(quality.findings), createdAt: now })
      })
  return assetId
}

const localRefine = (body: string, language: string) => {
  const refined = body
    .replace(/AI 优化建议：[^\n]*/g, '')
    .replace(/如果这与您当前的产品规划相关/g, '如果该方向符合贵司当前规划')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (/回复|联系|发送|预约|沟通|评估|确认|下一步/.test(refined)) return refined
  if (language === 'English') return `${refined}\n\nIf this is relevant, please reply and I can send a concise summary for internal review.`
  if (language === 'Deutsch') return `${refined}\n\nWenn das relevant ist, antworten Sie mir gern, dann sende ich Ihnen eine kurze Zusammenfassung zur internen Prüfung.`
  return `${refined}\n\n如果方向相关，请直接回复，我可以先发一份两页摘要供内部评估。`
}

const localDraft = (input: z.infer<typeof generateInput>) => {
  if (input.existingBody?.trim()) return localRefine(input.existingBody, input.language)
  const salutation = input.language === 'English' ? 'Hello,' : input.language === 'Deutsch' ? 'Guten Tag,' : '您好，'
  if (input.language === 'English') return `${salutation}\n\nBased on the recent signal “${input.customerSignal}”, we prepared a concise ${input.contentType} for ${input.customerRole} in the ${input.targetMarket} market. It focuses on verifiable delivery experience, implementation certainty, and measurable business impact.\n\nIf this is relevant to your current ${input.buyingStage} stage, I can first share a two-page summary for a quick internal review.`
  if (input.language === 'Deutsch') return `${salutation}\n\nAuf Grundlage des aktuellen Signals „${input.customerSignal}“ haben wir für ${input.customerRole} im Markt ${input.targetMarket} eine kurze ${input.contentType} vorbereitet. Im Mittelpunkt stehen nachprüfbare Projekterfahrung, Liefersicherheit und messbarer Geschäftsnutzen.\n\nWenn dies zu Ihrer aktuellen Phase „${input.buyingStage}“ passt, sende ich Ihnen gern zuerst eine zweiseitige Zusammenfassung zur internen Prüfung.`
  return `${salutation}\n\n基于“${input.customerSignal}”这一近期信号，我们为${input.targetMarket}市场的${input.customerRole}整理了与${input.buyingStage}阶段匹配的${input.contentType}。重点包括可核验的项目经验、交付确定性和可量化的业务收益。\n\n如果方向一致，我可以先分享一份两页摘要，方便您快速判断是否值得进一步沟通。`
}

export const contentRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/assets', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(contentAssets.workspaceId, request.auth.workspaceId)]
    if (query.q) conditions.push(or(like(contentAssets.title, `%${query.q}%`), like(contentAssets.targetMarket, `%${query.q}%`), like(contentAssets.customerRole, `%${query.q}%`), like(contentAssets.body, `%${query.q}%`))!)
    if (query.status) conditions.push(eq(contentAssets.status, query.status))
    if (query.contentType) conditions.push(eq(contentAssets.contentType, query.contentType))
    const where = and(...conditions)
    const orderBy = query.sort === 'updated_asc' ? asc(contentAssets.updatedAt) : query.sort === 'title_asc' ? asc(contentAssets.title) : query.sort === 'title_desc' ? desc(contentAssets.title) : query.sort === 'market_asc' ? asc(contentAssets.targetMarket) : desc(contentAssets.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(contentAssets).where(where)))?.count ?? 0
    const items = (await db.select().from(contentAssets).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(serializeAsset)
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/assets', async (request, reply) => {
    const parsed = assetInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const id = (await createAsset(request.auth.workspaceId, request.auth.userId, parsed.data))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.created', id, { title: parsed.data.title })
    return reply.code(201).send(serializeAsset((await db.$first(db.select().from(contentAssets).where(eq(contentAssets.id, id))))!))
  })

  app.get('/assets/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const asset = (await db.$first(db.select().from(contentAssets).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))))
    if (!asset) return reply.code(404).send({ error: 'NOT_FOUND', message: '内容资产不存在。' })
    const latestCheck = (await db.$first(db.select().from(contentQualityChecks).where(and(eq(contentQualityChecks.contentAssetId, id), eq(contentQualityChecks.workspaceId, request.auth.workspaceId))).orderBy(desc(contentQualityChecks.createdAt))))
    return { ...serializeAsset(asset), latestQualityCheck: latestCheck ? { ...latestCheck, findings: JSON.parse(latestCheck.findingsJson) as string[] } : null }
  })

  app.patch('/assets/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = assetPatch.safeParse(request.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(contentAssets).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '内容资产不存在。' })
    const provided = pickProvided(request.body, parsed.data)
    const { changeNote, ...changes } = provided
    if (!Object.keys(changes).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const now = Date.now()
    const title = changes.title ?? existing.title
    const body = changes.body ?? existing.body
    const targetMarket = changes.targetMarket ?? existing.targetMarket
    const customerRole = changes.customerRole ?? existing.customerRole
    const customerSignal = changes.customerSignal ?? existing.customerSignal
    const contentChanged = changes.title !== undefined || changes.body !== undefined
    const versionNumber = contentChanged ? existing.currentVersion + 1 : existing.currentVersion
    const versionId = contentChanged ? createId('cvn') : null
    const quality = evaluateQuality(body, targetMarket, customerRole, customerSignal)
    await db.transaction(async tx => {
            await tx.update(contentAssets).set({
                      ...changes, currentVersion: versionNumber, qualityScore: quality.overallScore,
                      customerRelevance: quality.customerRelevance, evidenceScore: quality.evidenceScore,
                      actionClarity: quality.actionClarity,
                      ...(changes.status === '已发布' ? { publishedAt: now } : {}),
                      ...(changes.status !== undefined ? { archivedAt: changes.status === '已归档' ? now : null } : {}),
                      updatedAt: now,
                    }).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))
            if (versionId) await tx.insert(contentVersions).values({ id: versionId, workspaceId: request.auth.workspaceId, contentAssetId: id, versionNumber, title, body, changeNote: changeNote ?? '保存内容', createdByUserId: request.auth.userId, createdAt: now })
            await tx.insert(contentQualityChecks).values({ id: createId('cqc'), workspaceId: request.auth.workspaceId, contentAssetId: id, contentVersionId: versionId, overallScore: quality.overallScore, customerRelevance: quality.customerRelevance, evidenceScore: quality.evidenceScore, actionClarity: quality.actionClarity, status: 'completed', findingsJson: JSON.stringify(quality.findings), createdAt: now })
          })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.updated', id, { fields: Object.keys(changes), versionNumber })
    return serializeAsset((await db.$first(db.select().from(contentAssets).where(eq(contentAssets.id, id))))!)
  })

  app.post('/assets/:id/duplicate', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = (await db.$first(db.select().from(contentAssets).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '内容资产不存在。' })
    const duplicateId = (await createAsset(request.auth.workspaceId, request.auth.userId, { title: `${existing.title}（副本）`, contentType: existing.contentType, channel: existing.channel, status: '草稿', language: existing.language, body: existing.body, summary: existing.summary, targetMarket: existing.targetMarket, customerRole: existing.customerRole, buyingStage: existing.buyingStage, customerSignal: existing.customerSignal, sourceMethod: '复用资产' }))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.duplicated', duplicateId, { sourceId: id })
    return reply.code(201).send(serializeAsset((await db.$first(db.select().from(contentAssets).where(eq(contentAssets.id, duplicateId))))!))
  })

  app.get('/assets/:id/versions', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const exists = (await db.$first(db.select({ id: contentAssets.id }).from(contentAssets).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))))
    if (!exists) return reply.code(404).send({ error: 'NOT_FOUND', message: '内容资产不存在。' })
    return { items: (await db.select().from(contentVersions).where(and(eq(contentVersions.contentAssetId, id), eq(contentVersions.workspaceId, request.auth.workspaceId))).orderBy(desc(contentVersions.versionNumber))) }
  })

  app.post('/assets/:id/quality-check', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const asset = (await db.$first(db.select().from(contentAssets).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))))
    if (!asset) return reply.code(404).send({ error: 'NOT_FOUND', message: '内容资产不存在。' })
    const quality = evaluateQuality(asset.body, asset.targetMarket, asset.customerRole, asset.customerSignal)
    const now = Date.now()
    await insertQuality(request.auth.workspaceId, id, null, quality, now)
    await db.update(contentAssets).set({ qualityScore: quality.overallScore, customerRelevance: quality.customerRelevance, evidenceScore: quality.evidenceScore, actionClarity: quality.actionClarity, updatedAt: now }).where(eq(contentAssets.id, id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.quality_checked', id, { overallScore: quality.overallScore })
    return quality
  })

  app.post('/assets/:id/link-campaign', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = z.object({ campaignId: z.string().trim().min(1).max(120) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: '请选择营销活动。' })
    const asset = (await db.$first(db.select().from(contentAssets).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))))
    if (!asset) return reply.code(404).send({ error: 'NOT_FOUND', message: '内容资产不存在。' })
    const campaign = (await db.$first(db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.workspaceId, request.auth.workspaceId)))))
    if (!campaign) return reply.code(404).send({ error: 'CAMPAIGN_NOT_FOUND', message: '营销活动不存在。' })
    let ids: string[] = []
    try { ids = JSON.parse(asset.linkedCampaignIdsJson) as string[] } catch { ids = [] }
    ids = [...new Set([...ids, parsed.data.campaignId])]
    const existingLink = (await db.$first(db.select({ id: campaignContentLinks.id }).from(campaignContentLinks).where(and(eq(campaignContentLinks.campaignId, campaign.id), eq(campaignContentLinks.contentAssetId, id)))))
    const now = Date.now()
    await db.transaction(async tx => {
            await tx.update(contentAssets).set({ linkedCampaignIdsJson: JSON.stringify(ids), updatedAt: now }).where(and(eq(contentAssets.id, id), eq(contentAssets.workspaceId, request.auth.workspaceId)))
            if (!existingLink) {
              const position = ((await db.$first(tx.select({ max: sql<number>`coalesce(max(${campaignContentLinks.position}), 0)` }).from(campaignContentLinks).where(eq(campaignContentLinks.campaignId, campaign.id))))?.max ?? 0) + 1
              await tx.insert(campaignContentLinks).values({ id: createId('ccl'), workspaceId: request.auth.workspaceId, campaignId: campaign.id, contentAssetId: id, position, purpose: '内容资产关联', createdAt: now })
            }
          })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.campaign_linked', id, { campaignId: parsed.data.campaignId })
    return serializeAsset((await db.$first(db.select().from(contentAssets).where(eq(contentAssets.id, id))))!)
  })

  app.post('/analyze', async (request, reply) => {
    const parsed = z.object({
      title: z.string().trim().max(200).default('未命名内容'),
      contentType: z.string().trim().max(80).default('内容检查'),
      language: z.string().trim().max(40).default('中文'),
      body: z.string().max(60_000).default(''),
      targetMarket: z.string().trim().max(160).default('待补全'),
      customerRole: z.string().trim().max(100).default('待补全'),
      buyingStage: z.string().trim().max(80).default('问题认知'),
      customerSignal: z.string().trim().max(160).default('待识别'),
      sourceMethod: z.string().trim().max(80).default('客户信号'),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const input = parsed.data
    const quality = evaluateQuality(input.body, input.targetMarket, input.customerRole, input.customerSignal)
    const compact = input.body.replace(/\s/g, '')
    const tips: { label: string; tone: 'good' | 'warning'; detail: string }[] = []
    tips.push({ label: compact.length >= 120 ? '篇幅合适' : '内容偏短', tone: compact.length >= 120 ? 'good' : 'warning', detail: compact.length >= 120 ? '正文长度足以说明场景、证据和下一步。' : '建议补充客户场景、依据或一个明确下一步。' })
    tips.push({ label: /如果|也许|可能/.test(input.body) ? '语气可更确定' : '语气直接', tone: /如果|也许|可能/.test(input.body) ? 'warning' : 'good', detail: /如果|也许|可能/.test(input.body) ? '减少条件式表达，能让行动请求更明确。' : '措辞克制且具备明确方向。' })
    tips.push({ label: /回复|联系|发送|预约|沟通|评估|确认|下一步/.test(input.body) ? '行动请求明确' : '缺少行动请求', tone: /回复|联系|发送|预约|沟通|评估|确认|下一步/.test(input.body) ? 'good' : 'warning', detail: '建议在结尾给出回复、会议或资料获取等低阻力下一步。' })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.analyzed', input.title, { contentType: input.contentType, overallScore: quality.overallScore })
    return { quality, tips }
  })

  app.post('/generate', async (request, reply) => {
    const parsed = generateInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const input = parsed.data
    const runId = createId('cgr')
    const startedAt = Date.now()
    let body = ''
    let generationMode = 'ai'
    let serviceName: string | null = null
    let model: string | null = null
    let fallbackReason: string | null = null
    if (!(await hasAiConfiguration(request.auth.workspaceId))) {
      generationMode = 'local-rules'
      fallbackReason = 'AI_NOT_CONFIGURED'
      body = localDraft(input)
    } else {
      try {
        const result = await completeWithAi({
          workspaceId: request.auth.workspaceId,
          timeoutMs: 30_000,
          messages: [
            { role: 'system', content: '你是 B2B 外贸客户增长内容编辑。只输出可直接发送的正文，不要标题、解释、Markdown 代码块、占位符或未经证实的数据。内容需具体、克制、专业，并包含一个低压力下一步。' },
            { role: 'user', content: input.existingBody?.trim()
              ? `请润色以下${input.language}${input.contentType}，保留事实、客户和意图，让语言更自然、行动请求更直接，不要虚构数据：\n\n${input.existingBody}`
              : `生成${input.language}的${input.contentType}。目标市场：${input.targetMarket}；客户角色：${input.customerRole}；购买阶段：${input.buyingStage}；客户信号：${input.customerSignal}；信息来源：${input.sourceMethod}；发布渠道：${input.channel}。` },
          ], maxTokens: 500, temperature: .3,
        })
        body = result.content
        serviceName = result.serviceName
        model = result.model
      } catch (error) {
        generationMode = 'local-rules'
        fallbackReason = error instanceof AiUnavailableError ? error.code : 'AI_CALL_FAILED'
        body = localDraft(input)
      }
    }
    const quality = evaluateQuality(body, input.targetMarket, input.customerRole, input.customerSignal)
    const completedAt = Date.now()
    let assetId: string | null = null
    if (input.saveAsAsset) assetId = (await createAsset(request.auth.workspaceId, request.auth.userId, { ...input, body, summary: body.replace(/\s+/g, ' ').slice(0, 160), status: '草稿' }))
    await db.insert(contentGenerationRuns).values({ id: runId, workspaceId: request.auth.workspaceId, contentAssetId: assetId, status: 'completed', generationMode, serviceName, model, inputJson: JSON.stringify(input), outputTitle: input.title, outputBody: body, error: fallbackReason, startedAt, completedAt, createdAt: startedAt })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'content.generated', assetId ?? runId, { generationMode, saved: Boolean(assetId) })
    return { id: runId, assetId, title: input.title, body, generationMode, serviceName, model, quality, fallbackReason }
  })

  app.get('/generation-runs', async (request) => ({ items: (await db.select().from(contentGenerationRuns).where(eq(contentGenerationRuns.workspaceId, request.auth.workspaceId)).orderBy(desc(contentGenerationRuns.createdAt)).limit(50)) }))
}
