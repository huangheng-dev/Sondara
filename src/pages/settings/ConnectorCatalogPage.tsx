import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Alert, Flex, Form, Input, InputNumber, Popconfirm, Space, Switch, Tabs, Typography } from 'antd'
import { CheckCircle2, Clock3, ExternalLink, KeyRound, Pencil, Play, Trash2, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { DataTable } from '@/components/ui/DataTable'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer, PageState, TableToolbar } from '@/components/ui/PageModules'
import { StatusNotice } from '@/components/ui/StatusNotice'
import { SearchInput } from '@/components/ui/SearchInput'
import { integrationApi, type ExternalConnectorCatalogItem } from '@/lib/api'
import { useUiStore } from '@/stores/ui-store'

const nativeConnectors = [
  ['官网表单与通用 Webhook', '主动询盘', '网站表单、Webhook、UTM、去重和自动跟进任务', '/settings/lead-sources'],
  ['邮件询盘自动入库', '主动询盘', 'IMAP 收件、业务询盘识别、客户/联系人/任务闭环', '/settings/integrations'],
  ['CSV、Excel、PDF 名单导入', '名单导入', '字段映射、预览、去重、来源审计和待验证状态', '/customers'],
  ['搜索引擎与企业官网研究', '企业发现', '搜索服务、同域多页面研究和证据链', '/settings/integrations'],
  ['地图企业发现', '企业发现', 'Google Places 地点发现与企业官网核验', '/settings/integrations'],
  ['来源追踪、去重与归因', '数据治理', '触点、UTM、来源、合并和渠道 ROI', '/attribution'],
  ['Google Ads Lead Form', '广告线索', 'Google Key 验证、Lead ID 幂等和自动入库', '/settings/lead-sources'],
  ['LinkedIn Lead Gen', '广告线索', '签名验证、Lead Form Response 拉取和失败转人工', '/settings/lead-sources'],
  ['Meta Lead Ads', '广告线索', 'OAuth、官方签名、完整字段拉取和去重入库', '/settings/lead-sources'],
  ['展会与协会名单', '名单导入', '公开目录研究及 CSV、Excel、PDF 导入', '/customers'],
  ['全球采购公告', '采购机会', 'TED、SAM.gov、UNGM 官方数据源、去重和任务闭环', '/settings/integrations'],
  ['新闻、招聘与扩张信号', '意向信号', '有来源证据才加分，并随候选进入客户档案', '/radar'],
] as const

const categoryLabel: Record<ExternalConnectorCatalogItem['category'], string> = {
  'data-enrichment': '数据补全', verification: '联系方式验证', 'supply-chain': '供应链数据', crm: 'CRM', visitor: '访客识别', 'vertical-data': '垂直数据库',
}

