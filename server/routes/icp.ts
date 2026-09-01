import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AiUnavailableError, completeWithAi, hasAiConfiguration } from '../ai/client.js'
import { db } from '../db/client.js'
import { auditLogs, businessProfiles, knowledgeItems } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth, requirePermission } from '../plugins/auth.js'

const knowledgeTypes = ['产品与方案', '产品知识', '应用知识', '合规知识', '公司资料', '客户案例', '客户判断规则', '市场知识', '竞争信息'] as const
const knowledgeStatuses = ['已启用', '待复核', '已停用'] as const

const profileInput = z.object({
  company: z.string().trim().max(200).default(''),
  website: z.string().trim().max(300).default(''),
  products: z.string().trim().max(4000).default(''),
  regions: z.string().trim().max(1000).default(''),
  customers: z.string().trim().max(4000).default(''),
  exclusions: z.string().trim().max(2000).default(''),
  selectedMarket: z.string().trim().max(200).optional(),
})

const knowledgeInput = z.object({
  title: z.string().trim().min(1).max(200),
  itemType: z.enum(knowledgeTypes).default('市场知识'),
  summary: z.string().max(8000).default(''),
  source: z.string().trim().max(300).default('手动录入'),
  sourceUrl: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(knowledgeStatuses).default('待复核'),
})
const knowledgePatch = knowledgeInput.partial()

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  itemType: z.enum(knowledgeTypes).optional(),
  status: z.enum(knowledgeStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'updated_asc', 'title_asc', 'title_desc', 'references_desc', 'references_asc']).default('updated_desc'),
})

type ProfileRow = typeof businessProfiles.$inferSelect
type KnowledgeRow = typeof knowledgeItems.$inferSelect

const serializeProfile = (row: ProfileRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  company: row.company,
  website: row.website,
  products: row.products,
  regions: row.regions,
  customers: row.customers,
  exclusions: row.exclusions,
  selectedMarket: row.selectedMarket,
  analysisStatus: row.analysisStatus,
  analysisSummary: normalizeAnalysisSummary(row),
  analysisMode: row.analysisMode,
  analysisError: row.analysisError,
  analyzedAt: row.analyzedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const serializeKnowledge = (row: KnowledgeRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  itemType: row.itemType,
  summary: row.summary,
  source: row.source,
  sourceUrl: row.sourceUrl,
  tags: (() => { try { return JSON.parse(row.tagsJson) as string[] } catch { return [] } })(),
  status: row.status,
  referenceCount: row.referenceCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({
        id: createId('aud'), workspaceId, actorUserId, action,
        entityType: 'business_profile', entityId,
        metadata: JSON.stringify(metadata), createdAt: Date.now(),
      })
}

const writeKnowledgeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({
        id: createId('aud'), workspaceId, actorUserId, action,
        entityType: 'knowledge_item', entityId,
        metadata: JSON.stringify(metadata), createdAt: Date.now(),
      })
}

const ensureProfile = async (workspaceId: string, userId: string): Promise<ProfileRow> => {
  const existing = (await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.workspaceId, workspaceId))))
  if (existing) return existing
  const now = Date.now()
  const row: ProfileRow = {
    id: createId('bpr'), workspaceId, ownerUserId: userId,
    company: '', website: '', products: '', regions: '', customers: '', exclusions: '',
    selectedMarket: '待验证细分市场',
    analysisStatus: 'idle', analysisSummary: '', analysisMode: 'idle', analysisError: null,
    analyzedAt: null, createdAt: now, updatedAt: now,
  }
  await db.insert(businessProfiles).values(row)
  return row
}

type MarketRecommendation = {
  name: string
  reason: string
  profile?: string[]
  criteria?: string[]
  signals?: string[]
}

type AnalysisResult = {
  summary: string
  signals: string[]
  recommendedMarkets: MarketRecommendation[]
  criteria: string[]
}

const MAX_RECOMMENDED_MARKETS = 10

