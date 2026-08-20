import { eq } from 'drizzle-orm'
import { db } from './client.js'
import {
  businessProfiles, campaignAudienceMembers, campaignContentLinks, campaigns, campaignSteps,
  candidateContacts, candidateEvidence, channelCosts, contentAssets, contentQualityChecks,
  contentVersions, customers, deals, inboxContacts, knowledgeItems, messageEntries, messageThreads,
  radarCandidates, radarJobEvents, radarQueueItems, radarTasks, tasks, users, workspaceMembers, workspaces,
} from './schema.js'
import { createId } from '../lib/ids.js'
import { hashPassword } from '../lib/password.js'

if (process.env.NODE_ENV === 'production') throw new Error('开发测试账户不能在生产环境中生成。')

const email = 'demo@sondara.local'
const password = 'Sondara@2026'
const displayName = 'Sondara 演示账户'
const workspaceName = 'Sondara 虚构业务演示工作区'
const now = Date.now()
const day = 86_400_000
const passwordHash = await hashPassword(password)
const daysFromNow = (offset: number) => now + offset * day

let user = (await db.$first(db.select().from(users).where(eq(users.email, email))))
if (user) {
  await db.update(users).set({ passwordHash, displayName, status: 'active', updatedAt: now }).where(eq(users.id, user.id))
  user = (await db.$first(db.select().from(users).where(eq(users.id, user.id))))
} else {
  const id = createId('usr')
  await db.insert(users).values({ id, email, passwordHash, displayName, status: 'active', createdAt: now, updatedAt: now })
  user = (await db.$first(db.select().from(users).where(eq(users.id, id))))
}
if (!user) throw new Error('开发测试账户生成失败。')

let member = (await db.$first(db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id))))
if (!member) {
  const workspaceId = createId('wsp')
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id: workspaceId, name: workspaceName, ownerUserId: user.id, createdAt: now, updatedAt: now })
    await tx.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: 'owner', createdAt: now })
  })
  member = (await db.$first(db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id))))
}
if (!member) throw new Error('开发测试工作区生成失败。')
const workspaceId = member.workspaceId
await db.update(workspaces).set({ name: workspaceName, updatedAt: now }).where(eq(workspaces.id, workspaceId))

type CustomerSample = {
  company: string
  region: string
  industry: string
  score: number
  confidence: number
  signal: string
  source: string
  value: number
  size: string
  stage: string
  contacts: number
  valid: number
  interaction: string
  nextAction: string
  due: number
  dueLabel: string
  priority: string
  dealStage: string
  probability: number
  closeDays: number
  risk: string
  taskTitle: string
  impact: string
}

