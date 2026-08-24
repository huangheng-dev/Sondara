import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Bot, BriefcaseBusiness, CalendarPlus, CheckCircle2, Clock3, Globe2, Mail, MessageCircle, MoreHorizontal, RadioTower, Send, Sparkles, UserRound, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useUiStore } from '@/stores/ui-store'
import { Modal } from '@/components/ui/Modal'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { authApi, dealApi, inboxApi, taskApi, type InboxMessageApiRecord, type InboxThreadApiRecord } from '@/lib/api'
import { Alert, Card, Col, Descriptions, Flex, Input, List, Row, Segmented, Space, Timeline, Typography } from 'antd'
import { PageContainer } from '@/components/ui/PageModules'

type InboxFilter = '全部' | '未读' | '高意向' | '待跟进'
type DialogName = 'quick' | 'timeline' | 'deal' | 'task' | 'confirm' | null
const filterToApi: Record<InboxFilter, 'all' | 'unread' | 'high_intent' | 'follow_up'> = { 全部: 'all', 未读: 'unread', 高意向: 'high_intent', 待跟进: 'follow_up' }
const formatTime = (value: number) => {
  const date = new Date(value)
  const today = new Date()
  const day = 86_400_000
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (today.getTime() - date.getTime() < day * 2) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
const messageStatus = (message: InboxMessageApiRecord) => message.status === 'confirmed' ? '已确认 · 待渠道接入' : message.status === 'delivered' ? '已送达' : message.status === 'sent' ? '已发送' : message.status === 'failed' ? '发送失败' : message.status === 'received' ? message.channel : message.status

export function InboxPage() {
  const [activeId, setActiveId] = useState('')
  const [reply, setReply] = useState('')
  const [, setMobileConversation] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<InboxFilter>('全部')
  const [channelFilter, setChannelFilter] = useState('全部渠道')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogName>(null)
  const threadListRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const threadBodyRef = useRef<HTMLDivElement>(null)
  const showToast = useUiStore(state => state.showToast)
  const queryClient = useQueryClient()
  const authSession = useQuery({ queryKey: ['auth-session'], queryFn: authApi.session, retry: false })

  const threadsQuery = useInfiniteQuery({
    queryKey: ['inbox-threads', authSession.data?.workspace.id, deferredQuery, filter, channelFilter],
    queryFn: ({ pageParam }) => inboxApi.listThreads({ q: deferredQuery || undefined, channel: channelFilter, filter: filterToApi[filter], cursor: typeof pageParam === 'string' ? pageParam : undefined, limit: 4 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    enabled: Boolean(authSession.data?.workspace.id),
    retry: 1,
  })
  const threads = useMemo(() => threadsQuery.data?.pages.flatMap(page => page.items) ?? [], [threadsQuery.data])
  const threadMeta = threadsQuery.data?.pages[0]
  const activeThread = threads.find(thread => thread.id === activeId) ?? threads[0]

  useEffect(() => {
    if (!activeId && threads[0]) setActiveId(threads[0].id)
    else if (activeId && threads.length && !threads.some(thread => thread.id === activeId)) setActiveId(threads[0]!.id)
  }, [activeId, threads])
  useEffect(() => {
    const target = loadMoreRef.current
    const root = threadListRef.current
    if (!target || !root || !threadsQuery.hasNextPage || threadsQuery.isFetchingNextPage) return
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) void threadsQuery.fetchNextPage() }, { root, rootMargin: '120px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [threadsQuery.hasNextPage, threadsQuery.isFetchingNextPage, threadsQuery.fetchNextPage])

  const messagesQuery = useInfiniteQuery({
    queryKey: ['inbox-messages', activeThread?.id],
    queryFn: ({ pageParam }) => inboxApi.listMessages(activeThread!.id, { cursor: typeof pageParam === 'string' ? pageParam : undefined, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    enabled: Boolean(activeThread?.id),
    retry: 1,
  })
  const threadMessages = useMemo(() => messagesQuery.data?.pages.slice().reverse().flatMap(page => page.items) ?? [], [messagesQuery.data])
  useEffect(() => {
    if (!activeThread?.id) return
    if (activeThread.unreadCount > 0) void inboxApi.markRead(activeThread.id).then(() => queryClient.invalidateQueries({ queryKey: ['inbox-threads'] }))
    const timer = window.setTimeout(() => { if (threadBodyRef.current) threadBodyRef.current.scrollTop = threadBodyRef.current.scrollHeight }, 80)
    return () => window.clearTimeout(timer)
  }, [activeThread?.id])

  const dealQuery = useQuery({ queryKey: ['deals', authSession.data?.workspace.id], queryFn: () => dealApi.list({ pageSize: 100 }), enabled: Boolean(authSession.data?.workspace.id), retry: 1 })
  const converted = useMemo(() => new Set(dealQuery.data?.items.map(deal => deal.company) ?? []), [dealQuery.data])
  const channelOptions = useMemo(() => ['全部渠道', ...(threadMeta?.channels ?? [])].map(item => ({ value: item, label: item, icon: item === '全部渠道' ? <RadioTower /> : item === '邮件' ? <Mail /> : item === 'LinkedIn' ? <BriefcaseBusiness /> : item === '网站表单' ? <Globe2 /> : <MessageCircle /> })), [threadMeta?.channels])

  const markAllMutation = useMutation({
    mutationFn: inboxApi.markAllRead,
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['inbox-threads'] }); showToast('全部消息已标记为已读') },
    onError: cause => showToast(cause instanceof Error ? cause.message : '标记失败'),
  })
  const replyMutation = useMutation({
    mutationFn: () => inboxApi.confirmReply(activeThread!.id, reply.trim()),
    onSuccess: async result => {
      setReply('')
      setDialog(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['inbox-messages', activeThread?.id] }), queryClient.invalidateQueries({ queryKey: ['inbox-threads'] }), queryClient.invalidateQueries({ queryKey: ['customers'] })])
      showToast(result.delivery.label)
      window.setTimeout(() => { if (threadBodyRef.current) threadBodyRef.current.scrollTop = threadBodyRef.current.scrollHeight }, 100)
    },
    onError: cause => showToast(cause instanceof Error ? cause.message : '回复确认失败'),
  })

  const openThread = (thread: InboxThreadApiRecord) => {
    setActiveId(thread.id)
    setMobileConversation(true)
  }
  const openConfirm = () => {
    if (!reply.trim()) return showToast('请先输入回复内容')
    setDialog('confirm')
  }
  const tone = activeThread?.intent === '高意向' ? 'green' : activeThread?.intent === '待跟进' ? 'orange' : 'blue'

  return <PageContainer>
    <PageHeader title="客户消息" description="统一处理客户回复、判断意向，并把确认后的对话转成明确的跟进动作。" actions={<Button disabled={!threadMeta?.unreadTotal || markAllMutation.isPending} onClick={() => markAllMutation.mutate()}><CheckCircle2 size={16} />{markAllMutation.isPending ? '正在处理…' : `全部已读${threadMeta?.unreadTotal ? ` · ${threadMeta.unreadTotal}` : ''}`}</Button>} />
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={7}>
        <Card className="inbox-list-card" title="消息列表" extra={threadMeta?.total ? `${threadMeta.total} 条` : undefined}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <SearchInput ariaLabel="搜索消息" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索联系人、企业或内容" />
            <Flex wrap gap={8}><CustomSelect ariaLabel="消息渠道" value={channelFilter} onChange={setChannelFilter} options={channelOptions} /><Segmented aria-label="消息状态" value={filter} options={['全部', '未读', '高意向', '待跟进']} onChange={value=>setFilter(value as InboxFilter)}/></Flex>
          </Space>
          <div ref={threadListRef} style={{ marginTop: 16 }}>
            {threadsQuery.isError ? <EmptyState title="消息加载失败" action={<Button onClick={() => threadsQuery.refetch()}>重新加载</Button>}/> : <List loading={threadsQuery.isLoading} dataSource={threads} locale={{emptyText:<EmptyState title="暂无消息" description="客户回复进入连接渠道后，会集中显示在这里。" icon={MessageCircle}/>}} renderItem={thread=><List.Item className={activeThread?.id===thread.id?'is-active':undefined} onClick={()=>openThread(thread)} style={{ cursor: 'pointer' }}><List.Item.Meta title={<Flex justify="space-between"><Typography.Text strong>{thread.contact.name}</Typography.Text><Typography.Text type="secondary">{formatTime(thread.lastMessageAt)}</Typography.Text></Flex>} description={<Space direction="vertical" size={2}><Typography.Text type="secondary">{thread.contact.company} · {thread.channel}</Typography.Text><Typography.Text ellipsis>{thread.lastMessagePreview}</Typography.Text><Badge tone={thread.intent === '高意向' ? 'green' : thread.intent === '待跟进' ? 'orange' : 'blue'}>{thread.intent}</Badge></Space>}/></List.Item>}/>}
            {threads.length > 0 && <div ref={loadMoreRef} role="status"><Typography.Text type="secondary">{threadsQuery.isFetchingNextPage ? '正在加载更多…' : threadsQuery.hasNextPage ? '继续向下滚动加载' : '已加载全部消息'}</Typography.Text></div>}
          </div>
        </Card>
      </Col>
      <Col xs={24} xl={activeThread&&detailsOpen?11:17}>
        <Card className="inbox-conversation-card" title={activeThread ? `${activeThread.contact.name} · ${activeThread.contact.company}` : '对话'} extra={activeThread&&<Space><Badge tone={tone}>{activeThread.intent}</Badge><Button aria-label="查看客户详情" onClick={() => setDetailsOpen(true)}><UserRound /></Button></Space>}>
          {activeThread ? <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Flex justify="center">{messagesQuery.hasNextPage && <Button disabled={messagesQuery.isFetchingNextPage} onClick={() => messagesQuery.fetchNextPage()}>{messagesQuery.isFetchingNextPage ? '正在加载…' : '加载更早消息'}</Button>}</Flex>
            <div ref={threadBodyRef}>{messagesQuery.isError ? <EmptyState title="对话加载失败" action={<Button onClick={() => messagesQuery.refetch()}>重试</Button>}/> : <List loading={messagesQuery.isLoading} dataSource={threadMessages} locale={{emptyText:<EmptyState title="线程暂无消息" icon={MessageCircle}/>}} renderItem={message=><List.Item><List.Item.Meta title={message.direction==='inbound'?'客户回复':'主动触达'} description={<><Typography.Paragraph>{message.body}</Typography.Paragraph><Typography.Text type="secondary">{formatTime(message.createdAt)} · {messageStatus(message)}</Typography.Text></>}/></List.Item>}/>}</div>
            <Card size="small" title={<Space><Sparkles/>AI 意向判断：{activeThread.intent}</Space>}><Typography.Text type="secondary">{activeThread.intent === '高意向' ? '客户提出具体资料或沟通需求，建议在 4 小时内回复。' : '需要结合下一次回复继续判断需求与采购时机。'}</Typography.Text></Card>
            <Flex wrap gap={8}><Button onClick={() => setReply('您好，感谢您的回复。我们已经整理好相关项目案例与验证资料摘要，请确认接收方式。')}><Mail />发送资料</Button><Button onClick={() => setReply('您好，建议本周安排一次 20 分钟技术交流，您周四或周五方便吗？')}><CalendarPlus />安排会议</Button><Button onClick={() => setDialog('quick')}><MoreHorizontal />更多</Button></Flex>
            <Input.TextArea rows={5} value={reply} onChange={event => setReply(event.target.value)} maxLength={1000} showCount placeholder="输入回复内容…" aria-label="回复内容" />
            <Flex justify="flex-end" wrap gap={8}><Button onClick={() => setReply(`您好 ${activeThread.contact.name}，感谢回复。我们可以根据贵司的应用场景准备案例、验证文件和交付计划。建议本周安排一次 20 分钟技术交流。`)}><Bot />AI 建议</Button><Button variant="primary" onClick={openConfirm}><Send />预览并确认</Button></Flex>
          </Space> : <EmptyState title="选择一条客户消息" description="选中左侧会话后，可查看上下文、判断意向并创建跟进动作。" icon={MessageCircle}/>}
        </Card>
      </Col>
      {activeThread&&detailsOpen&&<Col xs={24} xl={6}><Card className="inbox-details-card" title="客户信息" extra={<Button aria-label="关闭客户详情" onClick={() => setDetailsOpen(false)}><X /></Button>}><Descriptions column={1} items={[{key:'job',label:'职位',children:activeThread.contact.jobTitle},{key:'region',label:'地区',children:activeThread.contact.region},{key:'source',label:'来源',children:activeThread.contact.source},{key:'channel',label:'渠道',children:activeThread.channel}]}/><Space direction="vertical" style={{ width: '100%', marginTop: 16 }}><Button block onClick={() => setDialog('task')}><CalendarPlus />创建跟进任务</Button><Button block onClick={() => setDialog('timeline')}><Clock3 />查看客户时间线</Button><Button block variant="primary" disabled={converted.has(activeThread.contact.company)} onClick={() => setDialog('deal')}>{converted.has(activeThread.contact.company) ? '已创建商机' : '转为商机'}</Button></Space></Card></Col>}
    </Row>

    <Modal open={dialog === 'quick'} title="更多快捷回复" description="选择后可继续编辑，再由你预览确认。" onClose={() => setDialog(null)}><List dataSource={['感谢回复，我会在今天内整理完整资料发给您。', '为了准备更准确的方案，方便补充一下当前项目时间计划吗？', '收到，我先确认技术资料与交付周期，稍后回复您。']} renderItem={item=><List.Item actions={[<ArrowLeft key="use"/>]} onClick={() => { setReply(item); setDialog(null) }}><Typography.Text>{item}</Typography.Text></List.Item>}/></Modal>
    <Modal open={dialog === 'timeline'} title={`${activeThread?.contact.company ?? ''} · 客户时间线`} description="按时间查看当前已加载的真实对话记录" onClose={() => setDialog(null)}><Timeline items={threadMessages.slice().reverse().map(message=>({children:<Space direction="vertical" size={2}><Typography.Text type="secondary">{new Date(message.createdAt).toLocaleString('zh-CN')}</Typography.Text><Typography.Text strong>{message.direction === 'inbound' ? '客户回复' : message.status === 'confirmed' ? '回复已确认' : '主动触达'}</Typography.Text><Typography.Text>{message.body}</Typography.Text></Space>}))}/></Modal>
    <Modal open={dialog === 'confirm'} title="确认回复内容" description="确认后会写入服务端外发队列，并按当前渠道与连接状态执行。" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)} disabled={replyMutation.isPending}>返回编辑</Button><Button variant="primary" loading={replyMutation.isPending} onClick={() => replyMutation.mutate()}>确认并加入待发送</Button></>}><Space direction="vertical" size="middle" style={{width:'100%'}}><Descriptions column={1} bordered items={[{key:'contact',label:'联系人',children:activeThread?.contact.name},{key:'company',label:'企业与渠道',children:`${activeThread?.contact.company??''} · ${activeThread?.channel??''}`} ]}/><Typography.Paragraph>{reply}</Typography.Paragraph><Alert type="info" showIcon icon={<AlertCircle/>} message="当前交付方式：服务端外发队列" description="邮件会在 SMTP 可用时进入发送队列；其他渠道保留可追踪的待执行记录，不会虚假标记为已送达。"/></Space></Modal>
    <CreateDialog open={dialog === 'task'} title={`创建跟进任务 · ${activeThread?.contact.company ?? ''}`} description="任务会进入经营总览和客户跟进计划。" submitLabel="创建任务" successMessage="跟进任务已创建" onClose={() => setDialog(null)} onSubmit={async values => { await taskApi.create({ customerId: activeThread?.customerId ?? null, title: values.title, priority: values.priority as '高' | '中' | '低', dueAt: Date.parse(values.date), dueLabel: values.date, company: activeThread?.contact.company ?? '客户', nextAction: values.title, source: '客户消息' }); await queryClient.invalidateQueries({ queryKey: ['tasks'] }) }} fields={[{ name: 'title', label: '任务名称', required: true }, { name: 'priority', label: '优先级', type: 'select', required: true, options: ['高', '中', '低'] }, { name: 'date', label: '完成时间', type: 'datetime', required: true }]} />
    <CreateDialog open={dialog === 'deal'} title={`转为商机 · ${activeThread?.contact.company ?? ''}`} description="补齐金额、阶段和下一步，创建后会同步进入商机跟进和客户库。" submitLabel="创建商机" successMessage="已转为销售商机" onClose={() => setDialog(null)} onSubmit={async values => { await dealApi.create({ customerId: activeThread?.customerId ?? null, company: activeThread?.contact.company ?? '', stage: values.stage as '线索确认' | '需求确认' | '方案评估', valueAmount: Number(values.value), currency: values.currency as 'CNY' | 'EUR' | 'USD', ownerLabel: '我', nextAction: values.next, expectedCloseAt: Date.parse(values.date), risk: '新回复商机，待确认需求范围', source: `客户消息 · ${activeThread?.channel ?? ''}` }); await Promise.all([dealQuery.refetch(), queryClient.invalidateQueries({ queryKey: ['customers'] })]) }} fields={[{ name: 'value', label: '预计金额', type: 'number', required: true }, { name: 'currency', label: '币种', type: 'select', required: true, options: ['CNY', 'EUR', 'USD'] }, { name: 'stage', label: '阶段', type: 'select', required: true, options: ['线索确认', '需求确认', '方案评估'] }, { name: 'date', label: '预计成交日', type: 'date', required: true }, { name: 'next', label: '下一步动作', required: true }]} />
  </PageContainer>
}