const genericMarketFallbacks: MarketRecommendation[] = [
  { name: '目标行业终端工厂与项目业主', reason: '终端工厂和项目业主具有直接采购、扩建改造、检修替换和技术选型需求。' },
  { name: '设备制造商与 OEM 配套客户', reason: '设备制造商可把产品集成到成套设备和生产线中，形成持续配套需求。' },
  { name: 'EPC、工程公司与系统集成商', reason: '工程设计与系统集成企业能够在项目设计、选型和采购阶段导入解决方案。' },
  { name: '区域经销商与授权代理商', reason: '具备本地客户覆盖、库存、技术支持和售后能力的渠道伙伴适合长期开发。' },
  { name: '公共采购与招投标项目客户', reason: '政府、公共事业和大型组织的公开采购机会可通过官方公告核验需求和截止时间。' },
  { name: '新建、扩产与技术改造企业', reason: '公开的新工厂、扩产、产线升级和自动化改造信号通常对应明确采购窗口。' },
  { name: '检修替换与备件采购客户', reason: '存量设备维护、故障替换和备件补充形成持续且可复购的需求。' },
  { name: '进口商、批发商与专业分销网络', reason: '已有进口资质、行业客户和仓储配送能力的企业可承担区域市场覆盖。' },
  { name: '技术服务商与运维承包商', reason: '提供安装、调试、维护和改造服务的企业能够影响终端选型并产生配套采购。' },
  { name: '跨国企业区域采购与供应链团队', reason: '跨国企业的区域采购和供应链团队适合围绕供应商准入、标准化和多站点需求开发。' },
]

const marketSegment = (name: string) => name
  .replace(/^(海外|全球)/, '')
  .replace(/(客户|市场)$/, '')
  .trim() || '目标细分市场'

const uniqueStrings = (values: Array<string | undefined>, limit: number) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= limit) break
  }
  return result
}

const marketProfileDefaults = (name: string, segment: string) => {
  if (/生物制药|制药装备|医药/.test(name)) return ['生物制药工厂、制药装备商或洁净工程公司', '涉及无菌生产、洁净流体或 GMP 验证', '具备项目采购、工程设计或设备集成能力', '官网可核验产线、产品或工程案例']
  if (/食品|饮料/.test(name)) return ['食品饮料生产企业、设备商或工艺工程公司', '涉及卫生输送、CIP 清洗或过程控制', '具备产线新建、扩产或设备升级计划', '官网可核验工厂、产品和生产场景']
  if (/乳品|酿酒/.test(name)) return ['乳品、啤酒或酿造工厂及其工程服务商', '重视物料隔离、卫生输送和清洗效率', '具备生产线自动化或柔性改造能力', '官网可核验工艺、产能或项目案例']
  if (/半导体|高纯/.test(name)) return ['晶圆厂、高纯设备商或洁净工程集成商', '涉及高纯介质输送和精密过程控制', '具备厂务工程、设备配套或项目采购能力', '官网可核验半导体业务与技术能力']
  if (/新能源/.test(name)) return ['新能源材料工厂、设备制造商或工程集成商', '涉及洁净输送、耐腐蚀和计量调节', '具备新建产线、扩产或自动化升级计划', '官网可核验产能、项目或产品应用']
  if (/精细化工|化工/.test(name)) return ['精细化工生产企业、工艺设备商或 EPC 公司', '涉及复杂介质、温压条件和批次控制', '具备技改、扩产或安全升级需求', '官网可核验工艺、装置或项目能力']
  if (/发酵|生物工程/.test(name)) return ['发酵、生物工程或生物材料生产企业', '涉及洁净输送、CIP/SIP 和批次控制', '具备工厂扩建、产线升级或设备采购计划', '官网可核验生产工艺与应用方向']
  if (/水处理/.test(name)) return ['水处理设备商、工程公司或工业终端工厂', '涉及泵阀、控制和成套系统配套', '具备项目投标、工程交付或备件采购能力', '官网可核验项目案例和服务区域']
  if (/化妆品|日化/.test(name)) return ['化妆品、日化生产企业或混配设备商', '涉及卫生混配、物料输送和柔性生产', '具备新品扩线、产能升级或设备替换计划', '官网可核验品牌、工厂或生产能力']
  if (/渠道|经销|代理|分销|进口商|批发商/.test(name)) return ['目标行业的进口商、经销商或区域代理商', '具备本地销售、技术支持和售后能力', '拥有匹配的行业客户、库存或项目网络', '官网可核验代理品牌、团队和覆盖区域']
  if (/EPC|工程|系统集成/.test(name)) return ['EPC、工程设计公司或系统集成商', '能够影响项目设计、产品选型和采购', '具备目标行业项目经验与交付团队', '官网可核验工程案例和服务范围']
  return [segment, '业务场景与当前细分市场直接匹配', '具备项目采购、设备集成、生产运营或区域渠道能力', '官网、业务身份和公开经营信息可核验']
}

