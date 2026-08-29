import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'

if (!process.argv.includes('--confirm')) {
  throw new Error('该脚本会把当前 OULAM 主工作区的公司资料迁移为 DONJOY。确认后请使用 --confirm 运行。')
}

const databasePath = resolve(process.env.SONDARA_DATABASE_PATH || 'data/sondara.sqlite')
const databaseUrl = process.env.SONDARA_DATABASE_URL || `file:${databasePath.replaceAll('\\', '/')}`
const db = createClient({ url: databaseUrl })
const now = Date.now()

const analysis = {
  summary: 'DONJOY 面向海外市场提供高洁净泵、卫生级与无菌阀门、阀门控制和工艺管路解决方案，适合围绕洁净生产、过程自动化、工厂扩建、设备配套和区域渠道开展客户开发。',
  signals: ['新建工厂、扩产或洁净产线改造', '设备采购、招标与供应商准入', 'CIP/SIP、自动化或工艺升级', '区域代理、OEM 配套与系统集成合作'],
  recommendedMarkets: [
    { name: '海外生物制药与制药装备客户', reason: '无菌阀门、高洁净泵和 ASME BPE 管路能力与洁净生产、验证和设备配套需求匹配。' },
    { name: '海外食品饮料加工客户', reason: '卫生级泵阀、CIP 清洗和过程控制适用于食品饮料生产线的新建、扩产及设备升级。' },
    { name: '海外乳品与酿酒工程客户', reason: '乳品和酿酒工艺重视卫生输送、物料隔离、清洗效率与生产线自动化。' },
    { name: '海外半导体高纯流体客户', reason: '高纯介质输送、洁净管路和精密过程控制适合半导体及相关设备配套场景。' },
    { name: '海外新能源材料与设备客户', reason: '新能源材料生产和设备配套存在洁净输送、耐腐蚀、计量调节与自动化需求。' },
    { name: '海外精细化工过程客户', reason: '复杂介质、温压条件和批次控制需要可靠的泵阀选型与过程控制方案。' },
    { name: '海外水处理与工艺设备客户', reason: '水处理设备制造商、工程商和终端工厂具有持续的泵阀、控制与系统配套需求。' },
    { name: '海外高洁净设备渠道与系统集成商', reason: '完整的泵、阀门和控制产品组合适合区域分销、OEM 配套和项目集成。' },
  ],
  criteria: [
    '具有高洁净生产、工程设计、设备制造、系统集成或区域渠道能力',
    '应用场景涉及生物制药、食品饮料、乳品酿酒、半导体、新能源、精细化工或水处理',
    '存在工厂新建、扩产、招标、设备升级、供应商准入或渠道合作等近期公开信号',
    '排除消费类企业、业务范围不匹配或无法核验官网与公开来源的联系人',
  ],
}

const knowledgeReplacements = [
  {
    oldTitle: 'OULAM 公司与制造能力',
    title: 'DONJOY 公司与制造能力',
    type: '公司资料',
    summary: 'DONJOY 创立于 1993 年，面向国际市场研发和制造高洁净泵、阀门控制器、卫生级与无菌阀门及相关工艺设备。英文官网展示现代化制造、研发和国际贸易服务能力。',
    tags: ['DONJOY', '公司资料', '制造能力', '海外业务'],
  },
  {
    oldTitle: 'OULAM 产品范围',
    title: 'DONJOY 高洁净泵阀产品范围',
    type: '产品知识',
    summary: '英文官网产品覆盖卫生级泵、卫生级与无菌阀门、阀门控制器、执行器、调节阀、安全控制、罐体清洗、过滤器、人孔和卫生管件。',
    tags: ['卫生级泵', '无菌阀门', '阀门控制', '卫生管件'],
  },
  {
    oldTitle: 'OULAM 交付与服务承诺',
    title: 'DONJOY 国际标准与技术资料',
    type: '合规知识',
    summary: 'DONJOY 英文资料涵盖 ASME BPE、EHEDG、FDA、3-A、PED 等标准与认证信息，并提供英文产品目录、证书和技术支持入口。',
    tags: ['ASME BPE', 'EHEDG', 'FDA', '3-A', 'PED'],
  },
  {
    oldTitle: '炼化项目客户案例',
    title: 'DONJOY 生物制药应用方向',
    type: '行业应用',
    summary: '面向生物制药和制药装备客户，重点匹配无菌阀门、高洁净泵、CIP/SIP、材质追溯、表面处理和洁净管路需求。',
    tags: ['生物制药', '无菌', 'CIP', 'SIP'],
  },
  {
    oldTitle: '煤制气项目客户案例',
    title: 'DONJOY 食品饮料与乳品应用方向',
    type: '行业应用',
    summary: '面向食品、饮料、乳品和酿酒客户，重点匹配卫生级输送、混合、清洗、物料隔离和过程自动化需求。',
    tags: ['食品饮料', '乳品', '酿酒', '卫生级工艺'],
  },
  {
    oldTitle: '海上油气项目客户案例',
    title: 'DONJOY 海外渠道与系统集成客户',
    type: '客户判断规则',
    summary: '优先开发具备本地工业客户、技术选型、售后服务、设备配套或项目集成能力的海外经销商、代理商、OEM 和系统集成商。',
    tags: ['海外渠道', '经销商', 'OEM', '系统集成商'],
  },
]