// Every organization, person, message and commercial figure below is fictional.
// Keep production/customer data in the ignored data/ directory, never in this seed.
const customerSamples: CustomerSample[] = [
  { company: '示例客户 A（虚构）', region: '上海', industry: '生物制药 EPC / 洁净管路系统', score: 94, confidence: 88, signal: '单抗产线扩建，正在确认 ASME BPE 管件和隔膜阀清单', source: '展会名单 + 官网项目新闻', value: 1_860_000, size: '100-200 人', stage: '方案评估', contacts: 4, valid: 3, interaction: '技术部询问双螺杆泵 CIP/SIP 集成方案', nextAction: '发送 ASME BPE 管件与双螺杆泵资料包', due: 2, dueLabel: '2 天后', priority: '高', dealStage: '方案评估', probability: 65, closeDays: 42, risk: '预算已批复，需确认 SIP 温度、膜片材料和表面粗糙度报告', taskTitle: '为示例客户 A 发送泵阀资料包', impact: '虚构预计影响 186 万' },
  { company: '示例客户 B（虚构）', region: '江苏', industry: '半导体湿化学品输送', score: 91, confidence: 82, signal: '新厂房湿制程系统招标，关注 316L 与阀组控制', source: '招投标公开信息', value: 2_280_000, size: '200-500 人', stage: '需求确认', contacts: 5, valid: 4, interaction: '要求提供阀门控制器和执行器兼容性清单', nextAction: '整理执行器、定位器和自控阀配置表', due: 3, dueLabel: '3 天后', priority: '高', dealStage: '需求确认', probability: 45, closeDays: 56, risk: '竞品正在参与控制器兼容测试，需要尽快提供 IO 清单', taskTitle: '为示例客户 B 整理兼容性配置表', impact: '虚构预计影响 228 万' },
  { company: '示例客户 C（虚构）', region: '广东', industry: '乳品设备制造', score: 89, confidence: 84, signal: '酸奶产线改造，需要离心泵、防混阀和 CIP 清洗组件', source: '行业名录 + 官网产品页', value: 980_000, size: '50-100 人', stage: '方案评估', contacts: 3, valid: 2, interaction: '下载了卫生离心泵和清洗球样本', nextAction: '发送乳品 CIP 阀阵方案', due: 4, dueLabel: '4 天后', priority: '中', dealStage: '方案评估', probability: 60, closeDays: 35, risk: 'CIP 回水温差和阀阵布局还需工艺复核', taskTitle: '为示例客户 C 输出初步方案', impact: '虚构预计影响 98 万' },
  { company: '示例客户 D（虚构）', region: '浙江', industry: '饮料与酿酒设备', score: 86, confidence: 79, signal: '新增 NFC 果汁产线，正在比较卫生泵和阀门品牌', source: '官网新闻', value: 760_000, size: '50-100 人', stage: '线索确认', contacts: 2, valid: 2, interaction: '首封邮件已读，询问 3-A/FDA 文件', nextAction: '发送 3-A/FDA 认证文件和案例', due: 5, dueLabel: '5 天后', priority: '中', dealStage: '线索确认', probability: 25, closeDays: 70, risk: '决策链尚未明确，需要先培养技术联系人', taskTitle: '为示例客户 D 发送认证文件', impact: '虚构预计影响 76 万' },
  { company: '示例客户 E（虚构）', region: '浙江', industry: '新能源电池材料', score: 90, confidence: 85, signal: '正极材料产线扩建，涉及高洁净输送和清洗系统', source: '客户推荐', value: 1_680_000, size: '200-500 人', stage: '商务谈判', contacts: 4, valid: 3, interaction: '已确认技术参数，等待交货期和付款条件', nextAction: '出具形式发票和交期计划', due: 1, dueLabel: '明天', priority: '高', dealStage: '商务谈判', probability: 75, closeDays: 18, risk: '付款节点和交付周期需要销售经理批准', taskTitle: '确认示例客户 E 交期并出具形式发票', impact: '虚构预计影响 168 万' },
  { company: '示例客户 F（虚构）', region: '四川', industry: '精细化工 / 日化原料', score: 82, confidence: 73, signal: '车间自动化改造，关注耐腐蚀泵阀和执行机构', source: '搜索引擎', value: 540_000, size: '100-200 人', stage: '需求确认', contacts: 3, valid: 2, interaction: '工艺工程师询问转子泵输送高粘度物料', nextAction: '发送高粘度转子泵选型表', due: 6, dueLabel: '6 天后', priority: '中', dealStage: '需求确认', probability: 40, closeDays: 63, risk: '高粘度物料颗粒数据不足，密封方案待定', taskTitle: '为示例客户 F 发送选型表', impact: '虚构预计影响 54 万' },
  { company: '示例客户 G（虚构）', region: '山东', industry: '酿酒交钥匙工程', score: 84, confidence: 76, signal: '精酿啤酒项目增加 CIP 模块', source: '展会回访', value: 620_000, size: '20-50 人', stage: '线索确认', contacts: 2, valid: 1, interaction: '等待项目 P&ID 确认口径和连接方式', nextAction: '跟进 P&ID 并准备阀阵清单', due: 7, dueLabel: '7 天后', priority: '中', dealStage: '线索确认', probability: 20, closeDays: 80, risk: 'P&ID 未提供，口径和连接标准无法锁定', taskTitle: '跟进示例客户 G 的 P&ID', impact: '虚构预计影响 62 万' },
  { company: '示例客户 H（虚构）', region: '湖北', industry: '制药装备 / 无菌管路', score: 92, confidence: 86, signal: '新疫苗车间配液系统招标，关注无菌隔膜阀和管件证书', source: '老客户转介绍', value: 2_050_000, size: '100-200 人', stage: '方案评估', contacts: 4, valid: 3, interaction: '要求提供材质证书、Ra 报告和 EHEDG 文件', nextAction: '整理无菌阀门验证文件包', due: 2, dueLabel: '2 天后', priority: '高', dealStage: '方案评估', probability: 62, closeDays: 45, risk: '验证文件完整性将直接影响技术评分', taskTitle: '为示例客户 H 准备验证文件包', impact: '虚构预计影响 205 万' },
  { company: '示例客户 I（虚构）', region: '江苏', industry: '半导体湿法设备集成', score: 88, confidence: 80, signal: '晶圆清洗设备批量交付，需要高洁净离心泵和阀门控制器', source: '招投标公开信息', value: 1_920_000, size: '100-200 人', stage: '商务谈判', contacts: 5, valid: 4, interaction: '已完成样机测试，正在确认 PED/CE 与电气配置', nextAction: '补充 PED/CE 文件并确认交期', due: 3, dueLabel: '3 天后', priority: '高', dealStage: '商务谈判', probability: 70, closeDays: 25, risk: '客户内审要求增加电气防护与执行器配置说明', taskTitle: '为示例客户 I 补充认证文件', impact: '虚构预计影响 192 万' },
  { company: '示例客户 J（虚构）', region: '福建', industry: '水处理 / 纯化水系统', score: 79, confidence: 70, signal: '纯化水与注射水系统二期项目立项', source: '官网招标公告', value: 480_000, size: '50-100 人', stage: '方案评估', contacts: 2, valid: 2, interaction: '询问离心泵材质、死角控制和清洗球覆盖范围', nextAction: '发送纯化水系统泵阀选型建议', due: 8, dueLabel: '8 天后', priority: '中', dealStage: '方案评估', probability: 50, closeDays: 50, risk: '项目预算分两期，首期采购范围可能缩小', taskTitle: '为示例客户 J 发送选型建议', impact: '虚构预计影响 48 万' },
  { company: '示例客户 K（虚构）', region: '天津', industry: '乳品工程 / 巴氏奶产线', score: 81, confidence: 75, signal: '旧线自动化升级，需要防混阀和自控执行器', source: '行业展会', value: 860_000, size: '100-200 人', stage: '需求确认', contacts: 3, valid: 2, interaction: '技术总监关注停机改造窗口和备件交期', nextAction: '确认停机窗口并准备改造清单', due: 9, dueLabel: '9 天后', priority: '中', dealStage: '需求确认', probability: 35, closeDays: 60, risk: '旧线停机窗口未定，方案排期无法确认', taskTitle: '确认示例客户 K 的改造窗口', impact: '虚构预计影响 86 万' },
  { company: '示例客户 L（虚构）', region: '安徽', industry: '洗涤日化 / 精细化工', score: 76, confidence: 68, signal: '洗衣液原料车间扩建，比较普通泵阀与卫生级方案', source: '搜索引擎广告', value: 390_000, size: '50-100 人', stage: '线索确认', contacts: 2, valid: 1, interaction: '采购询问转子泵价格区间和维护成本', nextAction: '发送总拥有成本对比表', due: 10, dueLabel: '10 天后', priority: '低', dealStage: '线索确认', probability: 30, closeDays: 75, risk: '客户仍在比较普通泵阀，需要突出清洗维护收益', taskTitle: '为示例客户 L 发送成本对比表', impact: '虚构预计影响 39 万' },
  { company: '示例客户 M（虚构）', region: '陕西', industry: '新能源电解液输送', score: 87, confidence: 81, signal: '电解液项目进入设备详设，关注耐腐蚀密封和自控接口', source: '设计院推荐', value: 1_350_000, size: '200-500 人', stage: '方案评估', contacts: 4, valid: 3, interaction: '要求确认双螺杆泵密封方案和废液回收接口', nextAction: '组织技术会议确认接口图', due: 4, dueLabel: '4 天后', priority: '高', dealStage: '方案评估', probability: 58, closeDays: 48, risk: '洁净等级与废液回收接口待设计院确认', taskTitle: '组织示例客户 M 的接口会议', impact: '虚构预计影响 135 万' },
  { company: '示例客户 N（虚构）', region: '湖南', industry: '生物发酵 / 饮品配料', score: 78, confidence: 72, signal: '发酵中试线需要小流量高洁净输送方案', source: '内容白皮书下载', value: 720_000, size: '20-50 人', stage: '线索确认', contacts: 2, valid: 1, interaction: '下载了双螺杆泵样本，询问小流量曲线', nextAction: '发送小试流量曲线和样机计划', due: 11, dueLabel: '11 天后', priority: '中', dealStage: '线索确认', probability: 28, closeDays: 68, risk: '客户需要小试数据，短期成交概率有限', taskTitle: '为示例客户 N 发送流量资料', impact: '虚构预计影响 72 万' },
  { company: '示例客户 O（虚构）', region: '山东', industry: '食品加工工程 / 调味品', score: 83, confidence: 77, signal: '调味品 CIP 项目需要离心泵、过滤器和地漏方案', source: '老客户回访', value: 680_000, size: '50-100 人', stage: '需求确认', contacts: 3, valid: 2, interaction: '项目经理询问卫生级认证和过滤器滤芯规格', nextAction: '发送食品 CIP 配置清单', due: 5, dueLabel: '5 天后', priority: '中', dealStage: '需求确认', probability: 42, closeDays: 55, risk: '卫生级认证清单尚不完整，需补充过滤器资料', taskTitle: '为示例客户 O 发送配置清单', impact: '虚构预计影响 68 万' },
  { company: '示例客户 P（虚构）', region: '重庆', industry: '精细化工 / 电子化学品', score: 85, confidence: 78, signal: '电子化学品车间提升洁净等级，需要高洁净泵阀替换', source: '行业名录', value: 920_000, size: '100-200 人', stage: '方案评估', contacts: 3, valid: 2, interaction: '工艺工程师询问 316L 材质、密封材质和清洗验证', nextAction: '确认物料腐蚀性并出具密封方案', due: 6, dueLabel: '6 天后', priority: '高', dealStage: '方案评估', probability: 55, closeDays: 40, risk: '物料腐蚀性未确认，错误密封会影响报价准确性', taskTitle: '确认示例客户 P 的密封方案', impact: '虚构预计影响 92 万' },
]

