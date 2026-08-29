import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Descriptions, Popconfirm, Space, Typography } from 'antd'
import { Copy, KeyRound, Link2, Pencil, Plus, Power, RefreshCw, Trash2, Webhook } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { ListRefreshButton } from '@/components/ui/ListRefreshButton'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { DataTable } from '@/components/ui/DataTable'
import { leadSourceApi, type LeadSourceConnection, type LeadSourceEvent, type LeadSourceProvider } from '@/lib/api'
import { useUiStore } from '@/stores/ui-store'
import { PageContainer } from '@/components/ui/PageModules'
import { RecordTime } from '@/components/ui/TableCells'
import { StatusNotice } from '@/components/ui/StatusNotice'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'

const providerLabel: Record<LeadSourceProvider, string> = {
  'website-form': '网站表单',
  'generic-webhook': '通用 Webhook',
  'google-ads-lead-form': 'Google Ads Lead Form',
  'linkedin-lead-gen': 'LinkedIn Lead Gen',
  'meta-lead-ads': 'Meta Lead Ads',
}
const providerByLabel = Object.fromEntries(Object.entries(providerLabel).map(([value, label]) => [label, value])) as Record<string, LeadSourceProvider>
type SourcePreset = { provider: LeadSourceProvider; name: string; description: string; requirements: string; accountPlaceholder: string; formPlaceholder: string }
const sourcePresets: SourcePreset[] = [
  { provider: 'website-form', name: '官网表单与询价', description: '接收联系表单、询价、预约演示、申请试用和资料下载。', requirements: '站点域名；可选表单名称', accountPlaceholder: '例如：www.example.com', formPlaceholder: '例如：Contact / RFQ / Demo' },
  { provider: 'generic-webhook', name: '通用 Webhook', description: '供商城、落地页、客服、低代码表单及其他系统推送线索。', requirements: '业务系统名称；可选事件类型', accountPlaceholder: '例如：商城、客服或落地页', formPlaceholder: '例如：inquiry / demo_request' },
  { provider: 'google-ads-lead-form', name: 'Google Ads Lead Form', description: '接收 Google Ads 线索表单提交并保留广告归因字段。', requirements: 'Google Ads 客户 ID；Lead Form ID', accountPlaceholder: 'Google Ads Customer ID', formPlaceholder: 'Lead Form Asset ID' },
  { provider: 'linkedin-lead-gen', name: 'LinkedIn Lead Gen', description: '通过 LinkedIn 官方 Lead Sync 授权读取表单与联系人资料。', requirements: '广告账户、表单 ID、Client ID、Access Token、Client Secret', accountPlaceholder: 'LinkedIn Ad Account ID', formPlaceholder: 'Lead Gen Form ID' },
  { provider: 'meta-lead-ads', name: 'Meta Lead Ads', description: '接收 Facebook 与 Instagram Lead Ads 通知并读取完整表单。', requirements: 'Page ID、Form ID、App ID、Access Token、App Secret', accountPlaceholder: 'Facebook Page / Ad Account ID', formPlaceholder: 'Instant Form ID' },
]
const presetByProvider = Object.fromEntries(sourcePresets.map(item => [item.provider, item])) as Record<LeadSourceProvider, SourcePreset>
const automationInput = (value: string) => value === '仅保存原始事件'
  ? { autoCreateCustomer: false, createFollowUpTask: false }
  : value === '自动创建客户，不创建任务'
    ? { autoCreateCustomer: true, createFollowUpTask: false }
    : { autoCreateCustomer: true, createFollowUpTask: true }
const automationLabel = (item: Pick<LeadSourceConnection, 'autoCreateCustomer' | 'createFollowUpTask'>) => !item.autoCreateCustomer ? '仅保存事件' : item.createFollowUpTask ? '客户 + 联系人 + 任务' : '客户 + 联系人'
const eventTone = (status: string) => status === 'processed' ? 'green' : status === 'needs_review' ? 'orange' : status === 'failed' ? 'red' : 'blue'
const connectionState = (item: LeadSourceConnection) => {
  if (!item.enabled) return { tone: 'neutral' as const, label: '已停用' }
  if (item.status === 'active') return { tone: 'green' as const, label: '闭环运行中' }
  if (item.status === 'error') return { tone: 'red' as const, label: '处理异常' }
  if (item.status === 'webhook_received') return { tone: 'orange' as const, label: '可信事件待补全' }
  if (item.status === 'ready_for_verification') return { tone: 'blue' as const, label: '凭据待回调验证' }
  if (item.status === 'ready') {
    if (item.provider === 'linkedin-lead-gen') return { tone: 'blue' as const, label: 'Lead Sync 已配置' }
    if (item.provider === 'meta-lead-ads') return { tone: 'blue' as const, label: '签名验证已配置' }
    return { tone: 'blue' as const, label: '可接收' }
  }
  return { tone: 'neutral' as const, label: '待配置平台凭据' }
}

