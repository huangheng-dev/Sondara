import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bookmark,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Gauge,
  Globe2,
  HandCoins,
  Import,
  Landmark,
  Layers3,
  ListFilter,
  ListTree,
  MapPinned,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Ship,
  Target,
  UsersRound,
  X,
  Zap,
} from 'lucide-react'
import type { Candidate } from '@/types'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { CandidateList, type CandidateSort } from '@/pages/radar/CandidateList'
import { CompanyDecisionDrawer } from '@/pages/radar/CompanyDecisionDrawer'
import { useUiStore } from '@/stores/ui-store'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { authApi, customerApi, icpApi, radarApi, taskApi, type CustomerApiRecord, type RadarTaskStatus } from '@/lib/api'
import { parseCsv } from '@/utils/csv'

type Filter = '全部' | '高匹配' | '强信号'
type Mode = '智能多渠道' | '地图找客' | '企业官网' | '搜索引擎' | '行业名录' | '展会协会' | '招投标项目' | '招聘扩产' | '新闻融资' | '贸易海关' | '社交网络' | '种子名单'
type ChannelGroup = '企业发现' | '机会信号' | '数据与名单'

const modes: { label: Mode; group: ChannelGroup; description: string; icon: typeof Layers3; available: boolean }[] = [
  { label: '智能多渠道', group: '企业发现', description: '自动组合所有已启用来源', icon: Layers3, available: true },
  { label: '地图找客', group: '企业发现', description: '地图、商圈与本地企业', icon: MapPinned, available: true },
  { label: '企业官网', group: '企业发现', description: '官网、产品页与联系页面', icon: Globe2, available: true },
  { label: '搜索引擎', group: '企业发现', description: '关键词、地区与场景检索', icon: Search, available: true },
  { label: '行业名录', group: '机会信号', description: '垂直目录与认证企业库', icon: ListTree, available: true },
  { label: '展会协会', group: '机会信号', description: '展商、会员与会议名单', icon: CalendarDays, available: true },
  { label: '招投标项目', group: '机会信号', description: '采购公告与项目中标信息', icon: Landmark, available: true },
  { label: '招聘扩产', group: '机会信号', description: '岗位、新产线与扩张迹象', icon: Briefcase, available: true },
  { label: '新闻融资', group: '数据与名单', description: '融资、并购与经营动态', icon: Newspaper, available: true },
  { label: '贸易海关', group: '数据与名单', description: '进出口、供应链与采购关系信号', icon: Ship, available: true },
  { label: '社交网络', group: '数据与名单', description: '企业主页、关键岗位与关系信号', icon: UsersRound, available: true },
  { label: '种子名单', group: '数据与名单', description: '导入后自动补全和去重', icon: Import, available: true },
]
const moneyValue=(value:string)=>Number(value.replace(/[^\d.]/g,''))
const formatCandidateValue=(value:number,currency:'CNY'|'EUR'|'USD')=>`${currency==='CNY'?'¥':currency==='EUR'?'€':'$'}${value.toLocaleString('zh-CN')}`
const formatUpdated=(value:number)=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(value)
const statusLabels:Record<RadarTaskStatus,string>={queued:'等待执行',running:'正在执行',paused:'已暂停',completed:'已完成',failed:'执行失败',cancelled:'已取消'}