const customerRows = customerSamples.map((sample, index) => {
  const id = createId('cus')
  const createdAt = now - (22 - index) * day
  return {
    id, workspaceId, company: sample.company, region: sample.region, industry: sample.industry,
    score: sample.score, confidence: sample.confidence, signal: sample.signal, source: sample.source,
    estimatedValue: sample.value, size: sample.size, stage: sample.stage, contacts: sample.contacts,
    validContacts: sample.valid, interaction: sample.interaction, nextAction: sample.nextAction,
    dueAt: daysFromNow(sample.due), ownerUserId: user.id, createdAt, updatedAt: now - (index % 5) * day,
  }
})

const dealRows = customerRows.map((customer, index) => {
  const sample = customerSamples[index]
  const createdAt = customer.createdAt + day
  return {
    id: createId('del'), workspaceId, customerId: customer.id, company: sample.company, stage: sample.dealStage,
    probability: sample.probability, valueAmount: sample.value, currency: 'CNY', ownerLabel: displayName,
    nextAction: sample.nextAction, expectedCloseAt: daysFromNow(sample.closeDays), risk: sample.risk,
    source: sample.source, stageEnteredAt: now - (3 + index % 9) * day, ownerUserId: user.id,
    createdAt, updatedAt: now - (index % 4) * day,
  }
})

const taskRows = customerRows.map((customer, index) => {
  const sample = customerSamples[index]
  return {
    id: createId('tsk'), workspaceId, customerId: customer.id, title: sample.taskTitle, priority: sample.priority,
    dueAt: daysFromNow(sample.due), dueLabel: sample.dueLabel, company: sample.company, nextAction: sample.nextAction,
    impact: sample.impact, source: sample.source, status: index === 4 ? 'completed' : 'open', ownerUserId: user.id,
    createdAt: customer.createdAt + 2 * day, updatedAt: index === 4 ? now - day : now - (index % 3) * day,
  }
})
type ContentSample = {
  title: string
  contentType: string
  channel: string
  status: string
  language: string
  targetMarket: string
  customerRole: string
  buyingStage: string
  customerSignal: string
  sourceMethod: string
  summary: string
  body: string
  quality: [number, number, number, number]
}

const contentSamples: ContentSample[] = [
  {
    title: '双螺杆泵在生物制药 CIP/SIP 中的选型要点',
    contentType: '技术跟进邮件', channel: '邮件', status: '已发布', language: '中文',
    targetMarket: '中国生物制药 EPC', customerRole: '工艺/验证负责人', buyingStage: '方案比较',
    customerSignal: '单抗/疫苗产线扩建', sourceMethod: '官网公开参数',
    summary: '虚构示例：围绕流量、材料、表面处理和认证文件清单，说明工业泵如何进入 CIP/SIP 方案评估。',
    body: '您好，\n\n针对生物制药配液、CIP/SIP 和无菌输送场景，我们整理了一份虚构产品的选型要点。所有参数均为演示占位，不代表任何真实公司或产品。\n\n如果贵司正在做技术评分，可以继续按 P&ID 口径补充曲线、材质证书和阀组联动建议。期待您反馈当前介质、温度和清洗工况。',
    quality: [92, 94, 90, 88],
  },
  {
    title: 'ASME BPE 隔膜阀与防混双座阀资料清单',
    contentType: '销售跟进资料', channel: '销售资料', status: '待审核', language: '中文',
    targetMarket: '制药无菌管路', customerRole: '采购/验证经理', buyingStage: '风险评估',
    customerSignal: '需要材质和表面粗糙度证明', sourceMethod: '产品资料',
    summary: '面向无菌阀门项目，列出隔膜阀、防混双座阀、执行器、定位器、材质证书、Ra 报告和追溯文件的提交清单。',
    body: '虚构产品资料包包含：1）型号与口径；2）材质证书与追溯；3）密封材料证明；4）表面粗糙度报告；5）控制接口说明；6）CIP/SIP 安装注意事项；7）认证文件索引。建议在技术评标前一次性提交，减少反复补件。',
    quality: [89, 88, 84, 86],
  },
  {
    title: '半导体湿制程高洁净泵阀控制方案',
    contentType: '行业方案', channel: '销售资料', status: '已发布', language: '中文',
    targetMarket: '半导体湿制程', customerRole: '设备电气负责人', buyingStage: '需求确认',
    customerSignal: '新厂房湿制程招标', sourceMethod: '招投标信号',
    summary: '说明 316L 泵阀、气动执行器、阀门控制器和自控调节阀如何匹配湿化学品输送、晶圆清洗和废液回收系统。',
    body: '半导体湿制程系统更关注材料一致性、控制接口和稳定交付。本段使用虚构方案说明如何组合泵阀、执行器和控制器。建议在招标阶段明确介质特性、管路口径、信号类型、PLC 接口、电气防护、表面处理和验收标准。',
    quality: [90, 91, 86, 87],
  },
  {
    title: '乳品饮料 CIP 清洗球与离心泵节能改造案例',
    contentType: '客户案例', channel: '内容资产', status: '可复用', language: '中文',
    targetMarket: '乳品饮料设备', customerRole: '工程经理', buyingStage: '方案比较',
    customerSignal: '旧线改造或新增 CIP 模块', sourceMethod: '复用案例',
    summary: '通过标准化 CIP 阀阵、清洗球覆盖和离心泵选型，帮助乳品饮料客户减少清洗等待时间与能耗。',
    body: '某乳品饮料客户在旧线改造中，将原有分散式清洗改为标准化 CIP 阀阵，并用高洁净离心泵与清洗球组合优化覆盖路径。项目重点包括：按管路容积校核泵流量和压力；用防混双座阀降低交叉污染风险；用清洗球覆盖测试确认喷淋盲区；统一备件口径以降低维护成本。最终方案帮助客户缩短清洗等待时间，并提高了复产可预测性。具体节能量需按现场管路和 CIP 程序复核。',
    quality: [87, 85, 82, 84],
  },
  {
    title: '虚构工业产品认证包首次触达邮件',
    contentType: '首次触达邮件', channel: '邮件', status: '草稿', language: '中文',
    targetMarket: '食品/制药/半导体设备商', customerRole: '技术采购', buyingStage: '问题认知',
    customerSignal: '新建产线或设备升级', sourceMethod: '客户信号',
    summary: '面向新接触客户的虚构短邮件，演示如何介绍工业产品线和认证基础。',
    body: '您好，\n\n我们是一家仅用于本项目演示的虚构工业设备供应商，提供泵阀、执行器、管件和清洗方案。\n\n如果贵司正在评估洁净管路或 CIP/SIP 方案，我可以先按应用场景发送虚构的认证文件索引和选型清单。方便告知目前处于新建产线、旧线改造还是设备投标阶段吗？',
    quality: [84, 86, 78, 82],
  },
]