const marketSignals = (name: string, defaults: string[]) => {
  if (/生物制药|制药装备|医药/.test(name)) return ['GMP 或验证改造', '新建或扩建无菌产线', '洁净流体系统采购', '制药工程或设备招标']
  if (/食品|饮料/.test(name)) return ['新建或扩建食品产线', 'CIP 与卫生升级', '生产设备替换采购', '食品工程项目招标']
  if (/乳品|酿酒/.test(name)) return ['乳品或酿造产线扩建', '卫生输送与清洗升级', '生产自动化改造', '工艺设备采购']
  if (/半导体|高纯/.test(name)) return ['晶圆厂或配套项目扩建', '高纯流体系统采购', '厂务工程招标', '设备商新产品配套']
  if (/新能源/.test(name)) return ['材料产线扩建', '耐腐蚀设备采购', '计量与自动化升级', '新工厂或新项目投产']
  if (/精细化工|化工/.test(name)) return ['工艺装置新建或改造', '复杂介质输送需求', '过程控制与安全升级', '设备检修与替换采购']
  if (/发酵|生物工程/.test(name)) return ['发酵产线新建或扩产', 'CIP/SIP 系统升级', '批次控制与自动化改造', '生物设备采购']
  if (/水处理/.test(name)) return ['水处理项目招标', '成套设备集成采购', '泵阀备件与替换', '工业水系统升级']
  if (/化妆品|日化/.test(name)) return ['混配或灌装产线扩建', '卫生生产升级', '柔性设备采购', '新工厂或新品扩线']
  if (/渠道|经销|代理|分销|进口商|批发商/.test(name)) return ['新增品牌代理', '区域分销扩张', 'OEM、库存或项目合作', '现有产品线补充']
  if (/EPC|工程|系统集成/.test(name)) return ['新项目中标或签约', '工程采购与供应商准入', '设计选型与设备集成', '区域项目团队扩张']
  return uniqueStrings(defaults, 4)
}

const enrichMarket = (market: MarketRecommendation, defaultCriteria: string[], defaultSignals: string[], exclusions = ''): MarketRecommendation => {
  const segment = marketSegment(market.name)
  const providedProfile = (market.profile ?? []).filter(Boolean)
  const providedSignals = (market.signals ?? []).filter(Boolean)
  const profile = uniqueStrings([
    ...(providedProfile.length >= 4 ? providedProfile : []),
    ...marketProfileDefaults(market.name, segment),
    ...providedProfile,
  ], 5)
  const signals = uniqueStrings([
    ...(providedSignals.length >= 4 ? providedSignals : []),
    ...marketSignals(market.name, defaultSignals),
    ...providedSignals,
  ], 5)
  const criteria = uniqueStrings([
    `主营业务、产品组合或项目场景与「${segment}」直接匹配`,
    profile[0] ? `企业类型符合：${profile[0]}` : undefined,
    profile[1] ? `核心应用或能力符合：${profile[1]}` : undefined,
    profile[2] ? `采购与交付能力符合：${profile[2]}` : undefined,
    signals[0] ? `近期出现“${signals[0]}”等可核验需求信号` : undefined,
    signals[1] ? `近期出现“${signals[1]}”等采购窗口信号` : undefined,
    '官网、法人主体、经营地区和业务身份可由可信公开来源交叉核验',
    exclusions ? `排除：${exclusions.slice(0, 100)}` : '排除业务不匹配、停止经营或无法核验公开来源的企业',
    ...(market.criteria ?? []),
    ...defaultCriteria,
  ], 8)
  return {
    name: market.name,
    reason: market.reason,
    profile,
    criteria,
    signals,
  }
}