export function LeadSourcesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { canManageSettings } = useWorkspaceAccess()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const showToast = useUiStore(state => state.showToast)
  const [createOpen, setCreateOpen] = useState(false)
  const [createPreset, setCreatePreset] = useState<SourcePreset | null>(null)
  const [webhook, setWebhook] = useState<{ name: string; url: string; token: string } | null>(null)
  const [editing, setEditing] = useState<LeadSourceConnection | null>(null)
  const [reviewing, setReviewing] = useState<LeadSourceEvent | null>(null)
  const connections = useQuery({ queryKey: ['lead-source-connections'], queryFn: leadSourceApi.listConnections, retry: 1 })
  const events = useQuery({ queryKey: ['lead-source-events'], queryFn: leadSourceApi.listEvents, retry: 1 })
  const refresh = async () => { await Promise.all([connections.refetch(), events.refetch()]); showToast('已检查最新线索与连接状态') }
  const rotateWebhook = async (item: LeadSourceConnection) => {
    try {
      const result = await leadSourceApi.regenerateWebhook(item.id)
      setWebhook({ name: item.name, url: result.webhookUrl, token: result.webhookToken })
      showToast('已生成新的 Webhook Token，旧地址立即失效')
    } catch (cause) { showToast(cause instanceof Error ? cause.message : '重置失败') }
  }
  useEffect(() => {
    const oauth = searchParams.get('oauth')
    if (!oauth) return
    showToast(oauth === 'success' ? '平台授权已完成' : searchParams.get('message') || '平台授权未完成，请重试')
    void connections.refetch()
    setSearchParams({}, { replace: true })
  }, [connections, searchParams, setSearchParams, showToast])
  const startOAuth = async (item: LeadSourceConnection) => {
    try {
      const result = await leadSourceApi.startOAuth(item.id)
      window.location.assign(result.authorizationUrl)
    } catch (cause) { showToast(cause instanceof Error ? cause.message : '无法启动平台授权') }
  }
  const openCreate = (preset: SourcePreset | null = null) => { setCreatePreset(preset); setCreateOpen(true) }
  const closeCreate = () => { setCreateOpen(false); setCreatePreset(null) }
  const connectedProviders = new Set((connections.data?.items ?? []).map(item => item.provider))
  const missingPresets = sourcePresets.filter(item => !connectedProviders.has(item.provider))
  const createFields = [
    { name: 'name', label: '来源名称', required: true, placeholder: '例如：官网询价表单' },
    { name: 'provider', label: '接入方式', type: 'select' as const, required: true, options: Object.values(providerLabel) },
    { name: 'automation', label: '收到线索后', type: 'select' as const, required: true, options: ['自动创建客户、联系人和跟进任务', '自动创建客户，不创建任务', '仅保存原始事件'] },
    { name: 'accountRef', label: '账户或站点标识', placeholder: createPreset?.accountPlaceholder ?? '网站域名、广告账户或 Page ID' },
    { name: 'formRef', label: '表单标识', placeholder: createPreset?.formPlaceholder ?? '可选；用于区分多个表单' },
    ...(!createPreset || ['linkedin-lead-gen', 'meta-lead-ads'].includes(createPreset.provider) ? [
      { name: 'clientId', label: '平台 Client / App ID', placeholder: '在平台开发者后台创建应用后填写' },
      { name: 'accessToken', label: '平台访问 Token', type: 'password' as const, placeholder: '可稍后填写或改用 OAuth 授权' },
      { name: 'verificationSecret', label: '平台 Client / App Secret', type: 'password' as const, placeholder: '用于 OAuth 与官方回调签名验证' },
    ] : []),
  ]

  return <PageContainer>
    {!embedded && (
      <PageHeader title="集成中心" description="接收官网表单、Webhook 和广告线索，并查看从事件到客户与跟进任务的处理结果。" actions={<><ListRefreshButton label="检查新线索" onClick={refresh} loading={connections.isFetching || events.isFetching}/><Button variant="primary" disabled={!canManageSettings} onClick={() => openCreate()}><Plus size={16}/>添加其他来源</Button></>}/>
    )}

    <StatusNotice
      tone={missingPresets.length ? 'info' : 'success'}
      icon={<Link2 size={17}/>}
      title={`线索入口配置 ${sourcePresets.length - missingPresets.length}/${sourcePresets.length}`}
      description={missingPresets.length ? '未配置的入口保持停用；需要使用时在列表中填写账户或平台凭据。' : '主流网站表单、Webhook 与广告线索入口均已建立连接。'}
    />

    <Panel title="线索入口" subtitle="官网表单、Webhook 和广告线索统一在这里配置；每个真实连接拥有独立 Token、处理策略和运行状态。" action={embedded ? <Space><ListRefreshButton label="检查新线索" onClick={refresh} loading={connections.isFetching || events.isFetching}/><Button variant="primary" disabled={!canManageSettings} onClick={() => openCreate()}><Plus size={16}/>添加其他来源</Button></Space> : undefined}>
      {connections.isLoading ? <EmptyState spinning title="正在读取线索来源" icon={RefreshCw}/> : connections.isError ? <EmptyState title="线索来源读取失败" description={connections.error instanceof Error ? connections.error.message : '请稍后重试。'} icon={Link2} action={<Button size="sm" onClick={() => connections.refetch()}>重新加载</Button>}/> : <DataTable ariaLabel="线索入口配置表格" columns={[{ key: 'name', title: '来源' }, { key: 'provider', title: '接入方式与准备项' }, { key: 'automation', title: '自动化闭环' }, { key: 'status', title: '连接状态' }, { key: 'synced', title: '最近事件' }, { key: 'actions', title: '操作' }]} rows={[
        ...(connections.data?.items ?? []).map(item => ({ key: item.id, cells: [
        <Space orientation="vertical" size={0}><Typography.Text strong>{item.name}</Typography.Text><Typography.Text type="secondary">{item.accountRef || '未限定账户'}</Typography.Text></Space>,
        <Space orientation="vertical" size={0}><Typography.Text>{providerLabel[item.provider]}</Typography.Text><Typography.Text type="secondary">{presetByProvider[item.provider].requirements}</Typography.Text></Space>,
        <Badge tone={item.autoCreateCustomer ? 'blue' : 'neutral'}>{automationLabel(item)}</Badge>,
        <Space orientation="vertical" size={2}><Badge tone={connectionState(item).tone}>{connectionState(item).label}</Badge>{item.lastError && <Typography.Text type="danger">{item.lastError}</Typography.Text>}</Space>,
        <RecordTime value={item.lastSyncedAt ?? item.updatedAt} label={item.lastSyncedAt ? '最近收到' : '最近更新'}/>,
        <Space>{['linkedin-lead-gen', 'meta-lead-ads'].includes(item.provider) && <Button size="sm" disabled={!canManageSettings} aria-label={`授权 ${item.name}`} title="平台 OAuth 授权" onClick={() => void startOAuth(item)}><KeyRound/></Button>}<Button size="sm" disabled={!canManageSettings} aria-label={`编辑 ${item.name}`} title="编辑连接" onClick={() => setEditing(item)}><Pencil/></Button><Button size="sm" disabled={!canManageSettings} aria-label={`${item.enabled ? '停用' : '启用'} ${item.name}`} title={item.enabled ? '停用连接' : '启用连接'} onClick={async () => { await leadSourceApi.updateConnection(item.id, { enabled: !item.enabled }); await client.invalidateQueries({ queryKey: ['lead-source-connections'] }); showToast(item.enabled ? '连接已停用' : '连接已启用') }}><Power/></Button><Button size="sm" disabled={!canManageSettings} aria-label={`重置 ${item.name} Webhook`} title="重置 Webhook" onClick={() => void rotateWebhook(item)}><Webhook/></Button>{canManageSettings&&<Popconfirm title={`删除连接“${item.name}”？`} description="只有没有接入记录的连接可以删除；已有记录请停用，以保留来源和归因历史。" okText="删除" cancelText="取消" okButtonProps={{danger:true}} onConfirm={async()=>{try{await leadSourceApi.removeConnection(item.id);await client.invalidateQueries({queryKey:['lead-source-connections']});showToast('线索来源连接已删除')}catch(cause){showToast(cause instanceof Error?cause.message:'连接删除失败')}}}><Button size="sm" aria-label={`删除 ${item.name}`} title="删除连接"><Trash2/></Button></Popconfirm>}</Space>,
      ] })),
        ...missingPresets.map(preset => ({ key: `preset-${preset.provider}`, cells: [
          <Space orientation="vertical" size={0}><Typography.Text strong>{preset.name}</Typography.Text><Typography.Text type="secondary">{preset.description}</Typography.Text></Space>,
          <Space orientation="vertical" size={0}><Typography.Text>{providerLabel[preset.provider]}</Typography.Text><Typography.Text type="secondary">{preset.requirements}</Typography.Text></Space>,
          <Badge tone="neutral">保存后设置</Badge>,
          <Badge tone="neutral">待填写</Badge>,
          <Typography.Text type="secondary">—</Typography.Text>,
          <Button size="sm" disabled={!canManageSettings} onClick={() => openCreate(preset)}><Pencil size={14}/>填写配置</Button>,
        ] })),
      ]}/>
    }
    </Panel>

    <Panel title="线索处理记录" subtitle="每个事件都会显示是否已经完成客户、联系人和任务闭环。">
      {events.isLoading ? <EmptyState spinning title="正在读取线索事件" icon={RefreshCw}/> : events.isError ? <EmptyState title="线索事件读取失败" description={events.error instanceof Error ? events.error.message : '请稍后重试。'} icon={Webhook}/> : events.data?.items.length ? <DataTable ariaLabel="线索处理记录表格" columns={[{ key: 'event', title: '事件' }, { key: 'status', title: '处理状态' }, { key: 'result', title: '闭环结果' }, { key: 'time', title: '接收时间' }, { key: 'action', title: '查看' }]} rows={events.data.items.map(item => ({ key: item.id, cells: [
        <Space orientation="vertical" size={0}><Typography.Text strong>{item.providerEventId}</Typography.Text><Typography.Text type="secondary">{connections.data?.items.find(connection => connection.id === item.connectionId)?.name || item.connectionId}</Typography.Text></Space>,
        <Space orientation="vertical" size={0}><Badge tone={eventTone(item.processingStatus)}>{item.processingStatus === 'processed' ? '已入库' : item.processingStatus === 'needs_review' ? '待人工处理' : item.processingStatus === 'failed' ? '处理失败' : '已接收'}</Badge>{item.processingError && <Typography.Text type="secondary">{item.processingError}</Typography.Text>}</Space>,
        <Space wrap>{item.customerId && <Badge tone="green">客户</Badge>}{item.contactId && <Badge tone="blue">联系人</Badge>}{item.taskId && <Badge tone="orange">任务</Badge>}{!item.customerId && !item.contactId && !item.taskId && <Typography.Text type="secondary">尚未生成业务记录</Typography.Text>}</Space>,
        <RecordTime value={item.receivedAt}/>,
        item.customerId ? <Button size="sm" onClick={() => navigate('/customers')}>客户库</Button> : <Button size="sm" onClick={() => setReviewing(item)}>人工处理</Button>,
      ] }))}/> : <EmptyState title="尚未收到线索事件" description="完成 Webhook 配置或平台授权后，新事件会显示在这里。" icon={Webhook}/>}
    </Panel>

    <CreateDialog open={createOpen} title={createPreset ? `配置 · ${createPreset.name}` : '添加线索来源'} description={createPreset ? `${createPreset.description} 需要准备：${createPreset.requirements}。密钥可以稍后通过编辑补充。` : '为其他网站、表单或广告账户创建独立连接。'} submitLabel="保存并建立连接" successMessage="线索来源已创建，请立即保存 Webhook 地址和 Token" onClose={closeCreate} onSubmit={async values => {
      const result = await leadSourceApi.createConnection({ name: values.name, provider: providerByLabel[values.provider], accountRef: values.accountRef || undefined, formRef: values.formRef || undefined, clientId: values.clientId || undefined, accessToken: values.accessToken || undefined, verificationSecret: values.verificationSecret || undefined, ...automationInput(values.automation) })
      setWebhook({ name: result.name, url: result.webhookUrl, token: result.webhookToken })
      await client.invalidateQueries({ queryKey: ['lead-source-connections'] })
    }} initialValues={{ name: createPreset?.name ?? '', provider: createPreset ? providerLabel[createPreset.provider] : '', automation: '自动创建客户、联系人和跟进任务' }} fields={createFields}/>

    <CreateDialog open={Boolean(editing)} title={`编辑来源 · ${editing?.name ?? ''}`} description="可以更新自动入库策略与平台凭据；密钥留空时保留现有值。" submitLabel="保存修改" successMessage="线索来源已更新" onClose={() => setEditing(null)} onSubmit={async values => { if (!editing) return false; await leadSourceApi.updateConnection(editing.id, { name: values.name, accountRef: values.accountRef, formRef: values.formRef, clientId: values.clientId, ...automationInput(values.automation), ...(values.accessToken ? { accessToken: values.accessToken } : {}), ...(values.verificationSecret ? { verificationSecret: values.verificationSecret } : {}) }); await client.invalidateQueries({ queryKey: ['lead-source-connections'] }); setEditing(null) }} initialValues={editing ? { name: editing.name, accountRef: editing.accountRef ?? '', formRef: editing.formRef ?? '', clientId: editing.clientId ?? '', accessToken: '', verificationSecret: '', automation: editing.autoCreateCustomer ? editing.createFollowUpTask ? '自动创建客户、联系人和跟进任务' : '自动创建客户，不创建任务' : '仅保存原始事件' } : undefined} fields={[{ name: 'name', label: '来源名称', required: true }, { name: 'automation', label: '收到线索后', type: 'select', required: true, options: ['自动创建客户、联系人和跟进任务', '自动创建客户，不创建任务', '仅保存原始事件'] }, { name: 'accountRef', label: '账户或站点标识' }, { name: 'formRef', label: '表单标识' }, { name: 'clientId', label: '平台 Client / App ID' }, { name: 'accessToken', label: '替换访问 Token', type: 'password', placeholder: '留空则保留现有 Token' }, { name: 'verificationSecret', label: '替换 Client / App Secret', type: 'password', placeholder: '留空则保留现有 Secret' }]}/>

    <CreateDialog open={Boolean(reviewing)} title="人工处理线索事件" description="补齐企业和联系人信息后，系统会创建或匹配客户、保存联系人并生成跟进任务。" submitLabel="完成入库" successMessage="线索已完成客户、联系人和任务闭环" onClose={() => setReviewing(null)} onSubmit={async values => { if (!reviewing) return false; await leadSourceApi.processEvent(reviewing.id, { company: values.company, full_name: values.full_name || undefined, email: values.email || undefined, phone: values.phone || undefined, job_title: values.job_title || undefined, region: values.region || undefined, industry: values.industry || undefined, website: values.website || undefined, message: values.message || undefined }); await Promise.all([client.invalidateQueries({ queryKey: ['lead-source-events'] }), client.invalidateQueries({ queryKey: ['lead-source-connections'] }), client.invalidateQueries({ queryKey: ['customers'] }), client.invalidateQueries({ queryKey: ['tasks'] })]); setReviewing(null) }} fields={[{ name: 'company', label: '企业名称', required: true }, { name: 'full_name', label: '联系人姓名' }, { name: 'email', label: '工作邮箱', type: 'email' }, { name: 'phone', label: '联系电话' }, { name: 'job_title', label: '职位' }, { name: 'region', label: '国家或地区' }, { name: 'industry', label: '行业' }, { name: 'website', label: '企业官网' }, { name: 'message', label: '需求说明', type: 'textarea' }]}/>

    <Modal open={Boolean(webhook)} width={720} title={`${webhook?.name ?? ''} · Webhook 配置`} description="地址包含一次性显示的验证 Token，请立即安全保存。" onClose={() => setWebhook(null)} footer={<Button onClick={() => setWebhook(null)}>完成</Button>}>
      {webhook && <Space orientation="vertical" size="middle" style={{ width: '100%' }}><Descriptions bordered column={1} items={[{ key: 'url', label: 'Webhook 地址', children: <Typography.Text copyable>{webhook.url}</Typography.Text> }, { key: 'token', label: '验证 Token', children: <Typography.Text copyable>{webhook.token}</Typography.Text> }]}/><StatusNotice tone="info" icon={<Webhook size={17}/>} title="通用字段格式" description="POST JSON 建议包含 id、company、full_name、email、phone、job_title、region、industry、website 和 message；系统也会识别常见广告表单字段。"/><Button onClick={() => { navigator.clipboard?.writeText(webhook.url); showToast('Webhook 地址已复制') }}><Copy/>复制完整地址</Button></Space>}
    </Modal>
  </PageContainer>
}