const contentRows = contentSamples.map((sample) => {
  const id = createId('cnt')
  const versionId = createId('cvn')
  const createdAt = now - (contentSamples.length - contentSamples.indexOf(sample)) * day
  return {
    asset: {
      id, workspaceId, title: sample.title, contentType: sample.contentType, channel: sample.channel,
      status: sample.status, language: sample.language, body: sample.body, summary: sample.summary,
      targetMarket: sample.targetMarket, customerRole: sample.customerRole, buyingStage: sample.buyingStage,
      customerSignal: sample.customerSignal, sourceMethod: sample.sourceMethod, currentVersion: 1,
      qualityScore: sample.quality[0], customerRelevance: sample.quality[1], evidenceScore: sample.quality[2],
      actionClarity: sample.quality[3], linkedCampaignIdsJson: '[]', ownerUserId: user.id,
      publishedAt: sample.status === '已发布' || sample.status === '可复用' ? now - 2 * day : null,
      archivedAt: null, createdAt, updatedAt: createdAt + day,
    },
    version: {
      id: versionId, workspaceId, contentAssetId: id, versionNumber: 1, title: sample.title, body: sample.body,
      changeNote: '初始化虚构演示内容', createdByUserId: user.id, createdAt,
    },
    quality: {
      id: createId('cqc'), workspaceId, contentAssetId: id, contentVersionId: versionId,
      overallScore: sample.quality[0], customerRelevance: sample.quality[1], evidenceScore: sample.quality[2],
      actionClarity: sample.quality[3], status: 'completed',
      findingsJson: JSON.stringify(['演示数据：已完成相关性、证据、行动清晰度检查。']), createdAt,
    },
  }
})
const campaignDefinitions = [
  {
    name: '生物制药 ASME BPE 夏季唤醒', market: '中国生物制药 EPC 与制药终端', audienceLabel: '生物制药高匹配客户',
    status: '运行中', channel: '邮件', stopRule: '收到技术回复', progress: 68, sentCount: 42, replyCount: 8,
    opportunityCount: 3, revenueAmount: 560_000, nextAction: '第二轮发送阀门验证文件清单',
    startOffset: -14, nextRunOffset: 2, completedOffset: null as number | null, audienceIndexes: [0, 7, 9, 12, 3],
    steps: [
      { position: 1, name: '首次触达：双螺杆泵选型要点', channel: '邮件', contentIndex: 0, status: 'executed', offset: -14 },
      { position: 2, name: '第二轮：无菌阀门资料清单', channel: '邮件', contentIndex: 1, status: 'scheduled', offset: 2 },
    ],
  },
  {
    name: '华东半导体湿制程关键客户培育', market: '华东半导体湿制程设备商', audienceLabel: '半导体湿制程客户',
    status: '运行中', channel: '邮件 + 销售跟进', stopRule: '创建商机', progress: 52, sentCount: 28,
    replyCount: 6, opportunityCount: 2, revenueAmount: 420_000, nextAction: '邀约控制器兼容性技术会',
    startOffset: -10, nextRunOffset: 3, completedOffset: null as number | null, audienceIndexes: [1, 8, 12, 15],
    steps: [
      { position: 1, name: '发送湿制程控制方案', channel: '邮件', contentIndex: 2, status: 'executed', offset: -10 },
      { position: 2, name: '邀约技术会确认 IO 清单', channel: '销售跟进', contentIndex: 2, status: 'scheduled', offset: 3 },
    ],
  },
  {
    name: '乳品饮料 CIP 改造邀约', market: '华南与华东乳品饮料设备商', audienceLabel: '乳品饮料 CIP 改造客户',
    status: '草稿', channel: '邮件', stopRule: '手动停止', progress: 10, sentCount: 0, replyCount: 0,
    opportunityCount: 0, revenueAmount: 0, nextAction: '确认名单并预约改造沟通',
    startOffset: 0, nextRunOffset: 5, completedOffset: null as number | null, audienceIndexes: [2, 3, 10, 13],
    steps: [
      { position: 1, name: '发送 CIP 改造案例', channel: '邮件', contentIndex: 3, status: 'draft', offset: 5 },
      { position: 2, name: '补发认证包首次触达邮件', channel: '邮件', contentIndex: 4, status: 'draft', offset: 12 },
    ],
  },
]

const campaignRows = campaignDefinitions.map((definition, index) => {
  const id = createId('cmp')
  const startAt = daysFromNow(definition.startOffset)
  const nextRunAt = daysFromNow(definition.nextRunOffset)
  const completedAt = definition.completedOffset === null ? null : daysFromNow(definition.completedOffset)
  const steps = definition.steps.map((step) => ({
    id: createId('cst'), workspaceId, campaignId: id, position: step.position, name: step.name, channel: step.channel,
    contentAssetId: contentRows[step.contentIndex].asset.id, status: step.status, scheduledAt: daysFromNow(step.offset),
    executedAt: step.status === 'executed' ? daysFromNow(step.offset + 1) : null,
    recipientCount: definition.status === '草稿' ? 0 : definition.audienceIndexes.length,
    replyCount: step.status === 'executed' ? Math.ceil(definition.replyCount / definition.steps.length) : 0,
    configJson: JSON.stringify({ stopRule: definition.stopRule }), createdAt: startAt, updatedAt: now,
  }))
  const audience = definition.audienceIndexes.map((customerIndex, audienceIndex) => ({
    id: createId('cam'), workspaceId, campaignId: id, customerId: customerRows[customerIndex].id,
    company: customerSamples[customerIndex].company,
    status: audienceIndex < definition.replyCount ? 'replied' : definition.status === '草稿' ? 'pending' : 'sent',
    stopReason: audienceIndex < definition.replyCount ? '客户已回复' : null,
    lastEventAt: audienceIndex < definition.replyCount ? now - audienceIndex * 3_600_000 : definition.status === '草稿' ? null : startAt + audienceIndex * 3_600_000,
    createdAt: startAt, updatedAt: now,
  }))
  const contentLinks = [...new Set(definition.steps.map((step) => step.contentIndex))].map((contentIndex, position) => ({
    id: createId('ccl'), workspaceId, campaignId: id, contentAssetId: contentRows[contentIndex].asset.id,
    position: position + 1,
    purpose: definition.steps.find((step) => step.contentIndex === contentIndex)?.name ?? '触达内容',
    createdAt: startAt,
  }))
  return {
    campaign: {
      id, workspaceId, name: definition.name, market: definition.market, audienceLabel: definition.audienceLabel,
      status: definition.status, channel: definition.channel, stopRule: definition.stopRule, timezone: 'Asia/Shanghai',
      progress: definition.progress, sentCount: definition.sentCount, replyCount: definition.replyCount,
      opportunityCount: definition.opportunityCount, revenueAmount: definition.revenueAmount, currency: 'CNY',
      nextAction: definition.nextAction, startAt, nextRunAt, ownerUserId: user.id, completedAt,
      createdAt: now - (campaignDefinitions.length - index) * day, updatedAt: now,
    },
    steps, audience, contentLinks,
  }
})

