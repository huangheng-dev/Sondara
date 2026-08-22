import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Database,
  Layers3,
  MessageSquareReply,
  MoreHorizontal,
  Plus,
  Radar,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { useUiStore } from '@/stores/ui-store'
import { authApi, customerApi, dealApi, taskApi } from '@/lib/api'

export function DashboardPage() {
  const navigate = useNavigate()
  const showToast = useUiStore(s => s.showToast)
  const [dialog, setDialog] = useState<'plan'|'calendar'|null>(null)
  const [details,setDetails]=useState<'tasks'|'task'|'suggestion'|null>(null)
  const [activeTask,setActiveTask]=useState<string[]|null>(null)
  const [planCount,setPlanCount]=useState(0)
  const [taskArchiveView,setTaskArchiveView]=useState(false)
  const authSession=useQuery({queryKey:['auth-session'],queryFn:authApi.session,retry:false})
  const workspaceId=authSession.data?.workspace.id
  const taskQuery=useQuery({queryKey:['tasks',workspaceId],queryFn:()=>taskApi.list({pageSize:100,sort:'created_desc'}),enabled:Boolean(workspaceId),retry:1})
  const archivedTaskQuery=useQuery({queryKey:['tasks',workspaceId,'archived'],queryFn:()=>taskApi.list({pageSize:100,sort:'created_desc',archivedOnly:true}),enabled:Boolean(workspaceId&&taskArchiveView),retry:1})
  const customerQuery=useQuery({queryKey:['customers',workspaceId],queryFn:()=>customerApi.list({pageSize:100,sort:'updated_desc'}),enabled:Boolean(workspaceId),retry:1})
  const dealQuery=useQuery({queryKey:['deals',workspaceId],queryFn:()=>dealApi.list({pageSize:100,sort:'updated_desc'}),enabled:Boolean(workspaceId),retry:1})
  const activeTaskRecords=taskQuery.data?.items??[]
  const taskRecords=taskArchiveView?(archivedTaskQuery.data?.items??[]):activeTaskRecords
  const customers=customerQuery.data?.items??[]
  const deals=dealQuery.data?.items??[]
  const isLoading = taskQuery.isLoading || customerQuery.isLoading || dealQuery.isLoading
  const isError = taskQuery.isError || customerQuery.isError || dealQuery.isError
  const taskItems=useMemo(()=>taskRecords.map(task=>[task.priority,task.title,task.dueLabel,task.company,task.nextAction,task.impact,task.id]),[taskRecords])
  const completed=useMemo(()=>new Set(taskRecords.filter(task=>task.status==='completed').map(task=>task.title)),[taskRecords])
  const pendingTasks=useMemo(()=>activeTaskRecords.filter(task=>task.status==='open'),[activeTaskRecords])
  const dueToday=pendingTasks.filter(task=>task.dueLabel.includes('今天'))
  const highPriority=pendingTasks.filter(task=>task.priority==='高')
  const activeDeals=deals.filter(deal=>deal.stage!=='赢单')
  const wonDeals=deals.filter(deal=>deal.stage==='赢单')
  const riskDeals=deals.filter(deal=>Math.floor((Date.now()-deal.stageEnteredAt)/86_400_000)>=14)
  const highIntentCustomers=customers.filter(customer=>customer.stage==='重点跟进'||customer.stage==='有商机')
  const incompleteCustomers=customers.filter(customer=>customer.stage==='待补全'||customer.validContacts===0)
  const contactedCustomers=customers.filter(customer=>customer.interaction&&customer.interaction!=='未触达')
  const focusCustomer=highIntentCustomers[0]??incompleteCustomers[0]??customers[0]??null
  const focusCompany=focusCustomer?.company??'重点客户'
  const focusAction=focusCustomer?.nextAction??'补全联系人并确认下一次沟通安排'
  const pulseHeadline = highPriority.length > 0 || highIntentCustomers.length > 0
    ? `先处理 ${highPriority.length} 项高优先事项，再推进 ${highIntentCustomers.length} 家重点客户`
    : customers.length > 0
      ? '当前无高优先事项，继续补全客户资料并推进有效触达'
      : '从创建客户雷达开始，建立第一批可跟进客户'
  const metrics = [
    {label:'待推进事项',value:String(pendingTasks.length),detail:`${dueToday.length} 项今天到期`,icon:CheckCircle2,tone:'blue',change:dueToday.length>0?`${dueToday.length} 项今天到期`:'暂无到期',progress:Math.min(100,pendingTasks.length*5)},
    {label:'高优先事项',value:String(highPriority.length),detail:'需要优先处理',icon:Zap,tone:'violet',change:highPriority.length>0?'需聚焦':'无高优先',progress:Math.min(100,highPriority.length*10)},
    {label:'活跃商机',value:String(activeDeals.length),detail:`${riskDeals.length} 项存在停滞风险`,icon:Target,tone:'orange',change:wonDeals.length>0?`已赢 ${wonDeals.length} 单`:'暂无赢单',progress:Math.min(100,activeDeals.length*8)},
    {label:'重点客户',value:String(highIntentCustomers.length),detail:`${incompleteCustomers.length} 家资料待补全`,icon:UsersRound,tone:'green',change:`${contactedCustomers.length} 家已触达`,progress:Math.min(100,customers.length>0?Math.round((contactedCustomers.length/customers.length)*100):0)},
  ]
  const workstreams=[
    {label:'客户发现',detail:'雷达发现候选企业',value:String(customers.length),unit:'家客户',progress:Math.min(100,customers.length*2),icon:Radar,path:'/radar',tone:'blue'},
    {label:'客户研究',detail:'联系人与证据核验',value:String(contactedCustomers.length),unit:'家已触达',progress:Math.min(100,customers.length>0?Math.round((contactedCustomers.length/customers.length)*100):0),icon:Database,path:'/customers',tone:'violet'},
    {label:'营销触达',detail:'回复与意向识别',value:String(pendingTasks.filter(t=>t.source==='营销活动'||t.nextAction?.includes('回复')).length),unit:'项待跟进',progress:Math.min(100,pendingTasks.length*8),icon:MessageSquareReply,path:'/inbox',tone:'cyan'},
    {label:'商机推进',detail:'方案评估与成交',value:String(activeDeals.length),unit:'个活跃',progress:Math.min(100,deals.length>0?Math.round((wonDeals.length/deals.length)*100):0),icon:TrendingUp,path:'/pipeline',tone:'green'},
  ]
  const attentionItems = [
    {title:highIntentCustomers.length>0?'重点客户待跟进':incompleteCustomers.length>0?'客户资料待补全':focusCustomer?'下一位客户待推进':'建立第一批客户',detail:focusCustomer?`${focusCompany} · ${focusAction}`:'暂无客户，可先从雷达发现候选',count:focusCustomer?'今天':'0',tone:'orange' as const,icon:MessageSquareReply,path:focusCustomer?'/customers':'/radar'},
    {title:'商机停滞风险',detail:`${riskDeals.length} 个商机超过 14 天未推进`,count:String(riskDeals.length),tone:'red' as const,icon:AlertTriangle,path:'/pipeline'},
    {title:'客户资料待补全',detail:'缺少联系人或有效联系方式',count:String(incompleteCustomers.length),tone:'blue' as const,icon:UsersRound,path:'/customers'},
  ]
  const markComplete=async(id:string)=>{const task=taskRecords.find(item=>item.id===id);if(task){await taskApi.update(task.id,{status:'completed'});await taskQuery.refetch()}}

  if (isLoading) {
    return <div className="page-content dashboard-page">
      <PageHeader title="经营总览" description="聚焦经营结果、增长进度与今天真正需要处理的行动。" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'var(--color-text-secondary, #667085)' }}>
        <RefreshCw size={20} className="is-spinning" style={{ marginRight: 8 }} />
        正在加载经营数据…
      </div>
    </div>
  }

  if (isError) {
    return <div className="page-content dashboard-page">
      <PageHeader title="经营总览" description="聚焦经营结果、增长进度与今天真正需要处理的行动。" />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 12, color: 'var(--color-text-secondary, #667085)' }}>
        <AlertTriangle size={32} style={{ color: 'var(--color-danger, #f04438)' }} />
        <p>数据加载失败，请检查网络连接后重试。</p>
        <Button variant="primary" onClick={() => { taskQuery.refetch(); customerQuery.refetch(); dealQuery.refetch(); }}>重新加载</Button>
      </div>
    </div>
  }

  return <div className="page-content dashboard-page">
    <PageHeader title="经营总览" description="聚焦经营结果、增长进度与今天真正需要处理的行动。" actions={<>
      <Button onClick={()=>setTaskArchiveView(value=>!value)}><Layers3 size={16}/>{taskArchiveView?'返回待办':'已归档任务'}</Button>
      <Button onClick={() => setDialog('calendar')}><CalendarPlus size={16} />日程</Button>
      <Button onClick={() => setDialog('plan')} variant="primary"><Plus size={16} />新建增长计划{planCount>0?` · ${planCount}`:''}</Button>
    </>} />

    <section className="dashboard-executive" aria-label="今日经营摘要">
      <article className="dashboard-pulse-card">
        <header><span><Sparkles/>今日经营脉搏</span><Badge tone="green">运行正常</Badge></header>
        <div><small>建议优先级</small><h2>{pulseHeadline}</h2><p>当前获客与商机流程运行稳定，重点关注今日到期任务和停滞超过 14 天的商机。</p></div>
        <footer><span><small>今日到期</small><strong>{dueToday.length}</strong></span><span><small>重点客户</small><strong>{highIntentCustomers.length}</strong></span><span><small>风险商机</small><strong>{riskDeals.length}</strong></span><Button onClick={()=>navigate('/customers')}>进入客户工作台<ArrowUpRight/></Button></footer>
      </article>
      <section className="dashboard-metrics" aria-label="当前经营状态">
        {metrics.map(({label,value,detail,icon:Icon,tone,change,progress})=><article className={`dashboard-metric tone-${tone}`} key={label}><header><span>{label}</span><i><Icon size={17}/></i></header><div><strong>{value}</strong><b>{change}</b></div><footer><span>{detail}</span><i><u style={{width:`${progress}%`}}/></i></footer></article>)}
      </section>
    </section>

    <section className="dashboard-workstreams" aria-label="增长执行进度">
      <header><div><span>增长执行进度</span><h2>从客户发现到商机推进</h2><p>聚合本周关键工作流，快速判断当前推进节奏和需要介入的环节。</p></div><Button size="sm" variant="ghost" onClick={()=>navigate('/attribution')}>查看转化分析<ArrowRight/></Button></header>
      <div>{workstreams.map(({label,detail,value,unit,progress,icon:Icon,path,tone})=><Button className={`workstream-${tone}`} key={label} onClick={()=>navigate(path)}><header><i><Icon/></i><span><strong>{label}</strong><small>{detail}</small></span><ArrowUpRight/></header><div><strong>{value}</strong><span>{unit}</span><b>{progress}%</b></div><footer><i><u style={{width:`${progress}%`}}/></i><span>本周完成度</span></footer></Button>)}</div>
    </section>

    <div className="dashboard-columns dashboard-command-layout">
      <Panel className="dashboard-task-panel" title="今日行动清单" subtitle="按紧迫度与收入影响排序，完成后自动更新经营状态" action={<Button size="sm" variant="ghost" onClick={()=>setDetails('tasks')}>全部事项<ArrowRight size={14}/></Button>}>
        <div className="task-list">{taskItems.length ? taskItems.slice(0,4).map((t,index) => <article className={`${completed.has(t[1])?'is-completed':''} task-priority-${t[0]==='高'?'high':'normal'}`} key={t[6]}><span className="task-order">{String(index+1).padStart(2,'0')}</span><Button className="task-check" disabled={taskArchiveView} aria-label={`完成${t[1]}`} onClick={async()=>{try{await markComplete(t[6]);showToast(`${t[1]}已标记完成`)}catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}}}><CheckCircle2 size={18}/></Button><div className="task-main"><strong>{t[1]}</strong><p>{t[3]} · 下一步：{t[4]}</p></div><div className="task-schedule"><Badge tone={t[0] === '高' ? 'red' : 'orange'}>{t[0]}优先级</Badge><span>{t[2]}</span></div><div className="task-impact"><small>预计影响</small><strong>{t[5]}</strong></div><Button className="task-more" aria-label={`更多操作：${t[1]}`} onClick={()=>{setActiveTask(t);setDetails('task')}}><MoreHorizontal size={18}/></Button></article>) : <EmptyState className="list-empty-state compact" icon={ClipboardList} title={taskArchiveView?'暂无归档任务':'暂无待办事项'} />}</div>
      </Panel>

      <aside className="dashboard-side dashboard-action-rail">
        <Panel className="dashboard-attention-panel" title="经营提醒" subtitle="异常、机会和系统建议集中处理">
          <div className="dashboard-attention-list">{attentionItems.map(({title,detail,count,tone,icon:Icon,path})=><Button className={`attention-${tone}`} key={title} onClick={()=>navigate(path)}><i><Icon/></i><span><strong>{title}</strong><small>{detail}</small></span><Badge tone={tone}>{count}</Badge><ArrowRight/></Button>)}</div>
          <div className="dashboard-recommendation"><i><Sparkles/></i><span><small>今日建议</small><strong>{focusCustomer?`优先推进 ${focusCompany}`:'先建立第一批客户'}</strong><p>{focusCustomer?`${focusAction}，并在完成后记录结果。`:'创建雷达任务并保存高匹配候选，形成可跟进客户。'}</p></span><Button onClick={()=>focusCustomer?setDetails('suggestion'):navigate('/radar')}>立即处理<ArrowRight/></Button></div>
        </Panel>
      </aside>
    </div>

    <CreateDialog open={dialog === 'plan'} title="新建增长计划" description="选择市场与目标，创建一条可跟踪的增长主线。" successMessage="增长计划已创建" onClose={()=>setDialog(null)} onSubmit={async values=>{await taskApi.create({priority:'中',title:`启动计划：${values.name}`,dueAt:values.due?Date.parse(values.due):null,dueLabel:values.due||'待安排',company:values.market,nextAction:values.goal,impact:'待评估',source:'经营计划'});await taskQuery.refetch();setPlanCount(count=>count+1)}} fields={[{name:'name',label:'计划名称',required:true,placeholder:'例如：德国经销商拓展'},{name:'market',label:'目标市场',type:'select',required:true,options:['德国食品设备','华东制药装备','北美阀门经销']},{name:'goal',label:'目标',type:'select',required:true,options:['发现目标客户','获得有效回复','创建销售商机']},{name:'due',label:'目标日期',type:'date'}]} />
    <CreateDialog open={dialog === 'calendar'} title="新建日程" description="安排个人跟进和复盘。" submitLabel="添加日程" successMessage="日程已添加" onClose={()=>setDialog(null)} onSubmit={async values=>{await taskApi.create({priority:'中',title:values.title,dueAt:Date.parse(values.date),dueLabel:values.date,company:'个人日程',nextAction:values.note||'按计划执行',impact:'—',source:'日程'});await taskQuery.refetch()}} fields={[{name:'title',label:'日程标题',required:true},{name:'date',label:'日期',type:'date',required:true},{name:'note',label:'备注',type:'textarea'}]} />
    <Modal open={details==='tasks'} title={taskArchiveView?'已归档经营事项':'全部经营事项'} description="按时间、优先级和预计收入影响排序。" onClose={()=>setDetails(null)}><div className="dashboard-task-dialog">{taskItems.length ? taskItems.map(t=><Button key={t[6]} onClick={()=>{setActiveTask(t);setDetails('task')}}><CheckCircle2 className={completed.has(t[1])?'done':''}/><span><strong>{t[1]}</strong><small>{t[2]} · {t[3]} · {t[4]}</small></span><b>{t[5]}</b><ArrowRight/></Button>) : <EmptyState className="list-empty-state compact dashboard-task-dialog-empty" icon={ClipboardList} title="暂无经营事项" />}</div></Modal>
    <Modal open={details==='task'} title={activeTask?.[1]??'任务详情'} description={`${activeTask?.[3]??''} · ${activeTask?.[2]??''}`} onClose={()=>setDetails(null)} footer={<><Button onClick={()=>setDetails(null)}>关闭</Button>{activeTask&&<Button onClick={async()=>{try{await taskApi.archive(activeTask[6],!taskArchiveView);await Promise.all([taskQuery.refetch(),archivedTaskQuery.refetch()]);setDetails(null);showToast(taskArchiveView?'任务已恢复':'任务已归档')}catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}}}><Layers3/>{taskArchiveView?'恢复任务':'归档任务'}</Button>}<Button variant="primary" disabled={taskArchiveView} onClick={async()=>{if(activeTask){try{await markComplete(activeTask[6]);setDetails(null);showToast('任务已完成')}catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}}}}>标记完成</Button></>}><div className="task-detail-dialog"><span><small>下一步动作</small><strong>{activeTask?.[4]}</strong></span><span><small>预计收入影响</small><strong>{activeTask?.[5]}</strong></span></div></Modal>
    <Modal open={details==='suggestion'} title={`${focusCompany} 跟进建议`} description="根据客户阶段、联系人完整度和下一步动作生成。" onClose={()=>setDetails(null)} footer={<><Button onClick={()=>setDetails(null)}>稍后处理</Button><Button variant="primary" disabled={!focusCustomer} onClick={async()=>{if(!focusCustomer)return;try{await taskApi.create({customerId:focusCustomer.id,priority:'高',title:`${focusCompany} 建议跟进`,dueLabel:'今天',company:focusCompany,nextAction:focusAction,impact:focusCustomer.estimatedValue?`¥${focusCustomer.estimatedValue.toLocaleString('zh-CN')}`:'待评估',source:'经营建议'});await taskQuery.refetch();setDetails(null);showToast(`${focusCompany} 跟进任务已创建`)}catch(cause){showToast(cause instanceof Error?cause.message:'任务创建失败')}}}>创建跟进任务</Button></>}><div className="suggestion-dialog"><Sparkles/><p>{focusCustomer?`建议先执行“${focusAction}”，沟通后及时更新客户阶段、有效联系人和下一次跟进时间。`:'暂无可生成建议的客户，请先从 AI 获客保存候选。'}</p></div></Modal>
  </div>
}