export function RadarPage() {
  const [searchParams,setSearchParams]=useSearchParams()
  const [filter, setFilter] = useState<Filter>('全部')
  const [mode, setMode] = useState<Mode>('智能多渠道')
  const [query, setQuery] = useState('')
  const [sort,setSort]=useState<CandidateSort>('匹配分最高')
  const [archiveView,setArchiveView]=useState(false)
  const [checkedCandidates,setCheckedCandidates]=useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [dialog, setDialog] = useState<'task'|'import'|null>(null)
  const [batchTaskOpen,setBatchTaskOpen]=useState(false)
  const [taskDetail,setTaskDetail]=useState(false)
  const showToast = useUiStore(s => s.showToast)
  const authSession=useQuery({queryKey:['auth-session'],queryFn:authApi.session,retry:false})
  const workspaceId=authSession.data?.workspace.id
  const profileQuery=useQuery({queryKey:['icp-profile'],queryFn:icpApi.getProfile,enabled:Boolean(workspaceId),retry:1,staleTime:30_000})
  const knowledgeQuery=useQuery({queryKey:['icp-knowledge',workspaceId,'enabled'],queryFn:()=>icpApi.listKnowledge({status:'已启用',pageSize:100}),enabled:Boolean(workspaceId),retry:1,staleTime:30_000})
  const selectedMarketName=profileQuery.data?.selectedMarket??'德国食品设备'
  const enabledKnowledge=knowledgeQuery.data?.total??0
  const customerQuery=useQuery({queryKey:['customers',workspaceId],queryFn:()=>customerApi.list({pageSize:100,sort:'updated_desc'}),enabled:Boolean(workspaceId),retry:1})
  const radarTaskQuery=useQuery({queryKey:['radar-tasks',workspaceId],queryFn:()=>radarApi.listTasks({pageSize:100}),enabled:Boolean(workspaceId),retry:1,refetchInterval:2500})
  const candidateQuery=useQuery({queryKey:['radar-candidates',workspaceId,archiveView],queryFn:()=>radarApi.listCandidates({pageSize:100,sort:'updated_desc',status:archiveView?'archived':undefined}),enabled:Boolean(workspaceId),retry:1,refetchInterval:3000})
  const activeTask=radarTaskQuery.data?.items[0]??null
  const queueQuery=useQuery({queryKey:['radar-queue',workspaceId,activeTask?.id],queryFn:()=>radarApi.listQueue({taskId:activeTask?.id,pageSize:20}),enabled:Boolean(workspaceId&&activeTask?.id),retry:1,refetchInterval:2500})
  const taskEventQuery=useQuery({queryKey:['radar-events',workspaceId,activeTask?.id],queryFn:()=>radarApi.listTaskEvents(activeTask!.id),enabled:Boolean(workspaceId&&activeTask?.id&&taskDetail),retry:1,refetchInterval:taskDetail?2500:false})
  useEffect(()=>{if(searchParams.get('create')==='1'){setDialog('task');setSearchParams({}, {replace:true})}},[searchParams,setSearchParams])
  const candidateRecords=candidateQuery.data?.items??[]
  const candidates=useMemo<Candidate[]>(()=>candidateRecords.map(candidate=>({
    id:candidate.id,company:candidate.company,region:candidate.region,industry:candidate.industry,size:candidate.size,
    score:candidate.score,signal:candidate.signal,source:candidate.source,value:formatCandidateValue(candidate.estimatedValue,candidate.currency),
    confidence:candidate.confidence,updatedAt:formatUpdated(candidate.updatedAt),reason:candidate.reason,dimensions:candidate.dimensions,
    evidence:candidate.evidence.map(item=>({title:item.title,source:item.source,time:item.time,strength:item.strength})),committee:candidate.committee,contacts:candidate.contacts??[],relationships:candidate.relationships,
  })),[candidateRecords])
  const saved=useMemo(()=>{const companies=new Set(customerQuery.data?.items.map(customer=>customer.company)??[]);return new Set(candidateRecords.filter(candidate=>candidate.status==='saved'||companies.has(candidate.company)).map(candidate=>candidate.id))},[candidateRecords,customerQuery.data])
  const targetMarkets=[...new Set([selectedMarketName,'德国食品设备','华东制药装备','北美阀门经销'])]
  const filtered = useMemo(() => { const rows=candidates.filter(c => {
    const matchesQuery = !query || `${c.company}${c.industry}${c.region}${c.signal}${c.source}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === '全部' || (filter === '高匹配' && c.score >= 92) || (filter === '强信号' && /新建|扩张|招投标|访问/.test(c.signal))
    const matchesMode = mode === '智能多渠道' ||
      (mode === '地图找客' && /地图|本地企业/.test(c.source)) ||
      (mode === '企业官网' && /官网|公开网络/.test(c.source)) ||
      (mode === '搜索引擎' && /官网|公开网络|新闻/.test(c.source)) ||
      (mode === '行业名录' && /行业目录/.test(c.source)) ||
      (mode === '展会协会' && /展会|协会/.test(c.source)) ||
      (mode === '招投标项目' && /招投标/.test(`${c.source}${c.signal}`)) ||
      (mode === '招聘扩产' && /招聘|扩张|扩产|新建/.test(`${c.source}${c.signal}`)) ||
      (mode === '新闻融资' && /新闻|融资|并购/.test(`${c.source}${c.signal}`)) ||
      (mode === '贸易海关' && /贸易|海关|进出口/.test(c.source)) ||
      (mode === '社交网络' && /社交|LinkedIn/.test(c.source)) ||
      mode === '种子名单'
    return matchesQuery && matchesFilter && matchesMode
  });if(sort==='匹配分最高')return [...rows].sort((a,b)=>b.score-a.score);if(sort==='匹配分最低')return [...rows].sort((a,b)=>a.score-b.score);if(sort==='企业名称 A–Z')return [...rows].sort((a,b)=>a.company.localeCompare(b.company,'zh-CN'));if(sort==='企业名称 Z–A')return [...rows].sort((a,b)=>b.company.localeCompare(a.company,'zh-CN'));if(sort==='证据置信度最高')return [...rows].sort((a,b)=>b.confidence-a.confidence);if(sort==='证据置信度最低')return [...rows].sort((a,b)=>a.confidence-b.confidence);if(sort==='预计价值最高')return [...rows].sort((a,b)=>moneyValue(b.value)-moneyValue(a.value));if(sort==='预计价值最低')return [...rows].sort((a,b)=>moneyValue(a.value)-moneyValue(b.value));if(sort==='最早发现')return [...rows].reverse();return rows}, [candidates,filter, mode, query,sort])
  const candidatePaging=usePagination(filtered,6,`${query}|${filter}|${mode}|${sort}`)
  const ensureCandidateCustomer=async(candidate:Candidate):Promise<{record:CustomerApiRecord;created:boolean;reachable:boolean}>=>{
    const existing=customerQuery.data?.items.find(customer=>customer.company===candidate.company)
    if(existing)return {record:existing,created:false,reachable:true}
    // Make sure public contacts (especially verified emails) have been discovered before promotion.
    if(!candidate.contacts.some(contact=>contact.email)){
      try{ await radarApi.enrichCandidateContacts(candidate.id) }catch{ /* keep any already-discovered contacts */ }
    }
    const result=await radarApi.promoteCandidate(candidate.id)
    return {record:result.customer,created:result.created,reachable:result.reachable}
  }
  const save = async(candidate: Candidate) => {try{const result=await ensureCandidateCustomer(candidate);await radarApi.updateCandidate(candidate.id,'saved');await Promise.all([customerQuery.refetch(),candidateQuery.refetch()]);setCheckedCandidates(value=>{const next=new Set(value);next.delete(candidate.id);return next});showToast(result.reachable?(result.created?`${candidate.company} 已保存至客户库`:`${candidate.company} 已在客户库中`):`${candidate.company} 已保存，但未发现可发信邮箱，请补全联系人`)}catch(cause){showToast(cause instanceof Error?cause.message:'客户保存失败，请稍后重试。')}}
  const saveChecked=async()=>{try{let created=0;for(const candidate of candidates.filter(item=>checkedCandidates.has(item.id))){const result=await ensureCandidateCustomer(candidate);await radarApi.updateCandidate(candidate.id,'saved');if(result.created)created+=1}await Promise.all([customerQuery.refetch(),candidateQuery.refetch()]);showToast(created?`已将 ${created} 家候选保存至客户库`:'所选候选均已在客户库中');setCheckedCandidates(new Set())}catch(cause){showToast(cause instanceof Error?cause.message:'批量保存失败，请稍后重试。')}}
  const createCheckedTask=async(values:Record<string,string>)=>{const chosen=candidates.filter(candidate=>checkedCandidates.has(candidate.id));const customerResults=[] as CustomerApiRecord[];for(const candidate of chosen)customerResults.push((await ensureCandidateCustomer(candidate)).record);for(const customer of customerResults)await taskApi.create({customerId:customer.id,title:values.title,priority:values.priority as '高'|'中'|'低',dueAt:Number.isFinite(Date.parse(values.due))?Date.parse(values.due):null,dueLabel:values.due,company:customer.company,nextAction:values.title,impact:customer.estimatedValue?`¥${customer.estimatedValue.toLocaleString('zh-CN')}`:'待评估',source:'AI 获客'});await customerQuery.refetch();setCheckedCandidates(new Set())}
  const enrichCandidate=async(candidate:Candidate)=>{const result=await radarApi.enrichCandidateContacts(candidate.id);const refreshed=await candidateQuery.refetch();const next=refreshed.data?.items.find(item=>item.id===candidate.id);if(next)setSelected({...candidate,confidence:next.confidence,evidence:next.evidence.map(item=>({title:item.title,source:item.source,time:item.time,strength:item.strength})),committee:next.committee,contacts:next.contacts??[],relationships:next.relationships,updatedAt:formatUpdated(next.updatedAt)});return result.message}
  const createCandidateTask=async(candidate:Candidate)=>{const customer=(await ensureCandidateCustomer(candidate)).record;const title='完成首次触达并记录结果';const dueAt=Date.now()+48*60*60*1000;await taskApi.create({customerId:customer.id,title,priority:'高',dueAt,dueLabel:'48 小时内',company:customer.company,nextAction:title,impact:customer.estimatedValue?`¥${customer.estimatedValue.toLocaleString('zh-CN')}`:'待评估',source:'AI 获客'});await customerQuery.refetch()}
  const archiveCandidates=async(ids:string[], archived:boolean)=>{try{await Promise.all(ids.map(id=>radarApi.archiveCandidate(id,archived)));await candidateQuery.refetch();setCheckedCandidates(new Set());setSelected(null);showToast(archived?`已归档 ${ids.length} 家候选`:`已恢复 ${ids.length} 家候选`)}catch(cause){showToast(cause instanceof Error?cause.message:'归档操作失败')}
  }
  const createRadarTask=async(values:Record<string,string>)=>{const seedUrls=values.seedUrls.split(/[\n,，]+/).map(value=>value.trim()).filter(Boolean);if(/企业官网|种子名单/.test(values.mode)&&!seedUrls.length)throw new Error('该获客方式必须填写至少一个企业官网或公开来源网址');await radarApi.createTask({name:values.name,icp:values.icp,mode:values.mode,depth:values.depth,candidateLimit:Number(values.limit),knowledgeScope:values.knowledge,targetRegion:values.region,researchLanguage:values.language,inputSource:'AI 获客',seedUrls});await Promise.all([radarTaskQuery.refetch(),queueQuery.refetch()])}
  const importRadarTask=async(values:Record<string,string>)=>{const file=values.file as unknown;if(!(file instanceof File))throw new Error('请选择名单文件');if(/\.xlsx?$/i.test(file.name))throw new Error('当前版本支持 CSV/TXT，Excel 请另存为 CSV 后导入。');const text=await file.text();const rows=parseCsv(text);const valuesToCheck=rows.flatMap(row=>Object.values(row));const urls:string[]=valuesToCheck.map((value:string)=>value.trim()).filter(Boolean).map((value:string)=>{if(/^https?:\/\//i.test(value))return value;if(/^[\w-]+(\.[\w-]+)+(\/|$)/i.test(value))return `https://${value.replace(/^\/+/,'')}`;return ''}).filter(Boolean);const seedUrls=[...new Set(urls)];if(!seedUrls.length)throw new Error('未在 CSV/TXT 中识别到官网或域名列，请包含 website、domain、官网、网站或网址列。');await radarApi.createTask({name:`种子名单研究 · ${file.name}`,icp:values.market,mode:'种子名单',depth:'标准研究',candidateLimit:100,knowledgeScope:'全部已启用知识',targetRegion:'按名单识别',researchLanguage:'自动识别',inputSource:`种子名单 · ${file.name}`,seedUrls});await Promise.all([radarTaskQuery.refetch(),queueQuery.refetch()])}
  const changeTaskStatus=async(action:'pause'|'resume'|'cancel'|'retry')=>{if(!activeTask)return;try{await radarApi.taskAction(activeTask.id,action);await Promise.all([radarTaskQuery.refetch(),queueQuery.refetch()]);showToast(action==='pause'?'任务已暂停':action==='resume'?'任务已继续':action==='cancel'?'任务已取消':'任务已重新进入队列')}catch(cause){showToast(cause instanceof Error?cause.message:'任务状态更新失败。')}}
  const latestQueue=queueQuery.data?.items[0]
  const researchCandidates=candidateRecords.filter(candidate=>candidate.status==='candidate'||candidate.status==='review').slice(0,3)
  const savedCount=candidateRecords.filter(candidate=>candidate.status==='saved').length

  return <div>
    <PageHeader title="AI 获客" description="从多渠道持续发现、研究和筛选值得跟进的目标企业。" actions={<>
      <Button onClick={()=>setArchiveView(value=>!value)}><Layers3 size={16}/>{archiveView?'返回候选':'已归档'}</Button>
      <Button onClick={()=>activeTask?setTaskDetail(true):showToast('暂无雷达任务，请先创建任务。')}><Activity size={16}/>任务详情</Button>
      <Button onClick={() => setDialog('import')}><Import size={16} />导入名单</Button>
      <Button variant="primary" onClick={() => setDialog('task')}><Plus size={16} />创建雷达任务</Button>
    </>} />

    <div id="radar-candidates">
      <Panel>
        <div>
          <div>
            <SearchInput ariaLabel="搜索候选客户" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索企业、行业或信号"/>
            <CustomSelect ariaLabel="筛选获客渠道" value={mode} onChange={value=>setMode(value as Mode)} options={modes.map(({label,icon:Icon})=>({value:label,label,icon:<Icon/>}))}/>
            <CustomSelect ariaLabel="筛选候选状态" value={filter} onChange={value=>setFilter(value as Filter)} options={[{value:'全部',label:'全部候选',icon:<ListFilter/>},{value:'高匹配',label:'高匹配',icon:<Target/>},{value:'强信号',label:'强信号',icon:<Zap/>}]}/>
            <CustomSelect ariaLabel="候选排序" value={sort} onChange={value=>setSort(value as CandidateSort)} options={[
              {value:'匹配分最高',label:'匹配分最高',icon:<Gauge/>},{value:'匹配分最低',label:'匹配分最低',icon:<Gauge/>},
              {value:'企业名称 A–Z',label:'企业名称 A–Z',icon:<ArrowDown/>},{value:'企业名称 Z–A',label:'企业名称 Z–A',icon:<ArrowUp/>},
              {value:'证据置信度最高',label:'证据置信度最高',icon:<CheckCircle2/>},{value:'证据置信度最低',label:'证据置信度最低',icon:<CheckCircle2/>},
              {value:'预计价值最高',label:'预计价值最高',icon:<HandCoins/>},{value:'预计价值最低',label:'预计价值最低',icon:<HandCoins/>},
              {value:'最近发现',label:'最近发现',icon:<CalendarDays/>},{value:'最早发现',label:'最早发现',icon:<CalendarDays/>},
            ]}/>
            <Button disabled={candidateQuery.isFetching||radarTaskQuery.isFetching} onClick={async()=>{await Promise.all([candidateQuery.refetch(),radarTaskQuery.refetch()]);showToast('候选客户列表已刷新')}}><RefreshCw className="is-spinning"/>刷新</Button>
            <Button disabled={!query&&filter==='全部'&&mode==='智能多渠道'&&sort==='匹配分最高'} onClick={()=>{setQuery('');setFilter('全部');setMode('智能多渠道');setSort('匹配分最高')}}>清除筛选</Button>
          </div>
          <div aria-hidden={checkedCandidates.size===0}><span><CheckCircle2/><small>已选择</small><strong>{checkedCandidates.size}</strong><small>家</small></span><div><Button disabled={archiveView} onClick={saveChecked}><Bookmark/>保存客户</Button><Button disabled={archiveView} onClick={()=>setBatchTaskOpen(true)}><CheckCircle2/>创建任务</Button><Button onClick={()=>archiveCandidates([...checkedCandidates],!archiveView)}><Layers3/>{archiveView?'恢复所选':'归档所选'}</Button><Button aria-label="取消选择" title="取消选择" onClick={()=>setCheckedCandidates(new Set())}><X/></Button></div></div>
        </div>
        <CandidateList candidates={candidatePaging.pageItems} saved={saved} selected={checkedCandidates} sort={sort} onSortChange={setSort} onSelectionChange={setCheckedCandidates} onOpen={setSelected} onSave={archiveView?async()=>showToast('请先恢复候选，再保存至客户库。'):save} />
        {filtered.length>0&&<Pagination page={candidatePaging.page} pageSize={candidatePaging.pageSize} total={filtered.length} onPageChange={candidatePaging.setPage} onPageSizeChange={candidatePaging.setPageSize} itemName="家候选"/>}
      </Panel>
    </div>

    <CompanyDecisionDrawer candidate={selected} open={Boolean(selected)} onClose={() => setSelected(null)} onSave={archiveView?async()=>showToast('请先恢复候选，再保存至客户库。'):save} onEnrich={enrichCandidate} onCreateTask={createCandidateTask} />
    <CreateDialog open={dialog==='task'} title="创建雷达任务" description="系统会按所选渠道复用搜索、地图和公开行业来源；也可以直接填写企业官网、行业名录、协会名单或招投标页面。后台会提取证据、合并多来源、去重并写入候选列表。" successMessage="雷达任务已创建并进入研究队列" onClose={()=>setDialog(null)} onSubmit={createRadarTask} initialValues={{icp:selectedMarketName,knowledge:`全部已启用知识（${enabledKnowledge} 条）`,mode:'智能多渠道',language:'自动识别',depth:'标准研究',limit:'100'}} fields={[{name:'name',label:'任务名称',required:true},{name:'icp',label:'客户定位结果',type:'select',required:true,options:targetMarkets},{name:'knowledge',label:'增长知识范围',type:'select',required:true,options:[`全部已启用知识（${enabledKnowledge} 条）`,'仅产品与客户判断规则','产品、案例与市场知识','不引用增长知识']},{name:'mode',label:'获客渠道',type:'select',required:true,options:modes.map(channel=>channel.label)},{name:'region',label:'目标地区',required:true},{name:'language',label:'研究语言',type:'select',options:['自动识别','中文','英语','德语']},{name:'depth',label:'研究深度',type:'select',required:true,options:['快速发现','标准研究','深度核验']},{name:'limit',label:'候选上限',type:'number',required:true},{name:'seedUrls',label:'公开来源网址（可选，每行一个）',type:'textarea',placeholder:'企业官网、行业名录、协会名单或招投标页面网址'}]} />
    <CreateDialog open={dialog==='import'} title="导入种子名单" description="导入 CSV/TXT 名单；系统会识别官网或域名列，并进入种子 URL 研究队列。" submitLabel="进入导入队列" successMessage="名单导入任务已进入队列" onClose={()=>setDialog(null)} onSubmit={importRadarTask} fields={[{name:'file',label:'名单文件',type:'file',accept:'.csv,.txt,text/csv,text/plain',required:true},{name:'market',label:'关联客户定位',type:'select',required:true,options:targetMarkets}]}/>
    <CreateDialog open={batchTaskOpen} title={`为 ${checkedCandidates.size} 家候选创建任务`} description="候选会先保存至客户库，再生成统一的跟进任务。" submitLabel="创建任务" successMessage="候选已保存并创建跟进任务" onClose={()=>setBatchTaskOpen(false)} onSubmit={createCheckedTask} fields={[{name:'title',label:'任务名称',required:true,placeholder:'例如：复核联系人并完成首次触达'},{name:'due',label:'截止时间',required:true},{name:'priority',label:'优先级',type:'select',required:true,options:['高','中','低']},{name:'note',label:'执行说明',type:'textarea'}]}/>
    <Modal open={taskDetail&&Boolean(activeTask)} width={780} title={activeTask?.name??'雷达任务'} description="雷达任务详情与当前执行状态" onClose={()=>setTaskDetail(false)} footer={<>{activeTask&&['queued','running'].includes(activeTask.status)&&<Button onClick={()=>changeTaskStatus('pause')}>暂停任务</Button>}{activeTask?.status==='paused'&&<Button onClick={()=>changeTaskStatus('resume')}>继续任务</Button>}{activeTask?.status==='failed'&&<Button onClick={()=>changeTaskStatus('retry')}>失败重试</Button>}{activeTask&&['queued','running','paused','failed'].includes(activeTask.status)&&<Button variant="danger" onClick={()=>changeTaskStatus('cancel')}>取消任务</Button>}<Button onClick={()=>setTaskDetail(false)}>关闭</Button><Button variant="primary" onClick={()=>{setTaskDetail(false);setDialog('task')}}>复制为新任务</Button></>}>
      {activeTask&&
      <div>
        <section><article><i><Activity/></i><span><small>任务进度</small><strong>{activeTask.progress}%</strong><em>{activeTask.currentStage}</em></span></article><article><i><Target/></i><span><small>高匹配候选</small><strong>{activeTask.highMatchCount}</strong><em>匹配分 90 以上</em></span></article><article><i><ListTree/></i><span><small>队列重试</small><strong>{latestQueue?.attempts??0}/{latestQueue?.maxAttempts??3}</strong><em>{latestQueue?statusLabels[latestQueue.status]:'暂无队列记录'}</em></span></article></section>
        <dl><div><dt>客户定位</dt><dd>{activeTask.icp}</dd></div><div><dt>发现方式</dt><dd>{activeTask.mode}</dd></div><div><dt>研究深度</dt><dd>{activeTask.depth}</dd></div><div><dt>候选上限</dt><dd>{activeTask.candidateLimit} 家</dd></div><div><dt>目标地区</dt><dd>{activeTask.targetRegion}</dd></div><div><dt>运行状态</dt><dd>{statusLabels[activeTask.status]}</dd></div></dl>
        <div><CheckCircle2 size={16}/><span><h3>当前阶段 · {activeTask.currentStage}</h3><p>{activeTask.lastError??'任务状态由服务端队列维护；数据源接入后会写入候选、证据和研究进度。'}</p></span></div>
        <div>
          <section><header><span><h3>处理流水线</h3><p>从发现、研究到保存至客户库</p></span><Badge tone={activeTask.status==='failed'?'orange':activeTask.status==='completed'?'green':'blue'}>{statusLabels[activeTask.status]}</Badge></header><div>{[
            ['发现与采集',String(activeTask.candidatesFound),'已发现',activeTask.progress],['高匹配筛选',String(activeTask.highMatchCount),'90 分以上',activeTask.candidatesFound?Math.round(activeTask.highMatchCount/activeTask.candidatesFound*100):0],['AI 企业研究',String(researchCandidates.length),'待研究',researchCandidates.length?Math.round(researchCandidates.reduce((sum,item)=>sum+item.confidence,0)/researchCandidates.length):0],['人工复核',String(candidateRecords.filter(item=>item.status==='review').length),'等待确认',candidateRecords.length?Math.round(candidateRecords.filter(item=>item.status==='review').length/candidateRecords.length*100):0],['保存至客户库',String(savedCount),'已保存',candidateRecords.length?Math.round(savedCount/candidateRecords.length*100):0],
          ].map((item,index)=><div key={item[0]}><i>{index+1}</i><span><strong>{item[0]}</strong><small>{item[2]}</small></span><b>{item[1]}</b><em><u style={{width:`${item[3]}%`}}/></em></div>)}</div></section>
          <section><header><span><h3>研究队列</h3><p>等待核验证据与联系人</p></span><Button aria-label="刷新研究队列" disabled={candidateQuery.isFetching||queueQuery.isFetching} onClick={async()=>{await Promise.all([candidateQuery.refetch(),queueQuery.refetch()]);showToast('研究队列已刷新')}}><RefreshCw size={14} className="is-spinning"/></Button></header><div>{researchCandidates.length?researchCandidates.map(item=><div key={item.id}><span><i><Activity size={15}/></i><strong>{item.company}</strong><small>{item.evidence.length} 条证据待核验</small></span><b>{item.confidence}%</b><em><u style={{width:`${item.confidence}%`}}/></em></div>):<EmptyState title="暂无研究队列" icon={Activity} />}</div></section>
        </div>
        <section><header><span><h3>执行记录</h3><p>连接器、重试和完成状态均由服务端记录</p></span></header><div>{taskEventQuery.data?.items.length?taskEventQuery.data.items.slice(0,8).map(event=><article key={event.id}><i/><span><strong>{event.message}</strong><small>{new Date(event.createdAt).toLocaleString('zh-CN')}</small></span></article>):<EmptyState title="暂无执行记录" icon={Activity} />}</div></section>
      </div>}
    </Modal>
  </div>
}