for (const row of contentRows) {
  const linkedCampaignIds = campaignRows
    .filter((campaignRow) => campaignRow.contentLinks.some((link) => link.contentAssetId === row.asset.id))
    .map((campaignRow) => campaignRow.campaign.id)
  row.asset.linkedCampaignIdsJson = JSON.stringify(linkedCampaignIds)
}
type MessageSample = {
  name: string
  company: string
  customerIndex: number
  jobTitle: string
  region: string
  channel: string
  intent: string
  subject: string
  outbound: string
  inbound: string
  offset: number
  unread: number
  campaignIndex?: number
}

const messageSamples: MessageSample[] = [
  { name: '示例联系人 A', company: '示例客户 A（虚构）', customerIndex: 0, jobTitle: '工艺工程部经理', region: '上海', channel: '邮件', intent: '高意向', subject: '示例客户 A：CIP/SIP 参数确认', outbound: '您好，这是一封虚构演示邮件。我们先发送材料和表面处理说明，并可按 P&ID 复核流量与阀组联动。', inbound: '虚构回复：资料收到，请补充高温工况下的密封材料建议和阀门控制接口。', offset: 35 * 60_000, unread: 1, campaignIndex: 0 },
  { name: '示例联系人 B', company: '示例客户 B（虚构）', customerIndex: 1, jobTitle: '设备采购主管', region: '江苏', channel: '邮件', intent: '待判断', subject: '示例客户 B：控制器兼容性清单', outbound: '您好，这是一封虚构演示邮件。附件为执行器和控制器配置说明，请告知 PLC 信号类型和电气防护要求。', inbound: '虚构回复：请把 IO 信号、反馈触点和气源要求整理成表格。', offset: 3 * 3_600_000, unread: 0, campaignIndex: 1 },
  { name: '示例联系人 C', company: '示例客户 E（虚构）', customerIndex: 4, jobTitle: '项目采购经理', region: '浙江', channel: '邮件', intent: '高意向', subject: '示例客户 E：形式发票和交期计划', outbound: '您好，这是一封虚构演示邮件。技术参数已确认，正在协调交期和付款节点。', inbound: '虚构回复：请先提供形式发票，交期按演示计划安排。', offset: 26 * 60_000, unread: 1 },
  { name: '示例联系人 D', company: '示例客户 H（虚构）', customerIndex: 7, jobTitle: '验证负责人', region: '湖北', channel: '网站表单', intent: '高意向', subject: '示例客户 H：验证文件', outbound: '您好，这是一封虚构演示邮件。我们可以按验证目录整理材质和认证文件索引。', inbound: '虚构回复：请先发送完整文件目录和预计提交时间。', offset: 5 * 3_600_000, unread: 1, campaignIndex: 0 },
  { name: '示例联系人 E', company: '示例客户 I（虚构）', customerIndex: 8, jobTitle: '电气负责人', region: '江苏', channel: 'LinkedIn', intent: '待跟进', subject: '示例客户 I：认证与电气配置', outbound: '您好，这是一封虚构演示消息。认证文件和执行器配置会整理后发送。', inbound: '虚构回复：文件请标注适用型号，便于逐项核对。', offset: 28 * 3_600_000, unread: 0, campaignIndex: 1 },
  { name: '示例联系人 F', company: '示例客户 C（虚构）', customerIndex: 2, jobTitle: '项目经理助理', region: '广东', channel: '邮件', intent: '低优先级', subject: '自动回复：资料已收到', outbound: '您好，这是一封虚构演示邮件。附件为 CIP 方案资料。', inbound: '虚构自动回复：邮件已收到，稍后转交技术部评估。', offset: 2 * 86_400_000, unread: 0, campaignIndex: 2 },
]

const messageRows = messageSamples.map((sample, index) => {
  const contactId = createId('ict')
  const threadId = createId('mth')
  const inboundAt = now - sample.offset
  const outboundAt = inboundAt - 18 * 3_600_000
  const campaign = sample.campaignIndex === undefined ? null : campaignRows[sample.campaignIndex]
  return {
    contact: {
      id: contactId, workspaceId, customerId: customerRows[sample.customerIndex].id, name: sample.name,
      company: sample.company, jobTitle: sample.jobTitle, region: sample.region,
      source: campaign ? `营销活动 · ${campaign.campaign.name}` : '客户消息 · 公开联系人',
      primaryChannel: sample.channel,
      email: `${['wang', 'chen', 'lin', 'zhao', 'liu', 'huang'][index]}@example.com`,
      phone: null, externalRef: null, createdAt: outboundAt, updatedAt: inboundAt,
    },
    thread: {
      id: threadId, workspaceId, contactId, customerId: customerRows[sample.customerIndex].id,
      campaignId: campaign?.campaign.id ?? null, subject: sample.subject, channel: sample.channel,
      intent: sample.intent, status: 'open', assigneeUserId: user.id, lastMessagePreview: sample.inbound,
      lastMessageAt: inboundAt, lastInboundAt: inboundAt, unreadCount: sample.unread,
      createdAt: outboundAt, updatedAt: inboundAt,
    },
    outboundEntry: {
      id: createId('msg'), workspaceId, threadId, direction: 'outbound', messageType: 'text', body: sample.outbound,
      status: 'delivered', channel: sample.channel, senderLabel: displayName, externalId: null,
      confirmedByUserId: null, confirmedAt: null, sentAt: outboundAt, deliveredAt: outboundAt + 60_000,
      metadataJson: JSON.stringify({ seed: true }), createdAt: outboundAt, updatedAt: outboundAt,
    },
    inboundEntry: {
      id: createId('msg'), workspaceId, threadId, direction: 'inbound', messageType: 'text', body: sample.inbound,
      status: 'received', channel: sample.channel, senderLabel: sample.name, externalId: null,
      confirmedByUserId: null, confirmedAt: null, sentAt: inboundAt, deliveredAt: inboundAt,
      metadataJson: JSON.stringify({ seed: true }), createdAt: inboundAt, updatedAt: inboundAt,
    },
  }
})
const radarTaskDefinitions = [
  {
    name: '长三角生物制药 EPC 高洁净线索雷达',
    icp: '寻找长三角生物制药 EPC、制药终端和无菌管路系统集成商；要求出现新建产线、GMP 验证、配液系统、CIP/SIP、ASME BPE 管件采购信号；优先 100 人以上且有工程/验证团队的企业。',
    targetRegion: '长三角（上海、江苏、浙江、安徽）', researchLanguage: '中文', depth: '标准研究', candidateLimit: 50,
    seedUrls: ['https://novaflow.example.com/'],
  },
  {
    name: '华东华南半导体湿制程与新能源材料雷达',
    icp: '寻找半导体湿制程设备、晶圆清洗、锂电/电解液/电子化学品材料企业；关注 316L 高洁净输送、阀门控制器、气动执行器、耐腐蚀密封和废液回收接口需求。',
    targetRegion: '华东、华南、华中', researchLanguage: '中文', depth: '深度研究', candidateLimit: 40,
    seedUrls: ['https://novaflow.example.com/'],
  },
]