const normalizeMarkets = (
  markets: MarketRecommendation[],
  criteria: string[],
  signals: string[],
  fallbacks: MarketRecommendation[] = [],
  exclusions = '',
) => {
  const unique = new Map<string, MarketRecommendation>()
  for (const market of [...markets, ...fallbacks]) {
    const name = String(market?.name ?? '').trim()
    if (!name || unique.has(name)) continue
    unique.set(name, enrichMarket({ ...market, name, reason: String(market?.reason ?? '') }, criteria, signals, exclusions))
    if (unique.size >= MAX_RECOMMENDED_MARKETS) break
  }
  return [...unique.values()]
}

const localAnalyze = (input: z.infer<typeof profileInput>): AnalysisResult => {
  const products = (input.products || '').trim()
  const customers = (input.customers || '').trim()
  const regions = (input.regions || '').trim()
  const sourceText = `${products} ${customers}`
  const summaryBits: string[] = []
  if (products) summaryBits.push(`根据“${products.slice(0, 40)}${products.length > 40 ? '…' : ''}”的产品能力`)
  if (customers) summaryBits.push(`已成交/理想客户为“${customers.slice(0, 40)}${customers.length > 40 ? '…' : ''}”`)
  if (regions) summaryBits.push(`主要销售地区覆盖 ${regions}`)
  const summary = summaryBits.length
    ? `${summaryBits.join('，')}。建议优先围绕已有产品验证和明确客户画像的细分市场展开 AI 获客，并保留证据和人工复核。`
    : '业务资料尚不完善。建议先补充产品、客户示例和重点地区，AI 获客才能据此生成更可靠的市场和候选判断。'
  const signals = ['新建、扩建或技术改造项目', '招标、采购与供应商准入', '检修、备件与替换需求', '区域代理、分销或工程合作']
  const recommendedMarkets: { name: string; reason: string }[] = []
  const isHygienicBusiness = /卫生级|无菌|高洁净|hygienic|sanitary|aseptic|ASME BPE|CIP|SIP/i.test(sourceText)
  if (isHygienicBusiness) {
    recommendedMarkets.push(
      { name: '海外生物制药与制药装备客户', reason: `高洁净泵、无菌阀门与洁净管路能力适合围绕${regions || '目标销售地区'}的生物制药工厂、设备制造商和工程项目核验公开需求。` },
      { name: '海外食品饮料加工客户', reason: '卫生级泵阀、CIP 清洗和过程控制适用于食品饮料生产线的新建、扩产与设备升级。' },
      { name: '海外乳品与酿酒工程客户', reason: '乳品和酿酒工艺重视卫生输送、物料隔离、清洗效率与生产线自动化。' },
      { name: '海外半导体高纯流体客户', reason: '高纯介质输送、洁净管路和精密过程控制适合半导体及相关设备配套场景。' },
      { name: '海外新能源材料与设备客户', reason: '新能源材料生产和设备配套存在洁净输送、耐腐蚀、计量调节与自动化需求。' },
      { name: '海外精细化工过程客户', reason: '复杂介质、温压条件和批次控制需要可靠的泵阀选型与过程控制方案。' },
      { name: '海外水处理与工艺设备客户', reason: '水处理设备制造商、工程商和终端工厂具有持续的泵阀、控制与系统配套需求。' },
      { name: '海外高洁净设备渠道与系统集成商', reason: '完整的泵、阀门与控制产品组合适合区域分销、OEM 配套和项目集成。' },
      { name: '海外发酵与生物工程客户', reason: '发酵、生物工程和生物材料生产涉及洁净输送、批次控制、CIP/SIP 与过程自动化需求。' },
      { name: '海外化妆品与日化生产客户', reason: '化妆品和日化生产重视卫生混配、物料输送、清洗效率及柔性生产线升级。' },
    )
  } else if (/阀门|valve|泵|管路|流体|管道|flow control/i.test(sourceText)) {
    recommendedMarkets.push(
      { name: '全球油气与石化项目业主及 EPC', reason: `产品与工业流体控制和项目型采购匹配，可围绕${regions || '目标销售地区'}的油气、炼化、石化与工程项目寻找公开采购信号。` },
      { name: '工业阀门经销商与区域代理商', reason: '完整产品范围、定制交付和技术选型能力适合发展拥有工业客户与本地服务能力的渠道伙伴。' },
      { name: '电力、水处理与煤化工工程客户', reason: '这些行业存在持续的项目建设、检修与备件需求，可通过工程案例、招标和供应商名录核验。' },
    )
  }
  if (!isHygienicBusiness && /食品|乳品|饮料|餐饮|烘焙/i.test(sourceText))
    recommendedMarkets.push({ name: '食品与饮料工厂工程客户', reason: '业务资料包含食品相关应用，可优先核验具备工厂建设、扩产或卫生级流体项目需求的企业。' })
  if (!isHygienicBusiness && /制药|医药|GMP|生物/i.test(sourceText))
    recommendedMarkets.push({ name: '制药与生物工程项目客户', reason: '业务资料包含制药相关应用，可优先核验扩产、验证改造和工程采购信号。' })
  if (!recommendedMarkets.length)
    recommendedMarkets.push({ name: '待验证细分市场', reason: '请补充产品与客户示例后再运行分析，以获得更明确的市场建议。' })
  const criteria = [
    customers ? `优先匹配客户画像：${customers.slice(0, 60)}` : '优先行业与产品应用场景匹配的企业',
    '具备项目采购、工程设计、设备集成、自有工厂或区域渠道能力',
    '出现项目建设、招标采购、检修替换、扩产或渠道合作等近期公开信号',
    input.exclusions ? `排除：${input.exclusions.slice(0, 80)}` : '排除业务范围不匹配或无法核验公开来源的企业',
  ]
  const shouldFill = Boolean(sourceText.trim()) && recommendedMarkets[0]?.name !== '待验证细分市场'
  return {
    summary,
    signals,
    recommendedMarkets: normalizeMarkets(recommendedMarkets, criteria, signals, shouldFill ? genericMarketFallbacks : [], input.exclusions),
    criteria,
  }
}