export function ConnectorCatalogPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const showToast = useUiStore(state => state.showToast)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部分类')
  const [selected, setSelected] = useState<ExternalConnectorCatalogItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [runTarget, setRunTarget] = useState<ExternalConnectorCatalogItem | null>(null)
  const [runQuery, setRunQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [scheduleTarget, setScheduleTarget] = useState<ExternalConnectorCatalogItem | null>(null)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [form] = Form.useForm<Record<string, string | boolean>>()
  const catalog = useQuery({ queryKey: ['external-connector-catalog'], queryFn: integrationApi.catalog, retry: 1 })
  const filtered = useMemo(() => (catalog.data?.items ?? []).filter(item => {
    const matchQuery = !query || `${item.name}${item.description}${item.examples.join('')}`.toLowerCase().includes(query.toLowerCase())
    return matchQuery && (category === '全部分类' || categoryLabel[item.category] === category)
  }), [catalog.data?.items, category, query])

  useEffect(() => {
    if (!selected) return
    form.resetFields()
    const defaults = Object.fromEntries(selected.fields.filter(field => field.defaultValue !== undefined).map(field => [field.key, field.defaultValue]))
    form.setFieldsValue({ name: selected.configuration?.name ?? selected.name, enabled: selected.configuration?.enabled ?? true, ...defaults, ...selected.configuration?.settings })
  }, [form, selected])

  const save = async () => {
    if (!selected) return
    try {
      const values = await form.validateFields()
      setSaving(true)
      const settings: Record<string, string> = {}
      const credentials: Record<string, string> = {}
      for (const field of selected.fields) {
        const value = String(values[field.key] ?? '').trim()
        if (!value) continue
        if (field.secret) credentials[field.key] = value
        else settings[field.key] = value
      }
      await integrationApi.saveExternalConnector(selected.key, { name: String(values.name || selected.name), enabled: Boolean(values.enabled), settings, credentials })
      await queryClient.invalidateQueries({ queryKey: ['external-connector-catalog'] })
      setSelected(null)
      showToast(`${selected.name}配置已加密保存`)
    } catch (cause) {
      if (cause instanceof Error) showToast(cause.message)
    } finally { setSaving(false) }
  }

  const extensionRows = filtered.map(item => {
    const config = item.configuration
    return { key: item.key, cells: [
      <Space orientation="vertical" size={1} key="name"><Typography.Text strong>{item.name}</Typography.Text><Typography.Text type="secondary">可选服务商：{item.examples.join('、')}</Typography.Text></Space>,
      <Badge tone="blue" key="category">{categoryLabel[item.category]}</Badge>,
      <Typography.Text key="description">{item.description}</Typography.Text>,
      <Space orientation="vertical" size={1} key="status"><Badge tone={!config ? 'neutral' : ['validated','available'].includes(config.status) ? 'green' : config.status === 'error' ? 'red' : 'orange'}>{!config ? '待配置' : config.status === 'available' ? '最近运行成功' : config.status === 'validated' ? '配置完整' : config.status === 'error' ? '运行失败' : '已保存凭据'}</Badge>{config?.lastValidatedAt ? <Typography.Text type="secondary">{new Date(config.lastValidatedAt).toLocaleString('zh-CN')}</Typography.Text> : null}{config?.lastError ? <Typography.Text type="danger">{config.lastError}</Typography.Text> : null}</Space>,
      <Space key="actions">
        <Button size="sm" ariaLabel={`配置 ${item.name}`} title="配置" onClick={() => setSelected(item)} icon={config ? <Pencil size={14}/> : <KeyRound size={14}/>}/>
        {config ? <Button size="sm" onClick={async () => { try { const result = await integrationApi.validateExternalConnector(item.key); await catalog.refetch(); showToast(result.message) } catch (cause) { showToast(cause instanceof Error ? cause.message : '配置校验失败') } }} icon={<CheckCircle2 size={14}/>}>校验</Button> : null}
        {config && item.key !== 'website-visitor-identification' ? <Button size="sm" onClick={() => { setRunQuery(''); setRunTarget(item) }} icon={<Play size={14}/>}>运行</Button> : null}
        {config && item.key !== 'website-visitor-identification' ? <Button size="sm" ariaLabel={`定时同步 ${item.name}`} title="定时同步" onClick={() => setScheduleTarget(item)} icon={<Clock3 size={14}/>}/> : null}
        {config?.webhookPath ? <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}${config.webhookPath}`); showToast('Webhook 地址已复制') }} icon={<Webhook size={14}/>}>地址</Button> : null}
        {config ? <Popconfirm title={`清除${item.name}配置？`} description="加密凭据和设置会被删除，业务数据不受影响。" onConfirm={async () => { await integrationApi.removeExternalConnector(item.key); await catalog.refetch(); showToast('连接器配置已清除') }}><Button size="sm" danger ariaLabel={`清除 ${item.name} 配置`} icon={<Trash2 size={14}/>} /></Popconfirm> : null}
      </Space>,
    ] }
  })

  const nativeContent = <Panel title="已内置能力" subtitle="无需额外密钥即可使用的系统原生能力和对应配置入口。"><DataTable ariaLabel="内置能力表格" minWidth={1080} columns={[{ key: 'name', title: '原生能力', width: 260 }, { key: 'category', title: '类型', width: 140 }, { key: 'description', title: '当前闭环', width: 480 }, { key: 'status', title: '状态', width: 130 }, { key: 'actions', title: '配置入口', width: 150 }]} rows={nativeConnectors.map(item => ({ key: item[0], cells: [<Typography.Text strong>{item[0]}</Typography.Text>, <Badge tone="blue">{item[1]}</Badge>, <Typography.Text>{item[2]}</Typography.Text>, <Badge tone="green">程序已内置</Badge>, <Button size="sm" onClick={() => navigate(item[3])} icon={<ExternalLink size={14}/>}>前往配置</Button>] }))}/></Panel>
  const extensionContent = catalog.isLoading ? <PageState status="loading" title="正在读取可选集成"/> : catalog.isError ? <PageState status="error" title="可选集成读取失败" onRetry={() => catalog.refetch()}/> : <Panel title="可选外部服务" subtitle="按业务需要填写自己的服务商账号和密钥；不配置不会影响内置能力。"><TableToolbar filters={<><SearchInput ariaLabel="搜索可选集成" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索能力或服务商"/><CustomSelect ariaLabel="筛选可选集成分类" value={category} onChange={setCategory} options={['全部分类', ...Object.values(categoryLabel)]}/></>}/><DataTable ariaLabel="可选外部服务表格" minWidth={1280} columns={[{ key: 'name', title: '集成能力', width: 280 }, { key: 'category', title: '分类', width: 150 }, { key: 'description', title: '用途', width: 360 }, { key: 'status', title: '配置状态', width: 210 }, { key: 'actions', title: '操作', width: 320 }]} rows={extensionRows}/></Panel>

  return <PageContainer>
    {!embedded && <PageHeader title="集成中心" description="发现系统已经支持的能力，并配置需要自有账号或付费授权的服务。"/>}
    <StatusNotice
      tone="info"
      icon={<KeyRound size={17}/>}
      title="可选外部服务已预留"
      description="未填写凭据的连接器不会运行；需要时从下方列表配置、校验并设置同步计划。"
    />
    {embedded ? extensionContent : <Tabs items={[{ key: 'native', label: `已内置能力（${nativeConnectors.length}）`, children: nativeContent }, { key: 'extensions', label: `可配置扩展（${catalog.data?.items.length ?? 7}）`, children: extensionContent }]}/>}
    <Modal open={Boolean(selected)} width={680} title={`配置${selected?.name ?? ''}`} description="密钥和 Token 通过 AES-256-GCM 加密保存；留空的密钥字段会保留已有值。" onClose={() => setSelected(null)} footer={<><Button onClick={() => setSelected(null)}>取消</Button><Button variant="primary" loading={saving} onClick={save}>加密保存</Button></>}>
      {selected ? <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label="连接名称" rules={[{ required: true, message: '请输入连接名称' }]}><Input/></Form.Item>
        {selected.fields.map(field => <Form.Item key={field.key} name={field.key} label={field.secret && selected.configuration?.credentialEndings[field.key] ? `${field.label}（当前 •••• ${selected.configuration.credentialEndings[field.key]}）` : field.label} rules={[{ required: Boolean(field.required && !(field.secret && selected.configuration?.hasCredentials)), message: `请填写${field.label}` }]}>
          {field.type === 'password'
            ? <Input.Password autoComplete="new-password" placeholder={field.placeholder ?? '留空保留原值'}/>
            : field.type === 'select'
              ? <CustomSelect ariaLabel={field.label} options={field.options ?? []}/>
              : <Input type={field.type === 'url' ? 'url' : 'text'} placeholder={field.placeholder}/>}
        </Form.Item>)}
        <Form.Item name="enabled" label="启用配置" valuePropName="checked"><Switch/></Form.Item>
      </Form> : null}
    </Modal>
    <Modal open={Boolean(runTarget)} width={560} title={`运行${runTarget?.name ?? ''}`} description="运行会调用已配置服务商的官方接口，并可能消耗其 API 额度。结果按企业和联系人去重后进入客户库。" onClose={() => setRunTarget(null)} footer={<><Button onClick={() => setRunTarget(null)}>取消</Button><Button variant="primary" loading={running} onClick={async () => { if (!runTarget) return; const needsQuery = ['company-contact-database','trade-supply-chain-data','vertical-industry-database'].includes(runTarget.key); if (needsQuery && !runQuery.trim()) { showToast('请先填写搜索关键词'); return } try { setRunning(true); const result = await integrationApi.runExternalConnector(runTarget.key, { query: runQuery.trim() || undefined, limit: 25, importRecords: true }); await catalog.refetch(); setRunTarget(null); showToast(`运行完成：读取 ${result.fetchedCount}，新增 ${result.createdCount}，更新 ${result.updatedCount}，跳过 ${result.skippedCount}`) } catch (cause) { showToast(cause instanceof Error ? cause.message : '连接器运行失败') } finally { setRunning(false) } }}>确认运行</Button></>}>
      <Space orientation="vertical" size="middle" style={{width:'100%'}}>
        <Alert type="warning" showIcon title="这是一次真实联网操作" description="请先确认服务商套餐、数据授权范围和当地合规要求。系统不会绕过登录、验证码或平台限制。"/>
        {runTarget && ['company-contact-database','trade-supply-chain-data','vertical-industry-database'].includes(runTarget.key) ? <Form layout="vertical"><Form.Item label="搜索关键词" required><Input value={runQuery} onChange={event => setRunQuery(event.target.value)} placeholder="例如 industry + buyer + region"/></Form.Item></Form> : <Typography.Text type="secondary">本次最多处理 25 条待处理记录，并保存运行结果。</Typography.Text>}
      </Space>
    </Modal>
    <Modal open={Boolean(scheduleTarget)} width={580} title={`定时同步 · ${scheduleTarget?.name ?? ''}`} description="设置周期、单次和每日额度。连续失败 5 次会自动暂停，恢复时保留同步游标。" onClose={() => setScheduleTarget(null)} footer={null}>
      {scheduleTarget?.configuration ? <Form layout="vertical" initialValues={{ enabled: scheduleTarget.configuration.scheduleEnabled, intervalMinutes: String(scheduleTarget.configuration.scheduleIntervalMinutes), query: scheduleTarget.configuration.scheduleQuery ?? '', perRunLimit: scheduleTarget.configuration.perRunLimit, dailyLimit: scheduleTarget.configuration.dailyLimit }} onFinish={async values => { try { setScheduleSaving(true); await integrationApi.saveExternalConnectorSchedule(scheduleTarget.key, { enabled: Boolean(values.enabled), intervalMinutes: Number(values.intervalMinutes), query: String(values.query || '').trim() || undefined, perRunLimit: Number(values.perRunLimit), dailyLimit: Number(values.dailyLimit) }); await catalog.refetch(); setScheduleTarget(null); showToast(values.enabled ? '定时同步已启用' : '定时同步已暂停') } catch (cause) { showToast(cause instanceof Error ? cause.message : '定时同步保存失败') } finally { setScheduleSaving(false) } }}>
        <Form.Item name="enabled" label="启用定时同步" valuePropName="checked"><Switch/></Form.Item>
        {['company-contact-database','trade-supply-chain-data','vertical-industry-database'].includes(scheduleTarget.key) ? <Form.Item name="query" label="固定搜索关键词" rules={[{required:true,message:'请填写定时任务搜索关键词'}]}><Input placeholder="例如 industrial buyer Germany"/></Form.Item> : null}
        <Form.Item name="intervalMinutes" label="运行周期" rules={[{required:true}]}><CustomSelect ariaLabel="运行周期" options={[{label:'每 15 分钟',value:'15'},{label:'每小时',value:'60'},{label:'每 6 小时',value:'360'},{label:'每天',value:'1440'},{label:'每周',value:'10080'}]}/></Form.Item>
        <Space size="middle" align="start"><Form.Item name="perRunLimit" label="单次最多" rules={[{required:true}]}><InputNumber min={1} max={100}/></Form.Item><Form.Item name="dailyLimit" label="每日最多" rules={[{required:true}]}><InputNumber min={1} max={10000}/></Form.Item></Space>
        {scheduleTarget.configuration.pausedReason ? <Alert type="warning" showIcon title="当前说明" description={scheduleTarget.configuration.pausedReason}/> : null}
        <Flex justify="flex-end" gap={8} style={{marginTop:16}}><Button onClick={() => setScheduleTarget(null)}>取消</Button><Button htmlType="submit" variant="primary" loading={scheduleSaving}>保存计划</Button></Flex>
      </Form> : null}
    </Modal>
  </PageContainer>
}