const radarTaskRows = radarTaskDefinitions.map((definition, index) => {
  const id = createId('rdt')
  const startedAt = now - (index + 2) * day
  const completedAt = now - (index + 1) * day
  return {
    id, workspaceId, name: definition.name, icp: definition.icp, mode: '智能多渠道', depth: definition.depth,
    candidateLimit: definition.candidateLimit, knowledgeScope: 'NovaFlow 虚构产品与行业资料', targetRegion: definition.targetRegion,
    researchLanguage: definition.researchLanguage, inputSource: 'NovaFlow 示例站点 + 虚构行业信号', status: 'completed',
    progress: 100, currentStage: '研究完成', candidatesFound: index === 0 ? 4 : 3, highMatchCount: index === 0 ? 3 : 2,
    lastError: null, ownerUserId: user.id, startedAt, completedAt, seedUrlsJson: JSON.stringify(definition.seedUrls),
    createdAt: startedAt, updatedAt: completedAt,
  }
})

type RadarCandidateSample = {
  taskIndex: number
  company: string
  region: string
  industry: string
  size: string
  score: number
  confidence: number
  signal: string
  source: string
  value: number
  status: string
  reason: string
  contactName: string
  contactRole: string
  email: string
  phone: string
  evidence: string[]
  dimensions: Array<{ label: string; score: number; note: string }>
}

const radarCandidateSamples: RadarCandidateSample[] = [
  { taskIndex: 0, company: '无锡颐和生物工程有限公司', region: '江苏', industry: '生物制药配液系统', size: '100-200 人', score: 89, confidence: 84, signal: '官网发布 GMP 配液系统项目交付案例，正在招聘验证工程师', source: '官网 + 招聘平台（演示）', value: 1_280_000, status: 'review', reason: '具备制药工程团队和近期交付信号，适合 ASME BPE 管件与隔膜阀切入。', contactName: '公开资料联系人', contactRole: '工程部', email: 'contact@yihe-bio.example.com', phone: '0510-00000001', evidence: ['官网案例提到 GMP 配液系统', '招聘验证工程师', '产品页包含洁净管路'], dimensions: [{ label: '行业匹配', score: 92, note: '生物制药配液系统' }, { label: '采购信号', score: 85, note: '项目案例与验证招聘' }, { label: '可触达性', score: 78, note: '官网公开邮箱' }] },
  { taskIndex: 0, company: '泰州康源制药系统有限公司', region: '江苏', industry: '无菌制药装备', size: '50-100 人', score: 86, confidence: 80, signal: '新建验证实验室并采购无菌阀门备件', source: '公开招投标（演示）', value: 960_000, status: 'candidate', reason: '业务与无菌阀门强相关，但需确认项目预算和决策人。', contactName: '公开资料联系人', contactRole: '采购部', email: 'info@kangyuan-pharma.example.com', phone: '0523-00000002', evidence: ['招投标提及无菌阀门', '官网列出制药系统服务', '公司规模中等'], dimensions: [{ label: '行业匹配', score: 90, note: '无菌制药装备' }, { label: '采购信号', score: 82, note: '招投标片段' }, { label: '预算能力', score: 72, note: '需进一步确认' }] },
  { taskIndex: 0, company: '上海翊安生物技术有限公司', region: '上海', industry: '抗体药工艺开发', size: '200-500 人', score: 84, confidence: 76, signal: '中试放大与 CIP/SIP 平台建设', source: '官网新闻（演示）', value: 1_450_000, status: 'candidate', reason: '终端制药客户，采购周期较长但产品匹配度高。', contactName: '公开资料联系人', contactRole: '工艺开发', email: 'bd@yian-bio.example.com', phone: '021-00000003', evidence: ['中试平台扩建新闻', '岗位包含 CIP/SIP', '公司有融资新闻'], dimensions: [{ label: '行业匹配', score: 88, note: '抗体药工艺开发' }, { label: '采购信号', score: 76, note: '平台扩建' }, { label: '企业规模', score: 85, note: '200-500 人' }] },
  { taskIndex: 0, company: '合肥璞华制药装备有限公司', region: '安徽', industry: '制药 EPC / 流体系统', size: '50-100 人', score: 80, confidence: 72, signal: '承接华东注射水和配液系统项目', source: '行业名录（演示）', value: 780_000, status: 'candidate', reason: '区域 EPC 客户，适合作为渠道型客户持续培育。', contactName: '公开资料联系人', contactRole: '销售部', email: 'sales@puhua-epc.example.com', phone: '0551-00000004', evidence: ['行业名录列出流体系统', '官网服务包含注射水', '近期更新项目案例'], dimensions: [{ label: '行业匹配', score: 84, note: '制药 EPC' }, { label: '渠道价值', score: 82, note: '可重复采购' }, { label: '信号强度', score: 68, note: '缺少直接招标信号' }] },
  { taskIndex: 1, company: '常州芯澄半导体设备有限公司', region: '江苏', industry: '晶圆清洗设备', size: '100-200 人', score: 91, confidence: 83, signal: '湿法清洗设备扩产，需要阀门控制器和 316L 管件', source: '招标平台（演示）', value: 1_720_000, status: 'review', reason: '高匹配半导体设备商，采购窗口明确。', contactName: '公开资料联系人', contactRole: '供应链', email: 'purchase@xincheng-semi.example.com', phone: '0519-00000005', evidence: ['招标提到湿法清洗设备', '岗位招聘电气工程师', '官网产品含湿制程模块'], dimensions: [{ label: '行业匹配', score: 94, note: '晶圆清洗设备' }, { label: '采购信号', score: 90, note: '扩产与招标' }, { label: '技术匹配', score: 86, note: '控制器与 316L' }] },
  { taskIndex: 1, company: '嘉兴润钠新能源材料有限公司', region: '浙江', industry: '钠盐电池材料', size: '200-500 人', score: 87, confidence: 79, signal: '新厂房物料输送系统招标，关注耐腐蚀密封', source: '公开招标（演示）', value: 1_180_000, status: 'candidate', reason: '新能源材料客户，需确认洁净等级和介质腐蚀性。', contactName: '公开资料联系人', contactRole: '设备部', email: 'equipment@runna-energy.example.com', phone: '0573-00000006', evidence: ['招标提到物料输送', '新厂房建设公示', '岗位招聘设备工程师'], dimensions: [{ label: '行业匹配', score: 86, note: '新能源材料' }, { label: '采购信号', score: 84, note: '新厂房招标' }, { label: '技术风险', score: 70, note: '腐蚀参数待确认' }] },
  { taskIndex: 1, company: '佛山乳泰智能装备有限公司', region: '广东', industry: '乳品饮料装备', size: '50-100 人', score: 78, confidence: 70, signal: '新增 CIP 模块和阀阵集成需求', source: '展会回访（演示）', value: 640_000, status: 'candidate', reason: '食品装备方向与高洁净泵阀匹配，但项目金额较小。', contactName: '公开资料联系人', contactRole: '项目部', email: 'project@rutai-equip.example.com', phone: '0757-00000007', evidence: ['展会回访记录', '官网列出 CIP 模块', '招聘流体工程师'], dimensions: [{ label: '行业匹配', score: 82, note: '乳品饮料装备' }, { label: '采购信号', score: 74, note: 'CIP 模块需求' }, { label: '预算能力', score: 66, note: '项目金额中等' }] },
]