try {
  const profile = (await db.execute({
    sql: `select id, workspace_id, owner_user_id, company from business_profiles
          where lower(company) like '%oulam%' or company like '%欧拉姆%' or lower(company) like '%donjoy%' or company like '%东正科技%'
          order by case when lower(company) like '%donjoy%' or company like '%东正科技%' then 0 else 1 end limit 1`,
    args: [],
  })).rows[0]
  if (!profile) throw new Error('未找到 OULAM 或 DONJOY 主业务资料，未执行迁移。')

  const workspaceId = String(profile.workspace_id)
  const ownerUserId = profile.owner_user_id ? String(profile.owner_user_id) : null

  await db.execute('begin immediate')
  await db.execute({
    sql: 'update workspaces set name = ?, updated_at = ? where id = ?',
    args: ['东正科技有限公司（DONJOY）', now, workspaceId],
  })
  if (ownerUserId) {
    await db.execute({
      sql: `update users set display_name = case when display_name like '%OULAM%' or display_name like '%欧拉姆%' then 'DONJOY 外贸管理员' else display_name end,
            currency = 'USD', updated_at = ? where id = ?`,
      args: [now, ownerUserId],
    })
  }
  await db.execute({
    sql: `update business_profiles set company = ?, website = ?, products = ?, regions = ?, customers = ?, exclusions = ?,
          selected_market = ?, analysis_status = 'complete', analysis_summary = ?, analyzed_at = ?, analysis_mode = 'official-source',
          analysis_error = null, updated_at = ? where id = ? and workspace_id = ?`,
    args: [
      '东正科技有限公司（DONJOY）',
      'https://www.donjoypumps.com/',
      '面向海外市场的高洁净流体设备与过程控制解决方案，包括卫生级泵、无菌与卫生级阀门、阀门控制器和执行器、调节阀、罐体清洗、安全控制及 ASME BPE 管件。',
      '全球海外市场；每次获客任务按国家或区域单独选择',
      '海外生物制药、食品饮料、乳品与酿酒、半导体、新能源、精细化工和水处理领域的终端工厂、设备制造商、EPC、系统集成商、经销商及代理商',
      '消费类企业、与高洁净流体工艺无关的业务，以及无法核验官网、业务身份或公开来源的联系人',
      analysis.recommendedMarkets[0].name,
      JSON.stringify(analysis),
      now,
      now,
      String(profile.id),
      workspaceId,
    ],
  })

  let replacedKnowledge = 0
  for (const item of knowledgeReplacements) {
    const result = await db.execute({
      sql: `update knowledge_items set title = ?, item_type = ?, summary = ?, source = 'DONJOY 英文外贸官网',
            source_url = 'https://www.donjoypumps.com/', tags_json = ?, status = '已启用', updated_at = ?
            where workspace_id = ? and title = ?`,
      args: [item.title, item.type, item.summary, JSON.stringify(item.tags), now, workspaceId, item.oldTitle],
    })
    replacedKnowledge += Number(result.rowsAffected ?? 0)
  }
  const disabledLegacyFiles = await db.execute({
    sql: `update knowledge_items set title = '旧业务资料 · OULAM VALVE Company Profile', status = '已停用', updated_at = ?
          where workspace_id = ? and title = 'OULAM VALVE Company Profile'`,
    args: [now, workspaceId],
  })

  await db.execute({
    sql: `insert into audit_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `aud_${randomUUID().replaceAll('-', '')}`,
      workspaceId,
      ownerUserId,
      'system.company_profile_migrated',
      'workspace',
      workspaceId,
      JSON.stringify({ from: String(profile.company), to: 'DONJOY', website: 'https://www.donjoypumps.com/', replacedKnowledge, disabledLegacyFiles: Number(disabledLegacyFiles.rowsAffected ?? 0) }),
      now,
    ],
  })
  await db.execute('commit')
  console.log(`DONJOY company profile migrated: workspace=${workspaceId}, knowledge=${replacedKnowledge}, disabledLegacyFiles=${disabledLegacyFiles.rowsAffected ?? 0}`)
} catch (error) {
  try { await db.execute('rollback') } catch { /* no active transaction */ }
  throw error
} finally {
  await db.close()
}
