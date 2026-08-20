import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, ArrowUpRight, Building2, CheckCircle2, CircleAlert,
  Database, Download, MessageCircleReply, RefreshCw, Send, Sparkles,
  Target, Trophy, UsersRound, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Panel } from '@/components/ui/Panel'
import { SearchInput } from '@/components/ui/SearchInput'
import { usePagination } from '@/hooks/usePagination'
import { ApiError, attributionApi, type AttributionBottleneck, type AttributionChannel, type AttributionPeriod } from '@/lib/api'
import { useUiStore } from '@/stores/ui-store'
import { downloadCsv } from '@/utils/download'
import { Checkbox, Segmented } from 'antd'

type Period = '本月' | '本季度' | '本年度'
type Bottleneck = '全部瓶颈' | AttributionBottleneck
type ResultFilter = '全部结果' | '已有成交' | '暂无成交'
type ChannelSort = '转化率最高' | '转化率最低' | '发现客户最多' | '回复最多' | '成交客户最多' | '渠道名称 A–Z'

const periodMap: Record<Period, AttributionPeriod> = { 本月: 'month', 本季度: 'quarter', 本年度: 'year' }

const stageMeta = [
  {key:'discovered',label:'发现客户',icon:UsersRound},
  {key:'qualified',label:'有效客户',icon:CheckCircle2},
  {key:'contacted',label:'已触达',icon:Send},
  {key:'replies',label:'获得回复',icon:MessageCircleReply},
  {key:'deals',label:'创建商机',icon:Target},
  {key:'won',label:'成交客户',icon:Trophy},
] as const

const conversionRate=(won:number,discovered:number)=>discovered?Number((won/discovered*100).toFixed(1)):0
const exportRows=(items:AttributionChannel[],fileName='sondara-conversion-analysis.csv')=>downloadCsv(fileName,[['渠道','发现客户','有效客户','已触达','获得回复','创建商机','成交客户','总转化率','收入','成本','ROI','主要瓶颈'],...items.map(row=>[row.name,row.discovered,row.qualified,row.contacted,row.replies,row.deals,row.won,`${row.conversionRate}%`,row.revenue,row.cost,row.roi??'',row.bottleneck])])

