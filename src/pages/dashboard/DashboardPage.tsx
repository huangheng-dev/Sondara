import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Database,
  MessageSquareReply,
  Plus,
  Radar,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  Zap,
  Bot,
} from 'lucide-react'
import { useMemo, useState, type UIEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, Col, Descriptions, Flex, Progress, Row, Segmented, Space, Statistic, Steps, Typography } from 'antd'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { List } from '@/components/ui/List'
import { PageContainer, PageState } from '@/components/ui/PageModules'
import { StatusNotice } from '@/components/ui/StatusNotice'
import { useUiStore } from '@/stores/ui-store'
import { authApi, customerApi, dealApi, radarApi, taskApi } from '@/lib/api'

export function DashboardPage() {
  const navigate = useNavigate()
  const showToast = useUiStore(s => s.showToast)
  const [dialog, setDialog] = useState<'calendar'|null>(null)
  const [details,setDetails]=useState<'task'|'suggestion'|null>(null)
  const [activeTask,setActiveTask]=useState<string[]|null>(null)
  const [taskArchiveView,setTaskArchiveView]=useState(false)
  const [visibleTaskCount,setVisibleTaskCount]=useState(8)
  const authSession=useQuery({queryKey:['auth-session'],queryFn:authApi.session,retry:false})
  const workspaceId=authSession.data?.workspace.id
  const canManageWorkspace=['owner','admin'].includes(authSession.data?.workspace.role??'')
  const taskQuery=useQuery({queryKey:['tasks',workspaceId],queryFn:()=>taskApi.list({pageSize:100,sort:'created_desc'}),enabled:Boolean(workspaceId),retry:1})
  const archivedTaskQuery=useQuery({queryKey:['tasks',workspaceId,'archived'],queryFn:()=>taskApi.list({pageSize:100,sort:'created_desc',archivedOnly:true}),enabled:Boolean(workspaceId&&taskArchiveView),retry:1})
  const customerQuery=useQuery({queryKey:['customers',workspaceId],queryFn:()=>customerApi.list({pageSize:100,sort:'updated_desc'}),enabled:Boolean(workspaceId),retry:1})
  const customerSummaryQuery=useQuery({queryKey:['customers-summary',workspaceId],queryFn:customerApi.summary,enabled:Boolean(workspaceId),retry:1})
  const dealQuery=useQuery({queryKey:['deals',workspaceId],queryFn:()=>dealApi.list({pageSize:100,sort:'updated_desc'}),enabled:Boolean(workspaceId),retry:1})
  const automationQuery=useQuery({queryKey:['radar-automation-brief',workspaceId],queryFn:radarApi.automationBrief,enabled:Boolean(workspaceId),retry:1,refetchInterval:30_000})
  const automation=automationQuery.data
  const activeTaskRecords=taskQuery.data?.items??[]
  const pendingTasks=useMemo(()=>activeTaskRecords.filter(task=>task.status==='open'),[activeTaskRecords])
  const taskRecords=taskArchiveView?(archivedTaskQuery.data?.items??[]):pendingTasks
  const customers=customerQuery.data?.items??[]
  const deals=dealQuery.data?.items??[]
  const isLoading = taskQuery.isLoading || customerQuery.isLoading || customerSummaryQuery.isLoading || dealQuery.isLoading
  const isError = taskQuery.isError || customerQuery.isError || customerSummaryQuery.isError || dealQuery.isError
  const taskItems=useMemo(()=>taskRecords.map(task=>[task.priority,task.title,task.dueLabel,task.company,task.nextAction,task.impact,task.id,task.actionPath??'']),[taskRecords])
  const visibleTaskItems=taskItems.slice(0,visibleTaskCount)
  const dueToday=pendingTasks.filter(task=>task.dueLabel.includes('今天'))
  const highPriority=pendingTasks.filter(task=>task.priority==='高')
  const activeDeals=deals.filter(deal=>!['赢单','输单'].includes(deal.stage))
  const wonDeals=deals.filter(deal=>deal.stage==='赢单')
  const riskDeals=deals.filter(deal=>Math.floor((Date.now()-deal.stageEnteredAt)/86_400_000)>=14)
  const highIntentCustomers=customers.filter(customer=>customer.stage==='重点跟进'||customer.stage==='有商机')
  const incompleteCustomers=customers.filter(customer=>customer.stage==='待补全'||customer.validContacts===0)
  const customerSummary=customerSummaryQuery.data??{total:customers.length,researched:0,contacted:0,replied:0,opportunities:0,won:0,incomplete:incompleteCustomers.length,highIntent:highIntentCustomers.length}
  const focusCustomer=highIntentCustomers[0]??incompleteCustomers[0]??customers[0]??null
  const focusCompany=focusCustomer?.company??'重点客户'
  const focusAction=focusCustomer?.nextAction??'补全联系人并确认下一次沟通安排'
  const pulseHeadline = highPriority.length > 0 || highIntentCustomers.length > 0
    ? `先处理 ${highPriority.length} 项高优先事项，再推进 ${highIntentCustomers.length} 家重点客户`
    : customers.length > 0
      ? '当前无高优先事项，继续补全客户资料并推进有效触达'
      : '从创建获客任务开始，建立第一批可跟进客户'
  const metrics = [
    {label:'待推进事项',value:String(pendingTasks.length),detail:`${dueToday.length} 项今天到期`,icon:CheckCircle2,tone:'blue',change:dueToday.length>0?`${dueToday.length} 项今天到期`:'暂无到期',progress:Math.min(100,pendingTasks.length*5)},
    {label:'高优先事项',value:String(highPriority.length),detail:'需要优先处理',icon:Zap,tone:'violet',change:highPriority.length>0?'需聚焦':'无高优先',progress:Math.min(100,highPriority.length*10)},
    {label:'活跃商机',value:String(activeDeals.length),detail:`${riskDeals.length} 项存在停滞风险`,icon:Target,tone:'orange',change:wonDeals.length>0?`已赢 ${wonDeals.length} 单`:'暂无赢单',progress:Math.min(100,activeDeals.length*8)},
    {label:'重点客户',value:String(highIntentCustomers.length),detail:`${customerSummary.incomplete} 家资料待补全`,icon:UsersRound,tone:'green',change:`${customerSummary.contacted} 家已真实触达`,progress:Math.min(100,customerSummary.total>0?Math.round((customerSummary.contacted/customerSummary.total)*100):0)},
  ]
  const workstreams=[
    {label:'客户发现',detail:'已进入正式客户库',value:String(customerSummary.total),unit:'家客户',progress:Math.min(100,customerSummary.total*2),icon:Radar,path:'/radar',tone:'blue'},
    {label:'客户研究',detail:'已有有效联系人',value:String(customerSummary.researched),unit:'家已研究',progress:Math.min(100,customerSummary.total>0?Math.round((customerSummary.researched/customerSummary.total)*100):0),icon:Database,path:'/customers',tone:'violet'},
    {label:'营销触达',detail:`${customerSummary.replied} 家已回复`,value:String(customerSummary.contacted),unit:'家已触达',progress:Math.min(100,customerSummary.total>0?Math.round((customerSummary.contacted/customerSummary.total)*100):0),icon:MessageSquareReply,path:'/inbox',tone:'cyan'},
    {label:'商机推进',detail:'方案评估与成交',value:String(activeDeals.length),unit:'个活跃',progress:Math.min(100,deals.length>0?Math.round((wonDeals.length/deals.length)*100):0),icon:TrendingUp,path:'/pipeline',tone:'green'},
  ]
  const attentionItems = [
    {title:highIntentCustomers.length>0?'重点客户待跟进':incompleteCustomers.length>0?'客户资料待补全':focusCustomer?'下一位客户待推进':'建立第一批客户',detail:focusCustomer?`${focusCompany} · ${focusAction}`:'暂无客户，可先从雷达发现候选',count:focusCustomer?'今天':'0',tone:'orange' as const,icon:MessageSquareReply,path:focusCustomer?'/customers':'/radar'},
    {title:'商机停滞风险',detail:`${riskDeals.length} 个商机超过 14 天未推进`,count:String(riskDeals.length),tone:'red' as const,icon:AlertTriangle,path:'/pipeline'},
    {title:'客户资料待补全',detail:'缺少联系人或有效联系方式',count:String(incompleteCustomers.length),tone:'blue' as const,icon:UsersRound,path:'/customers'},
  ]
  const markComplete=async(id:string)=>{const task=taskRecords.find(item=>item.id===id);if(task){await taskApi.update(task.id,{status:'completed'});await taskQuery.refetch()}}
  const restoreTask=async(id:string)=>{await taskApi.archive(id,false);await Promise.all([taskQuery.refetch(),archivedTaskQuery.refetch()])}
  const loadMoreTasks=(event:UIEvent<HTMLDivElement>)=>{
    const {scrollTop,clientHeight,scrollHeight}=event.currentTarget
    if(scrollHeight-scrollTop-clientHeight<64&&visibleTaskCount<taskItems.length){setVisibleTaskCount(count=>Math.min(count+8,taskItems.length))}
  }

  if (isLoading) {
    return <PageContainer>
      <PageHeader title="经营总览" description="聚焦经营结果、增长进度与今天真正需要处理的行动。" />
      <PageState status="loading" loadingVariant="page" title="正在加载经营数据…" description="正在读取客户、任务和商机数据。"/>
    </PageContainer>
  }

  if (isError) {
    return <PageContainer>
      <PageHeader title="经营总览" description="聚焦经营结果、增长进度与今天真正需要处理的行动。" />
      <PageState status="error" title="经营数据加载失败" description="请检查网络连接和 API 服务后重试。" onRetry={() => { taskQuery.refetch(); customerQuery.refetch(); dealQuery.refetch(); }}/>
    </PageContainer>
  }

  return <PageContainer>
    <PageHeader title="经营总览" description="聚焦经营结果、增长进度与今天真正需要处理的行动。" actions={<>
      <Button onClick={() => setDialog('calendar')}><CalendarPlus size={16} />日程</Button>
      <Button onClick={() => navigate('/radar?create=1')} variant="primary"><Plus size={16} />创建获客计划</Button>
    </>} />

    {customers.length===0&&<Card title="开始第一轮获客" extra={<Badge tone="blue">首次使用</Badge>}><Space orientation="vertical" size="large" style={{width:'100%'}}><Typography.Text type="secondary">按照业务目标完成三个步骤，系统才会产生可跟进客户；技术配置可以稍后补充。</Typography.Text><Steps responsive current={0} items={[{title:'确定目标客户',content:'填写业务资料并确认市场'},{title:'准备数据来源',content:'检查搜索、地图或公开网址'},{title:'建立获客计划',content:'系统按周期自动发现新客户'}]}/><Space wrap><Button onClick={()=>navigate('/icp')}>确定目标客户</Button>{canManageWorkspace&&<Button onClick={()=>navigate('/settings/integrations')}>检查集成状态</Button>}<Button variant="primary" onClick={()=>navigate('/radar?create=1')}>创建获客计划</Button></Space></Space></Card>}

    <Panel title="自动获客简报" subtitle="计划运行、今日新增和 AI 健康状态集中呈现" action={<Button size="sm" type="link" onClick={()=>navigate('/radar')}>进入 AI 获客<ArrowRight size={15}/></Button>}>
      <Row gutter={[16,16]} align="middle">
        <Col xs={12} md={6}><Statistic title="自动计划" value={automation?.activePlans??0} suffix="个"/></Col>
        <Col xs={12} md={6}><Statistic title="今日新候选" value={automation?.newCandidatesToday??0} suffix="家"/></Col>
        <Col xs={12} md={6}><Statistic title="今日高匹配" value={automation?.highMatchToday??0} suffix="家"/></Col>
        <Col xs={12} md={6}><Statistic title="正在运行" value={automation?.activeRuns??0} suffix="轮"/></Col>
      </Row>
      <StatusNotice
        className="dashboard-automation-notice"
        tone={automation?.aiReadiness.ready?'success':automation?.aiReadiness.configured?'warning':'info'}
        icon={<Bot size={17}/>}
        title={automation?.aiReadiness.ready?'自动获客运行正常':automation?.aiReadiness.configured?'AI 服务暂不可用':'等待配置 AI 服务'}
        description={automation?.nextRunAt
          ? `${automation.nextPlanName??'获客计划'} · 下次运行 ${new Date(automation.nextRunAt).toLocaleString('zh-CN')}`
          : automation?.activePlans
            ? automation?.aiReadiness.message??'正在检查 AI 与自动获客状态…'
            : '创建计划后，系统会按周期自动发现和研究新客户。'}
        action={<Button size="sm" onClick={()=>navigate(automation?.activePlans?'/radar':'/radar?create=1')}>{automation?.activePlans?'查看计划':'创建计划'}</Button>}
      />
      {automation?.salesGuardian&&<Flex align="center" gap={8} wrap style={{marginTop:12}}><Badge tone={automation.salesGuardian.overdueTasks||automation.salesGuardian.staleDeals?'orange':'green'}>推进守护</Badge><Typography.Text type="secondary">高意向待接管 {automation.salesGuardian.highIntentOpen} 条 · 逾期行动 {automation.salesGuardian.overdueTasks} 项 · 停滞商机 {automation.salesGuardian.staleDeals} 个 · 已自动建立 {automation.salesGuardian.guardianTasks} 项守护任务</Typography.Text></Flex>}
    </Panel>

    <Row className="dashboard-overview" gutter={[16, 16]} aria-label="今日经营摘要">
      <Col xs={24} xl={8}>
        <Card className="dashboard-pulse" title={<Space><Sparkles size={18}/>今日经营脉搏</Space>} extra={<Badge tone="blue">数据已同步</Badge>}>
          <Typography.Title level={2} className="dashboard-pulse__headline">{pulseHeadline}</Typography.Title>
          <Typography.Paragraph type="secondary" className="dashboard-pulse__description">指标按真实客户、有效联系人、实际发送记录、回复和商机数据计算；历史品牌案例不计入当前销售进度。</Typography.Paragraph>
          <Flex className="dashboard-pulse__stats" wrap>
            <Statistic title="今日到期" value={dueToday.length}/>
            <Statistic title="重点客户" value={highIntentCustomers.length}/>
            <Statistic title="风险商机" value={riskDeals.length}/>
          </Flex>
          <Button block className="dashboard-pulse__action" onClick={()=>navigate('/customers')}>进入客户工作台<ArrowUpRight size={16}/></Button>
        </Card>
      </Col>
      <Col xs={24} xl={16}>
        <Row gutter={[16, 16]} aria-label="当前经营状态">
          {metrics.map(({label,value,detail,icon:Icon,tone,change,progress})=><Col xs={24} md={12} key={label}>
            <Card className={`dashboard-metric dashboard-tone--${tone}`}>
              <Flex className="dashboard-metric__heading" align="center" justify="space-between">
                <Flex align="center" gap={10}><span className="dashboard-metric__icon"><Icon size={18}/></span><Typography.Text className="dashboard-metric__label">{label}</Typography.Text></Flex>
                <Typography.Text className="dashboard-metric__change">{change}</Typography.Text>
              </Flex>
              <Statistic value={value}/>
              <Typography.Text type="secondary" className="dashboard-metric__detail">{detail}</Typography.Text>
              <Progress aria-label={`${label}进度`} percent={progress} showInfo={false}/>
            </Card>
          </Col>)}
        </Row>
      </Col>
    </Row>

    <Panel className="dashboard-workflow-panel" title="从客户发现到商机推进" subtitle="聚合本周关键工作流，快速判断当前推进节奏和需要介入的环节。" action={<Button size="sm" type="link" onClick={()=>navigate('/attribution')}>查看转化分析<ArrowRight size={15}/></Button>}>
      <Row gutter={[16, 16]}>
        {workstreams.map(({label,detail,value,unit,progress,icon:Icon,path,tone})=><Col xs={24} sm={12} xl={6} key={label}>
          <Card className={`workflow-card dashboard-tone--${tone}`} size="small" hoverable onClick={()=>navigate(path)}>
            <Flex align="center" justify="space-between">
              <Flex align="center" gap={10}><span className="workflow-card__icon"><Icon size={18}/></span><Typography.Text strong>{label}</Typography.Text></Flex>
              <ArrowRight className="workflow-card__arrow" size={15}/>
            </Flex>
            <Statistic value={value} suffix={unit}/>
            <Typography.Text type="secondary" className="workflow-card__detail">{detail}</Typography.Text>
            <Progress aria-label={`${label}进度`} percent={progress} showInfo={false}/>
          </Card>
        </Col>)}
      </Row>
    </Panel>

    <Row className="dashboard-lower-grid" gutter={[16, 16]}>
      <Col xs={24} xl={16}>
        <Panel className="dashboard-action-panel" title="今日行动清单" subtitle={taskArchiveView?'查看已经归档的历史任务，可随时恢复为待办':'按紧迫度与收入影响排序，完成后自动更新经营状态'} action={<Segmented aria-label="行动清单类型" value={taskArchiveView?'已归档':'待办'} options={['待办','已归档']} onChange={value=>{setTaskArchiveView(value==='已归档');setVisibleTaskCount(8)}}/>}>
          {taskItems.length ? <div className="dashboard-task-scroll" onScroll={loadMoreTasks}>
            <List className="dashboard-task-list" dataSource={visibleTaskItems} renderItem={(t,index)=><List.Item actions={[
              <Badge key="priority" tone={t[0] === '高' ? 'red' : 'orange'}>{t[0]}优先级</Badge>,
              taskArchiveView
                ? <Button key="restore" size="sm" icon={<RotateCcw size={14}/>} onClick={async()=>{try{await restoreTask(t[6]);showToast(`${t[1]}已恢复为待办`)}catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}}}>恢复</Button>
                : <Button key="complete" size="sm" className="dashboard-task-list__complete" icon={<CheckCircle2 size={14}/>} onClick={async()=>{try{await markComplete(t[6]);showToast(`${t[1]}已标记完成`)}catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}}}>完成</Button>,
              <Button key="details" size="sm" ariaLabel={`打开任务：${t[1]}`} title={t[7]?'前往处理':'查看详情'} icon={<ArrowRight size={14}/>} onClick={()=>{if(t[7])navigate(t[7]);else{setActiveTask(t);setDetails('task')}}}/>,
            ]}><List.Item.Meta title={<Typography.Text strong>{`${String(index+1).padStart(2,'0')} · ${t[1]}`}</Typography.Text>} description={<span className="dashboard-task-list__description"><span>{t[3]}</span><span>下一步：{t[4]}</span><span>{t[2]}</span><span>预计影响 {t[5]}</span></span>}/></List.Item>}/>
          </div> : <EmptyState icon={ClipboardList} title={taskArchiveView?'暂无归档任务':'暂无待办事项'} />}
        </Panel>
      </Col>
      <Col xs={24} xl={8}>
        <Panel className="dashboard-attention-panel" title="经营提醒" subtitle="异常、机会和系统建议集中处理">
          <List className="dashboard-attention-list" dataSource={attentionItems} renderItem={({title,detail,count,tone,icon:Icon,path})=><List.Item actions={[<Badge key="count" tone={tone}>{count}</Badge>]}><Button className="attention-link" block type="text" onClick={()=>navigate(path)}><span className={`attention-link__icon dashboard-tone--${tone}`}><Icon size={17}/></span><span className="attention-link__copy"><Typography.Text strong>{title}</Typography.Text><Typography.Text type="secondary">{detail}</Typography.Text></span><ArrowRight size={15}/></Button></List.Item>}/>
          <Card className="dashboard-suggestion" size="small" title={<Space size={8}><Sparkles size={16}/>今日建议</Space>}><Typography.Paragraph>{focusCustomer?`优先推进 ${focusCompany}：${focusAction}，并在完成后记录结果。`:'先创建获客任务并保存高匹配候选，形成可跟进客户。'}</Typography.Paragraph><Button onClick={()=>focusCustomer?setDetails('suggestion'):navigate('/radar?create=1')}>立即处理<ArrowRight size={15}/></Button></Card>
        </Panel>
      </Col>
    </Row>

    <CreateDialog open={dialog === 'calendar'} title="新建日程" description="安排个人跟进和复盘。" submitLabel="添加日程" successMessage="日程已添加" onClose={()=>setDialog(null)} onSubmit={async values=>{await taskApi.create({priority:'中',title:values.title,dueAt:Date.parse(values.date),dueLabel:values.date,company:'个人日程',nextAction:values.note||'按计划执行',impact:'—',source:'日程'});await taskQuery.refetch()}} fields={[{name:'title',label:'日程标题',required:true},{name:'date',label:'日期',type:'date',required:true},{name:'note',label:'备注',type:'textarea'}]} />
    <Modal open={details==='task'} title={activeTask?.[1]??'任务详情'} description={`${activeTask?.[3]??''} · ${activeTask?.[2]??''}`} onClose={()=>setDetails(null)} footer={<><Button onClick={()=>setDetails(null)}>关闭</Button>{activeTask&&<Button variant="primary" onClick={async()=>{try{await taskApi.archive(activeTask[6],!taskArchiveView);await Promise.all([taskQuery.refetch(),archivedTaskQuery.refetch()]);setDetails(null);showToast(taskArchiveView?'任务已恢复':'任务已归档')}catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}}}>{taskArchiveView?'恢复任务':'归档任务'}</Button>}</>}><Descriptions bordered column={1} items={[{key:'next',label:'下一步动作',children:activeTask?.[4]},{key:'impact',label:'预计收入影响',children:activeTask?.[5]}]}/></Modal>
    <Modal open={details==='suggestion'} title={`${focusCompany} 跟进建议`} description="根据客户阶段、联系人完整度和下一步动作生成。" onClose={()=>setDetails(null)} footer={<><Button onClick={()=>setDetails(null)}>稍后处理</Button><Button variant="primary" disabled={!focusCustomer} onClick={async()=>{if(!focusCustomer)return;try{await taskApi.create({customerId:focusCustomer.id,priority:'高',title:`${focusCompany} 建议跟进`,dueLabel:'今天',company:focusCompany,nextAction:focusAction,impact:focusCustomer.estimatedValue?`¥${focusCustomer.estimatedValue.toLocaleString('zh-CN')}`:'待评估',source:'经营建议'});await taskQuery.refetch();setDetails(null);showToast(`${focusCompany} 跟进任务已创建`)}catch(cause){showToast(cause instanceof Error?cause.message:'任务创建失败')}}}>创建跟进任务</Button></>}><StatusNotice tone="info" icon={<Sparkles size={17}/>} title="建议动作" description={focusCustomer?`先执行“${focusAction}”，沟通后及时更新客户阶段、有效联系人和下一次跟进时间。`:'暂无可生成建议的客户，请先从 AI 获客保存候选。'}/></Modal>
  </PageContainer>
}
