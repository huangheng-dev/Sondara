const apiOrigin = process.env.SONDARA_API_ORIGIN || 'http://127.0.0.1:4176'
const email = process.env.SONDARA_FORMAL_EMAIL?.trim()
const password = process.env.SONDARA_FORMAL_PASSWORD
const targetRegion = process.env.SONDARA_FORMAL_TARGET_REGION || '德国、荷兰和比利时'

if (!email || !password) throw new Error('运行正式获客流程前必须设置 SONDARA_FORMAL_EMAIL 和 SONDARA_FORMAL_PASSWORD。')

const loginResponse = await fetch(`${apiOrigin}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, remember: false }),
})
if (!loginResponse.ok) throw new Error(`正式账户登录失败：${loginResponse.status} ${await loginResponse.text()}`)
const cookie = loginResponse.headers.getSetCookie()[0]?.split(';')[0]
if (!cookie) throw new Error('登录成功但未收到会话 Cookie。')

const request = async (path, options = {}) => {
  const response = await fetch(`${apiOrigin}${path}`, {
    ...options,
    headers: { cookie, 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} 失败：${response.status} ${body.message || JSON.stringify(body)}`)
  return body
}

const flowName = `DONJOY ${targetRegion}高洁净工艺客户正式获客流程`
const existingTasks = await request('/api/radar/tasks?page=1&pageSize=100')
let radarTask = existingTasks.items.find(item => item.name === flowName)
if (!radarTask) {
  radarTask = await request('/api/radar/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: flowName,
      icp: '寻找服务生物制药、食品饮料、乳品或高洁净工艺项目的终端工厂、设备制造商、EPC、系统集成商及具备技术服务能力的区域经销商。',
      mode: '智能多渠道',
      depth: '标准研究',
      candidateLimit: 12,
      knowledgeScope: '全部已启用的 DONJOY 官方资料',
      targetRegion,
      researchLanguage: 'English',
      inputSource: 'DONJOY 正式获客流程',
      seedUrls: [],
    }),
  })
}

const deadline = Date.now() + 4 * 60_000
while (['queued', 'running'].includes(radarTask.status) && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 3000))
  radarTask = await request(`/api/radar/tasks/${radarTask.id}`)
  console.log(`radar ${radarTask.status} ${radarTask.progress}% ${radarTask.currentStage}`)
}

const candidates = await request(`/api/radar/candidates?taskId=${encodeURIComponent(radarTask.id)}&page=1&pageSize=100&sort=score_desc`)
let promoted = null
for (const candidate of candidates.items) {
  if (candidate.status === 'saved') continue
  try {
    promoted = await request(`/api/radar/candidates/${candidate.id}/promote`, { method: 'POST', body: '{}' })
    break
  } catch (error) {
    console.log(`skip candidate ${candidate.company}: ${error.message}`)
  }
}

const content = await request('/api/content/generate', {
  method: 'POST',
  body: JSON.stringify({
    title: 'DONJOY Hygienic Flow and Process Control Solutions',
    contentType: '首次触达邮件',
    channel: '邮件',
    language: 'English',
    targetMarket: `${targetRegion} pharmaceutical, food and hygienic process industries`,
    customerRole: 'Plant engineering teams, equipment manufacturers, system integrators and technical distributors',
    buyingStage: 'Supplier evaluation',
    customerSignal: 'A new plant, capacity expansion, hygienic process upgrade, equipment procurement or regional distribution opportunity',
    sourceMethod: 'DONJOY English export website, product catalogs and public technical materials',
    saveAsAsset: true,
    existingBody: `Hello,\n\nDONJOY develops hygienic pumps, aseptic and sanitary valves, valve control solutions and process components for pharmaceutical, food and other high-cleanliness applications. Public technical materials cover ASME BPE, EHEDG, FDA and 3-A related requirements; final compliance should be confirmed against the selected product and current certificate.\n\nIf you are planning a new line, capacity expansion, process upgrade, equipment integration or regional distribution project, please share the medium, flow, pressure, temperature, cleaning requirements and applicable standards. We can prepare a focused English selection package for technical review.`,
  }),
})

const customerId = promoted?.customer?.id || null
const customerCompany = promoted?.customer?.company || null
const campaign = await request('/api/campaigns', {
  method: 'POST',
  body: JSON.stringify({
    name: `DONJOY ${targetRegion}高洁净行业客户开发`,
    market: targetRegion,
    audienceLabel: customerCompany ? `首位已核验候选：${customerCompany}` : '等待人工核验首批海外候选客户',
    status: '草稿',
    channel: '邮件',
    stopRule: '收到回复或人工停止',
    timezone: 'Asia/Shanghai',
    nextAction: '人工审核客户、联系人和邮件正文后再确认执行',
    contentAssetId: content.assetId,
    audienceCustomerIds: customerId ? [customerId] : [],
  }),
})

const task = await request('/api/tasks', {
  method: 'POST',
  body: JSON.stringify({
    customerId,
    title: '审核首批海外获客候选与触达内容',
    priority: '高',
    dueAt: Date.now() + 2 * 86_400_000,
    dueLabel: '2 天内',
    company: customerCompany || 'DONJOY 海外获客',
    nextAction: '核验企业、联系人和需求信号，确认无误后再执行营销活动',
    impact: '建立首批正式海外销售机会',
    source: '正式获客流程',
  }),
})

console.log(JSON.stringify({
  radar: { id: radarTask.id, status: radarTask.status, candidates: candidates.total },
  promotedCustomer: customerCompany,
  content: { id: content.assetId, mode: content.generationMode, quality: content.quality?.overallScore },
  campaign: { id: campaign.id, status: campaign.status, audience: campaign.audienceCount },
  task: { id: task.id, status: task.status },
  outboundExecuted: false,
}, null, 2))
