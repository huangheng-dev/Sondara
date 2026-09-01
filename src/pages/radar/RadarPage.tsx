import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Col, Descriptions, Flex, Popconfirm, Progress, Row, Space, Statistic, Typography } from 'antd'
import { useSearchParams } from 'react-router-dom'
import {
  Activity,
  Bookmark,
  CheckCircle2,
  Clock3,
  Import,
  Layers3,
  Plus,
  X,
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
import { DetailDrawer, DetailSection } from '@/components/ui/DetailDrawer'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { List } from '@/components/ui/List'
import { authApi, automationApi, collectAllPages, customerApi, icpApi, radarApi, taskApi, type AcquisitionPlanStatus, type CustomerApiRecord, type RadarTaskStatus } from '@/lib/api'
import { parseLeadFile } from '@/utils/csv'
import { PageContainer, SelectionBar, TableToolbar } from '@/components/ui/PageModules'
import { StatusNotice } from '@/components/ui/StatusNotice'

type Filter = '全部' | '高匹配' | '强信号'
type CandidateScope = 'active' | 'rejected' | 'archived'
type SourceFilter = '全部来源' | '搜索引擎' | '地图' | '企业官网' | '行业目录' | '展会协会' | '采购公告' | '种子名单'
const sourceFilters: SourceFilter[] = ['全部来源', '搜索引擎', '地图', '企业官网', '行业目录', '展会协会', '采购公告', '种子名单']
const strategyOptions = ['目标企业发现', '经销商与合作伙伴开发', '采购项目监控', '本地企业开发', '自定义名单研究']
const dataSourceOptions = ['搜索引擎', '地图', '企业官网', '行业目录', '展会协会', '采购公告', '种子名单']
const overseasRegionOptions = ['全球海外市场（自动轮换国家）','欧洲（自动轮换国家）','北美（自动轮换国家）','中东（自动轮换国家）','东南亚（自动轮换国家）','拉丁美洲（自动轮换国家）','亚洲（自动轮换国家）','大洋洲（自动轮换国家）','非洲（自动轮换国家）']
const intentSignalOptions = ['主动询盘', '采购公告', '扩张建设', '招聘变化', '新闻融资', '贸易与供应链', '关键岗位变化', '内容互动']
const researchLanguageOptions = [
  '自动匹配目标市场', '英语', '德语', '法语', '西班牙语', '意大利语', '葡萄牙语',
  '荷兰语', '波兰语', '俄语', '阿拉伯语', '土耳其语', '日语', '韩语',
  '印度尼西亚语', '越南语', '泰语', '简体中文',
]
const dataSourceId: Record<string, string> = { 搜索引擎: 'search', 地图: 'map', 企业官网: 'website', 行业目录: 'industry-directory', 展会协会: 'trade-show', 采购公告: 'procurement', 种子名单: 'seed-list' }
const dataSourceName: Record<string, string> = Object.fromEntries(Object.entries(dataSourceId).map(([name,id])=>[id,name]))
const moneyValue=(value:string)=>Number(value.replace(/[^\d.]/g,''))
const formatCandidateValue=(value:number,currency:'CNY'|'EUR'|'USD')=>value>0?`${currency==='CNY'?'¥':currency==='EUR'?'€':'$'}${value.toLocaleString('zh-CN')}`:'待评估'
const formatUpdated=(value:number)=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(value)
const statusLabels:Record<RadarTaskStatus,string>={queued:'等待执行',running:'正在执行',paused:'已暂停',completed:'已完成',failed:'执行失败',cancelled:'已取消'}
const taskTone=(status:RadarTaskStatus)=>status==='completed'?'green':status==='failed'?'red':status==='paused'?'orange':status==='cancelled'?'neutral':'blue'
const planStatusLabels:Record<AcquisitionPlanStatus,string>={active:'自动运行',paused:'已暂停',blocked:'等待恢复'}
const planTone=(status:AcquisitionPlanStatus)=>status==='active'?'green':status==='blocked'?'orange':'neutral'
const scheduleLabels:Record<string,string>={manual:'仅运行一次',daily:'每天',weekdays:'工作日',weekly:'每周一'}
const analysisMarkets=(summary:string|undefined)=>{try{const value=JSON.parse(summary??'{}') as {recommendedMarkets?:Array<{name?:unknown}>};return (value.recommendedMarkets??[]).map(item=>String(item.name??'').trim()).filter(Boolean)}catch{return []}}

export function RadarPage() {
  const [searchParams,setSearchParams]=useSearchParams()
  const [filter, setFilter] = useState<Filter>('全部')
  const [source, setSource] = useState<SourceFilter>('全部来源')
  const [query, setQuery] = useState('')
  const [sort,setSort]=useState<CandidateSort>('匹配分最高')
  const [candidateScope,setCandidateScope]=useState<CandidateScope>('active')
  const [checkedCandidates,setCheckedCandidates]=useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [dialog, setDialog] = useState<'task'|'import'|'edit'|null>(null)
  const [batchTaskOpen,setBatchTaskOpen]=useState(false)
  const [runHistoryOpen,setRunHistoryOpen]=useState(false)
  const [simulationResult,setSimulationResult]=useState<Awaited<ReturnType<typeof automationApi.simulatePlan>>|null>(null)
  const [automationRun,setAutomationRun]=useState<Awaited<ReturnType<typeof automationApi.run>>|null>(null)
  const [selectedTaskId,setSelectedTaskId]=useState<string|null>(null)
  const [selectedPlanId,setSelectedPlanId]=useState<string|null>(null)
  const [candidateTaskId,setCandidateTaskId]=useState('all')
  const showToast = useUiStore(s => s.showToast)
  const authSession=useQuery({queryKey:['auth-session'],queryFn:authApi.session,retry:false})
  const workspaceId=authSession.data?.workspace.id
  const canWrite=Boolean(authSession.data?.workspace.role&&authSession.data.workspace.role!=='viewer')
  const profileQuery=useQuery({queryKey:['icp-profile'],queryFn:icpApi.getProfile,enabled:Boolean(workspaceId),retry:1,staleTime:30_000})
  const knowledgeQuery=useQuery({queryKey:['icp-knowledge',workspaceId,'enabled'],queryFn:()=>collectAllPages((page,pageSize)=>icpApi.listKnowledge({status:'已启用',page,pageSize})),enabled:Boolean(workspaceId),retry:1,staleTime:30_000})
  const selectedMarketName=profileQuery.data?.selectedMarket??''
  const enabledKnowledge=knowledgeQuery.data?.total??0
  const customerQuery=useQuery({queryKey:['customers',workspaceId],queryFn:()=>collectAllPages((page,pageSize)=>customerApi.list({page,pageSize,sort:'updated_desc'})),enabled:Boolean(workspaceId),retry:1})
  const radarTaskQuery=useQuery({queryKey:['radar-tasks',workspaceId],queryFn:()=>collectAllPages((page,pageSize)=>radarApi.listTasks({page,pageSize})),enabled:Boolean(workspaceId),retry:1,refetchInterval:2500})
  const planQuery=useQuery({queryKey:['acquisition-plans',workspaceId],queryFn:radarApi.listPlans,enabled:Boolean(workspaceId),retry:1,refetchInterval:5000})
  const plans=planQuery.data?.items??[]
  const currentPlan=plans.find(plan=>plan.id===selectedPlanId)??plans.find(plan=>plan.status==='active')??plans.find(plan=>plan.status==='blocked')??plans[0]??null
  const learningVersionsQuery=useQuery({queryKey:['learning-versions',workspaceId,currentPlan?.id],queryFn:()=>automationApi.learningVersions(currentPlan!.id),enabled:Boolean(workspaceId&&currentPlan?.id&&runHistoryOpen),retry:1})
  const automationRunsQuery=useQuery({queryKey:['automation-runs',workspaceId],queryFn:automationApi.runs,enabled:Boolean(workspaceId&&runHistoryOpen),retry:1,refetchInterval:10_000})
  const productionQuery=useQuery({queryKey:['automation-production-control',workspaceId],queryFn:radarApi.automationControl,enabled:Boolean(workspaceId),retry:1,refetchInterval:30_000})
  const production=productionQuery.data
  const taskRecords=radarTaskQuery.data?.items??[]
  const runningTasks=taskRecords.filter(task=>['queued','running','paused','failed'].includes(task.status))
  const currentRunTask=runningTasks.find(task=>task.id===selectedTaskId)??runningTasks.find(task=>['queued','running'].includes(task.status))??runningTasks[0]??null
  const activeTask=taskRecords.find(task=>task.id===selectedTaskId)??currentRunTask??taskRecords[0]??null
  const taskNameById=useMemo(()=>new Map(taskRecords.map(task=>[task.id,task.name])),[taskRecords])
  const filteredTaskId=candidateTaskId==='all'?undefined:candidateTaskId
  const candidateQuery=useQuery({queryKey:['radar-candidates',workspaceId,candidateScope,filteredTaskId??'all'],queryFn:()=>collectAllPages((page,pageSize)=>radarApi.listCandidates({page,pageSize,sort:'updated_desc',taskId:filteredTaskId,status:candidateScope==='active'?undefined:candidateScope})),enabled:Boolean(workspaceId),retry:1,refetchInterval:10_000})
  const taskCandidateQuery=useQuery({queryKey:['radar-task-candidates',workspaceId,activeTask?.id],queryFn:()=>collectAllPages((page,pageSize)=>radarApi.listCandidates({page,pageSize,sort:'updated_desc',taskId:activeTask?.id})),enabled:Boolean(workspaceId&&activeTask?.id&&runHistoryOpen),retry:1,refetchInterval:runHistoryOpen?10_000:false})
  const queueQuery=useQuery({queryKey:['radar-queue',workspaceId,activeTask?.id],queryFn:()=>radarApi.listQueue({taskId:activeTask?.id,pageSize:20}),enabled:Boolean(workspaceId&&activeTask?.id&&runHistoryOpen),retry:1,refetchInterval:runHistoryOpen?2500:false})
  const taskEventQuery=useQuery({queryKey:['radar-events',workspaceId,activeTask?.id],queryFn:()=>radarApi.listTaskEvents(activeTask!.id),enabled:Boolean(workspaceId&&activeTask?.id&&runHistoryOpen),retry:1,refetchInterval:runHistoryOpen?2500:false})
  useEffect(()=>{if(!taskRecords.length){setSelectedTaskId(null);return}if(!selectedTaskId||!taskRecords.some(task=>task.id===selectedTaskId))setSelectedTaskId(currentRunTask?.id??taskRecords[0].id)},[taskRecords,selectedTaskId,currentRunTask?.id])
  useEffect(()=>{if(!plans.length){setSelectedPlanId(null);return}if(!selectedPlanId||!plans.some(plan=>plan.id===selectedPlanId))setSelectedPlanId(plans.find(plan=>plan.status==='active')?.id??plans.find(plan=>plan.status==='blocked')?.id??plans[0].id)},[plans,selectedPlanId])
  useEffect(()=>{if(candidateTaskId!=='all'&&!taskRecords.some(task=>task.id===candidateTaskId))setCandidateTaskId('all')},[candidateTaskId,taskRecords])
  useEffect(()=>{setCheckedCandidates(new Set())},[candidateTaskId,candidateScope])
  useEffect(()=>{if(searchParams.get('create')==='1'){setDialog('task');setSearchParams({}, {replace:true})}},[searchParams,setSearchParams])
  const candidateRecords=candidateQuery.data?.items??[]
  const candidates=useMemo<Candidate[]>(()=>candidateRecords.map(candidate=>({
    id:candidate.id,company:candidate.company,region:candidate.region,industry:candidate.industry,size:candidate.size,
    score:candidate.score,signal:candidate.signal,source:candidate.source,taskName:candidate.radarTaskId?taskNameById.get(candidate.radarTaskId)??'历史任务':'直接录入',value:formatCandidateValue(candidate.estimatedValue,candidate.currency),
    confidence:candidate.confidence,updatedAt:formatUpdated(candidate.updatedAt),reason:candidate.reason,dimensions:candidate.dimensions,
    evidence:candidate.evidence.map(item=>({title:item.title,source:item.source,time:item.time,strength:item.strength,sourceUrl:item.sourceUrl})),intentSignals:candidate.intentSignals??[],committee:candidate.committee,contacts:candidate.contacts??[],relationships:candidate.relationships,
  })),[candidateRecords,taskNameById])
  const taskCandidateRecords=taskCandidateQuery.data?.items??[]
  const sourceSummary=useMemo(()=>{
    const counts=new Map<string,number>()
    taskCandidateRecords.forEach(candidate=>counts.set(candidate.source,(counts.get(candidate.source)??0)+1))
    return [...counts.entries()].sort((a,b)=>b[1]-a[1])
  },[taskCandidateRecords])
  const saved=useMemo(()=>{const companies=new Set(customerQuery.data?.items.map(customer=>customer.company)??[]);return new Set(candidateRecords.filter(candidate=>candidate.status==='saved'||companies.has(candidate.company)).map(candidate=>candidate.id))},[candidateRecords,customerQuery.data])
  const targetMarkets=[...new Set([selectedMarketName,...analysisMarkets(profileQuery.data?.analysisSummary)].filter(Boolean))]
  const filtered = useMemo(() => { const rows=candidates.filter(c => {
    const matchesQuery = !query || `${c.company}${c.industry}${c.region}${c.signal}${c.source}${c.taskName??''}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === '全部' || (filter === '高匹配' && c.score >= 92) || (filter === '强信号' && /新建|扩张|招投标|访问/.test(c.signal))
    const matchesMode = source === '全部来源' ||
      (source === '地图' && /地图|本地企业/.test(c.source)) ||
      (source === '企业官网' && /官网|公开网络/.test(c.source)) ||
      (source === '搜索引擎' && /搜索|公开网络|新闻/.test(c.source)) ||
      (source === '行业目录' && /行业目录/.test(c.source)) ||
      (source === '展会协会' && /展会|协会/.test(c.source)) ||
      (source === '采购公告' && /招投标|采购公告/.test(`${c.source}${c.signal}`)) ||
      (source === '种子名单' && /种子名单/.test(c.source))
    return matchesQuery && matchesFilter && matchesMode
  });if(sort==='匹配分最高')return [...rows].sort((a,b)=>b.score-a.score);if(sort==='匹配分最低')return [...rows].sort((a,b)=>a.score-b.score);if(sort==='企业名称 A–Z')return [...rows].sort((a,b)=>a.company.localeCompare(b.company,'zh-CN'));if(sort==='企业名称 Z–A')return [...rows].sort((a,b)=>b.company.localeCompare(a.company,'zh-CN'));if(sort==='证据置信度最高')return [...rows].sort((a,b)=>b.confidence-a.confidence);if(sort==='证据置信度最低')return [...rows].sort((a,b)=>a.confidence-b.confidence);if(sort==='预计价值最高')return [...rows].sort((a,b)=>moneyValue(b.value)-moneyValue(a.value));if(sort==='预计价值最低')return [...rows].sort((a,b)=>moneyValue(a.value)-moneyValue(b.value));if(sort==='最早发现')return [...rows].reverse();return rows}, [candidates,filter, source, query,sort])
  const candidatePaging=usePagination(filtered,10,`${candidateTaskId}|${query}|${filter}|${source}|${sort}`)
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
  const enrichCandidate=async(candidate:Candidate)=>{const result=await radarApi.enrichCandidateContacts(candidate.id);const refreshed=await candidateQuery.refetch();const next=refreshed.data?.items.find(item=>item.id===candidate.id);if(next)setSelected({...candidate,confidence:next.confidence,evidence:next.evidence.map(item=>({title:item.title,source:item.source,time:item.time,strength:item.strength,sourceUrl:item.sourceUrl})),intentSignals:next.intentSignals??[],committee:next.committee,contacts:next.contacts??[],relationships:next.relationships,updatedAt:formatUpdated(next.updatedAt)});return result.message}
  const createCandidateTask=async(candidate:Candidate)=>{const customer=(await ensureCandidateCustomer(candidate)).record;const title='完成首次触达并记录结果';const dueAt=Date.now()+48*60*60*1000;await taskApi.create({customerId:customer.id,title,priority:'高',dueAt,dueLabel:'48 小时内',company:customer.company,nextAction:title,impact:customer.estimatedValue?`¥${customer.estimatedValue.toLocaleString('zh-CN')}`:'待评估',source:'AI 获客'});await customerQuery.refetch()}
  const archiveCandidates=async(ids:string[], archived:boolean)=>{try{await Promise.all(ids.map(id=>radarApi.archiveCandidate(id,archived)));await candidateQuery.refetch();setCheckedCandidates(new Set());setSelected(null);showToast(archived?`已归档 ${ids.length} 家候选`:`已恢复 ${ids.length} 家候选`)}catch(cause){showToast(cause instanceof Error?cause.message:'归档操作失败')}
  }
  const restoreRejectedCandidates=async(ids:string[])=>{try{await Promise.all(ids.map(id=>radarApi.updateCandidate(id,'candidate')));await candidateQuery.refetch();setCheckedCandidates(new Set());setSelected(null);showToast(`已恢复 ${ids.length} 家候选`)}catch(cause){showToast(cause instanceof Error?cause.message:'恢复候选失败')}}
  const recordCandidateFeedback=async(candidate:Candidate,value:'match'|'mismatch')=>{await radarApi.updateCandidate(candidate.id,value==='match'?'review':'rejected');await candidateQuery.refetch();if(value==='mismatch')setSelected(null)}
  const createRadarTask=async(values:Record<string,string>)=>{const seedUrls=(values.seedUrls??'').split(/[\n,，]+/).map(value=>value.trim()).filter(Boolean);const dataSources=(values.dataSources||'搜索引擎,地图,行业目录,展会协会,采购公告').split(',').map(value=>dataSourceId[value]).filter(Boolean);const intentSignals=(values.intentSignals||'采购公告,扩张建设,招聘变化,新闻融资').split(',').map(value=>value.trim()).filter(Boolean);const scheduleType=values.schedule==='每天自动'?'daily':values.schedule==='每周一自动'?'weekly':values.schedule==='仅运行一次'?'manual':'weekdays';const fullAutopilot=values.automation==='全自动开发（安全发送）';const result=await radarApi.createPlan({name:values.name,icp:values.icp,mode:'智能多渠道',strategy:values.strategy||'目标企业发现',dataSources,intentSignals,depth:values.depth||'标准研究',candidateLimit:Number(values.limit),dailyCandidateLimit:Number(values.limit),knowledgeScope:values.knowledge||`全部已启用知识（${enabledKnowledge} 条）`,targetRegion:values.region,researchLanguage:values.language||'自动匹配目标市场',inputSource:'AI 获客',seedUrls,scheduleType,runTimeLocal:values.runTime||'08:00',timezone:authSession.data?.user.timezone||'Asia/Shanghai',weekdays:scheduleType==='weekly'?[1]:[1,2,3,4,5],requireAi:true,automationMode:values.automation==='自动研究'?'research_only':'safe_autopilot',autoOutreachEnabled:fullAutopilot,runImmediately:true});setSelectedPlanId(result.plan.id);if(result.initialRun){setSelectedTaskId(result.initialRun.task.id);setCandidateTaskId(result.initialRun.task.id)}await Promise.all([radarTaskQuery.refetch(),planQuery.refetch()]);setRunHistoryOpen(true);if(!result.initialRun)showToast(result.aiReadiness.message)}
  const importRadarTask=async(values:Record<string,string>)=>{const file=values.file as unknown;if(!(file instanceof File))throw new Error('请选择名单文件');const rows=await parseLeadFile(file);const valuesToCheck=rows.flatMap(row=>Object.values(row));const urls=valuesToCheck.flatMap(value=>{const matches=value.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})(?:\/[^\s,，;；]*)?/gi)??[];return matches.map(match=>/^https?:\/\//i.test(match)?match:`https://${match}`)});const seedUrls=[...new Set(urls)];if(!seedUrls.length)throw new Error('未在名单中识别到官网或域名，请检查 website、domain、官网、网站或网址列。');const created=await radarApi.createTask({name:`种子名单研究 · ${file.name}`,icp:values.market,mode:'种子名单',strategy:'自定义名单研究',dataSources:['seed-list','website'],intentSignals:[],depth:'标准研究',candidateLimit:100,knowledgeScope:'全部已启用知识',targetRegion:'按名单识别',researchLanguage:'自动匹配目标市场',inputSource:`种子名单 · ${file.name}`,seedUrls});setSelectedTaskId(created.id);setCandidateTaskId(created.id);await radarTaskQuery.refetch();setRunHistoryOpen(true)}
  const changeTaskStatus=async(action:'pause'|'resume'|'cancel'|'retry')=>{if(!activeTask)return;try{await radarApi.taskAction(activeTask.id,action);await Promise.all([radarTaskQuery.refetch(),queueQuery.refetch()]);showToast(action==='pause'?'任务已暂停':action==='resume'?'任务已继续':action==='cancel'?'任务已取消':'任务已重新进入队列')}catch(cause){showToast(cause instanceof Error?cause.message:'任务状态更新失败。')}}
  const simulateCurrentPlan=async()=>{if(!currentPlan)return;try{const result=await automationApi.simulatePlan(currentPlan.id);setSimulationResult(result);showToast(result.safe?'全流程演练通过':'演练发现需要处理的安全门槛')}catch(cause){showToast(cause instanceof Error?cause.message:'全流程演练失败')}}
  const latestQueue=queueQuery.data?.items[0]
  const researchCandidates=taskCandidateRecords.filter(candidate=>candidate.status==='candidate'||candidate.status==='review').slice(0,3)
  const savedCount=taskCandidateRecords.filter(candidate=>candidate.status==='saved').length
  const openRunHistory=(taskId?:string)=>{if(taskId)setSelectedTaskId(taskId);setRunHistoryOpen(true)}
  const changePlanStatus=async(action:'pause'|'resume'|'run'|'archive')=>{if(!currentPlan)return;try{const result=await radarApi.planAction(currentPlan.id,action);const run='run' in result?result.run:undefined;if(run)setSelectedTaskId(run.task.id);await Promise.all([planQuery.refetch(),radarTaskQuery.refetch()]);showToast(action==='pause'?'自动获客已暂停':action==='resume'?'自动获客已恢复':action==='run'?'已安排立即运行':'获客计划已归档')}catch(cause){showToast(cause instanceof Error?cause.message:'获客计划更新失败。')}}
  const updateCurrentPlan=async(values:Record<string,string>)=>{if(!currentPlan)return;const scheduleType=values.schedule==='每天自动'?'daily':values.schedule==='每周一自动'?'weekly':values.schedule==='仅运行一次'?'manual':'weekdays';const fullAutopilot=values.automation==='全自动开发（安全发送）';const dataSources=(values.dataSources||'').split(',').map(value=>dataSourceId[value]).filter(Boolean);const intentSignals=(values.intentSignals||'').split(',').map(value=>value.trim()).filter(Boolean);const seedUrls=(values.seedUrls??'').split(/[\n,，]+/).map(value=>value.trim()).filter(Boolean);await radarApi.updatePlan(currentPlan.id,{name:values.name,icp:values.icp,strategy:values.strategy,dataSources,intentSignals,depth:values.depth,knowledgeScope:values.knowledge,targetRegion:values.region,researchLanguage:values.language,candidateLimit:Number(values.limit),dailyCandidateLimit:Number(values.limit),seedUrls,scheduleType,runTimeLocal:values.runTime,timezone:authSession.data?.user.timezone||currentPlan.timezone,weekdays:scheduleType==='weekly'?[1]:[1,2,3,4,5],automationMode:values.automation==='自动研究'?'research_only':'safe_autopilot',autoOutreachEnabled:fullAutopilot});await planQuery.refetch()}
  const changeGlobalAutomation=async(action:'pause_all'|'resume_all')=>{try{const result=await radarApi.setAutomationControl(action);await Promise.all([productionQuery.refetch(),planQuery.refetch()]);showToast(action==='pause_all'?`自动触达已暂停，取消 ${result.cancelledMessages??0} 条待发送消息`:`已恢复 ${result.affectedPlans??0} 个全自动计划`)}catch(cause){showToast(cause instanceof Error?cause.message:'生产运行状态更新失败。')}}

  return <PageContainer>
    <PageHeader title="AI 获客" description="统一使用搜索、地图、官网、行业名录和采购公告发现客户，并推进至客户与跟进闭环。" actions={<>
      <Button disabled={!canWrite} onClick={() => setDialog('import')}><Import size={16} />导入名单</Button>
      <Button onClick={()=>openRunHistory(currentRunTask?.id)}><Activity size={16}/>运行记录{runningTasks.length>0&&<Badge tone="blue">{runningTasks.length}</Badge>}</Button>
      <Button variant="primary" disabled={!canWrite} onClick={() => setDialog('task')}><Plus size={16} />创建获客</Button>
    </>} />

    {(currentPlan||currentRunTask)&&<Card size="small">
      <Flex align="center" justify="space-between" wrap gap={16}>
        <Space orientation="vertical" size={2} style={{minWidth:0}}>
          <Space wrap size={8}>{currentPlan?<Badge tone={planTone(currentPlan.status)}>{planStatusLabels[currentPlan.status]}</Badge>:currentRunTask&&<Badge tone={taskTone(currentRunTask.status)}>{statusLabels[currentRunTask.status]}</Badge>}<Typography.Text strong>{currentPlan?.name??currentRunTask?.name}</Typography.Text></Space>
          <Typography.Text type="secondary">{currentRunTask&&['queued','running'].includes(currentRunTask.status)?`${currentRunTask.currentStage} · 已发现 ${currentRunTask.candidatesFound} 家 · ${currentRunTask.highMatchCount} 家高匹配`:currentPlan?`${scheduleLabels[currentPlan.scheduleType]} ${currentPlan.runTimeLocal} · ${currentPlan.nextRunAt?`下次运行 ${formatUpdated(currentPlan.nextRunAt)}`:currentPlan.lastError||'按需运行'}`:''}</Typography.Text>
        </Space>
        <Flex align="center" gap={12} wrap>
          {currentRunTask&&['queued','running'].includes(currentRunTask.status)&&<Progress aria-label={`${currentRunTask.name}自动发现进度`} percent={currentRunTask.progress} style={{width:180,margin:0}}/>}
          <Button size="sm" onClick={()=>openRunHistory(currentRunTask?.id)}>查看详情</Button>
        </Flex>
      </Flex>
    </Card>}

    {production&&production.state!=='not_configured'&&<Card size="small" title="生产运行控制" extra={<Space size={8}><Badge tone={production.state==='running'&&production.readyToSend?'green':production.readyToSend?'orange':'red'}>{production.state==='running'&&production.readyToSend?'自动运行中':production.state==='paused'?'已暂停':'等待就绪'}</Badge><Popconfirm title={production.state==='running'?'暂停全部自动触达？':'恢复全部自动触达？'} description={production.state==='running'?'待发送的自动消息会立即取消，已经发送的消息不会撤回。':'仅在发件、收件和安全阈值检查通过后恢复。'} okText={production.state==='running'?'暂停':'恢复'} cancelText="取消" onConfirm={()=>changeGlobalAutomation(production.state==='running'?'pause_all':'resume_all')}><Button size="sm" variant={production.state==='running'?'danger':'primary'} disabled={!canWrite||(production.state!=='running'&&!production.readyToSend)}>{production.state==='running'?'全部暂停':'恢复自动运行'}</Button></Popconfirm></Space>}>
      <Row gutter={[16,16]}>
        <Col xs={12} md={6}><Statistic title="今日发现" value={production.today.candidates} suffix="家"/><Typography.Text type="secondary">自动准入 {production.today.promoted} 家</Typography.Text></Col>
        <Col xs={12} md={6}><Statistic title="今日触达" value={production.today.sent} suffix="封"/><Typography.Text type="secondary">待发送 {production.pendingMessages} 封</Typography.Text></Col>
        <Col xs={12} md={6}><Statistic title="今日回复" value={production.today.replies} suffix="条"/><Typography.Text type="secondary">高意向 {production.today.highIntent} 条</Typography.Text></Col>
        <Col xs={12} md={6}><Statistic title="今日商机" value={production.today.deals} suffix="个"/><Typography.Text type="secondary">待人工接管 {production.today.needsHuman} 项</Typography.Text></Col>
      </Row>
      <Flex gap={16} wrap align="center" style={{marginTop:12}}>
        <Typography.Text type="secondary">发件服务 {production.connections.healthy}/{production.connections.total} 可用 · 回复接收 {production.connections.inboundReady} 个 · 近 7 天退信率 {production.deliveryHealth.bounceRate}% · 投诉 {production.deliveryHealth.complained} 次{production.nextScheduledAt?` · 下封 ${formatUpdated(production.nextScheduledAt)}`:''}</Typography.Text>
        {production.ramps[0]&&<Typography.Text type="secondary">{production.ramps[0].stage} · 今日 {production.ramps[0].used}/{production.ramps[0].limit} 封</Typography.Text>}
      </Flex>
      {production.issues[0]&&<div style={{marginTop:12}}><StatusNotice tone={production.issues[0].level==='error'?'warning':'info'} title={production.issues[0].title} description={production.issues[0].description}/></div>}
    </Card>}

    <Panel>
        <TableToolbar filters={<>
            <SearchInput ariaLabel="搜索候选客户" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索企业、行业、信号或任务"/>
            <CustomSelect ariaLabel="筛选真实数据源" value={source} onChange={value=>setSource(value as SourceFilter)} options={sourceFilters}/>
            <CustomSelect ariaLabel="筛选候选状态" value={filter} onChange={value=>setFilter(value as Filter)} options={[{value:'全部',label:'全部候选'},{value:'高匹配',label:'高匹配'},{value:'强信号',label:'强信号'}]}/>
            <CustomSelect ariaLabel="筛选来源任务" value={candidateTaskId} onChange={setCandidateTaskId} options={[{value:'all',label:'全部运行'},...taskRecords.map(task=>({value:task.id,label:task.name}))]}/>
            <CustomSelect ariaLabel="筛选候选范围" value={candidateScope} onChange={value=>setCandidateScope(value as CandidateScope)} options={[{value:'active',label:'当前候选'},{value:'rejected',label:'已排除'},{value:'archived',label:'已归档'}]}/>
            <CustomSelect ariaLabel="候选排序" value={sort} onChange={value=>setSort(value as CandidateSort)} options={['匹配分最高','匹配分最低','企业名称 A–Z','企业名称 Z–A','证据置信度最高','证据置信度最低','预计价值最高','预计价值最低','最近发现','最早发现']}/>
            <Button disabled={candidateScope==='active'&&candidateTaskId==='all'&&!query&&filter==='全部'&&source==='全部来源'&&sort==='匹配分最高'} onClick={()=>{setCandidateScope('active');setCandidateTaskId('all');setQuery('');setFilter('全部');setSource('全部来源');setSort('匹配分最高')}}>清除筛选</Button>
          </>} selection={checkedCandidates.size>0?<SelectionBar count={checkedCandidates.size} unit="家候选" actions={<>{candidateScope==='active'?<><Button disabled={!canWrite} onClick={saveChecked}><Bookmark/>保存客户</Button><Button disabled={!canWrite} onClick={()=>setBatchTaskOpen(true)}><CheckCircle2/>创建跟进</Button><Button disabled={!canWrite} onClick={()=>archiveCandidates([...checkedCandidates],true)}><Layers3/>归档所选</Button></>:candidateScope==='archived'?<Button disabled={!canWrite} onClick={()=>archiveCandidates([...checkedCandidates],false)}>恢复所选</Button>:<Button disabled={!canWrite} onClick={()=>restoreRejectedCandidates([...checkedCandidates])}>返回候选</Button>}<Button aria-label="取消选择" title="取消选择" onClick={()=>setCheckedCandidates(new Set())}><X/></Button></>}/>:undefined}/>
        <CandidateList candidates={candidatePaging.pageItems} saved={saved} selected={checkedCandidates} sort={sort} onSortChange={setSort} onSelectionChange={setCheckedCandidates} onOpen={setSelected} onSave={!canWrite?async()=>showToast('当前角色为只读成员，不能修改候选客户。'):candidateScope!=='active'?async()=>showToast(candidateScope==='archived'?'请先恢复候选，再保存至客户库。':'请先将客户返回候选，再保存至客户库。'):save} />
        {filtered.length>0&&<Pagination page={candidatePaging.page} pageSize={candidatePaging.pageSize} total={filtered.length} onPageChange={candidatePaging.setPage} onPageSizeChange={candidatePaging.setPageSize} itemName="家候选"/>}
    </Panel>

    <CompanyDecisionDrawer candidate={selected} open={Boolean(selected)} canWrite={canWrite&&candidateScope==='active'} onClose={() => setSelected(null)} onSave={candidateScope!=='active'?async()=>showToast(candidateScope==='archived'?'请先恢复候选，再保存至客户库。':'请先将客户返回候选，再保存至客户库。'):save} onEnrich={enrichCandidate} onCreateTask={createCandidateTask} onFeedback={recordCandidateFeedback} />
    <CreateDialog open={dialog==='task'} title="创建获客计划" description="设置一次后，系统会按计划自动发现、去重并研究客户；区域计划每轮自动选择一个具体国家，避免不同市场的数据混在一起。" submitLabel="创建并运行" successMessage="获客计划已保存" onClose={()=>setDialog(null)} onSubmit={createRadarTask} initialValues={{icp:selectedMarketName,knowledge:`全部已启用知识（${enabledKnowledge} 条）`,strategy:'目标企业发现',dataSources:'搜索引擎,地图,行业目录,展会协会,采购公告',intentSignals:'采购公告,扩张建设,招聘变化,新闻融资',region:'全球海外市场（自动轮换国家）',language:'自动匹配目标市场',depth:'标准研究',limit:'100',schedule:'工作日自动',runTime:'08:00',automation:'自动研究'}} fields={[{name:'name',label:'计划名称',required:true,placeholder:'例如：全球卫生级泵阀客户开发'},{name:'icp',label:'目标客户',type:'select',required:true,options:targetMarkets},{name:'region',label:'目标地区',type:'select',required:true,options:overseasRegionOptions,description:'系统会在所选区域内按轮次切换具体国家；每轮客户都必须通过官网、地址或国家域名验证。'},{name:'limit',label:'每轮候选上限',type:'number',min:1,max:10000,required:true},{name:'schedule',label:'运行周期',type:'select',required:true,options:['工作日自动','每天自动','每周一自动','仅运行一次']},{name:'runTime',label:'运行时间',type:'time',required:true,description:`使用账户时区 ${authSession.data?.user.timezone||'Asia/Shanghai'}；服务重启或错过时间会自动补跑。`},{name:'automation',label:'自动化程度',type:'select',required:true,options:['自动研究','安全自动推进','全自动开发（安全发送）'],description:'全自动开发仅对高分、多证据、已验证且未退订的邮箱生成个性化首触达；工作时段错峰发送，未回复时最多跟进 2 次，客户一旦回复即停止，30 天内不会重复触达。'},{name:'strategy',label:'获客策略',type:'select',options:strategyOptions,advanced:true},{name:'dataSources',label:'使用的数据源',type:'multiselect',options:dataSourceOptions,placeholder:'留空时使用推荐数据源',advanced:true},{name:'intentSignals',label:'关注的意向信号',type:'multiselect',options:intentSignalOptions,advanced:true},{name:'knowledge',label:'参考的业务知识',type:'select',options:[`全部已启用知识（${enabledKnowledge} 条）`,'仅产品与客户判断规则','产品、案例与市场知识','不引用增长知识'],advanced:true},{name:'language',label:'研究语言',type:'select',options:researchLanguageOptions,description:'建议保留“自动匹配目标市场”；指定语言时，搜索词、研究摘要和首触达内容会优先使用该语言。',advanced:true},{name:'depth',label:'研究深度',type:'select',options:['快速发现','标准研究','深度核验'],advanced:true},{name:'seedUrls',label:'补充公开网址',type:'textarea',placeholder:'每行一个官网、目录、展会或采购来源网址',advanced:true}]} />
    <CreateDialog open={dialog==='edit'} title="编辑获客计划" description="所有设置会从下一轮开始生效；正在运行的本轮不会被中断。" submitLabel="保存计划" successMessage="获客计划已更新" onClose={()=>setDialog(null)} onSubmit={updateCurrentPlan} initialValues={currentPlan?{name:currentPlan.name,icp:currentPlan.icp,strategy:currentPlan.strategy,dataSources:currentPlan.dataSources.map(item=>dataSourceName[item]??item).join(','),intentSignals:currentPlan.intentSignals.join(','),knowledge:currentPlan.knowledgeScope,language:currentPlan.researchLanguage,depth:currentPlan.depth,seedUrls:currentPlan.seedUrls.join('\n'),region:overseasRegionOptions.includes(currentPlan.targetRegion)?currentPlan.targetRegion:'全球海外市场（自动轮换国家）',limit:String(currentPlan.candidateLimit),schedule:currentPlan.scheduleType==='daily'?'每天自动':currentPlan.scheduleType==='weekly'?'每周一自动':currentPlan.scheduleType==='manual'?'仅运行一次':'工作日自动',runTime:currentPlan.runTimeLocal,automation:currentPlan.autoOutreachEnabled?'全自动开发（安全发送）':currentPlan.automationMode==='safe_autopilot'?'安全自动推进':'自动研究'}:{}} fields={[{name:'name',label:'计划名称',required:true},{name:'icp',label:'目标客户',type:'select',required:true,options:targetMarkets},{name:'region',label:'目标地区',type:'select',required:true,options:overseasRegionOptions},{name:'limit',label:'每轮候选上限',type:'number',min:1,max:10000,required:true},{name:'schedule',label:'运行周期',type:'select',required:true,options:['工作日自动','每天自动','每周一自动','仅运行一次']},{name:'runTime',label:'运行时间',type:'time',required:true},{name:'automation',label:'自动化程度',type:'select',required:true,options:['自动研究','安全自动推进','全自动开发（安全发送）']},{name:'strategy',label:'获客策略',type:'select',options:strategyOptions,advanced:true},{name:'dataSources',label:'使用的数据源',type:'multiselect',options:dataSourceOptions,advanced:true},{name:'intentSignals',label:'关注的意向信号',type:'multiselect',options:intentSignalOptions,advanced:true},{name:'knowledge',label:'参考的业务知识',type:'select',options:[`全部已启用知识（${enabledKnowledge} 条）`,'仅产品与客户判断规则','产品、案例与市场知识','不引用增长知识'],advanced:true},{name:'language',label:'研究语言',type:'select',options:researchLanguageOptions,advanced:true},{name:'depth',label:'研究深度',type:'select',options:['快速发现','标准研究','深度核验'],advanced:true},{name:'seedUrls',label:'补充公开网址',type:'textarea',placeholder:'每行一个官网、目录、展会或采购来源网址',advanced:true}]} />
    <CreateDialog open={dialog==='import'} title="导入种子名单" description="支持 CSV、XLSX 和可搜索 PDF；系统会识别官网或域名列，并进入种子 URL 研究队列。" submitLabel="进入导入队列" successMessage="名单导入任务已进入队列" onClose={()=>setDialog(null)} onSubmit={importRadarTask} fields={[{name:'file',label:'名单文件',type:'file',accept:'.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf',required:true},{name:'market',label:'关联客户定位',type:'select',required:true,options:targetMarkets}]}/>
    <CreateDialog open={batchTaskOpen} title={`为 ${checkedCandidates.size} 家候选创建跟进任务`} description="候选会先保存至客户库，再生成统一的跟进任务。" submitLabel="创建跟进" successMessage="候选已保存并创建跟进任务" onClose={()=>setBatchTaskOpen(false)} onSubmit={createCheckedTask} fields={[{name:'title',label:'任务名称',required:true,placeholder:'例如：复核联系人并完成首次触达'},{name:'due',label:'截止时间',required:true},{name:'priority',label:'优先级',type:'select',required:true,options:['高','中','低']},{name:'note',label:'执行说明',type:'textarea'}]}/>
    <DetailDrawer open={runHistoryOpen} width={720} title="运行记录" subtitle="查看客户发现进度、结果和执行日志" onClose={()=>setRunHistoryOpen(false)} footer={<>{activeTask&&['queued','running'].includes(activeTask.status)&&<Button onClick={()=>changeTaskStatus('pause')}>暂停运行</Button>}{activeTask?.status==='paused'&&<Button onClick={()=>changeTaskStatus('resume')}>继续运行</Button>}{activeTask?.status==='failed'&&<Button onClick={()=>changeTaskStatus('retry')}>重新运行</Button>}{activeTask&&['queued','running','paused','failed'].includes(activeTask.status)&&<Button variant="danger" onClick={()=>changeTaskStatus('cancel')}>取消运行</Button>}<Button onClick={()=>setRunHistoryOpen(false)}>关闭</Button><Button variant="primary" onClick={()=>{setRunHistoryOpen(false);setDialog('task')}}>{activeTask?'复制并新建':'创建获客'}</Button></>}>
      <Space orientation="vertical" size="middle" style={{width:'100%'}}>
        <DetailSection title="获客计划" subtitle="选择计划后查看、编辑或控制对应的自动运行" extra={currentPlan?<Badge tone={planTone(currentPlan.status)}>{planStatusLabels[currentPlan.status]}</Badge>:undefined}>
          {plans.length>1&&<div style={{marginBottom:12}}><CustomSelect ariaLabel="选择获客计划" value={currentPlan?.id??''} onChange={setSelectedPlanId} options={plans.map(plan=>({value:plan.id,label:plan.name}))}/></div>}
          {currentPlan?<><Descriptions bordered column={1} items={[{key:'schedule',label:'运行周期',children:`${scheduleLabels[currentPlan.scheduleType]} ${currentPlan.runTimeLocal}`},{key:'next',label:'下次运行',children:currentPlan.nextRunAt?new Date(currentPlan.nextRunAt).toLocaleString('zh-CN'):'按需运行'},{key:'runs',label:'累计运行',children:`${currentPlan.totalRuns} 轮`},{key:'automation',label:'自动化程度',children:currentPlan.autoOutreachEnabled?'高质量候选自动入库，并在安全门槛通过后执行有限触达序列；客户回复即停止':currentPlan.automationMode==='safe_autopilot'?'高质量候选自动入库，首次触达需人工批准':'自动研究，人工决定是否入库'},{key:'ai',label:'AI 门槛',children:currentPlan.requireAi?'AI 健康后自动运行':'允许基础研究'}]}/>{currentPlan.lastError&&<Alert type="warning" showIcon title={currentPlan.lastError} style={{marginTop:12}}/>}<Flex gap={8} wrap style={{marginTop:12}}><Button size="sm" disabled={!canWrite} onClick={()=>setDialog('edit')}>编辑计划</Button><Button size="sm" onClick={simulateCurrentPlan}>全流程演练</Button><Button size="sm" disabled={!canWrite} onClick={()=>changePlanStatus('run')}>立即运行</Button>{currentPlan.status==='paused'?<Button size="sm" disabled={!canWrite} onClick={()=>changePlanStatus('resume')}>恢复自动运行</Button>:<Button size="sm" disabled={!canWrite} onClick={()=>changePlanStatus('pause')}>暂停自动运行</Button>}<Popconfirm title="归档当前获客计划？" description="归档后不会继续自动运行，历史任务和候选客户仍会保留。" okText="归档" cancelText="取消" onConfirm={()=>changePlanStatus('archive')}><Button size="sm" variant="danger" disabled={!canWrite}>归档计划</Button></Popconfirm></Flex></>:<EmptyState title="尚未建立持续获客计划" description="创建后系统会按周期自动运行。" icon={Clock3}/>}
        </DetailSection>
        {currentPlan&&<DetailSection title="学习版本" subtitle="结果样本形成版本，可冻结或恢复历史版本"><List dataSource={learningVersionsQuery.data?.items.slice(0,5)??[]} locale={{emptyText:<EmptyState title="暂无学习版本" description="形成明确结果后会自动创建版本。"/>}} renderItem={version=><List.Item actions={version.status==='active'?[<Button key="freeze" size="sm" onClick={async()=>{await automationApi.learningAction(version.id,'freeze');await learningVersionsQuery.refetch()}}>冻结</Button>]:[<Button key="activate" size="sm" onClick={async()=>{await automationApi.learningAction(version.id,'activate');await learningVersionsQuery.refetch()}}>启用此版本</Button>]}><List.Item.Meta title={`v${version.version} · ${version.status==='active'?'当前启用':version.status==='frozen'?'已冻结':'历史版本'}`} description={`${version.sampleCount} 条结果 · 正向率 ${version.positiveRate}%`}/></List.Item>}/></DetailSection>}
        <DetailSection title="最近运行" subtitle="运行只负责产生候选客户，不会限制主列表显示" extra={<Badge tone="blue">{taskRecords.length}</Badge>}>
          {taskRecords.length?<List dataSource={taskRecords.slice(0,10)} renderItem={task=><List.Item extra={<Space size={8}><Badge tone={taskTone(task.status)}>{statusLabels[task.status]}</Badge><Button size="sm" variant={task.id===activeTask?.id?'primary':'secondary'} onClick={()=>setSelectedTaskId(task.id)}>{task.id===activeTask?.id?'当前':'查看'}</Button></Space>}><List.Item.Meta avatar={<Activity/>} title={<Typography.Text strong>{task.name}</Typography.Text>} description={`${task.currentStage} · 已发现 ${task.candidatesFound} 家 · ${formatUpdated(task.createdAt)}`}/></List.Item>}/>:<EmptyState title="还没有运行记录" description="创建获客后，进度和结果会记录在这里。" icon={Activity}/>}
        </DetailSection>
        <DetailSection title="完整自动化链路" subtitle="从发现、验证、入库到触达与结果的统一追踪"><List dataSource={automationRunsQuery.data?.items.slice(0,8)??[]} locale={{emptyText:<EmptyState title="暂无自动化链路"/>}} renderItem={run=><List.Item actions={[<Button key="view" size="sm" onClick={async()=>setAutomationRun(await automationApi.run(run.id))}>查看链路</Button>]}><List.Item.Meta avatar={<Activity/>} title={run.summary} description={`${run.runType==='simulation'?'演练':'真实运行'} · ${run.status} · ${formatUpdated(run.createdAt)}`}/></List.Item>}/></DetailSection>
        {activeTask&&<>
          <DetailSection title={activeTask.name} subtitle={`${activeTask.strategy} · 创建于 ${formatUpdated(activeTask.createdAt)}`} extra={<Badge tone={taskTone(activeTask.status)}>{statusLabels[activeTask.status]}</Badge>}>
            <Row gutter={[16,16]}><Col xs={12} sm={8}><Statistic title="运行进度" value={activeTask.progress} suffix="%"/></Col><Col xs={12} sm={8}><Statistic title="发现客户" value={activeTask.candidatesFound} suffix="家"/></Col><Col xs={12} sm={8}><Statistic title="高匹配" value={activeTask.highMatchCount} suffix="家"/></Col></Row>
            <Progress aria-label={`${activeTask.name}自动发现进度`} percent={activeTask.progress}/>
            <Typography.Text type="secondary">当前阶段：{activeTask.currentStage}{activeTask.lastError?` · ${activeTask.lastError}`:''}</Typography.Text>
            {activeTask.status==='completed'&&activeTask.candidatesFound<activeTask.candidateLimit&&<StatusNotice className="radar-run-notice" tone="info" title={`本轮形成 ${activeTask.candidatesFound} 家可核验候选`} description={`候选上限为 ${activeTask.candidateLimit} 家；完成度表示数据源已处理完。${sourceSummary.length?` 来源：${sourceSummary.map(([name,count])=>`${name} ${count} 家`).join('；')}。`:'本轮没有形成可核验候选。'}`}/>}
          </DetailSection>
          <DetailSection title="运行配置" subtitle="目标、地区与真实数据源">
            <Descriptions className="radar-run-config" bordered column={1} items={[{key:'icp',label:'客户定位',children:activeTask.icp},{key:'region',label:'目标地区',children:activeTask.targetRegion},{key:'sources',label:'数据源',children:activeTask.dataSources.map(item=>dataSourceName[item]??item).join('、')},{key:'signals',label:'意向信号',children:activeTask.intentSignals.join('、')||'未指定'},{key:'depth',label:'研究深度',children:activeTask.depth},{key:'limit',label:'候选上限',children:`${activeTask.candidateLimit} 家`}]}/>
          </DetailSection>
          <DetailSection title="处理结果" subtitle="从发现到保存客户库的当前数量">
            <List dataSource={[
              ['自动发现',String(activeTask.candidatesFound),'当前运行产生的候选',activeTask.progress],['高匹配',String(activeTask.highMatchCount),'匹配分 90 以上',activeTask.candidatesFound?Math.round(activeTask.highMatchCount/activeTask.candidatesFound*100):0],['待人工研究',String(researchCandidates.length),'需要核验证据与联系人',taskCandidateRecords.length?Math.round((taskCandidateRecords.length-researchCandidates.length)/taskCandidateRecords.length*100):0],['已保存客户库',String(savedCount),'已进入正式客户管理',taskCandidateRecords.length?Math.round(savedCount/taskCandidateRecords.length*100):0],
            ]} renderItem={(item,index)=><List.Item extra={<Typography.Text strong>{item[1]}</Typography.Text>}><List.Item.Meta avatar={<Badge tone="blue">{index+1}</Badge>} title={item[0]} description={<Space orientation="vertical" size={2}><Typography.Text type="secondary">{item[2]}</Typography.Text><Progress aria-label={`${item[0]}进度`} percent={Number(item[3])} showInfo={false}/></Space>}/></List.Item>}/>
          </DetailSection>
          <DetailSection title="执行日志" subtitle={`当前队列已尝试 ${latestQueue?.attempts??0} 次`}>
            {taskEventQuery.data?.items.length?<List dataSource={taskEventQuery.data.items.slice(0,8)} renderItem={event=><List.Item><List.Item.Meta avatar={<Activity/>} title={event.message} description={new Date(event.createdAt).toLocaleString('zh-CN')}/></List.Item>}/>:<EmptyState title="暂无执行记录" icon={Activity}/>}
          </DetailSection>
        </>}
      </Space>
    </DetailDrawer>
    <DetailDrawer open={Boolean(simulationResult)} width={640} title="全流程演练" subtitle="不会保存客户或发送真实消息" onClose={()=>setSimulationResult(null)} footer={<Button onClick={()=>setSimulationResult(null)}>关闭</Button>}>
      {simulationResult&&<Space orientation="vertical" size="middle" style={{width:'100%'}}><StatusNotice tone={simulationResult.safe?'success':'warning'} title={simulationResult.safe?'自动获客安全链路通过':'存在需要处理的安全门槛'} description={`追踪编号：${simulationResult.traceId}`}/><List dataSource={simulationResult.steps} renderItem={(step,index)=><List.Item><List.Item.Meta avatar={<Badge tone={step.status==='completed'?'green':step.status==='blocked'?'red':'orange'}>{index+1}</Badge>} title={step.title} description={step.description}/></List.Item>}/></Space>}
    </DetailDrawer>
    <DetailDrawer open={Boolean(automationRun)} width={680} title={automationRun?.summary??'自动化链路'} subtitle={automationRun?`追踪编号 ${automationRun.traceId}`:''} onClose={()=>setAutomationRun(null)} footer={<>{automationRun?.status==='failed'&&<Button variant="primary" onClick={async()=>{await automationApi.retryRun(automationRun.id);setAutomationRun(null);await automationRunsQuery.refetch();showToast('失败节点已重新进入队列')}}>重试失败运行</Button>}<Button onClick={()=>setAutomationRun(null)}>关闭</Button></>}>
      {automationRun&&<List dataSource={automationRun.events??[]} locale={{emptyText:<EmptyState title="暂无链路事件"/>}} renderItem={(event,index)=><List.Item><List.Item.Meta avatar={<Badge tone={event.status==='completed'?'green':event.status==='failed'?'red':event.status==='warning'?'orange':'blue'}>{index+1}</Badge>} title={event.title} description={<Space orientation="vertical" size={2}><Typography.Text type="secondary">{event.description}</Typography.Text><Typography.Text type="secondary">{formatUpdated(event.createdAt)}</Typography.Text></Space>}/></List.Item>}/>}
    </DetailDrawer>
  </PageContainer>
}
