import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, BriefcaseBusiness, CalendarDays, CheckCircle2, ClipboardCheck, Clock3, Download, Eye, Layers3, Plus, RefreshCw, ShieldCheck, TrendingUp, UserRound, X } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DataTable } from '@/components/ui/DataTable'
import { DetailDrawer } from '@/components/ui/DetailDrawer'
import { useUiStore } from '@/stores/ui-store'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { Modal } from '@/components/ui/Modal'
import { type DealRecord } from '@/stores/business-store'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { Panel } from '@/components/ui/Panel'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { downloadCsv } from '@/utils/download'
import { authApi, dealApi, type DealApiRecord } from '@/lib/api'
import { Checkbox } from 'antd'

const stages = ['线索确认', '需求确认', '方案评估', '商务谈判', '赢单']
const stageProbability:Record<string,number>={'线索确认':20,'需求确认':40,'方案评估':60,'商务谈判':80,'赢单':100}
type DealSort='阶段概率最高'|'企业名称 A–Z'|'企业名称 Z–A'|'阶段停留最长'|'阶段停留最短'
type RiskFilter='全部风险'|'仅看风险'
const sortIcon=(active:boolean,descending=false)=><span aria-hidden="true">{active?(descending?<ArrowDown/>:<ArrowUp/>):<ArrowUpDown/>}</span>
const currencySymbol:Record<DealApiRecord['currency'],string>={CNY:'¥',EUR:'€',USD:'$'}
type PipelineDealRecord = DealRecord & { closeDate: string }
const apiDealToRecord=(deal:DealApiRecord):PipelineDealRecord=>{const closeDate=deal.expectedCloseAt?new Date(deal.expectedCloseAt).toISOString().slice(0,10):'';return {id:deal.id,company:deal.company,stage:deal.stage,value:`${currencySymbol[deal.currency]}${deal.valueAmount.toLocaleString('zh-CN')}`,owner:deal.ownerLabel,next:deal.nextAction,close:deal.expectedCloseAt?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(deal.expectedCloseAt):'待安排',closeDate,risk:deal.risk,age:Math.max(0,Math.floor((Date.now()-deal.stageEnteredAt)/86_400_000)),source:deal.source}}
export function PipelinePage() {
  const showToast = useUiStore(s => s.showToast)
  const queryClient=useQueryClient()
  const [query,setQuery]=useState('');const [owner,setOwner]=useState('全部负责人');const [stageFilter,setStageFilter]=useState('全部阶段');const [riskFilter,setRiskFilter]=useState<RiskFilter>('全部风险');const [sort,setSort]=useState<DealSort>('阶段概率最高');const [archiveView,setArchiveView]=useState(false);const [selected,setSelected]=useState<number|null>(null);const [checked,setChecked]=useState<Set<string>>(new Set());  const [newOpen,setNewOpen]=useState(false);const [forecastOpen,setForecastOpen]=useState(false);const [editOpen,setEditOpen]=useState(false)
  const authSession=useQuery({queryKey:['auth-session'],queryFn:authApi.session,retry:false})
  const dealQuery=useQuery({queryKey:['deals',authSession.data?.workspace.id,archiveView],queryFn:()=>dealApi.list({pageSize:100,sort:'updated_desc',archivedOnly:archiveView}),enabled:Boolean(authSession.data?.workspace.id),retry:1})
  const dealRecords=useMemo(()=>dealQuery.data?.items.map(apiDealToRecord)??[],[dealQuery.data])
  const allDeals=useMemo(()=>dealRecords.map((deal,index)=>({...deal,probability:stageProbability[deal.stage]??20,index})),[dealRecords])
  const items=useMemo(()=>allDeals.filter(deal=>(!query||`${deal.company}${deal.owner}${deal.next}${deal.risk}`.toLowerCase().includes(query.toLowerCase()))&&(owner==='全部负责人'||deal.owner===owner)&&(stageFilter==='全部阶段'||deal.stage===stageFilter)&&(riskFilter==='全部风险'||deal.risk!=='已完成')).sort((a,b)=>sort==='企业名称 A–Z'?a.company.localeCompare(b.company,'zh-CN'):sort==='企业名称 Z–A'?b.company.localeCompare(a.company,'zh-CN'):sort==='阶段停留最长'?b.age-a.age:sort==='阶段停留最短'?a.age-b.age:b.probability-a.probability),[query,owner,stageFilter,riskFilter,sort,allDeals])
  const dealPaging=usePagination(items,6,`${query}|${owner}|${stageFilter}|${riskFilter}|${sort}`)
  const selectedDeal=selected===null?null:allDeals.find(item=>item.index===selected)??null
  const advance=async(company:string,_stage:string)=>{const deal=dealRecords.find(item=>item.company===company);if(!deal)return;const index=stages.indexOf(deal.stage);const next=stages[Math.min(index+1,stages.length-1)];if(next===deal.stage)return;await dealApi.update(deal.id,{stage:next as DealApiRecord['stage']});await Promise.all([dealQuery.refetch(),queryClient.invalidateQueries({queryKey:['customers']})]);showToast(`${company} 已推进至${next}`)}
  const advanceChecked=async()=>{const targets=dealRecords.filter(deal=>checked.has(deal.id)&&deal.stage!=='赢单');for(const deal of targets){const index=stages.indexOf(deal.stage);await dealApi.update(deal.id,{stage:stages[Math.min(index+1,stages.length-1)] as DealApiRecord['stage']})}await Promise.all([dealQuery.refetch(),queryClient.invalidateQueries({queryKey:['customers']})]);showToast(`已推进 ${targets.length} 个商机`);setChecked(new Set())}
  const archiveDeals=async(ids:string[], archived:boolean)=>{try{await Promise.all(ids.map(id=>dealApi.archive(id,archived)));await dealQuery.refetch();setChecked(new Set());setSelected(null);showToast(archived?`已归档 ${ids.length} 个商机`:`已恢复 ${ids.length} 个商机`)}catch(cause){showToast(cause instanceof Error?cause.message:'归档操作失败')}}
  const stageOptions=[
    {value:'全部阶段',label:'全部阶段',icon:<BriefcaseBusiness/>},
    {value:'线索确认',label:'线索确认',icon:<Eye/>},
    {value:'需求确认',label:'需求确认',icon:<UserRound/>},
    {value:'方案评估',label:'方案评估',icon:<ClipboardCheck/>},
    {value:'商务谈判',label:'商务谈判',icon:<TrendingUp/>},
    {value:'赢单',label:'赢单',icon:<CheckCircle2/>},
  ]
  const ownerOptions=['全部负责人',...[...new Set(dealRecords.map(deal=>deal.owner))]].map(label=>({value:label,label,icon:<UserRound/>}))
  const riskOptions=[{value:'全部风险',label:'全部风险',icon:<ShieldCheck/>},{value:'仅看风险',label:'仅看风险',icon:<AlertTriangle/>}]
  const sortOptions=[
    {value:'阶段概率最高',label:'阶段概率最高',icon:<TrendingUp/>},
    {value:'企业名称 A–Z',label:'企业名称 A–Z',icon:<ArrowDown/>},
    {value:'企业名称 Z–A',label:'企业名称 Z–A',icon:<ArrowUp/>},
    {value:'阶段停留最长',label:'阶段停留最长',icon:<Clock3/>},
    {value:'阶段停留最短',label:'阶段停留最短',icon:<Clock3/>},
  ]
  const clear=()=>{setQuery('');setOwner('全部负责人');setStageFilter('全部阶段');setRiskFilter('全部风险');setSort('阶段概率最高')}
  return <div><PageHeader title="商机跟进" description="聚焦成交概率、风险和下一步动作，把商机从线索稳定推进到成交。" actions={<><Button onClick={()=>setArchiveView(value=>!value)}><Layers3 size={16}/>{archiveView?'返回进行中':'已归档'}</Button><Button onClick={()=>setForecastOpen(true)}><TrendingUp size={16}/>查看预测</Button><Button variant="primary" onClick={()=>setNewOpen(true)}><Plus size={16}/>新建商机</Button></>}/>
    <Panel>
      <div>
        <div>
          <SearchInput ariaLabel="搜索商机" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索企业、负责人或下一步"/>
          <CustomSelect ariaLabel="筛选商机阶段" value={stageFilter} onChange={setStageFilter} options={stageOptions}/>
          <CustomSelect ariaLabel="筛选负责人" value={owner} onChange={setOwner} options={ownerOptions}/>
          <CustomSelect ariaLabel="筛选商机风险" value={riskFilter} onChange={value=>setRiskFilter(value as RiskFilter)} options={riskOptions}/>
          <CustomSelect ariaLabel="商机排序" value={sort} onChange={value=>setSort(value as DealSort)} options={sortOptions}/>
          <Button disabled={dealQuery.isFetching} onClick={async()=>{await dealQuery.refetch();showToast('商机列表已刷新')}}><RefreshCw className="is-spinning"/>刷新</Button>
          <Button disabled={!query&&owner==='全部负责人'&&stageFilter==='全部阶段'&&riskFilter==='全部风险'&&sort==='阶段概率最高'} onClick={clear}>清除筛选</Button>
        </div>
        <div aria-hidden={checked.size===0}>
          <span><CheckCircle2/><small>已选择</small><strong>{checked.size}</strong><small>个</small></span>
          <div>
            <Button disabled={archiveView} onClick={advanceChecked}><ArrowRight/>推进阶段</Button>
            <Button onClick={()=>archiveDeals([...checked],!archiveView)}><Layers3/>{archiveView?'恢复所选':'归档所选'}</Button>
            <Button onClick={()=>{const chosen=dealRecords.filter(deal=>checked.has(deal.id));downloadCsv('sondara-selected-deals.csv',[['企业','阶段','预计金额','负责人','预计成交','当前风险','下一步'],...chosen.map(deal=>[deal.company,deal.stage,deal.value,deal.owner,deal.close,deal.risk,deal.next])]);showToast(`已导出 ${chosen.length} 个商机`)}}><Download/>导出所选</Button>
            <Button aria-label="取消选择" title="取消选择" onClick={()=>setChecked(new Set())}><X/></Button>
          </div>
        </div>
      </div>
      {dealQuery.isPending?<div role="status"><RefreshCw className="is-spinning"/><strong>正在加载商机</strong><span>正在读取当前工作空间的商机数据…</span></div>:dealQuery.isError?<div role="alert"><AlertTriangle/><strong>商机加载失败</strong><span>{dealQuery.error instanceof Error?dealQuery.error.message:'请确认 API 服务可用。'}</span><Button onClick={()=>dealQuery.refetch()}>重新加载</Button></div>:items.length?<>
        <DataTable
          columns={[
            {key:'select',title:<span><Checkbox aria-label="选择本页全部商机" checked={dealPaging.pageItems.length>0&&dealPaging.pageItems.every(deal=>checked.has(deal.id))} onChange={event=>setChecked(current=>{const next=new Set(current);dealPaging.pageItems.forEach(deal=>event.target.checked?next.add(deal.id):next.delete(deal.id));return next})}/></span>,width:52},
            {key:'company',title:<Button onClick={()=>setSort(sort==='企业名称 A–Z'?'企业名称 Z–A':'企业名称 A–Z')}>企业档案{sortIcon(sort==='企业名称 A–Z'||sort==='企业名称 Z–A',sort==='企业名称 Z–A')}</Button>},
            {key:'stage',title:<Button onClick={()=>setSort('阶段概率最高')}>阶段与概率{sortIcon(sort==='阶段概率最高',true)}</Button>},
            {key:'value',title:'金额与成交'},
            {key:'risk',title:<Button onClick={()=>setSort(sort==='阶段停留最长'?'阶段停留最短':'阶段停留最长')}>负责人及风险{sortIcon(sort==='阶段停留最长'||sort==='阶段停留最短',sort==='阶段停留最长')}</Button>},
            {key:'next',title:'下一步动作'},
            {key:'actions',title:'操作'},
          ]}
          rows={dealPaging.pageItems.map(deal=>({key:deal.id,className:checked.has(deal.id)?'selected':'',cells:[
            <span><Checkbox aria-label={`选择 ${deal.company}`} checked={checked.has(deal.id)} onChange={event=>setChecked(current=>{const next=new Set(current);event.target.checked?next.add(deal.id):next.delete(deal.id);return next})}/></span>,
            <Button onClick={()=>setSelected(deal.index)}><i>{deal.company.slice(0,1)}</i><span><strong>{deal.company}</strong><small>{deal.source??'商机跟进'} · {deal.owner} 负责</small><em><BriefcaseBusiness/>当前商机阶段：{deal.stage}</em></span></Button>,
            <div><span><Badge tone={deal.probability>=80?'green':deal.probability>=60?'blue':'orange'}>{deal.stage}</Badge><strong>{deal.probability}%</strong></span><i><u style={{width:`${deal.probability}%`}}/></i><small>当前阶段成交概率</small></div>,
            <div><strong>{deal.value}</strong><small>预计 {deal.close} 成交</small></div>,
            <div><div><i><UserRound/></i><span><strong>{deal.owner}</strong><small><Clock3/>停留 {deal.age} 天</small></span></div><p><AlertTriangle/>{deal.risk}</p></div>,
            <Button onClick={()=>setSelected(deal.index)}><i><CalendarDays/></i><span><strong>{deal.next}</strong><small><ArrowRight/>查看详情并记录结果</small></span></Button>,
            <div><Button aria-label={`查看 ${deal.company}`} onClick={()=>setSelected(deal.index)}><Eye/></Button><Button aria-label={`推进 ${deal.company}`} disabled={archiveView||deal.stage==='赢单'} onClick={()=>advance(deal.company,deal.stage)}><ArrowRight/></Button><Button aria-label={`${archiveView?'恢复':'归档'} ${deal.company}`} onClick={()=>archiveDeals([deal.id],!archiveView)}><Layers3/></Button></div>,
          ]}))}
        />
        <Pagination page={dealPaging.page} pageSize={dealPaging.pageSize} total={items.length} onPageChange={dealPaging.setPage} onPageSizeChange={dealPaging.setPageSize} itemName="个商机"/>
      </>:<EmptyState title="暂无商机" description="从高意向客户或客户回复创建商机，开始记录金额、阶段和下一步。" icon={BriefcaseBusiness} action={<Button variant="primary" onClick={()=>setNewOpen(true)}><Plus/>新建商机</Button>}/>}
    </Panel>
    {selectedDeal&&<DetailDrawer open title={selectedDeal.company} subtitle={`${selectedDeal.owner} 负责 · 预计 ${selectedDeal.close} 成交`} onClose={()=>setSelected(null)} footer={<><Button onClick={()=>archiveDeals([selectedDeal.id],!archiveView)}><Layers3/>{archiveView?'恢复商机':'归档商机'}</Button><Button disabled={archiveView} onClick={()=>setEditOpen(true)}>编辑商机</Button><Button variant="primary" disabled={archiveView||selectedDeal.stage==='赢单'} onClick={()=>advance(selectedDeal.company,selectedDeal.stage)}>推进到下一阶段</Button></>}><div><Badge tone={selectedDeal.probability>=80?'green':'blue'}>{selectedDeal.stage} · {selectedDeal.probability}%</Badge><section><h3>成交概况</h3><dl><div><dt>预计金额</dt><dd>{selectedDeal.value}</dd></div><div><dt>阶段概率</dt><dd>{selectedDeal.probability}%</dd></div><div><dt>阶段停留</dt><dd>{selectedDeal.age} 天</dd></div><div><dt>当前风险</dt><dd>{selectedDeal.risk}</dd></div></dl></section><section><h3>下一步动作</h3><div><CalendarDays/><span><strong>{selectedDeal.next}</strong><small>建议在 48 小时内完成并记录结果</small></span></div></section><section><h3>AI 成交建议</h3><p>先确认决策链和时间窗口，再围绕客户当前风险提供一份短而明确的验证材料。</p></section></div></DetailDrawer>}
    <CreateDialog open={newOpen} title="新建商机" description="补齐金额、预计成交日与下一步，便于预测和推进。" successMessage="商机已创建，并同步更新客户阶段" onClose={()=>setNewOpen(false)} onSubmit={async values=>{await dealApi.create({company:values.company,stage:values.stage as DealApiRecord['stage'],probability:values.probability?Number(values.probability.replace('%','')):undefined,valueAmount:Number(values.value),currency:values.currency as DealApiRecord['currency'],ownerLabel:values.owner,nextAction:values.next,expectedCloseAt:Date.parse(values.date),risk:'新建商机，等待首次复核',source:'商机跟进'});await Promise.all([dealQuery.refetch(),queryClient.invalidateQueries({queryKey:['customers']})])}} fields={[{name:'company',label:'企业',required:true},{name:'owner',label:'负责人',required:true},{name:'value',label:'预计金额',type:'number',required:true},{name:'currency',label:'币种',type:'select',required:true,options:['CNY','EUR','USD']},{name:'stage',label:'阶段',type:'select',required:true,options:stages},{name:'date',label:'预计成交日',type:'date',required:true},{name:'probability',label:'成交概率',type:'select',options:['20%','40%','60%','80%','100%']},{name:'next',label:'下一步动作',required:true}]}/>
    <CreateDialog open={editOpen&&Boolean(selectedDeal)} title={`编辑商机 · ${selectedDeal?.company??''}`} description="调整阶段、预计成交日、风险和下一步动作。" submitLabel="保存修改" successMessage="商机信息已更新" onClose={()=>setEditOpen(false)} onSubmit={async values=>{if(!selectedDeal)return false;await dealApi.update(selectedDeal.id,{company:values.company,ownerLabel:values.owner,stage:values.stage as DealApiRecord['stage'],nextAction:values.next,expectedCloseAt:Date.parse(values.date),risk:values.risk||'暂无风险'});await Promise.all([dealQuery.refetch(),queryClient.invalidateQueries({queryKey:['customers']})])}} initialValues={selectedDeal?{company:selectedDeal.company,owner:selectedDeal.owner,stage:selectedDeal.stage,date:selectedDeal.closeDate,next:selectedDeal.next,risk:selectedDeal.risk}:undefined} fields={[{name:'company',label:'企业',required:true},{name:'owner',label:'负责人',required:true},{name:'stage',label:'阶段',type:'select',required:true,options:stages},{name:'date',label:'预计成交日',type:'date',required:true},{name:'risk',label:'当前风险'},{name:'next',label:'下一步动作',required:true}]}/>
    <Modal open={forecastOpen} title="本月销售预测" description="根据商机阶段、概率和预计成交日计算。" onClose={()=>setForecastOpen(false)} footer={<><Button onClick={()=>setForecastOpen(false)}>关闭</Button><Button variant="primary" onClick={()=>{setForecastOpen(false);setRiskFilter('仅看风险')}}>查看风险商机</Button></>}><div>{(() => {
      const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
      const monthStart = new Date(y, m, 1).getTime(); const monthEnd = new Date(y, m + 1, 1).getTime();
      const committed = allDeals.filter(d => d.stage === '商务谈判' && d.closeDate && new Date(d.closeDate).getTime() >= monthStart && new Date(d.closeDate).getTime() < monthEnd);
      const bestCase = allDeals.filter(d => d.stage !== '赢单' && d.closeDate && new Date(d.closeDate).getTime() >= monthStart && new Date(d.closeDate).getTime() < monthEnd);
      const parseValue = (v: string) => Number(v.replace(/[^0-9.-]/g, '')) || 0;
      const committedTotal = committed.reduce((s, d) => s + parseValue(d.value), 0);
      const bestCaseTotal = bestCase.reduce((s, d) => s + parseValue(d.value), 0);
      const weightedTotal = bestCase.reduce((s, d) => s + parseValue(d.value) * (stageProbability[d.stage] ?? 20) / 100, 0);
      const topDeals = [...bestCase].sort((a, b) => parseValue(b.value) - parseValue(a.value)).slice(0, 2);
      const topPct = bestCaseTotal > 0 && topDeals.length > 0 ? Math.round(topDeals.reduce((s, d) => s + parseValue(d.value), 0) / bestCaseTotal * 100) : 0;
      const fmt = (n: number) => n >= 10000 ? `¥${(n / 10000).toFixed(1)}万` : `¥${n.toLocaleString('zh-CN')}`;
      return <>
        <section><span>承诺成交</span><strong>{fmt(committedTotal)}</strong><small>{committed.length} 个商务谈判阶段商机</small></section>
        <section><span>最佳情况</span><strong>{fmt(bestCaseTotal)}</strong><small>{bestCase.length} 个本月预计成交商机</small></section>
        <section><span>加权预测</span><strong>{fmt(weightedTotal)}</strong><small>按当前阶段概率计算</small></section>
        {topDeals.length > 0 && <div><h3>本月判断</h3><p>{topDeals.map(d => d.company).join(' 与 ')} 占本月预测的 {topPct}%。建议今天确认合同条款和技术验证反馈，降低延期风险。</p></div>}
      </>;
    })()}</div></Modal>
  </div>
}
