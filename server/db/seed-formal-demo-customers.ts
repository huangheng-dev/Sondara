import { and, eq } from 'drizzle-orm'
import { db, databaseRuntime } from './client.js'
import { customers, inboxContacts, workspaces } from './schema.js'
import { createId } from '../lib/ids.js'

if (process.env.NODE_ENV === 'production') {
  throw new Error('正式演示客户不能写入生产环境。')
}

const workspaceId = process.env.SONDARA_SEED_WORKSPACE_ID?.trim()
if (!workspaceId) {
  throw new Error('请通过 SONDARA_SEED_WORKSPACE_ID 明确指定目标工作区。')
}

const workspace = await db.$first(db.select().from(workspaces).where(eq(workspaces.id, workspaceId)))
if (!workspace) throw new Error(`工作区不存在：${workspaceId}`)

const now = Date.now()
const day = 86_400_000
const samples = [
  { company: '澄川生物工程有限公司（演示）', score: 93, confidence: 88, value: 1_860_000, size: '100–200 人', stage: '有商机', nextAction: '安排工艺方案评审并确认设备清单', due: 2, contacts: [['李明', '项目总监', 'li.ming@chengchuan.example.com'], ['周妍', '采购经理', 'zhou.yan@chengchuan.example.com']] },
  { company: '凌岳洁净系统有限公司（演示）', score: 91, confidence: 85, value: 2_280_000, size: '200–500 人', stage: '重点跟进', nextAction: '提交执行器兼容性表与交付计划', due: 3, contacts: [['陈昊', '工艺工程师', 'chen.hao@lingyue.example.com'], ['孙洁', '供应链经理', 'sun.jie@lingyue.example.com']] },
  { company: '砺芯电子化学系统有限公司（演示）', score: 90, confidence: 84, value: 1_680_000, size: '100–200 人', stage: '有商机', nextAction: '确认物料参数并完成密封方案选型', due: 4, contacts: [['赵谦', '技术负责人', 'zhao.qian@lixin-chem.example.com'], ['顾宁', '采购主管', 'gu.ning@lixin-chem.example.com']] },
  { company: '清禾乳品工程有限公司（演示）', score: 88, confidence: 82, value: 980_000, size: '50–100 人', stage: '重点跟进', nextAction: '发送乳品 CIP 阀阵配置与案例', due: 5, contacts: [['林薇', '项目经理', 'lin.wei@qinghe-dairy.example.com'], ['韩启', '设备工程师', 'han.qi@qinghe-dairy.example.com']] },
  { company: '沃泉纯化水设备有限公司（演示）', score: 87, confidence: 80, value: 1_260_000, size: '50–100 人', stage: '培育中', nextAction: '补充材质证书与清洗验证资料包', due: 6, contacts: [['徐扬', '验证经理', 'xu.yang@woquan-water.example.com'], ['宋珂', '采购专员', 'song.ke@woquan-water.example.com']] },
  { company: '海岚发酵装备有限公司（演示）', score: 86, confidence: 78, value: 720_000, size: '20–50 人', stage: '培育中', nextAction: '提供小流量曲线与中试设备计划', due: 7, contacts: [['叶晨', '研发负责人', 'ye.chen@hailan-fermentation.example.com'], ['蒋雯', '项目采购', 'jiang.wen@hailan-fermentation.example.com']] },
] as const

let enriched = 0
let contactsCreated = 0

for (const sample of samples) {
  const customer = await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, workspaceId), eq(customers.company, sample.company))))
  if (!customer) continue

  await db.update(customers).set({
    score: sample.score,
    confidence: sample.confidence,
    estimatedValue: sample.value,
    size: sample.size,
    stage: sample.stage,
    contacts: sample.contacts.length,
    validContacts: sample.contacts.length,
    interaction: '已完成企业与联系人验证（演示数据）',
    nextAction: sample.nextAction,
    dueAt: now + sample.due * day,
    updatedAt: now,
  }).where(eq(customers.id, customer.id))

  for (const [name, jobTitle, email] of sample.contacts) {
    const existing = await db.$first(db.select().from(inboxContacts).where(and(
      eq(inboxContacts.workspaceId, workspaceId),
      eq(inboxContacts.company, sample.company),
      eq(inboxContacts.name, name),
    )))
    const contact = {
      customerId: customer.id,
      jobTitle,
      region: customer.region,
      source: '正式演示客户初始化',
      primaryChannel: '邮件',
      email,
      verificationStatus: 'verified',
      verifiedAt: now,
      verificationSource: '演示数据初始化',
      updatedAt: now,
    }
    if (existing) {
      await db.update(inboxContacts).set(contact).where(eq(inboxContacts.id, existing.id))
    } else {
      await db.insert(inboxContacts).values({ id: createId('con'), workspaceId, company: sample.company, name, createdAt: now, ...contact })
      contactsCreated += 1
    }
  }
  enriched += 1
}

console.log(`已完善 ${enriched} 家正式演示客户，新增 ${contactsCreated} 位已验证联系人。`)
await databaseRuntime.close()