const radarCandidateRows = radarCandidateSamples.map((sample) => {
  const id = createId('rdc')
  const task = radarTaskRows[sample.taskIndex]
  const discoveredAt = task.completedAt ?? now
  const contactId = createId('cnc')
  const evidenceIds = sample.evidence.map(() => createId('cev'))
  return {
    candidate: {
      id, workspaceId, radarTaskId: task.id, company: sample.company, region: sample.region, industry: sample.industry,
      size: sample.size, score: sample.score, signal: sample.signal, source: sample.source, estimatedValue: sample.value,
      currency: 'CNY', confidence: sample.confidence, status: sample.status, reason: sample.reason,
      dimensionsJson: JSON.stringify(sample.dimensions),
      committeeJson: JSON.stringify([
        { role: sample.contactRole, name: sample.contactName, priority: '高', status: '公开资料待验证' },
        { role: '技术负责人', name: '待补全', priority: '高', status: '需要人工确认' },
      ]),
      relationshipsJson: JSON.stringify([
        { type: '同区域项目', note: `与 NovaFlow 虚构目标行业“${sample.industry}”匹配` },
        { type: '跟进建议', note: '先发送产品认证和公开参数，再确认项目时间表' },
      ]),
      discoveredAt, updatedAt: discoveredAt,
    },
    contact: {
      id: contactId, workspaceId, candidateId: id, name: sample.contactName, role: sample.contactRole,
      email: sample.email, phone: sample.phone, socialUrl: null, sourceUrl: 'https://novaflow.example.com/',
      verificationStatus: 'public', confidence: 60, createdAt: discoveredAt, updatedAt: discoveredAt,
    },
    evidence: sample.evidence.map((title, evidenceIndex) => ({
      id: evidenceIds[evidenceIndex], workspaceId, candidateId: id, title, source: sample.source,
      observedLabel: evidenceIndex === 0 ? '强匹配信号' : '辅助判断信号',
      strength: evidenceIndex === 0 ? '强' : '中', sourceUrl: 'https://novaflow.example.com/',
      createdAt: discoveredAt,
    })),
  }
})
const businessProfile = {
  id: createId('bpr'),
  workspaceId,
  company: 'NovaFlow Industrial（虚构示例公司）',
  website: 'https://novaflow.example.com/',
  products: '虚构工业泵、阀门、执行器、控制器、清洗组件和管件产品线',
  regions: '虚构市场：华东、华南及海外经销区域',
  customers: '虚构客户画像：制药工程、半导体设备、新能源材料和食品装备企业',
  exclusions: '与虚构产品定位无关的普通工业和消费类业务',
  selectedMarket: '中国生物制药与半导体高洁净设备',
  analysisStatus: 'complete',
  analysisSummary: JSON.stringify({
    summary: 'NovaFlow 是仅用于开源演示的虚构工业品牌。本摘要和所有市场判断均为样例数据。',
    publicFacts: [
      '虚构事实：拥有工业流体产品线',
      '虚构事实：服务多个演示行业',
      '虚构事实：支持项目制交付',
    ],
    priorityMarkets: [
      { name: '生物制药 EPC', reason: 'ASME BPE、无菌阀门、CIP/SIP 和验证文件需求明确。' },
      { name: '半导体湿制程', reason: '316L 高洁净泵阀、阀组控制和执行器接口匹配度高。' },
      { name: '新能源/电子化学品', reason: '高洁净输送、耐腐蚀密封和清洗系统存在项目制机会。' },
    ],
    criteria: ['有工程团队或设备集成能力', '出现新建产线、招标、招聘或旧线改造信号', '需要 316L、Ra/EP、3-A/FDA/EHEDG/PED 等文件或控制接口'],
  }),
  analyzedAt: now,
  analysisMode: 'local-rules',
  analysisError: null,
  ownerUserId: user.id,
  createdAt: now,
  updatedAt: now,
}