const normalizeAnalysisSummary = (row: ProfileRow) => {
  if (!row.analysisSummary) return row.analysisSummary
  try {
    const parsed = JSON.parse(row.analysisSummary) as Partial<AnalysisResult>
    const fallback = localAnalyze({
      company: row.company,
      website: row.website,
      products: row.products,
      regions: row.regions,
      customers: row.customers,
      exclusions: row.exclusions,
      selectedMarket: row.selectedMarket,
    })
    const signals = Array.isArray(parsed.signals) && parsed.signals.length ? parsed.signals.map(String) : fallback.signals
    const criteria = Array.isArray(parsed.criteria) && parsed.criteria.length ? parsed.criteria.map(String) : fallback.criteria
    const markets = Array.isArray(parsed.recommendedMarkets) ? parsed.recommendedMarkets : []
    return JSON.stringify({
      summary: typeof parsed.summary === 'string' && parsed.summary ? parsed.summary : fallback.summary,
      signals,
      criteria,
      recommendedMarkets: normalizeMarkets(markets, criteria, signals, fallback.recommendedMarkets, row.exclusions),
    } satisfies AnalysisResult)
  } catch {
    return row.analysisSummary
  }
}

export const icpRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/profile', async (request) => {
    const row = (await ensureProfile(request.auth.workspaceId, request.auth.userId))
    return serializeProfile(row)
  })

  app.put('/profile', async (request, reply) => {
    const parsed = profileInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await ensureProfile(request.auth.workspaceId, request.auth.userId))
    const now = Date.now()
    const changes = pickProvided(request.body, parsed.data)
    const body = request.body as Record<string, unknown>
    const businessFieldsChanged = ['company', 'website', 'products', 'regions', 'customers', 'exclusions']
      .some(field => Object.prototype.hasOwnProperty.call(body, field))
    await db.update(businessProfiles).set({
            ...changes,
            ...(businessFieldsChanged ? { analysisStatus: 'idle', analysisSummary: '', analysisMode: 'idle', analysisError: null, analyzedAt: null } : {}),
            updatedAt: now,
          }).where(and(eq(businessProfiles.id, existing.id), eq(businessProfiles.workspaceId, request.auth.workspaceId)))
    const updated = (await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.id, existing.id))))!
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'icp.profile.updated', existing.id, { fields: Object.keys(parsed.data) })
    return serializeProfile(updated)
  })

  app.post('/profile/analyze', async (request, reply) => {
    const existing = (await ensureProfile(request.auth.workspaceId, request.auth.userId))
    const now = Date.now()
    await db.update(businessProfiles).set({ analysisStatus: 'running', analysisError: null, updatedAt: now })
            .where(eq(businessProfiles.id, existing.id))
    const input: z.infer<typeof profileInput> = {
      company: existing.company, website: existing.website, products: existing.products,
      regions: existing.regions, customers: existing.customers, exclusions: existing.exclusions,
      selectedMarket: existing.selectedMarket,
    }
    let result: AnalysisResult
    let mode: 'ai' | 'local-rules' = 'local-rules'
    let error: string | null = null
    if ((await hasAiConfiguration(request.auth.workspaceId))) {
      try {
        const response = await completeWithAi({
          workspaceId: request.auth.workspaceId,
          timeoutMs: 30_000,
          messages: [
            { role: 'system', content: `你是 B2B 客户定位分析师。只能根据用户提供的业务资料归纳，不得虚构数据或客户。只输出 JSON，字段为 summary(string)、signals(string[])、recommendedMarkets({name,reason,profile(string[]),criteria(string[]),signals(string[])}[])、criteria(string[])。输出 ${MAX_RECOMMENDED_MARKETS} 个互不重复且可执行的细分市场。每个市场必须单独生成：4-5 条企业特征、7-8 条可核验筛选条件、4-5 条意向信号；内容必须直接对应该市场的企业类型、应用场景、采购能力和公开信号，禁止在不同市场复制相同数组。reason 要明确说明当前业务为什么适合该市场。` },
            { role: 'user', content: `公司：${input.company}\n官网：${input.website}\n产品：${input.products}\n地区：${input.regions}\n客户示例：${input.customers}\n排除：${input.exclusions}` },
          ], maxTokens: 4800, temperature: .2,
        })
        const parsed = JSON.parse(response.content) as Partial<AnalysisResult>
        result = {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6).map(x => String(x)) : [],
          recommendedMarkets: Array.isArray(parsed.recommendedMarkets)
            ? parsed.recommendedMarkets.slice(0, MAX_RECOMMENDED_MARKETS).map(x => ({
                name: String(x?.name ?? ''),
                reason: String(x?.reason ?? ''),
                profile: Array.isArray(x?.profile) ? x.profile.slice(0, 5).map(String) : [],
                criteria: Array.isArray(x?.criteria) ? x.criteria.slice(0, 8).map(String) : [],
                signals: Array.isArray(x?.signals) ? x.signals.slice(0, 5).map(String) : [],
              })).filter(x => x.name)
            : [],
          criteria: Array.isArray(parsed.criteria) ? parsed.criteria.slice(0, 8).map(x => String(x)) : [],
        }
        if (!result.summary || !result.recommendedMarkets.length) throw new Error('AI_RESULT_INCOMPLETE')
        const fallback = localAnalyze(input)
        result.recommendedMarkets = normalizeMarkets(
          result.recommendedMarkets,
          result.criteria.length ? result.criteria : fallback.criteria,
          result.signals.length ? result.signals : fallback.signals,
          fallback.recommendedMarkets,
          input.exclusions,
        )
        mode = 'ai'
      } catch (cause) {
        error = cause instanceof AiUnavailableError ? cause.code : (cause instanceof Error ? cause.message : 'AI_CALL_FAILED')
        result = localAnalyze(input)
      }
    } else {
      result = localAnalyze(input)
    }
    const analysisSummary = JSON.stringify(result)
    const completedAt = Date.now()
    const selectedMarket = result.recommendedMarkets.some(item => item.name === existing.selectedMarket)
      ? existing.selectedMarket
      : result.recommendedMarkets[0]?.name ?? '待验证细分市场'
    await db.update(businessProfiles).set({
            analysisStatus: 'complete', analysisSummary, analysisMode: mode,
            analysisError: error, analyzedAt: completedAt, selectedMarket, updatedAt: completedAt,
          }).where(eq(businessProfiles.id, existing.id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'icp.profile.analyzed', existing.id, { mode, hasAi: mode === 'ai', error })
    const updated = (await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.id, existing.id))))!
    return reply.code(202).send({ ...serializeProfile(updated), analysis: result, mode })
  })

  app.get('/knowledge', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(knowledgeItems.workspaceId, request.auth.workspaceId)]
    if (query.q) conditions.push(or(
      like(knowledgeItems.title, `%${query.q}%`),
      like(knowledgeItems.summary, `%${query.q}%`),
      like(knowledgeItems.tagsJson, `%${query.q}%`),
    )!)
    if (query.itemType) conditions.push(eq(knowledgeItems.itemType, query.itemType))
    if (query.status) conditions.push(eq(knowledgeItems.status, query.status))
    const where = and(...conditions)
    const orderBy =
      query.sort === 'updated_asc' ? asc(knowledgeItems.updatedAt)
      : query.sort === 'title_asc' ? asc(knowledgeItems.title)
      : query.sort === 'title_desc' ? desc(knowledgeItems.title)
      : query.sort === 'references_desc' ? desc(knowledgeItems.referenceCount)
      : query.sort === 'references_asc' ? asc(knowledgeItems.referenceCount)
      : desc(knowledgeItems.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(knowledgeItems).where(where)))?.count ?? 0
    const items = (await db.select().from(knowledgeItems).where(where).orderBy(orderBy)
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(serializeKnowledge)
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/knowledge', async (request, reply) => {
    const parsed = knowledgeInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const row: KnowledgeRow = {
      id: createId('knw'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId,
      title: parsed.data.title, itemType: parsed.data.itemType, summary: parsed.data.summary,
      source: parsed.data.source, sourceUrl: parsed.data.sourceUrl ?? null,
      tagsJson: JSON.stringify(parsed.data.tags), status: parsed.data.status,
      referenceCount: 0, createdAt: now, updatedAt: now,
    }
    await db.insert(knowledgeItems).values(row)
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.created', row.id, { title: row.title, itemType: row.itemType })
    return reply.code(201).send(serializeKnowledge(row))
  })

  app.get('/knowledge/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = (await db.$first(db.select().from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    return serializeKnowledge(row)
  })

  app.patch('/knowledge/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = knowledgePatch.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await db.$first(db.select().from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    const provided = pickProvided(request.body, parsed.data) as Partial<z.infer<typeof knowledgeInput>>
    if (!Object.keys(provided).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const now = Date.now()
    const patch: Partial<KnowledgeRow> = { updatedAt: now }
    if (provided.title !== undefined) patch.title = provided.title
    if (provided.itemType !== undefined) patch.itemType = provided.itemType
    if (provided.summary !== undefined) patch.summary = provided.summary
    if (provided.source !== undefined) patch.source = provided.source
    if (provided.sourceUrl !== undefined) patch.sourceUrl = provided.sourceUrl
    if (provided.status !== undefined) patch.status = provided.status
    if (provided.tags !== undefined) patch.tagsJson = JSON.stringify(provided.tags)
    await db.update(knowledgeItems).set(patch)
            .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.updated', id, { fields: Object.keys(provided) })
    return serializeKnowledge((await db.$first(db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))))!)
  })

  app.patch('/knowledge/:id/status', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = z.object({ status: z.enum(knowledgeStatuses) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await db.$first(db.select().from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    const now = Date.now()
    await db.update(knowledgeItems).set({ status: parsed.data.status, updatedAt: now })
            .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.status_changed', id, { status: parsed.data.status })
    return serializeKnowledge((await db.$first(db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))))!)
  })

  app.delete('/knowledge/:id', { preHandler: requirePermission('data.delete') }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = (await db.$first(db.select({ id: knowledgeItems.id }).from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    await db.delete(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.deleted', id, {})
    return reply.code(204).send()
  })
}
