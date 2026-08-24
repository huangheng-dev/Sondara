import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, Building2, CheckCircle2, CircleAlert,
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
import { Alert, Avatar, Card, Checkbox, Col, Flex, List, Progress, Row, Segmented, Space, Statistic, Typography } from 'antd'
import { PageContainer, PageState, SelectionBar, TableToolbar } from '@/components/ui/PageModules'

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
  const sortIcon=(active:boolean,descending:boolean)=><span aria-hidden="true">{active?(descending?<ArrowDown/>:<ArrowUp/>):<ArrowUpDown/>}</span>
  const openChannel=(row:AttributionChannel)=>{setSelectedChannel(row);setDialog('channel')}
  const periodTabs=<Segmented aria-label="选择统计周期" value={period} options={['本月','本季度','本年度']} onChange={value=>setPeriod(value as Period)}/>

  const isLoading=overviewQuery.isLoading
  const isError=overviewQuery.isError
  const qualityItems=qualityQuery.data?.items
  const avgQuality=qualityItems?Math.round(qualityItems.reduce((s,i)=>s+i.pct,0)/qualityItems.length):null
  const selectedChannels=allRows.filter(row=>selected.has(row.name))

  return <PageContainer>
    <PageHeader title="转化分析" description="定位客户从发现到成交的流失环节，并比较不同获客渠道的真实转化能力。" actions={<>{periodTabs}<Button onClick={()=>overviewQuery.refetch()} loading={overviewQuery.isFetching}>{!overviewQuery.isFetching&&<RefreshCw size={16}/>}刷新</Button><Button onClick={()=>{exportRows(rows);showToast(`已导出 ${rows.length} 个渠道的转化数据`)}}><Download size={16}/>导出分析</Button></>}/>

    {isError ? (
      <Panel title="整体转化链路"><PageState status="error" title="数据加载失败" description="无法获取转化数据，请检查网络连接后重试。" onRetry={()=>overviewQuery.refetch()}/></Panel>
    ) : (
    <Panel title="整体转化链路" subtitle={`${period}客户从发现到成交的完整路径`} action={<Button onClick={()=>setDialog('quality')}><Database/>数据完整度 {avgQuality!==null?`${avgQuality}%`:'—'}<ArrowUpRight/></Button>}>
      <Flex vertical aria-label={`${period}客户转化链路`}>
        {isLoading ? (
          <EmptyState spinning title="正在加载转化数据…" icon={RefreshCw}/>
        ) : <Row gutter={[12,12]}>{stages.map((stage,index)=>{const Icon=stage.icon;const rawRate=stage.next===null?conversionRate(stage.value,stages[0].value):(stage.value>0?Number((stage.next/stage.value*100).toFixed(1)):0);const rate=Math.min(100,rawRate);const loss=stage.next===null?null:Math.max(0,stage.value-stage.next);return <Col xs={24} sm={12} xl={4} key={stage.key}><Card size="small" title={<Space><Icon size={16}/>阶段 {index+1} · {stage.label}</Space>}><Statistic value={stage.value}/><Progress aria-label={`${stage.label}转化率`} percent={rate} size="small"/><Flex justify="space-between"><Typography.Text type="secondary">{stage.next===null?'总转化率':'进入下一阶段'} {rate}%</Typography.Text>{loss!==null&&<Typography.Text type={loss>0?'danger':'secondary'}>流失 {loss.toLocaleString()}</Typography.Text>}</Flex></Card></Col>})}</Row>}
      </Flex>
    </Panel>
    )}

    <Panel title="渠道转化表现" subtitle="逐项比较渠道规模、触达、商机与成交结果">
      <TableToolbar filters={<>
          <SearchInput ariaLabel="搜索渠道" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索渠道名称"/>
          <CustomSelect ariaLabel="筛选主要瓶颈" value={bottleneck} onChange={value=>setBottleneck(value as Bottleneck)} options={(['全部瓶颈','获客质量','有效触达','客户回复','商机创建','成交推进'] as Bottleneck[]).map(label=>({value:label,label,icon:label==='获客质量'?<Target/>:label==='有效触达'?<Send/>:label==='客户回复'?<MessageCircleReply/>:label==='商机创建'?<Building2/>:label==='成交推进'?<Trophy/>:<CircleAlert/>}))}/>
          <CustomSelect ariaLabel="筛选成交结果" value={resultFilter} onChange={value=>setResultFilter(value as ResultFilter)} options={(['全部结果','已有成交','暂无成交'] as ResultFilter[]).map(label=>({value:label,label,icon:label==='暂无成交'?<CircleAlert/>:label==='已有成交'?<Trophy/>:<CheckCircle2/>}))}/>
          <CustomSelect ariaLabel="渠道排序" value={sort} onChange={value=>setSort(value as ChannelSort)} options={(['转化率最高','转化率最低','发现客户最多','回复最多','成交客户最多','渠道名称 A–Z'] as ChannelSort[]).map(label=>({value:label,label,icon:<ArrowUpDown/>}))}/>
          <Button loading={overviewQuery.isFetching} onClick={()=>overviewQuery.refetch()}>{!overviewQuery.isFetching&&<RefreshCw size={14}/>}刷新</Button>
          <Button disabled={!query&&bottleneck==='全部瓶颈'&&resultFilter==='全部结果'&&sort==='转化率最高'} onClick={clearFilters}>清除筛选</Button>
        </>} selection={selected.size>0?<SelectionBar summary={<Space><CheckCircle2/>已选择 {selected.size} 个渠道</Space>} actions={<><Button onClick={()=>setDialog('optimize')}><Sparkles/>生成任务</Button><Button onClick={()=>{const chosen=allRows.filter(row=>selected.has(row.name));exportRows(chosen,'sondara-selected-channels.csv');showToast(`已导出 ${chosen.length} 个所选渠道`)}}><Download/>导出所选</Button><Button aria-label="取消选择" title="取消选择" onClick={()=>setSelected(new Set())}><X/></Button></>}/>:undefined}/>
      {isLoading ? (
        <EmptyState spinning title="正在加载渠道数据…" icon={RefreshCw}/>
      ) : rows.length?<><DataTable
        columns={[
          {key:'select',title:<Checkbox aria-label="选择本页全部渠道" checked={pagedRows.length>0&&pagedRows.every(row=>selected.has(row.name))} onChange={event=>setSelected(current=>{const next=new Set(current);pagedRows.forEach(row=>event.target.checked?next.add(row.name):next.delete(row.name));return next})}/>,width:52},
          {key:'channel',title:<Button onClick={()=>setSort('渠道名称 A–Z')}>渠道{sortIcon(sort==='渠道名称 A–Z',false)}</Button>},
          {key:'scale',title:<Button onClick={()=>setSort('发现客户最多')}>获客规模{sortIcon(sort==='发现客户最多',true)}</Button>},
          {key:'reach',title:<Button onClick={()=>setSort('回复最多')}>触达与回复{sortIcon(sort==='回复最多',true)}</Button>},
          {key:'deals',title:<Button onClick={()=>setSort('成交客户最多')}>商机与成交{sortIcon(sort==='成交客户最多',true)}</Button>},
          {key:'rate',title:<Button onClick={()=>setSort(sort==='转化率最高'?'转化率最低':'转化率最高')}>总转化率{sortIcon(sort==='转化率最高'||sort==='转化率最低',sort==='转化率最高')}</Button>},
          {key:'bottleneck',title:'主要瓶颈与建议'},
          {key:'actions',title:'操作',width:72},
        ]}
        rows={pagedRows.map(row=>{const qualification=row.discovered>0?Number((row.qualified/row.discovered*100).toFixed(1)):0;return {
          key:row.name,
          className:selected.has(row.name)?'selected':'',
          cells:[
            <Checkbox aria-label={`选择 ${row.name}`} checked={selected.has(row.name)} onChange={event=>setSelected(current=>{const next=new Set(current);event.target.checked?next.add(row.name):next.delete(row.name);return next})}/>,
            <Button type="link" onClick={()=>openChannel(row)}><Avatar>{row.name.slice(0,1)}</Avatar><Space direction="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{period}渠道转化路径</Typography.Text></Space></Button>,
            <Space direction="vertical" size={2}><Flex justify="space-between"><Typography.Text strong>{row.discovered.toLocaleString()}</Typography.Text><Typography.Text type="secondary">有效 {row.qualified.toLocaleString()}</Typography.Text></Flex><Progress aria-label={`${row.name}客户有效率`} percent={qualification} showInfo={false}/><Typography.Text type="secondary">有效率 {qualification}%</Typography.Text></Space>,
            <Space direction="vertical" size={0}><Typography.Text strong>触达 {row.contacted.toLocaleString()}</Typography.Text><Typography.Text type="secondary">获得回复 {row.replies.toLocaleString()}</Typography.Text></Space>,
            <Space direction="vertical" size={0}><Typography.Text strong>商机 {row.deals.toLocaleString()}</Typography.Text><Typography.Text type="secondary">成交 {row.won.toLocaleString()}</Typography.Text></Space>,
            <Space direction="vertical" size={0}><Typography.Text strong>{row.conversionRate}%</Typography.Text><Typography.Text type="secondary">{row.won>0?'已有成交':'暂无成交'}</Typography.Text></Space>,
            <Space direction="vertical" size={2}><Badge tone={row.bottleneck==='获客质量'?'orange':'blue'}>{row.bottleneck}</Badge><Typography.Text type="secondary" ellipsis>{row.action}</Typography.Text></Space>,
            <Button aria-label={`查看 ${row.name} 转化链路`} title="查看转化链路" onClick={()=>openChannel(row)}><ArrowUpRight/></Button>,
          ],
        }})}
      /><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="个渠道"/></>:<EmptyState title="暂无渠道数据" icon={Database}/>}
    </Panel>

    <Modal open={dialog==='quality'} title="转化数据质量" description="影响转化率判断的关联与来源完整度。" onClose={()=>setDialog(null)}>
      {qualityQuery.isLoading ? <EmptyState spinning title="正在计算…" icon={RefreshCw}/> : <List dataSource={qualityItems??[]} renderItem={item=><List.Item extra={<Badge tone={item.pct>=80?'green':'orange'}>{item.pct}%</Badge>}><List.Item.Meta title={item.label} description={<Space direction="vertical" size={2}><Typography.Text type="secondary">{item.detail}</Typography.Text><Progress aria-label={`${item.label}完整度`} percent={item.pct} showInfo={false}/></Space>}/></List.Item>}/>}
    </Modal>
    <Modal open={dialog==='optimize'} title="转化优化建议" description={`${period} · 优先解决高影响流失阶段`} onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>关闭</Button><Button variant="primary" disabled={optimizeMutation.isPending||selectedChannels.length===0} onClick={()=>optimizeMutation.mutate(selectedChannels.map(c=>c.name))}>{optimizeMutation.isPending?'正在生成…':'生成优化任务'}</Button></>}>
      {selectedChannels.length?<List dataSource={selectedChannels.slice(0,5)} renderItem={ch=><List.Item extra={<Badge tone={ch.won===0?'orange':'blue'}>{ch.won===0?'高影响':`转化率 ${ch.conversionRate}%`}</Badge>}><List.Item.Meta avatar={ch.bottleneck==='获客质量'?<Target/>:ch.bottleneck==='有效触达'?<Send/>:ch.bottleneck==='客户回复'?<MessageCircleReply/>:ch.bottleneck==='商机创建'?<Building2/>:<Trophy/>} title={`${ch.name} · ${ch.bottleneck}`} description={ch.action}/></List.Item>}/>:<EmptyState title="请先选择至少一个渠道。" icon={CircleAlert}/>}
    </Modal>
    <Modal open={dialog==='channel'} title={`${selectedChannel?.name??''} · 转化详情`} description={`${period}完整转化链路`} onClose={()=>setDialog(null)}>
      <Space direction="vertical" size="middle" style={{width:'100%'}}><Row gutter={[12,12]}>{stageMeta.map(({key,label,icon:Icon})=><Col xs={12} md={8} key={key}><Card size="small"><Statistic title={<Space><Icon size={14}/>{label}</Space>} value={selectedChannel?.[key as keyof AttributionChannel] as number ?? 0}/></Card></Col>)}</Row><Alert type="warning" showIcon icon={<CircleAlert/>} message={`主要瓶颈：${selectedChannel?.bottleneck??'—'}`} description={selectedChannel?.action}/><Flex justify="flex-end" gap={8}><Button onClick={()=>setDialog(null)}>关闭</Button><Button variant="primary" onClick={()=>{if(selectedChannel){optimizeMutation.mutate([selectedChannel.name]);setDialog(null)}}}><Building2/>创建优化任务</Button></Flex></Space>
    </Modal>
  </PageContainer>
}