export function AttributionPage(){
  const [period,setPeriod]=useState<Period>('本月')
  const [query,setQuery]=useState('')
  const [bottleneck,setBottleneck]=useState<Bottleneck>('全部瓶颈')
  const [resultFilter,setResultFilter]=useState<ResultFilter>('全部结果')
  const [sort,setSort]=useState<ChannelSort>('转化率最高')
  const [selected,setSelected]=useState<Set<string>>(new Set())
  const [dialog,setDialog]=useState<'quality'|'optimize'|'channel'|null>(null)
  const [selectedChannel,setSelectedChannel]=useState<AttributionChannel|null>(null)
  const showToast=useUiStore(state=>state.showToast)
  const queryClient=useQueryClient()
  const apiPeriod=periodMap[period]

  const overviewQuery=useQuery({queryKey:['attribution-overview',apiPeriod],queryFn:()=>attributionApi.overview({period:apiPeriod}),staleTime:30_000})
  const qualityQuery=useQuery({queryKey:['attribution-quality'],queryFn:()=>attributionApi.quality(),enabled:dialog==='quality',staleTime:60_000})
  const optimizeMutation=useMutation({
    mutationFn:(channels:string[])=>attributionApi.createOptimizeTasks({period:apiPeriod,channels}),
    onSuccess:(data)=>{showToast(`已创建 ${data.created} 个转化优化任务`);setSelected(new Set());setDialog(null);queryClient.invalidateQueries({queryKey:['tasks']})},
    onError:(err)=>showToast(err instanceof ApiError?err.message:'创建优化任务失败'),
  })

  const allRows=useMemo(()=>overviewQuery.data?.channels??[],[overviewQuery.data])
  const stages=useMemo(()=>{
    const funnel=overviewQuery.data?.funnel??[]
    return stageMeta.map(stage=>{const found=funnel.find(f=>f.key===stage.key);return{...stage,value:found?.value??0}}).map((stage,index,array)=>({...stage,next:index<array.length-1?array[index+1].value:null}))
  },[overviewQuery.data])
  const rows=useMemo(()=>{
    const filtered=allRows.filter(row=>(!query||`${row.name}${row.bottleneck}${row.action}`.toLowerCase().includes(query.toLowerCase()))&&(bottleneck==='全部瓶颈'||row.bottleneck===bottleneck)&&(resultFilter==='全部结果'||resultFilter==='已有成交'&&row.won>0||resultFilter==='暂无成交'&&row.won===0))
    if(sort==='转化率最低')return [...filtered].sort((a,b)=>a.conversionRate-b.conversionRate)
    if(sort==='发现客户最多')return [...filtered].sort((a,b)=>b.discovered-a.discovered)
    if(sort==='回复最多')return [...filtered].sort((a,b)=>b.replies-a.replies)
    if(sort==='成交客户最多')return [...filtered].sort((a,b)=>b.won-a.won)
    if(sort==='渠道名称 A–Z')return [...filtered].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))
    return [...filtered].sort((a,b)=>b.conversionRate-a.conversionRate)
  },[allRows,query,bottleneck,resultFilter,sort])
  const paging=usePagination(rows,6,`${period}|${query}|${bottleneck}|${resultFilter}|${sort}`)
  const pagedRows=paging.pageItems

  useEffect(()=>setSelected(new Set()),[period])
  const clearFilters=()=>{setQuery('');setBottleneck('全部瓶颈');setResultFilter('全部结果');setSort('转化率最高')}
  const sortIcon=(active:boolean,descending:boolean)=><span className="customer-sort-icon" aria-hidden="true">{active?(descending?<ArrowDown/>:<ArrowUp/>):<ArrowUpDown/>}</span>
  const openChannel=(row:AttributionChannel)=>{setSelectedChannel(row);setDialog('channel')}
  const periodTabs=<Segmented className="conversion-period-tabs" aria-label="选择统计周期" value={period} options={['本月','本季度','本年度']} onChange={value=>setPeriod(value as Period)}/>

  const isLoading=overviewQuery.isLoading
  const isError=overviewQuery.isError
  const qualityItems=qualityQuery.data?.items
  const avgQuality=qualityItems?Math.round(qualityItems.reduce((s,i)=>s+i.pct,0)/qualityItems.length):null
  const selectedChannels=allRows.filter(row=>selected.has(row.name))

  return <div className="page-content conversion-page conversion-page-rebuilt">
    <PageHeader title="转化分析" description="定位客户从发现到成交的流失环节，并比较不同获客渠道的真实转化能力。" actions={<div className="conversion-header-actions">{periodTabs}<Button onClick={()=>overviewQuery.refetch()} disabled={isLoading}><RefreshCw/>刷新</Button><Button onClick={()=>{exportRows(rows);showToast(`已导出 ${rows.length} 个渠道的转化数据`)}}><Download/>导出分析</Button></div>}/>

    {isError ? (
      <Panel title="整体转化链路"><div><EmptyState title="数据加载失败" description="无法获取转化数据，请检查网络连接后重试。"/><div style={{textAlign:'center',marginTop:'1rem'}}><Button variant="primary" onClick={()=>overviewQuery.refetch()}>重新加载</Button></div></div></Panel>
    ) : (
    <Panel className="conversion-flow-panel conversion-overview-panel" title="整体转化链路" subtitle={`${period}客户从发现到成交的完整路径`} action={<Button className="conversion-quality-compact" onClick={()=>setDialog('quality')}><Database/><span>数据完整度</span><strong>{avgQuality!==null?`${avgQuality}%`:'—'}</strong><ArrowUpRight/></Button>}>
      <div className="conversion-flow" aria-label={`${period}客户转化链路`}>
        {isLoading ? (
          <div style={{padding:'2rem',color:'var(--text-muted)'}}>正在加载转化数据…</div>
        ) : stages.map((stage,index)=>{const Icon=stage.icon;const rate=stage.next===null?conversionRate(stage.value,stages[0].value):(stage.value>0?Number((stage.next/stage.value*100).toFixed(1)):0);const loss=stage.next===null?null:stage.value-stage.next;return <Fragment key={stage.key}><article className={index===stages.length-1?'complete':''}><header><i><Icon/></i><span><small>阶段 {index+1}</small><strong>{stage.label}</strong></span></header><b>{stage.value.toLocaleString()}</b>{stage.next===null?<footer><Badge tone="green">总转化率 {rate}%</Badge></footer>:<footer><span><strong>{rate}%</strong><small>进入下一阶段</small></span><em>流失 {loss?.toLocaleString()}</em></footer>}</article>{index<stages.length-1&&<i className="conversion-stage-arrow" aria-hidden="true"><ArrowRight/></i>}</Fragment>})}
      </div>
    </Panel>
    )}

    <Panel className="attribution-channel-table-panel standard-list-panel">
      <div className="standard-list-heading"><span><h2>渠道转化表现</h2><p>逐项比较渠道规模、触达、商机与成交结果</p></span></div>
      <div className="customer-toolbar module-toolbar standard-list-toolbar attribution-channel-toolbar">
        <div className="customer-filter-controls attribution-filter-controls">
          <SearchInput className="customer-search module-search" ariaLabel="搜索渠道" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索渠道名称"/>
          <CustomSelect ariaLabel="筛选主要瓶颈" value={bottleneck} onChange={value=>setBottleneck(value as Bottleneck)} options={(['全部瓶颈','获客质量','有效触达','客户回复','商机创建','成交推进'] as Bottleneck[]).map(label=>({value:label,label,icon:label==='获客质量'?<Target/>:label==='有效触达'?<Send/>:label==='客户回复'?<MessageCircleReply/>:label==='商机创建'?<Building2/>:label==='成交推进'?<Trophy/>:<CircleAlert/>}))}/>
          <CustomSelect ariaLabel="筛选成交结果" value={resultFilter} onChange={value=>setResultFilter(value as ResultFilter)} options={(['全部结果','已有成交','暂无成交'] as ResultFilter[]).map(label=>({value:label,label,icon:label==='暂无成交'?<CircleAlert/>:label==='已有成交'?<Trophy/>:<CheckCircle2/>}))}/>
          <CustomSelect className="sort-select" ariaLabel="渠道排序" value={sort} onChange={value=>setSort(value as ChannelSort)} options={(['转化率最高','转化率最低','发现客户最多','回复最多','成交客户最多','渠道名称 A–Z'] as ChannelSort[]).map(label=>({value:label,label,icon:<ArrowUpDown/>}))}/>
          <Button className="customer-clear module-clear" disabled={!query&&bottleneck==='全部瓶颈'&&resultFilter==='全部结果'&&sort==='转化率最高'} onClick={clearFilters}>清除筛选</Button>
        </div>
        <div className={`customer-selection-tools${selected.size>0?' has-selection':' is-empty'}`}><span><CheckCircle2/><small>已选择</small><strong>{selected.size}</strong><small>个</small></span>{selected.size>0&&<div><Button onClick={()=>setDialog('optimize')}><Sparkles/>生成任务</Button><Button onClick={()=>{const chosen=allRows.filter(row=>selected.has(row.name));exportRows(chosen,'sondara-selected-channels.csv');showToast(`已导出 ${chosen.length} 个所选渠道`)}}><Download/>导出所选</Button><Button aria-label="取消选择" title="取消选择" onClick={()=>setSelected(new Set())}><X/></Button></div>}</div>
      </div>
      {isLoading ? (
        <div style={{padding:'2rem',color:'var(--text-muted)'}}>正在加载渠道数据…</div>
      ) : rows.length?<><DataTable
        className="customer-table customer-table-pro standard-data-table attribution-channel-table"
        columns={[
          {key:'select',title:<span className="customer-check"><Checkbox aria-label="选择本页全部渠道" checked={pagedRows.length>0&&pagedRows.every(row=>selected.has(row.name))} onChange={event=>setSelected(current=>{const next=new Set(current);pagedRows.forEach(row=>event.target.checked?next.add(row.name):next.delete(row.name));return next})}/></span>,width:52},
          {key:'channel',title:<Button className="customer-sort-head" onClick={()=>setSort('渠道名称 A–Z')}>渠道{sortIcon(sort==='渠道名称 A–Z',false)}</Button>},
          {key:'scale',title:<Button className="customer-sort-head" onClick={()=>setSort('发现客户最多')}>获客规模{sortIcon(sort==='发现客户最多',true)}</Button>},
          {key:'reach',title:<Button className="customer-sort-head" onClick={()=>setSort('回复最多')}>触达与回复{sortIcon(sort==='回复最多',true)}</Button>},
          {key:'deals',title:<Button className="customer-sort-head" onClick={()=>setSort('成交客户最多')}>商机与成交{sortIcon(sort==='成交客户最多',true)}</Button>},
          {key:'rate',title:<Button className="customer-sort-head" onClick={()=>setSort(sort==='转化率最高'?'转化率最低':'转化率最高')}>总转化率{sortIcon(sort==='转化率最高'||sort==='转化率最低',sort==='转化率最高')}</Button>},
          {key:'bottleneck',title:'主要瓶颈与建议'},
          {key:'actions',title:'操作',width:72},
        ]}
        rows={pagedRows.map(row=>{const qualification=row.discovered>0?Number((row.qualified/row.discovered*100).toFixed(1)):0;return {
          key:row.name,
          className:selected.has(row.name)?'selected':'',
          cells:[
            <span className="customer-check"><Checkbox aria-label={`选择 ${row.name}`} checked={selected.has(row.name)} onChange={event=>setSelected(current=>{const next=new Set(current);event.target.checked?next.add(row.name):next.delete(row.name);return next})}/></span>,
            <Button className="standard-entity attribution-channel-entity" onClick={()=>openChannel(row)}><i style={{background:row.color,color:'#fff',boxShadow:'none'}}>{row.name.slice(0,1)}</i><span><strong>{row.name}</strong><small>{period}渠道转化路径</small></span></Button>,
            <div className="standard-progress"><span><strong>{row.discovered.toLocaleString()}</strong><small>有效 {row.qualified.toLocaleString()}</small></span><i><u style={{width:`${qualification}%`}}/></i><small>有效率 {qualification}%</small></div>,
            <div className="standard-cell-stack"><strong>触达 {row.contacted.toLocaleString()}</strong><small>获得回复 {row.replies.toLocaleString()}</small></div>,
            <div className="standard-cell-stack"><strong>商机 {row.deals.toLocaleString()}</strong><small>成交 {row.won.toLocaleString()}</small></div>,
            <div className="attribution-rate"><strong>{row.conversionRate}%</strong><small>{row.won>0?'已有成交':'暂无成交'}</small></div>,
            <div className="standard-next attribution-bottleneck"><Badge tone={row.bottleneck==='获客质量'?'orange':'blue'}>{row.bottleneck}</Badge><small>{row.action}</small></div>,
            <div className="standard-row-actions"><Button aria-label={`查看 ${row.name} 转化链路`} title="查看转化链路" onClick={()=>openChannel(row)}><ArrowUpRight/></Button></div>,
          ],
        }})}
      /><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="个渠道"/></>:<EmptyState className="list-empty-state" title="暂无渠道数据" icon={Database}/>}
    </Panel>

    <Modal open={dialog==='quality'} title="转化数据质量" description="影响转化率判断的关联与来源完整度。" onClose={()=>setDialog(null)}>
      <div className="status-detail-list">
        {qualityQuery.isLoading ? <div style={{padding:'1rem',color:'var(--text-muted)'}}>正在计算…</div> :
        (qualityItems??[]).map(item=><article key={item.label}>
          <span><strong>{item.label}</strong><small>{item.detail}</small></span>
          <Badge tone={item.pct>=80?'green':'orange'}>{item.pct}%</Badge>
        </article>)}
      </div>
    </Modal>
    <Modal open={dialog==='optimize'} title="转化优化建议" description={`${period} · 优先解决高影响流失阶段`} onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>关闭</Button><Button variant="primary" disabled={optimizeMutation.isPending||selectedChannels.length===0} onClick={()=>optimizeMutation.mutate(selectedChannels.map(c=>c.name))}>{optimizeMutation.isPending?'正在生成…':'生成优化任务'}</Button></>}>
      <div className="conversion-recommendations">
        {selectedChannels.slice(0,5).map(ch=><article key={ch.name}>
          <i>{ch.bottleneck==='获客质量'?<Target/>:ch.bottleneck==='有效触达'?<Send/>:ch.bottleneck==='客户回复'?<MessageCircleReply/>:ch.bottleneck==='商机创建'?<Building2/>:<Trophy/>}</i>
          <span><strong>{ch.name} · {ch.bottleneck}</strong><small>{ch.action}</small></span>
          <Badge tone={ch.won===0?'orange':'blue'}>{ch.won===0?'高影响':`转化率 ${ch.conversionRate}%`}</Badge>
        </article>)}
        {selectedChannels.length===0 && <div style={{padding:'1rem',color:'var(--text-muted)'}}>请先选择至少一个渠道。</div>}
      </div>
    </Modal>
    <Modal open={dialog==='channel'} title={`${selectedChannel?.name??''} · 转化详情`} description={`${period}完整转化链路`} onClose={()=>setDialog(null)}>
      <div className="conversion-channel-detail">
        <section>{stageMeta.map(({key,label,icon:Icon})=><span key={key}><i><Icon/></i><small>{label}</small><strong>{(selectedChannel?.[key as keyof AttributionChannel] as number ?? 0).toLocaleString()}</strong></span>)}</section>
        <article><CircleAlert/><span><strong>主要瓶颈：{selectedChannel?.bottleneck}</strong><small>{selectedChannel?.action}</small></span></article>
        <div><Button onClick={()=>setDialog(null)}>关闭</Button><Button variant="primary" onClick={()=>{if(selectedChannel){optimizeMutation.mutate([selectedChannel.name]);setDialog(null)}}}><Building2/>创建优化任务</Button></div>
      </div>
    </Modal>
  </div>
}
