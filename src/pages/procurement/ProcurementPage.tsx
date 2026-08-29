import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Avatar, Card, Checkbox, Descriptions, Form, Input, Popconfirm, Space, Switch, Tabs, Tag, Typography } from 'antd'
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ExternalLink, Landmark, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer, PageState, SelectionBar, TableToolbar } from '@/components/ui/PageModules'
import { Panel } from '@/components/ui/Panel'
import { Pagination } from '@/components/ui/Pagination'
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { List } from '@/components/ui/List'
import { Modal } from '@/components/ui/Modal'
import { integrationApi, procurementApi, type ProcurementOpportunitySort, type ProcurementProvider, type ProcurementSubscription } from '@/lib/api'
import { useUiStore } from '@/stores/ui-store'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { StatusNotice } from '@/components/ui/StatusNotice'

const providerNames: Record<ProcurementProvider, string> = { ted: '欧盟 TED', 'sam-gov': '美国 SAM.gov', ungm: '联合国 UNGM', 'world-bank': 'World Bank Procurement' }
const parseList = (value?: string) => (value ?? '').split(/[,，;；\n]/).map(item => item.trim()).filter(Boolean)
const formatTime = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚未同步'

export function ProcurementPage({ embedded = false, view = 'acquisition' }: { embedded?: boolean; view?: 'acquisition' | 'settings' } = {}) {
  const { canWrite, canDelete, canManageSettings } = useWorkspaceAccess()
  const queryClient = useQueryClient()
  const showToast = useUiStore(state => state.showToast)
  const [tab, setTab] = useState(view === 'settings' ? 'subscriptions' : 'opportunities')
  const [q, setQ] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [savedFilter, setSavedFilter] = useState('all')
  const [sort, setSort] = useState<ProcurementOpportunitySort>('relevance_desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [subscriptionOpen, setSubscriptionOpen] = useState(false)
  const [editing, setEditing] = useState<ProcurementSubscription | null>(null)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [subscriptionForm] = Form.useForm()
  const [connectionForm] = Form.useForm()

  const providers = useQuery({ queryKey: ['procurement-providers'], queryFn: procurementApi.providers })
  const subscriptions = useQuery({ queryKey: ['procurement-subscriptions'], queryFn: procurementApi.subscriptions, enabled: view === 'acquisition' })
  const opportunities = useQuery({ queryKey: ['procurement-opportunities', q, providerFilter, savedFilter, sort, page, pageSize], queryFn: () => procurementApi.opportunities({ q: q || undefined, provider: providerFilter === 'all' ? undefined : providerFilter as ProcurementProvider, saved: savedFilter === 'all' ? undefined : savedFilter === 'saved', sort, page, pageSize }), enabled: view === 'acquisition' })

  const refresh = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['procurement-providers'] }),
    queryClient.invalidateQueries({ queryKey: ['procurement-subscriptions'] }),
    queryClient.invalidateQueries({ queryKey: ['procurement-opportunities'] }),
  ])
  const run = useMutation({
    mutationFn: procurementApi.sync,
    onSuccess: async result => { await refresh(); showToast(`同步完成：新增 ${result.created} 条，更新 ${result.updated} 条；结果已进入 AI 获客`) },
    onError: error => showToast(error instanceof Error ? error.message : '同步失败'),
  })

  const openSubscription = (item?: ProcurementSubscription) => {
    setEditing(item ?? null)
    subscriptionForm.setFieldsValue(item ? { ...item, keywords: item.keywords.join('，'), regions: item.regions.join('，'), noticeTypes: item.noticeTypes.join('，') } : { provider: 'ted', enabled: true })
    setSubscriptionOpen(true)
  }
  const saveSubscription = async () => {
    try {
      const values = await subscriptionForm.validateFields()
      const payload = { name: values.name, provider: values.provider as ProcurementProvider, keywords: parseList(values.keywords), regions: parseList(values.regions), noticeTypes: parseList(values.noticeTypes), enabled: Boolean(values.enabled) }
      if (editing) await procurementApi.updateSubscription(editing.id, payload)
      else await procurementApi.createSubscription(payload)
      setSubscriptionOpen(false); setEditing(null); subscriptionForm.resetFields(); await refresh(); showToast(editing ? '采购订阅已更新' : '采购订阅已创建')
    } catch (error) { if (error instanceof Error) showToast(error.message) }
  }
  const saveConnection = async () => {
    try {
      const values = await connectionForm.validateFields()
      const selected = values.provider as 'sam-gov' | 'ungm'
      await integrationApi.create({ category: 'procurement', provider: selected, secret: values.secret, name: selected === 'sam-gov' ? 'SAM.gov Opportunities' : 'UNGM Notices' })
      setConnectionOpen(false); connectionForm.resetFields(); await refresh(); showToast('采购数据源已安全保存')
    } catch (error) { if (error instanceof Error) showToast(error.message) }
  }

  const opportunityItems = opportunities.data?.items ?? []
  const setOpportunitySort = (value: ProcurementOpportunitySort) => { setSort(value); setPage(1) }
  const sortIcon = (active: boolean, descending = false) => <span className="table-sort-indicator" data-sort-active={active} aria-hidden="true">{active ? descending ? <ArrowDown/> : <ArrowUp/> : <ArrowUpDown/>}</span>
  const bulkSave = async () => {
    setBulkPending(true)
    try {
      await Promise.all([...selected].map(id => procurementApi.save(id)))
      const count = selected.size
      setSelected(new Set())
      await refresh()
      showToast(`已将 ${count} 个采购方保存至客户库，并创建跟进任务`)
    } catch (error) { showToast(error instanceof Error ? error.message : '批量保存失败') }
    finally { setBulkPending(false) }
  }
  const bulkDismiss = async () => {
    setBulkPending(true)
    try {
      await Promise.all([...selected].map(id => procurementApi.dismiss(id)))
      const count = selected.size
      setSelected(new Set())
      await refresh()
      showToast(`已忽略 ${count} 条采购机会`)
    } catch (error) { showToast(error instanceof Error ? error.message : '批量忽略失败') }
    finally { setBulkPending(false) }
  }

  const opportunityRows = opportunityItems.map(item => ({ key: item.id, className: selected.has(item.id) ? 'selected' : '', cells: [
    <Checkbox key="select" disabled={!canWrite} aria-label={`选择 ${item.title}`} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next })}/>,
    <Space orientation="vertical" size={2} key="title"><Typography.Text strong ellipsis={{ tooltip: item.title }}>{item.title}</Typography.Text><Space size={6}><Typography.Text type="secondary" ellipsis={{ tooltip: item.externalId }}>{item.externalId}</Typography.Text>{item.saved ? <Badge tone="green">已跟进</Badge> : null}</Space></Space>,
    <Space orientation="vertical" size={2} key="buyer"><Typography.Text strong ellipsis={{ tooltip: item.buyer }}>{item.buyer}</Typography.Text><Typography.Text type="secondary">{item.country || '地区未公布'}</Typography.Text></Space>,
    <Badge tone={item.relevanceScore >= 75 ? 'green' : item.relevanceScore >= 55 ? 'blue' : 'neutral'} key="score">{item.relevanceScore} 分</Badge>,
    <Space orientation="vertical" size={2} key="provider"><Typography.Text strong>{providerNames[item.provider]}</Typography.Text><Typography.Text type="secondary">{item.noticeType || '公告'}</Typography.Text></Space>,
    <Space orientation="vertical" size={2} key="deadline"><Typography.Text strong>{item.deadlineAt ? new Date(item.deadlineAt).toLocaleDateString('zh-CN') : '截止时间未公布'}</Typography.Text><Typography.Text type="secondary">发布 {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-CN') : '时间未公布'}</Typography.Text></Space>,
    <Space key="actions">
      <Button size="sm" variant={item.saved ? 'primary' : 'secondary'} disabled={!canWrite||item.saved} onClick={async () => { await procurementApi.save(item.id); await refresh(); showToast('采购方已保存至客户库，并创建跟进任务') }} icon={<Bookmark size={14}/>}>{item.saved ? '已跟进' : '保存并跟进'}</Button>
      <Button size="sm" ariaLabel={`查看原文：${item.title}`} title="查看原文" type="link" href={item.sourceUrl} target="_blank" rel="noreferrer" icon={<ExternalLink size={14}/>}/>
      {canWrite&&<Popconfirm title="忽略这条机会？" description="忽略后不再显示，可通过重新同步保留来源记录。" onConfirm={async () => { await procurementApi.dismiss(item.id); setSelected(current => { const next = new Set(current); next.delete(item.id); return next }); await refresh(); showToast('采购机会已忽略') }}><Button size="sm" ariaLabel={`忽略：${item.title}`} title="忽略" icon={<Trash2 size={14}/>} /></Popconfirm>}
    </Space>,
  ] }))

  const opportunityContent = opportunities.isError
    ? <PageState status="error" title="采购机会加载失败" description={opportunities.error instanceof Error ? opportunities.error.message : undefined} onRetry={() => opportunities.refetch()}/>
    : <Panel>
      <TableToolbar filters={<>
        <SearchInput ariaLabel="搜索采购机会" value={q} onChange={event => { setQ(event.target.value); setPage(1) }} placeholder="搜索标题、采购方或说明"/>
        <CustomSelect ariaLabel="采购来源" value={providerFilter} onChange={value => { setProviderFilter(value); setPage(1) }} options={[{ value: 'all', label: '全部来源' }, ...Object.entries(providerNames).map(([value, label]) => ({ value, label }))]}/>
        <CustomSelect ariaLabel="跟进状态" value={savedFilter} onChange={value => { setSavedFilter(value); setPage(1) }} options={[{ value: 'all', label: '全部状态' }, { value: 'saved', label: '已跟进' }, { value: 'unsaved', label: '未跟进' }]}/>
        <CustomSelect ariaLabel="采购机会排序" value={sort} onChange={value => setOpportunitySort(value as ProcurementOpportunitySort)} options={[{ value: 'relevance_desc', label: '相关度最高' }, { value: 'relevance_asc', label: '相关度最低' }, { value: 'deadline_asc', label: '截止时间最近' }, { value: 'deadline_desc', label: '截止时间最远' }, { value: 'published_desc', label: '发布时间最新' }, { value: 'published_asc', label: '发布时间最早' }, { value: 'buyer_asc', label: '采购方 A–Z' }, { value: 'title_asc', label: '机会名称 A–Z' }]}/>
        <Button disabled={!q && providerFilter === 'all' && savedFilter === 'all' && sort === 'relevance_desc'} onClick={() => { setQ(''); setProviderFilter('all'); setSavedFilter('all'); setSort('relevance_desc'); setPage(1) }}>清除筛选</Button>
      </>} selection={selected.size > 0 ? <SelectionBar count={selected.size} unit="条机会" actions={<><Button loading={bulkPending} onClick={bulkSave}><Bookmark/>批量保存并跟进</Button><Popconfirm title={`忽略所选 ${selected.size} 条机会？`} description="忽略后不再显示，但来源记录仍会保留。" onConfirm={bulkDismiss}><Button variant="danger" disabled={bulkPending}><Trash2/>批量忽略</Button></Popconfirm><Button ariaLabel="取消选择" title="取消选择" onClick={() => setSelected(new Set())}><X/></Button></>}/> : undefined}/>
      <DataTable ariaLabel="招标采购机会表格" loading={opportunities.isLoading} columns={[
        { key: 'select', title: <Checkbox disabled={!canWrite} aria-label="选择本页全部采购机会" checked={opportunityItems.length > 0 && opportunityItems.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); opportunityItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next })}/>, width: 52, fixed: 'left' },
        { key: 'title', title: <Button onClick={() => setOpportunitySort(sort === 'title_asc' ? 'title_desc' : 'title_asc')}>采购机会{sortIcon(sort === 'title_asc' || sort === 'title_desc', sort === 'title_desc')}</Button>, kind: 'primary', width: 330, fixed: 'left' },
        { key: 'buyer', title: <Button onClick={() => setOpportunitySort(sort === 'buyer_asc' ? 'buyer_desc' : 'buyer_asc')}>采购方与地区{sortIcon(sort === 'buyer_asc' || sort === 'buyer_desc', sort === 'buyer_desc')}</Button>, width: 240 },
        { key: 'score', title: <Button onClick={() => setOpportunitySort(sort === 'relevance_desc' ? 'relevance_asc' : 'relevance_desc')}>相关度{sortIcon(sort === 'relevance_desc' || sort === 'relevance_asc', sort === 'relevance_desc')}</Button>, kind: 'metric', width: 130 },
        { key: 'source', title: '来源与类型', width: 180 },
        { key: 'deadline', title: <Button onClick={() => setOpportunitySort(sort === 'deadline_asc' ? 'deadline_desc' : 'deadline_asc')}>公告与截止{sortIcon(sort === 'deadline_asc' || sort === 'deadline_desc', sort === 'deadline_desc')}</Button>, kind: 'time', width: 190 },
        { key: 'actions', title: '操作', kind: 'actions', width: 210, fixed: 'right' },
      ]} rows={opportunityRows} minWidth={1332}/>
      <Pagination page={page} pageSize={pageSize} total={opportunities.data?.total ?? 0} onPageChange={setPage} onPageSizeChange={value => { setPageSize(value); setPage(1) }} itemName="条机会"/>
    </Panel>

  const subscriptionContent = subscriptions.isError ? <PageState status="error" title="采购订阅加载失败" onRetry={() => subscriptions.refetch()}/> : <Card>
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {(subscriptions.data?.items ?? []).length === 0 && !subscriptions.isLoading ? <PageState status="empty" title="尚未创建采购订阅" description="按产品或服务关键词、地区和公告类型创建订阅。"/> : null}
      {(subscriptions.data?.items ?? []).map(item => <Card size="small" key={item.id} title={<Space><Typography.Text strong>{item.name}</Typography.Text><Tag>{providerNames[item.provider]}</Tag>{item.enabled ? <Tag color="green">已启用</Tag> : <Tag>已停用</Tag>}</Space>} extra={<Space><Button size="sm" disabled={!canWrite} loading={run.isPending && run.variables === item.id} onClick={() => run.mutate(item.id)} icon={<RefreshCw size={14}/>}>同步</Button><Button size="sm" disabled={!canWrite} onClick={() => openSubscription(item)} icon={<Settings2 size={14}/>}>编辑</Button>{canDelete&&<Popconfirm title="删除该采购订阅？" onConfirm={async () => { await procurementApi.removeSubscription(item.id); await refresh(); showToast('采购订阅已删除') }}><Button size="sm" danger icon={<Trash2 size={14}/>}>删除</Button></Popconfirm>}</Space>}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[{ key: 'keywords', label: '关键词', children: item.keywords.join('、') }, { key: 'regions', label: '地区', children: item.regions.join('、') || '不限' }, { key: 'sync', label: '最近同步', children: formatTime(item.lastSyncAt) }, { key: 'status', label: '状态', children: item.lastSyncStatus === 'error' ? <Typography.Text type="danger">{item.lastError || '同步失败'}</Typography.Text> : item.lastSyncStatus === 'success' ? '同步成功' : '等待首次同步' }]}/>
      </Card>)}
    </Space>
  </Card>

  const sourceContent = providers.isLoading
    ? <PageState status="loading" title="正在读取采购数据源"/>
    : providers.isError
      ? <PageState status="error" title="采购数据源加载失败" description={providers.error instanceof Error ? providers.error.message : undefined} onRetry={() => providers.refetch()}/>
      : <List dataSource={providers.data?.items ?? []} renderItem={item => {
        const statusLabel = item.status === 'error' ? '异常' : item.configured ? '可用' : '未配置'
        const requiresCredential = item.provider === 'sam-gov' || item.provider === 'ungm'
        return <List.Item
          className="settings-service-row"
          key={item.provider}
          extra={<Space className="settings-service-row__actions" wrap>
              <Badge tone={statusLabel === '可用' ? 'green' : statusLabel === '异常' ? 'red' : 'neutral'}>{statusLabel}</Badge>
              <Typography.Text type="secondary">{requiresCredential ? item.configured ? '凭据已保存' : '需要访问凭据' : '无需密钥'}</Typography.Text>
              {requiresCredential&&<Button size="sm" disabled={!canManageSettings} onClick={() => { connectionForm.setFieldsValue({ provider: item.provider }); setConnectionOpen(true) }}>{item.configured?'更新凭据':'配置'}</Button>}
              {item.sourceUrl&&<Button size="sm" type="link" href={item.sourceUrl} target="_blank" icon={<ExternalLink size={14}/>}>官方页面</Button>}
            </Space>}
        >
          <List.Item.Meta
            avatar={<Avatar icon={<Landmark size={19}/>}/>}
            title={<Typography.Text strong>{item.name}</Typography.Text>}
            description={<Typography.Text type="secondary">{item.note}</Typography.Text>}
          />
        </List.Item>
      }}/>

  return <PageContainer>
    {!embedded&&<PageHeader title="招标采购" description="统一订阅和评估官方采购公告；确认机会后自动进入客户与任务闭环。" actions={<Button variant="primary" disabled={!canWrite} onClick={() => openSubscription()} icon={<Plus size={16}/>}>创建订阅</Button>}/>}
    <StatusNotice
      tone="info"
      icon={<Landmark size={17}/>}
      title="官方采购数据源"
      description="TED 与 World Bank 可直接使用；SAM.gov 和 UNGM 需要在数据源状态中补充访问凭据。"
    />
    {view === 'settings' ? sourceContent : <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'opportunities', label: `采购机会（${opportunities.data?.total ?? 0}）`, children: opportunityContent }, { key: 'subscriptions', label: `订阅（${subscriptions.data?.items.length ?? 0}）`, children: subscriptionContent }, { key: 'sources', label: '数据源状态', children: sourceContent }]}/>}

    <Modal open={subscriptionOpen} title={editing ? '编辑采购订阅' : '创建采购订阅'} description="设置官方来源、采购关键词与目标地区，系统将按订阅持续同步机会。" onClose={() => setSubscriptionOpen(false)} footer={<><Button onClick={() => setSubscriptionOpen(false)}>取消</Button><Button variant="primary" onClick={saveSubscription}>保存</Button></>}>
      <Form form={subscriptionForm} layout="vertical" requiredMark="optional">
        <Form.Item name="name" label="订阅名称" rules={[{ required: true, message: '请输入订阅名称' }]}><Input autoFocus placeholder="例如：欧洲企业软件采购"/></Form.Item>
        <Form.Item name="provider" label="官方来源" rules={[{ required: true }]}><CustomSelect ariaLabel="官方来源" options={Object.entries(providerNames).map(([value, label]) => ({ value, label }))}/></Form.Item>
        <Form.Item name="keywords" label="产品或服务关键词" rules={[{ required: true, message: '至少填写一个关键词' }]} extra="多个关键词用逗号或换行分隔"><Input.TextArea rows={3} placeholder="software，consulting，industrial automation"/></Form.Item>
        <Form.Item name="regions" label="地区代码" extra="TED 推荐 ISO 三字码（如 DEU、FRA）；SAM.gov 州筛选使用两字码"><Input placeholder="DEU，FRA"/></Form.Item>
        <Form.Item name="noticeTypes" label="公告类型"><Input placeholder="RFQ，RFP，Invitation to Bid"/></Form.Item>
        <Form.Item name="enabled" label="启用订阅" valuePropName="checked"><Switch/></Form.Item>
      </Form>
    </Modal>

    <Modal open={connectionOpen} title="配置采购数据源" description="保存官方接口访问凭据，用于同步对应采购公告。" onClose={() => setConnectionOpen(false)} footer={<><Button onClick={() => setConnectionOpen(false)}>取消</Button><Button variant="primary" onClick={saveConnection}>加密保存</Button></>}>
      <Form form={connectionForm} layout="vertical" requiredMark="optional">
        <Form.Item name="provider" label="数据源" rules={[{ required: true }]}><CustomSelect ariaLabel="采购数据源" options={[{ value: 'sam-gov', label: 'SAM.gov Public API' }, { value: 'ungm', label: 'UNGM Notices API' }]}/></Form.Item>
        <Form.Item name="secret" label="API Key / OAuth 令牌" rules={[{ required: true, message: '请输入访问凭据' }]}><Input.Password autoComplete="new-password" placeholder="仅加密存储，不会在页面回显"/></Form.Item>
      </Form>
    </Modal>
  </PageContainer>
}