const knowledgeSamples = [
  { title: 'NovaFlow 虚构公司资料卡', itemType: '公司资料', summary: 'NovaFlow Industrial 是仅用于 Sondara 开源演示的虚构公司，不对应任何真实组织。', source: '虚构示例站点', sourceUrl: 'https://novaflow.example.com/', tags: ['虚构数据', '公司资料', '工业设备'], status: '已启用', referenceCount: 12 },
  { title: '虚构工业泵技术参数模板', itemType: '产品知识', summary: '示例参数仅用于演示知识检索、内容生成和客户匹配，不代表任何真实产品。', source: '虚构示例站点', sourceUrl: 'https://novaflow.example.com/', tags: ['虚构数据', '产品参数', '演示'], status: '已启用', referenceCount: 9 },
  { title: '工业设备目标行业图谱（虚构）', itemType: '市场知识', summary: '本图谱使用虚构行业需求演示验证文件、材料一致性、耐腐蚀密封、CIP/SIP 和稳定交付等判断维度。', source: '虚构行业整理', sourceUrl: 'https://novaflow.example.com/', tags: ['虚构数据', '行业图谱', '演示'], status: '已启用', referenceCount: 21 },
  { title: 'ASME BPE / EHEDG / FDA / 3-A 认证要点', itemType: '合规知识', summary: '制药和食品客户常要求材质追溯、表面粗糙度、电抛光、密封材料食品级/制药级证明、CIP/SIP 适应性和第三方认证文件。提交资料时应按客户验证目录组织。', source: '行业公开标准说明', sourceUrl: null, tags: ['ASME BPE', 'EHEDG', 'FDA', '3-A', '验证文件'], status: '已启用', referenceCount: 176 },
  { title: '阀门控制器与气动执行器卖点', itemType: '产品知识', summary: '阀组控制方案要明确气源压力、阀位反馈、PLC 信号、NAMUR、电气防护、手动旁路、执行器扭矩和定位器兼容性。半导体与新能源客户尤其关注 IO 清单。', source: '内部销售资料（演示）', sourceUrl: null, tags: ['阀门控制器', '气动执行器', '自控调节阀', 'PLC'], status: '待复核', referenceCount: 58 },
  { title: 'CIP/SIP 清洗技术关注点', itemType: '应用知识', summary: 'CIP 关注流量、压力、清洗球覆盖、死角、回流温度和清洗剂兼容性；SIP 关注纯蒸汽冷凝排放、温度分布、膜片密封和坡度设计。', source: '行业应用整理', sourceUrl: null, tags: ['CIP', 'SIP', '清洗球', '无菌阀门'], status: '已启用', referenceCount: 143 },
  { title: '半导体湿制程客户需求模板', itemType: '客户判断规则', summary: '湿制程客户应确认介质、温度、压力、颗粒物、316L 要求、表面处理、阀组联动、PLC 接口、电气防护、废液回收和验收标准。缺少这些信息时不宜直接报价。', source: '销售方法论（演示）', sourceUrl: null, tags: ['半导体', '湿制程', '需求模板'], status: '已启用', referenceCount: 74 },
  { title: 'NovaFlow 虚构业务边界', itemType: '客户判断规则', summary: '虚构示例：排除与演示产品定位无关的市场，避免把高洁净产品优势错配到普通工业场景。', source: '虚构定位整理', sourceUrl: null, tags: ['虚构数据', '排除条件', '去噪'], status: '已启用', referenceCount: 6 },
]
const monthStart = (year: number, month: number) => Date.UTC(year, month, 1)
const channelCostRows = [
  { channel: '搜索引擎广告', june: 12800, july: 15600, note: '百度/360 高洁净泵阀关键词投放' },
  { channel: '行业展会', june: 26000, july: 18000, note: '制药装备展、半导体展和食品装备展' },
  { channel: '邮件营销', june: 3600, july: 4200, note: '企业邮箱发送平台和域名预热' },
  { channel: '内容白皮书', june: 6500, july: 7800, note: '双螺杆泵、CIP/SIP、湿制程方案内容制作' },
  { channel: '线上研讨会', june: 5200, july: 0, note: '7 月暂停大型线上课，转为资料包触达' },
  { channel: '百度爱采购', june: 4800, july: 5200, note: '工业品平台会员和线索采购' },
  { channel: 'LinkedIn 广告', june: 6800, july: 7600, note: '海外高洁净行业经销商和设备商触达' },
  { channel: '经销商联合活动', june: 9000, july: 12000, note: '区域经销商案例会和样品支持' },
  { channel: '陌生拜访', june: 7400, july: 8600, note: '华东/华南重点客户差旅' },
  { channel: '第三方名录', june: 3200, july: 2800, note: '制药 EPC、半导体设备和新能源企业名录' },
  { channel: '再营销广告', june: 2600, july: 3400, note: '官网访问人群和资料下载人群再营销' },
].flatMap((channel, index) => [
  {
    id: createId('cco'), workspaceId, channel: channel.channel, periodLabel: 'monthly',
    periodStart: monthStart(2026, 5), periodEnd: monthStart(2026, 6), costAmount: channel.june,
    currency: 'CNY', note: channel.note, ownerUserId: user.id,
    createdAt: now - (22 - index) * day, updatedAt: now - (22 - index) * day,
  },
  {
    id: createId('cco'), workspaceId, channel: channel.channel, periodLabel: 'monthly',
    periodStart: monthStart(2026, 6), periodEnd: monthStart(2026, 7), costAmount: channel.july,
    currency: 'CNY', note: channel.note, ownerUserId: user.id,
    createdAt: now - (11 - index) * day, updatedAt: now - (11 - index) * day,
  },
])

await db.transaction(async (tx) => {
  for (const table of [
    candidateEvidence, candidateContacts, radarJobEvents, radarQueueItems, radarCandidates,
    messageEntries, messageThreads, inboxContacts, campaignContentLinks, campaignAudienceMembers,
    campaignSteps, campaigns, contentQualityChecks, contentVersions, contentAssets, tasks, deals,
    knowledgeItems, channelCosts, radarTasks, businessProfiles, customers,
  ]) {
    await tx.delete(table).where(eq(table.workspaceId, workspaceId))
  }

  await tx.insert(customers).values(customerRows)
  await tx.insert(deals).values(dealRows)
  await tx.insert(tasks).values(taskRows)

  for (const row of contentRows) {
    await tx.insert(contentAssets).values(row.asset)
    await tx.insert(contentVersions).values(row.version)
    await tx.insert(contentQualityChecks).values(row.quality)
  }

  for (const row of campaignRows) {
    await tx.insert(campaigns).values(row.campaign)
    await tx.insert(campaignSteps).values(row.steps)
    await tx.insert(campaignAudienceMembers).values(row.audience)
    await tx.insert(campaignContentLinks).values(row.contentLinks)
  }

  for (const row of messageRows) {
    await tx.insert(inboxContacts).values(row.contact)
    await tx.insert(messageThreads).values(row.thread)
    await tx.insert(messageEntries).values([row.outboundEntry, row.inboundEntry])
  }

  await tx.insert(radarTasks).values(radarTaskRows)
  for (const row of radarCandidateRows) {
    await tx.insert(radarCandidates).values(row.candidate)
    await tx.insert(candidateContacts).values(row.contact)
    await tx.insert(candidateEvidence).values(row.evidence)
  }

  await tx.insert(businessProfiles).values(businessProfile)
  await tx.insert(knowledgeItems).values(knowledgeSamples.map((sample, index) => ({
    id: createId('knw'), workspaceId, ownerUserId: user.id, title: sample.title, itemType: sample.itemType,
    summary: sample.summary, source: sample.source, sourceUrl: sample.sourceUrl,
    tagsJson: JSON.stringify(sample.tags), status: sample.status, referenceCount: sample.referenceCount,
    createdAt: now - index * 3_600_000, updatedAt: now - index * 3_600_000,
  })))
  await tx.insert(channelCosts).values(channelCostRows)
})

const count = async (table: any) =>
  (await db.select().from(table).where(eq(table.workspaceId, workspaceId))).length

console.log(`Sondara fictional demo ready: ${email} / ${password}`)
console.log([
  `customers=${(await count(customers))}`, `deals=${(await count(deals))}`, `tasks=${(await count(tasks))}`,
  `contentAssets=${(await count(contentAssets))}`, `campaigns=${(await count(campaigns))}`,
  `messageThreads=${(await count(messageThreads))}`, `radarTasks=${(await count(radarTasks))}`,
  `radarCandidates=${(await count(radarCandidates))}`, `knowledgeItems=${(await count(knowledgeItems))}`,
  `channelCosts=${(await count(channelCosts))}`,
].join('  '))
