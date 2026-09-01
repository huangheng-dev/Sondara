import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'

if (!process.argv.includes('--confirm')) {
  throw new Error('该脚本会清空 DONJOY 主工作区的客户与业务流程数据，并重建正式公司资料。确认后请使用 --confirm 运行。')
}

const databasePath = resolve(process.env.SONDARA_DATABASE_PATH || 'data/sondara.sqlite')
const databaseUrl = process.env.SONDARA_DATABASE_URL || `file:${databasePath.replaceAll('\\', '/')}`
const db = createClient({ url: databaseUrl })
const now = Date.now()
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`
const requestedEmail = process.env.SONDARA_FORMAL_EMAIL?.trim()
const primaryUser = requestedEmail
  ? (await db.execute({ sql: 'select id, email from users where email = ? limit 1', args: [requestedEmail] })).rows[0]
  : (await db.execute({
      sql: `select u.id, u.email from business_profiles b
            join workspaces w on w.id = b.workspace_id
            join users u on u.id = w.owner_user_id
            where lower(b.company) like '%donjoy%' or b.company like '%东正科技%'
            order by b.updated_at desc limit 1`,
      args: [],
    })).rows[0]

if (!primaryUser) throw new Error('未找到 DONJOY 主账户，无法安全识别需要重建的工作区。')

const primaryWorkspace = (await db.execute({
  sql: 'select id from workspaces where owner_user_id = ? order by created_at limit 1',
  args: [primaryUser.id],
})).rows[0]

if (!primaryWorkspace) throw new Error('未找到 DONJOY 主工作区。')

const workspaceId = String(primaryWorkspace.id)
const userId = String(primaryUser.id)
const formalEmail = requestedEmail || String(primaryUser.email)

const clearWorkspaceTables = [
  'approval_requests',
  'external_object_mappings',
  'external_connector_runs',
  'lead_source_events',
  'customer_tags',
  'customer_touchpoints',
  'company_signals',
  'procurement_opportunities',
  'contact_suppressions',
  'message_delivery_events',
  'channel_webhook_events',
  'outbox_jobs',
  'message_thread_reads',
  'message_entries',
  'message_threads',
  'inbox_contacts',
  'campaign_execution_events',
  'campaign_content_links',
  'campaign_audience_members',
  'campaign_steps',
  'campaigns',
  'content_generation_runs',
  'content_quality_checks',
  'content_versions',
  'content_assets',
  'tasks',
  'deals',
  'candidate_evidence',
  'candidate_contacts',
  'radar_job_events',
  'radar_queue_items',
  'radar_candidates',
  'radar_tasks',
  'channel_costs',
  'knowledge_items',
  'business_profiles',
  'audit_logs',
  'customers',
]

const officialKnowledge = [
  {
    title: 'DONJOY 公司与海外业务',
    type: '公司资料',
    summary: 'DONJOY 创立于 1993 年，面向国际市场研发和制造高洁净泵、阀门控制器、卫生级与无菌阀门及相关工艺设备，并设有国际贸易服务入口。',
    tags: ['DONJOY', '公司资料', '海外业务', '制造能力'],
  },
  {
    title: 'DONJOY 高洁净泵产品范围',
    type: '产品知识',
    summary: '英文官网及目录公开展示离心泵、转子泵、双螺杆泵、柔性叶轮泵、混合泵等高洁净流体输送产品，可按介质、流量、压力、温度和清洗要求进行选型。',
    tags: ['卫生级泵', '离心泵', '转子泵', '双螺杆泵'],
  },
  {
    title: 'DONJOY 卫生级与无菌阀门',
    type: '产品知识',
    summary: '产品覆盖蝶阀、球阀、隔膜阀、无菌取样阀、防混阀、调节阀、止回阀、罐底阀和安全控制阀，面向卫生级与高洁净工艺应用。',
    tags: ['卫生级阀门', '无菌阀门', '防混阀', '调节阀'],
  },
  {
    title: 'DONJOY 阀门控制与过程自动化',
    type: '产品知识',
    summary: 'DONJOY 提供阀门控制器、位置反馈、定位器、气动执行器和调节阀，用于生产线阀位管理、流量调节和过程自动化。',
    tags: ['阀门控制器', '执行器', '定位器', '过程自动化'],
  },
  {
    title: 'DONJOY 海外重点行业应用',
    type: '行业应用',
    summary: '官网公开的重点行业包括生物制药、食品饮料、乳品与酿酒、半导体、新能源、精细化工和水处理，客户研究应优先核验洁净生产、工艺改造和设备配套需求。',
    tags: ['生物制药', '食品饮料', '半导体', '新能源', '水处理'],
  },
  {
    title: 'DONJOY 国际标准与认证资料',
    type: '合规知识',
    summary: '英文官网与目录公开说明产品和制造能力覆盖 ASME BPE、EHEDG、FDA、3-A、PED、CE 等标准或认证。对外沟通时应以具体产品的有效证书和最新技术文件为准。',
    tags: ['ASME BPE', 'EHEDG', 'FDA', '3-A', 'PED', 'CE'],
  },
  {
    title: 'DONJOY 海外理想客户与渠道',
    type: '客户判断规则',
    summary: '优先开发具有高洁净生产、工程设计、设备制造、系统集成或区域渠道能力的海外终端工厂、OEM、EPC、系统集成商、经销商和代理商。',
    tags: ['海外客户', 'OEM', 'EPC', '系统集成商', '经销商'],
  },
  {
    title: 'DONJOY 海外客户排除规则',
    type: '客户判断规则',
    summary: '排除消费类企业、与高洁净流体工艺无关的业务、无法核验企业官网或业务身份的记录，以及缺少可追溯公开来源的联系人。',
    tags: ['排除条件', '数据质量', '联系人核验'],
  },
]

const tx = await db.transaction('write')
try {
  for (const table of clearWorkspaceTables) {
    await tx.execute({ sql: `delete from ${table} where workspace_id = ?`, args: [workspaceId] })
  }

  await tx.execute({
    sql: 'update users set email = ?, display_name = ?, locale = ?, timezone = ?, currency = ?, updated_at = ? where id = ?',
    args: [formalEmail, '东正外贸管理员', 'zh-CN', 'Asia/Shanghai', 'USD', now, userId],
  })
  await tx.execute({
    sql: `update outbound_channel_connections set from_name = 'DONJOY', updated_at = ?
          where workspace_id = ? and (lower(from_name) like '%oulam%' or from_name like '%欧拉姆%')`,
    args: [now, workspaceId],
  })
  await tx.execute({
    sql: 'update workspaces set name = ?, updated_at = ? where id = ?',
    args: ['东正科技有限公司（DONJOY）', now, workspaceId],
  })

  await tx.execute({
    sql: `insert into business_profiles
      (id, workspace_id, company, website, products, regions, customers, exclusions, selected_market,
       analysis_status, analysis_summary, analyzed_at, analysis_mode, analysis_error, owner_user_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id('bpr'), workspaceId, '东正科技有限公司（DONJOY）', 'https://www.donjoypumps.com/',
      '面向海外市场的高洁净流体设备与过程控制解决方案，包括卫生级泵、无菌与卫生级阀门、阀门控制器和执行器、调节阀、罐体清洗、安全控制及 ASME BPE 管件。',
      '全球海外市场；每次获客任务按国家或区域单独选择。',
      '海外生物制药、食品饮料、乳品与酿酒、半导体、新能源、精细化工和水处理领域的终端工厂、设备制造商、EPC、系统集成商、经销商及代理商。',
      '消费类企业、与高洁净流体工艺无关的业务，以及无法核验官网、业务身份或公开来源的联系人。',
      '海外生物制药与制药装备客户', 'complete',
      JSON.stringify({
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
        criteria: ['具有高洁净生产、工程设计、设备制造、系统集成或区域渠道能力', '应用场景涉及生物制药、食品饮料、乳品酿酒、半导体、新能源、精细化工或水处理', '存在工厂新建、扩产、招标、设备升级、供应商准入或渠道合作等近期公开信号', '排除消费类企业、业务范围不匹配或无法核验官网与公开来源的联系人'],
      }),
      now, 'official-source', null, userId, now, now,
    ],
  })

  for (const item of officialKnowledge) {
    await tx.execute({
      sql: `insert into knowledge_items
        (id, workspace_id, title, item_type, summary, source, source_url, tags_json, status, reference_count, owner_user_id, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id('knw'), workspaceId, item.title, item.type, item.summary, 'DONJOY 英文外贸官网', 'https://www.donjoypumps.com/', JSON.stringify(item.tags), '已启用', 0, userId, now, now],
    })
  }

  await tx.execute({
    sql: `insert into audit_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id('aud'), workspaceId, userId, 'system.formal_data_initialized', 'workspace', workspaceId,
      JSON.stringify({ source: 'https://www.donjoypumps.com/', activeCustomers: 0, knowledgeItems: officialKnowledge.length }), now],
  })

  await tx.commit()
} catch (error) {
  await tx.rollback()
  throw error
}

const foreignKeyCheck = await db.execute('pragma foreign_key_check')
if (foreignKeyCheck.rows.length) throw new Error(`外键检查失败：${JSON.stringify(foreignKeyCheck.rows)}`)
await db.execute('pragma wal_checkpoint(truncate)')

console.log(JSON.stringify({
  databasePath,
  account: formalEmail,
  workspaceId,
  officialCustomers: 0,
  knowledgeItems: officialKnowledge.length,
  preserved: ['AI 服务及密钥', '搜索数据源配置', '邮件通道配置', '工作区 AI 策略'],
}, null, 2))

db.close()
