import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  FileQuestion,
  Gauge,
  GitMerge,
  Globe2,
  HandCoins,
  Import,
  Landmark,
  Layers3,
  ListTree,
  Mail,
  MapPin,
  MapPinned,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sprout,
  Star,
  Pencil,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { DetailDrawer } from '@/components/ui/DetailDrawer'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel } from '@/components/ui/Panel'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { useUiStore } from '@/stores/ui-store'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { Modal } from '@/components/ui/Modal'
import { downloadCsv } from '@/utils/download'
import { csvRowsToCustomers, parseLeadFile, type LeadColumnMapping } from '@/utils/csv'
import { useBusinessStore, type CustomerRecord } from '@/stores/business-store'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { usePagination } from '@/hooks/usePagination'
import { authApi, customerApi, inboxApi, taskApi, type CustomerApiInput, type CustomerApiRecord } from '@/lib/api'
import { CUSTOMER_STAGES, getStageTone, type CustomerStage } from '@/lib/customer-stages'
import { Checkbox } from 'antd'

type CustomerView = '全部客户' | CustomerStage | '已归档'
type CustomerSort = '最近更新' | '最早更新' | '企业名称 A–Z' | '企业名称 Z–A' | '匹配分最高' | '匹配分最低' | '预计价值最高' | '预计价值最低' | '联系人最多' | '联系人最少' | '截止时间最近' | '截止时间最远'
const moneyValue=(value:string)=>Number(value.replace(/[^\d.]/g,''))
const dueValue=(value:string)=>value==='今天'?0:value==='明天'?1:/48 小时/.test(value)?2:/2 个工作日/.test(value)?3:value==='本周'?7:(Number(value.match(/(\d+)月(\d+)日/)?.[2])||20)
const apiCustomerToRecord=(customer:CustomerApiRecord):CustomerRecord=>({
  id:customer.id,
  company:customer.company,
  region:customer.region,
  industry:customer.industry,
  score:customer.score,
  confidence:customer.confidence,
  signal:customer.signal,
  source:customer.source,
  value:customer.estimatedValue>0?`¥${customer.estimatedValue.toLocaleString('zh-CN')}`:'待评估',
  size:customer.size,
  stage:customer.stage,
  contacts:customer.contacts,
  valid:customer.validContacts,
  interaction:customer.interaction,
  next:customer.nextAction,
  due:customer.dueAt?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(customer.dueAt):'本周',
  owner:customer.ownerName??'未分配',
  ownerUserId:customer.ownerUserId,
  tags:(customer.tags??[]).map(tag=>tag.name),
  scoreOverride:customer.scoreOverride ?? null,
  scoreOverrideReason:customer.scoreOverrideReason ?? null,
  scoreOverrideByName:customer.scoreOverrideByName ?? null,
  scoreOverrideAt:customer.scoreOverrideAt ?? null,
})
const customerChangesToApi=(changes:Partial<CustomerRecord>):Partial<CustomerApiInput>=>{
  const input:Partial<CustomerApiInput>={}
  if(changes.company!==undefined)input.company=changes.company
  if(changes.region!==undefined)input.region=changes.region
  if(changes.industry!==undefined)input.industry=changes.industry
  if(changes.score!==undefined)input.score=changes.score
  if(changes.confidence!==undefined)input.confidence=changes.confidence
  if(changes.signal!==undefined)input.signal=changes.signal
  if(changes.source!==undefined)input.source=changes.source
  if(changes.value!==undefined)input.estimatedValue=moneyValue(changes.value)
  if(changes.size!==undefined)input.size=changes.size
  if(changes.stage!==undefined)input.stage=changes.stage
  if(changes.contacts!==undefined)input.contacts=changes.contacts
  if(changes.valid!==undefined)input.validContacts=changes.valid
  if(changes.interaction!==undefined)input.interaction=changes.interaction
  if(changes.next!==undefined)input.nextAction=changes.next
  if(changes.due!==undefined){const parsed=Date.parse(changes.due);if(Number.isFinite(parsed))input.dueAt=parsed}
  if(changes.ownerUserId!==undefined)input.ownerUserId=changes.ownerUserId
  return input
}
export function CustomersPage() {
  const [query,setQuery]=useState('')
  const [region,setRegion]=useState('全部市场')
  const [score,setScore]=useState('全部匹配分')
  const [source,setSource]=useState('全部来源')
  const [view,setView]=useState<CustomerView>('全部客户')
  const [sort,setSort]=useState<CustomerSort>('最近更新')
  const [selected,setSelected]=useState<Set<string>>(new Set())
  const [detail,setDetail]=useState<CustomerRecord|null>(null)
  const [dialog,setDialog]=useState<'customer'|'import'|null>(null)
  const [action,setAction]=useState<'task'|'tag'|'bulk'|'next'|'more'|'contact'|'add-contact'|'edit'|null>(null)
  const [actionCustomer,setActionCustomer]=useState<CustomerRecord|null>(null)
  const [importPreview,setImportPreview]=useState<{fileName:string;sourceName:string;sourceType:'行业目录'|'展会名单'|'历史客户'|'其他';sourceUrl?:string;rows:CustomerApiInput[];skipped:number}|null>(null)
  const [importing,setImporting]=useState(false)
  const [importHistoryOpen,setImportHistoryOpen]=useState(false)
  const [mergePreview,setMergePreview]=useState<Awaited<ReturnType<typeof customerApi.mergePreview>>|null>(null)
  const showToast=useUiStore(s=>s.showToast)
  const queryClient=useQueryClient()
  const replaceCustomers=useBusinessStore(s=>s.replaceCustomers)
  const authSession=useQuery({queryKey:['auth-session'],queryFn:authApi.session,retry:false})
  const customerQuery=useQuery({
    queryKey:['customers',authSession.data?.workspace.id,view],
    queryFn:()=>customerApi.list({pageSize:100,sort:'updated_desc',archivedOnly:view==='已归档'}),
    enabled:Boolean(authSession.data?.workspace.id),
    retry:1,
  })
  const importHistoryQuery=useQuery({queryKey:['customer-imports'],queryFn:customerApi.listImports,enabled:importHistoryOpen,retry:1})
  const customerRows=useMemo(()=>customerQuery.data?.items.map(apiCustomerToRecord)??[],[customerQuery.data])
  const membersQuery=useQuery({queryKey:['workspace-members'],queryFn:authApi.listWorkspaceMembers,retry:1})
  const contactsQuery=useQuery({queryKey:['customer-contacts',actionCustomer?.id],queryFn:()=>customerApi.listContacts(actionCustomer!.id),enabled:Boolean(actionCustomer?.id&&(action==='contact'||action==='add-contact')),retry:1})
  useEffect(()=>{if(customerQuery.isSuccess)replaceCustomers(customerRows)},[customerQuery.isSuccess,customerRows,replaceCustomers])
  const persistCustomerChanges=async(ids:string[],changes:Partial<CustomerRecord>)=>{
    const input=customerChangesToApi(changes)
    if(Object.keys(input).length)await Promise.all(ids.map(customerId=>customerApi.update(customerId,input)))
    await customerQuery.refetch()
  }
  const rows=useMemo(()=>{const filtered=customerRows.filter(a=>(!query||`${a.company}${a.industry}${a.signal}${a.tags.join('')}`.toLowerCase().includes(query.toLowerCase()))&&(region==='全部市场'||a.region.includes(region))&&(score==='全部匹配分'||score==='90 分以上'&&a.score>=90||score==='85–89 分'&&a.score>=85&&a.score<90)&&(source==='全部来源'||a.source===source)&&(view==='全部客户'||view==='已归档'||a.stage===view));if(sort==='最早更新')return [...filtered].reverse();if(sort==='企业名称 A–Z')return [...filtered].sort((a,b)=>a.company.localeCompare(b.company,'zh-CN'));if(sort==='企业名称 Z–A')return [...filtered].sort((a,b)=>b.company.localeCompare(a.company,'zh-CN'));if(sort==='匹配分最高')return [...filtered].sort((a,b)=>b.score-a.score);if(sort==='匹配分最低')return [...filtered].sort((a,b)=>a.score-b.score);if(sort==='预计价值最高')return [...filtered].sort((a,b)=>moneyValue(b.value)-moneyValue(a.value));if(sort==='预计价值最低')return [...filtered].sort((a,b)=>moneyValue(a.value)-moneyValue(b.value));if(sort==='联系人最多')return [...filtered].sort((a,b)=>b.contacts-a.contacts);if(sort==='联系人最少')return [...filtered].sort((a,b)=>a.contacts-b.contacts);if(sort==='截止时间最近')return [...filtered].sort((a,b)=>dueValue(a.due)-dueValue(b.due));if(sort==='截止时间最远')return [...filtered].sort((a,b)=>dueValue(b.due)-dueValue(a.due));return filtered},[customerRows,query,region,score,source,view,sort])
  const customerPaging=usePagination(rows,6,`${query}|${region}|${score}|${source}|${view}|${sort}`)
  const pagedRows=customerPaging.pageItems
  const stageIcons: Record<string, ReactNode> = {
    '待补全': <FileQuestion size={14}/>,
    '待验证': <CircleUserRound size={14}/>,
    '培育中': <Sprout size={14}/>,
    '重点跟进': <Star size={14}/>,
    '有商机': <HandCoins size={14}/>,
    '已成交': <CheckCircle2 size={14}/>,
    '停滞': <Clock3 size={14}/>,
    '已流失': <X size={14}/>,
  }
  const customerViewOptions = [
    {value:'全部客户',label:'全部客户',icon:<UsersRound/>},
    ...CUSTOMER_STAGES.map(s => ({ value: s.value, label: s.label, icon: stageIcons[s.value] ?? <FileQuestion size={14}/> })),
    {value:'已归档',label:'已归档',icon:<Layers3/>},
  ]
  const customerSourceOptions=[
    {value:'全部来源',label:'全部来源',icon:<Layers3/>},
    {value:'官网与公开网络',label:'官网与公开网络',icon:<Globe2/>},
    {value:'招投标信号',label:'招投标信号',icon:<Landmark/>},
    {value:'地图与本地企业',label:'地图与本地企业',icon:<MapPinned/>},
    {value:'行业目录',label:'行业目录',icon:<ListTree/>},
  ]
  const customerSortOptions=[
    {value:'最近更新',label:'最近更新',icon:<Clock3/>},{value:'最早更新',label:'最早更新',icon:<Clock3/>},
    {value:'企业名称 A–Z',label:'企业名称 A–Z',icon:<ArrowDown/>},{value:'企业名称 Z–A',label:'企业名称 Z–A',icon:<ArrowUp/>},
    {value:'匹配分最高',label:'匹配分最高',icon:<Gauge/>},{value:'匹配分最低',label:'匹配分最低',icon:<Gauge/>},
    {value:'预计价值最高',label:'预计价值最高',icon:<HandCoins/>},{value:'预计价值最低',label:'预计价值最低',icon:<HandCoins/>},
    {value:'联系人最多',label:'联系人最多',icon:<UsersRound/>},{value:'联系人最少',label:'联系人最少',icon:<CircleUserRound/>},
    {value:'截止时间最近',label:'截止时间最近',icon:<Clock3/>},{value:'截止时间最远',label:'截止时间最远',icon:<Clock3/>},
  ]
  const clear=()=>{setQuery('');setRegion('全部市场');setScore('全部匹配分');setSource('全部来源');setView('全部客户');setSort('最近更新')}
  const sortIcon=(active:boolean,descending:boolean)=><span className="customer-sort-icon" aria-hidden="true">{active?(descending?<ArrowDown/>:<ArrowUp/>):<ArrowUpDown/>}</span>
  const openMergePreview=async()=>{const [primaryCustomerId,duplicateCustomerId]=[...selected];if(!primaryCustomerId||!duplicateCustomerId)return;try{setMergePreview(await customerApi.mergePreview(primaryCustomerId,duplicateCustomerId))}catch(cause){showToast(cause instanceof Error?cause.message:'无法读取合并预览')}}
  const archiveCustomers=async(ids:string[], archived:boolean)=>{try{await Promise.all(ids.map(id=>customerApi.archive(id,archived)));await customerQuery.refetch();setSelected(new Set());showToast(archived?`已归档 ${ids.length} 家客户`:`已恢复 ${ids.length} 家客户`)}catch(cause){showToast(cause instanceof Error?cause.message:'归档操作失败')}}

  return <div className="page-content customers-page">
    <PageHeader title="客户库" description="管理已确认的客户资产、联系人关系、互动记录和下一步跟进。" actions={<>
      <Button onClick={()=>setImportHistoryOpen(true)}><Clock3 size={16}/>导入记录</Button>
      <Button onClick={()=>setDialog('import')}><Import size={16}/>导入</Button>
      <Button onClick={()=>{downloadCsv('sondara-customers.csv',[['企业','地区','行业','客户匹配分','阶段','预计价值'],...rows.map(r=>[r.company,r.region,r.industry,r.score,r.stage,r.value])]);showToast(`已导出 ${rows.length} 家客户`)}}><Download size={16}/>导出</Button>
      <Button variant="primary" onClick={()=>setDialog('customer')}><Plus size={16}/>新建客户</Button>
    </>}/>

    <Panel className="customer-workspace">
      <div className="customer-toolbar module-toolbar standard-list-toolbar">
        <div className="customer-filter-controls">
          <SearchInput className="customer-search module-search" ariaLabel="搜索客户" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索企业、行业或信号"/>
          <CustomSelect className="customer-view-select" ariaLabel="筛选客户分类" value={view} onChange={value=>setView(value as CustomerView)} options={customerViewOptions}/>
          <CustomSelect ariaLabel="筛选市场" value={region} onChange={setRegion} options={['全部市场','华东','德国','北美'].map(label=>({value:label,label,icon:<MapPin/>}))}/>
          <CustomSelect className="score-select" ariaLabel="筛选客户匹配分" value={score} onChange={setScore} options={['全部匹配分','90 分以上','85–89 分'].map(label=>({value:label,label,icon:<Gauge/>}))}/>
          <CustomSelect className="source-select" ariaLabel="筛选客户来源" value={source} onChange={setSource} options={customerSourceOptions}/>
          <CustomSelect className="sort-select" ariaLabel="客户排序" value={sort} onChange={value=>setSort(value as CustomerSort)} options={customerSortOptions}/>
          <Button className="customer-refresh" disabled={customerQuery.isFetching} onClick={async()=>{await customerQuery.refetch();showToast('客户列表已刷新')}}><RefreshCw className={customerQuery.isFetching?'is-spinning':undefined} size={14}/>刷新</Button>
          <Button className="customer-clear module-clear" onClick={clear} disabled={!query&&view==='全部客户'&&region==='全部市场'&&score==='全部匹配分'&&source==='全部来源'&&sort==='最近更新'}>清除筛选</Button>
        </div>
        <div className={`customer-selection-tools${selected.size>0?' has-selection':' is-empty'}`} aria-hidden={selected.size===0}><span><CheckCircle2/><small>已选择</small><strong>{selected.size}</strong><small>家</small></span><div><Button onClick={()=>{setActionCustomer(null);setAction('task')}}>创建任务</Button><Button onClick={()=>setAction('tag')}>添加标签</Button><Button onClick={()=>{setActionCustomer(null);setAction('bulk')}}>批量更新</Button><Button disabled={selected.size!==2||view==='已归档'} onClick={openMergePreview}><GitMerge/>合并重复项</Button><Button onClick={()=>archiveCustomers([...selected],view!=='已归档')}>{view==='已归档'?'恢复所选':'归档所选'}</Button><Button onClick={()=>{const chosen=customerRows.filter(customer=>selected.has(customer.id));downloadCsv('sondara-selected-customers.csv',[['企业','地区','行业','客户匹配分','阶段','负责人','预计价值'],...chosen.map(customer=>[customer.company,customer.region,customer.industry,customer.score,customer.stage,customer.owner,customer.value])]);showToast(`已导出 ${chosen.length} 家所选客户`)}}><Download/>导出所选</Button><Button aria-label="取消选择" title="取消选择" onClick={()=>setSelected(new Set())}><X/></Button></div></div>
      </div>
      {customerQuery.isPending?<div className="customer-data-state" role="status"><RefreshCw className="is-spinning"/><strong>正在加载客户数据</strong><span>正在从当前工作空间读取客户资产…</span></div>:customerQuery.isError?<div className="customer-data-state customer-data-error" role="alert"><FileQuestion/><strong>客户数据加载失败</strong><span>{customerQuery.error instanceof Error?customerQuery.error.message:'请确认 API 服务可用。'}</span><Button onClick={()=>customerQuery.refetch()}>重新加载</Button></div>:rows.length?<><DataTable
        className="customer-table customer-table-pro customer-library-table"
        minWidth={1020}
        columns={[
          {key:'select',title:<span className="customer-check"><Checkbox aria-label="选择本页全部" checked={pagedRows.length>0&&pagedRows.every(row=>selected.has(row.id))} onChange={e=>setSelected(value=>{const next=new Set(value);pagedRows.forEach(row=>e.target.checked?next.add(row.id):next.delete(row.id));return next})}/></span>,width:52},
          {key:'company',title:<Button className="customer-sort-head" onClick={()=>setSort(sort==='企业名称 A–Z'?'企业名称 Z–A':'企业名称 A–Z')}>企业档案{sortIcon(sort==='企业名称 A–Z'||sort==='企业名称 Z–A',sort==='企业名称 Z–A')}</Button>,width:230},
          {key:'quality',title:<Button className="customer-sort-head" onClick={()=>setSort(sort==='匹配分最高'?'匹配分最低':'匹配分最高')}>匹配质量{sortIcon(sort==='匹配分最高'||sort==='匹配分最低',sort==='匹配分最高')}</Button>,width:120},
          {key:'signal',title:<Button className="customer-sort-head" onClick={()=>setSort(sort==='最近更新'?'最早更新':'最近更新')}>购买信号{sortIcon(sort==='最近更新'||sort==='最早更新',sort==='最近更新')}</Button>,width:230},
          {key:'value',title:<Button className="customer-sort-head" onClick={()=>setSort(sort==='预计价值最高'?'预计价值最低':'预计价值最高')}>关系与价值{sortIcon(sort==='预计价值最高'||sort==='预计价值最低',sort==='预计价值最高')}</Button>,width:170},
          {key:'next',title:<Button className="customer-sort-head" onClick={()=>setSort(sort==='截止时间最近'?'截止时间最远':'截止时间最近')}>下一步动作{sortIcon(sort==='截止时间最近'||sort==='截止时间最远',sort==='截止时间最远')}</Button>,width:150},
          {key:'actions',title:'操作',width:64},
        ]}
        rows={pagedRows.map(account=>({key:account.id,className:selected.has(account.id)?'selected':'',cells:[
          <span className="customer-check"><Checkbox aria-label={`选择 ${account.company}`} checked={selected.has(account.id)} onChange={e=>setSelected(value=>{const next=new Set(value);e.target.checked?next.add(account.id):next.delete(account.id);return next})}/></span>,
          <Button className="customer-company" onClick={()=>setDetail(account)}><i>{account.company.slice(0,1)}</i><span><strong title={account.company}>{account.company}</strong><small title={`${account.region} · ${account.industry}`}>{account.region.split(/[（(]/)[0]} · {account.industry}{account.tags.length?` · ${account.tags.join('、')}`:''}</small><em><UserCheck size={12}/>{account.valid}/{account.contacts} 位联系人有效</em></span></Button>,
          <div className="customer-match"><header><strong>{account.scoreOverride??account.score}</strong><span>{(account.scoreOverride??account.score)>=90?'高度匹配':(account.scoreOverride??account.score)>=85?'值得跟进':'继续培育'}</span>{account.scoreOverride!=null?<span style={{marginLeft:4}}><Badge tone="orange"><Pencil size={9}/>修正</Badge></span>:null}</header><i><u style={{width:`${account.scoreOverride??account.score}%`}}/></i><small>证据置信度 {account.confidence}%</small></div>,
          <div className="customer-signal"><Badge tone={account.score>=90?'green':'blue'}>{account.signal}</Badge><strong>{account.source}</strong><small>最近互动 · {account.interaction}</small></div>,
          <div className="customer-relation"><span><Badge tone={getStageTone(account.stage)}>{account.stage}</Badge><small>负责人：{account.owner}</small></span><div><small>预计价值</small><strong className="money">{account.value}</strong></div></div>,
          <Button className="customer-next" aria-label={`安排下一步：${account.next}`} onClick={()=>{setActionCustomer(account);setAction('next')}}><i><CheckCircle2/></i><span><strong>{account.next}</strong><small className={account.due==='今天'?'urgent':''}><Clock3/>{account.due==='今天'?'今天截止':`截止 ${account.due}`}</small></span></Button>,
          <Button className="customer-more" aria-label={`更多操作：${account.company}`} onClick={()=>{setActionCustomer(account);setAction('more')}}><MoreHorizontal size={17}/></Button>,
        ]}))}
      /><Pagination page={customerPaging.page} pageSize={customerPaging.pageSize} total={rows.length} onPageChange={customerPaging.setPage} onPageSizeChange={customerPaging.setPageSize} itemName="家企业"/></>:<EmptyState className="list-empty-state" title="暂无客户" icon={Building2}/>}
    </Panel>

    <CustomerDetail customer={detail} onClose={()=>setDetail(null)} onTask={customer=>{setDetail(null);setActionCustomer(customer);setAction('next')}} onContact={customer=>{setDetail(null);setActionCustomer(customer);setAction('contact')}} onAddContact={customer=>{setDetail(null);setActionCustomer(customer);setAction('add-contact')}} onWhatsappOptIn={async contact=>{try{await customerApi.setWhatsappOptIn(detail!.id,contact.id,!contact.whatsappOptedInAt);await queryClient.invalidateQueries({queryKey:['customer-contacts',detail!.id]});showToast(contact.whatsappOptedInAt?'已撤销 WhatsApp 授权记录':'已记录 WhatsApp 授权')}catch(cause){showToast(cause instanceof Error?cause.message:'更新授权记录失败')}}}/>
    <CreateDialog open={dialog==='customer'} title="新建客户" description="先创建企业档案，联系人可稍后补全。" successMessage="客户已保存" onClose={()=>setDialog(null)} onSubmit={async values=>{await customerApi.create({company:values.company,region:values.region,industry:values.industry,score:70,confidence:70,signal:values.note||'手动创建',source:values.website?`手动录入 · ${values.website.slice(0,100)}`:'手动录入',size:'规模待补全',stage:'待补全',interaction:'刚刚',nextAction:'补全企业与联系人'});await customerQuery.refetch()}} fields={[{name:'company',label:'企业名称',required:true},{name:'website',label:'网站',placeholder:'https://example.com'},{name:'region',label:'地区',required:true},{name:'industry',label:'行业',required:true},{name:'note',label:'备注',type:'textarea'}]}/>
    <CreateDialog open={dialog==='import'} title="导入行业目录或展会名单" description="支持 CSV、XLSX、可搜索 PDF；文件仅在浏览器本地解析。若自动识别错误，可填写下方的原始列名覆盖映射。" submitLabel="继续预览" successMessage="文件已解析，请确认导入" onClose={()=>setDialog(null)} onSubmit={async values=>{const file=values.file as unknown;if(!(file instanceof File))throw new Error('请选择 CSV、Excel 或可搜索 PDF 文件');const mapping=Object.fromEntries(Object.entries({company:values.companyColumn,region:values.regionColumn,industry:values.industryColumn,contactName:values.contactNameColumn,contactEmail:values.contactEmailColumn,contactPhone:values.contactPhoneColumn,website:values.websiteColumn}).filter(([,value])=>Boolean(value))) as LeadColumnMapping;const parsed=csvRowsToCustomers(await parseLeadFile(file),mapping);const seen=new Set<string>();const rows:CustomerApiInput[]=[];let skipped=0;for(const row of parsed){const key=row.company.trim().toLowerCase();if(!key||seen.has(key)){skipped+=1;continue}seen.add(key);rows.push(row)}if(!rows.length)throw new Error('没有可导入的有效企业，请检查企业名称列；PDF 请使用可搜索文本版。');setImportPreview({fileName:file.name,sourceName:values.sourceName,sourceType:(values.sourceType as '行业目录'|'展会名单'|'历史客户'|'其他')??'其他',sourceUrl:values.sourceUrl||undefined,rows,skipped})}} fields={[{name:'sourceName',label:'名单名称',required:true,placeholder:'例如：Hannover Messe 2026 展商名单'},{name:'sourceType',label:'名单类型',type:'select',required:true,options:['行业目录','展会名单','历史客户','其他']},{name:'sourceUrl',label:'来源链接',placeholder:'可选；展会或目录公开页面'},{name:'file',label:'CSV、Excel 或 PDF 文件',type:'file',accept:'.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf',required:true},{name:'companyColumn',label:'企业名称列（手动映射，可选）',placeholder:'例如：Exhibitor Name'},{name:'regionColumn',label:'地区/国家列（可选）',placeholder:'例如：Country'},{name:'industryColumn',label:'行业列（可选）',placeholder:'例如：Sector'},{name:'contactNameColumn',label:'联系人列（可选）',placeholder:'例如：Contact Person'},{name:'contactEmailColumn',label:'邮箱列（可选）',placeholder:'例如：E-mail'},{name:'contactPhoneColumn',label:'电话列（可选）',placeholder:'例如：Phone'},{name:'websiteColumn',label:'官网列（可选）',placeholder:'例如：Website'}]}/>
    <CreateDialog open={action==='task'||action==='next'} title={action==='task'?`为 ${selected.size} 家客户创建任务`:`创建跟进任务 · ${actionCustomer?.company??''}`} description="任务保存后会更新客户的下一步动作，并同步到经营总览。" submitLabel="创建任务" successMessage="跟进任务已创建" onClose={()=>setAction(null)} onSubmit={async values=>{const ids=actionCustomer?[actionCustomer.id]:[...selected];await persistCustomerChanges(ids,{next:values.title,due:values.due,interaction:'刚刚'});for(const customerId of ids){const customer=customerRows.find(item=>item.id===customerId);if(customer)await taskApi.create({customerId,title:values.title,priority:values.priority as '高'|'中'|'低',dueAt:Number.isFinite(Date.parse(values.due))?Date.parse(values.due):null,dueLabel:values.due,company:customer.company,nextAction:values.title,impact:customer.value,source:'客户'})}setSelected(new Set())}} initialValues={actionCustomer?{title:actionCustomer.next,due:actionCustomer.due}:undefined} fields={[{name:'title',label:'任务名称',required:true},{name:'due',label:'截止时间',required:true},{name:'priority',label:'优先级',type:'select',required:true,options:['高','中','低']},{name:'note',label:'执行说明',type:'textarea'}]}/>
    <CreateDialog open={action==='tag'} title={`为 ${selected.size} 家客户添加标签`} description="标签会保存到当前工作区，可用于搜索、分组和后续活动受众。" submitLabel="添加标签" successMessage="客户标签已保存" onClose={()=>setAction(null)} onSubmit={async values=>{const colors:{[key:string]:"blue"|"green"|"orange"|"gray"}={蓝色:'blue',绿色:'green',橙色:'orange',灰色:'gray'};await customerApi.addTags([...selected],values.tag,colors[values.color]??'blue');await customerQuery.refetch();setSelected(new Set())}} fields={[{name:'tag',label:'标签',required:true,placeholder:'例如：本周重点'},{name:'color',label:'标签颜色',type:'select',options:['蓝色','绿色','橙色','灰色']}]}/>
    <CreateDialog open={action==='bulk'} title={`批量更新 ${selected.size} 家客户`} description="统一调整关系阶段和负责人，不修改企业基础资料。" submitLabel="应用更新" successMessage="所选客户已更新" onClose={()=>setAction(null)} onSubmit={async values=>{const owner=membersQuery.data?.items.find(item=>item.displayName===values.owner);await persistCustomerChanges([...selected],{stage:values.stage,ownerUserId:owner?.id??null});setSelected(new Set())}} fields={[{name:'stage',label:'关系阶段',type:'select',required:true,options:CUSTOMER_STAGES.map(s=>s.value)},{name:'owner',label:'负责人',type:'select',required:true,options:(membersQuery.data?.items??[]).map(item=>item.displayName)}]}/>
    <CreateDialog open={action==='contact'} title={`联系 ${actionCustomer?.company??''}`} description="邮件会进入统一 SMTP 队列；其他渠道会创建人工触达任务。" submitLabel="确认沟通" successMessage="沟通已进入执行队列" onClose={()=>setAction(null)} onSubmit={async values=>{if(!actionCustomer)return;const contact=contactsQuery.data?.items.find(item=>item.name===values.contact);if(!contact)throw new Error('请选择真实联系人；如果列表为空，请先添加联系人。');if(values.channel==='邮件'){if(!contact.email)throw new Error('该联系人没有有效邮箱，请先补充邮箱。');const thread=await inboxApi.createThread({customerId:actionCustomer.id,subject:`${actionCustomer.company} · 客户跟进`,channel:'邮件',contact:{name:contact.name,company:contact.company,jobTitle:contact.jobTitle,region:contact.region,source:contact.source,primaryChannel:'邮件',email:contact.email,phone:contact.phone}});await inboxApi.confirmReply(thread.id,values.message)}else{await taskApi.create({customerId:actionCustomer.id,title:`${values.channel}联系 ${contact.name}`,priority:'中',dueLabel:'今天',company:actionCustomer.company,nextAction:values.message,impact:actionCustomer.value,source:`客户沟通 · ${values.channel}`})}await persistCustomerChanges([actionCustomer.id],{interaction:`刚刚 · ${values.channel}`,next:'等待客户回复'});await queryClient.invalidateQueries({queryKey:['inbox-threads']})}} fields={[{name:'contact',label:'联系人',type:'select',required:true,options:(contactsQuery.data?.items??[]).map(item=>item.name)},{name:'channel',label:'沟通方式',type:'select',required:true,options:['邮件','电话','LinkedIn','WhatsApp','短信','微信']},{name:'message',label:'沟通内容',type:'textarea',required:true}]}/>
    <CreateDialog open={action==='add-contact'} title={`添加联系人 · ${actionCustomer?.company??''}`} description="联系人会保存到客户档案，并可直接用于邮件或人工触达。" submitLabel="保存联系人" successMessage="联系人已保存" onClose={()=>setAction(null)} onSubmit={async values=>{if(!actionCustomer)return;await customerApi.addContact(actionCustomer.id,{name:values.name,jobTitle:values.jobTitle,email:values.email||null,phone:values.phone||null,primaryChannel:values.channel});await Promise.all([customerQuery.refetch(),queryClient.invalidateQueries({queryKey:['customer-contacts',actionCustomer.id]})])}} fields={[{name:'name',label:'姓名',required:true},{name:'jobTitle',label:'职位'},{name:'email',label:'邮箱',type:'email'},{name:'phone',label:'电话'},{name:'channel',label:'首选渠道',type:'select',options:['邮件','电话','LinkedIn','WhatsApp','短信','微信']}]}/>
    <CreateDialog open={action==='edit'} title={`编辑客户 · ${actionCustomer?.company??''}`} description="更新企业基础信息、负责人和当前关系阶段。" submitLabel="保存修改" successMessage="客户资料已更新" onClose={()=>setAction(null)} onSubmit={async values=>{if(actionCustomer){const owner=membersQuery.data?.items.find(item=>item.displayName===values.owner);await persistCustomerChanges([actionCustomer.id],{company:values.company,region:values.region,industry:values.industry,stage:values.stage,ownerUserId:owner?.id??null})}}} initialValues={actionCustomer?{company:actionCustomer.company,region:actionCustomer.region,industry:actionCustomer.industry,stage:actionCustomer.stage,owner:actionCustomer.owner}:undefined} fields={[{name:'company',label:'企业名称',required:true},{name:'region',label:'地区',required:true},{name:'industry',label:'行业',required:true},{name:'stage',label:'关系阶段',type:'select',required:true,options:CUSTOMER_STAGES.map(s=>s.value)},{name:'owner',label:'负责人',type:'select',required:true,options:(membersQuery.data?.items??[]).map(item=>item.displayName)}]}/>
    <Modal open={Boolean(importPreview)} title="客户名单字段映射" description={importPreview?`${importPreview.fileName} · ${importPreview.sourceType} · 将校验并导入 ${importPreview.rows.length} 家企业`:''} onClose={()=>setImportPreview(null)} footer={<><Button onClick={()=>setImportPreview(null)} disabled={importing}>取消</Button><Button variant="primary" disabled={importing||!importPreview} onClick={async()=>{if(!importPreview)return;setImporting(true);try{const result=await customerApi.import({sourceName:importPreview.sourceName,sourceType:importPreview.sourceType,sourceUrl:importPreview.sourceUrl,rows:importPreview.rows});await customerQuery.refetch();setImportPreview(null);showToast(`已新增 ${result.created} 家，合并重复 ${result.duplicates} 条，新增联系人 ${result.contactsCreated} 位`)}catch(cause){showToast(cause instanceof Error?cause.message:'导入失败，请稍后重试。')}finally{setImporting(false)}}}>{importing?'正在导入…':'确认导入'}</Button></>}>{importPreview?<><div className="status-detail-list">{[['来源记录',`${importPreview.sourceType} · ${importPreview.sourceName}`,'导入记录将保留在审计日志'],['企业名称',`自动识别 ${importPreview.rows.length} 条`,'company / 公司名 / customer'],['地区、行业和联系人','按常见中英文列名自动映射','region / industry / email / phone'],['文件内重复',`跳过 ${importPreview.skipped} 条`,'按企业名称去重'],['入库状态','待验证','不会直接自动触达']].map(item=><article key={item[0]}><span><strong>{item[0]}</strong><small>{item[2]}</small></span><Badge tone={item[1].includes('跳过')&&importPreview.skipped>0?'orange':'green'}>{item[1]}</Badge></article>)}</div><div className="campaign-content-dialog">{importPreview.rows.slice(0,5).map(row=><article key={row.company}><i>{row.company.slice(0,1)}</i><span><strong>{row.company}</strong><small>{row.region} · {row.industry} · 匹配分 {row.score}</small></span><Badge tone="blue">待验证</Badge></article>)}{importPreview.rows.length>5?<small>仅预览前 5 条，确认后会交由服务端再次去重和入库。</small>:null}</div></>:null}</Modal>
    <Modal open={importHistoryOpen} title="客户名单导入记录" description="保留行业目录、展会名单和历史客户的入库来源。" onClose={()=>setImportHistoryOpen(false)} footer={<Button onClick={()=>setImportHistoryOpen(false)}>关闭</Button>}>{importHistoryQuery.isLoading?<EmptyState className="compact" title="正在读取导入记录" icon={RefreshCw}/>:importHistoryQuery.data?.items.length?<DataTable className="customer-table customer-table-pro" columns={[{key:'source',title:'来源'},{key:'result',title:'入库结果'},{key:'time',title:'导入时间'}]} rows={importHistoryQuery.data.items.map(item=>({key:item.id,cells:[<div className="standard-cell-stack"><strong>{item.sourceName}</strong><small>{item.sourceType}{item.sourceUrl?` · ${item.sourceUrl}`:''}</small></div>,<div className="standard-cell-stack"><strong>新增 {item.created} 家 · 联系人 {item.contactsCreated} 位</strong><small>共 {item.total} 条，重复/合并 {item.duplicates} 条</small></div>,<span>{new Date(item.createdAt).toLocaleString('zh-CN')}</span>]}))}/>:<EmptyState className="compact" title="暂无导入记录" description="首次导入行业目录、展会或历史客户后会显示在这里。" icon={Import}/>}</Modal>
    <Modal open={Boolean(mergePreview)} title="合并重复客户" description="合并后保留主客户档案，另一条记录会归档；联系人、任务、商机、会话和活动受众会安全迁移。" onClose={()=>setMergePreview(null)} footer={<><Button onClick={()=>setMergePreview(null)}>取消</Button><Button onClick={async()=>{if(!mergePreview)return;setMergePreview(await customerApi.mergePreview(mergePreview.duplicate.id,mergePreview.primary.id))}}>切换主记录</Button><Button variant="primary" onClick={async()=>{if(!mergePreview)return;try{await customerApi.merge(mergePreview.primary.id,mergePreview.duplicate.id);await customerQuery.refetch();setSelected(new Set());setMergePreview(null);showToast('重复客户已合并，原记录已归档')}catch(cause){showToast(cause instanceof Error?cause.message:'客户合并失败')}}}>确认合并</Button></>}>
      {mergePreview&&<div className="status-detail-list"><article><span><strong>保留主客户</strong><small>保留较完整的企业档案与后续关系</small></span><Badge tone="green">{mergePreview.primary.company}</Badge></article><article><span><strong>归档重复记录</strong><small>仍会留在审计记录中，可追溯本次合并</small></span><Badge tone="orange">{mergePreview.duplicate.company}</Badge></article><article><span><strong>迁移数据</strong><small>联系人 {mergePreview.contacts.duplicate} 位、任务 {mergePreview.transfers.tasks} 项、商机 {mergePreview.transfers.deals} 个、会话 {mergePreview.transfers.threads} 条</small></span><Badge tone="blue">安全迁移</Badge></article>{mergePreview.contacts.duplicateNames.length?<article><span><strong>同名联系人</strong><small>{mergePreview.contacts.duplicateNames.join('、')} 会合并联系方式，避免重复创建</small></span><Badge tone="orange">去重</Badge></article>:null}</div>}
    </Modal>
    <Modal open={action==='more'} title={`${actionCustomer?.company??''} · 更多操作`} onClose={()=>setAction(null)}><div className="action-sheet-list"><Button onClick={()=>{if(actionCustomer)setDetail(actionCustomer);setAction(null)}}><CircleUserRound/><span><strong>打开客户档案</strong><small>查看联系人、信号和最近动态</small></span><ChevronRight/></Button><Button onClick={()=>setAction('edit')}><Building2/><span><strong>编辑客户资料</strong><small>修改企业、地区、阶段和负责人</small></span><ChevronRight/></Button><Button onClick={()=>{setAction('contact')}}><Mail/><span><strong>联系客户</strong><small>创建邮件、电话或社交沟通记录</small></span><ChevronRight/></Button><Button onClick={()=>{setAction('next')}}><CheckCircle2/><span><strong>创建任务</strong><small>安排下一步动作和截止时间</small></span><ChevronRight/></Button><Button onClick={async()=>{if(!actionCustomer)return;await archiveCustomers([actionCustomer.id],view!=='已归档');setAction(null)}}><Layers3/><span><strong>{view==='已归档'?'恢复客户':'归档客户'}</strong><small>{view==='已归档'?'恢复到正常客户列表':'不删除数据，可随时恢复'}</small></span><ChevronRight/></Button></div></Modal>
  </div>
}

function CustomerDetail({customer,onClose,onTask,onContact,onAddContact,onWhatsappOptIn}:{customer:CustomerRecord|null;onClose:()=>void;onTask:(customer:CustomerRecord)=>void;onContact:(customer:CustomerRecord)=>void;onAddContact:(customer:CustomerRecord)=>void;onWhatsappOptIn:(contact:Awaited<ReturnType<typeof customerApi.listContacts>>['items'][number])=>void}) {
  const queryClient=useQueryClient()
  const showToast=useUiStore(s=>s.showToast)
  const [contactFilter,setContactFilter]=useState<'all'|'verified'|'unverified'|'invalid'>('all')
  const contactsQuery=useQuery({queryKey:['customer-contacts',customer?.id,contactFilter],queryFn:()=>customerApi.listContacts(customer!.id,{verificationStatus:contactFilter}),enabled:Boolean(customer?.id),retry:1})
  const [overrideMode,setOverrideMode]=useState(false)
  const [overrideScore,setOverrideScore]=useState(70)
  const [overrideReason,setOverrideReason]=useState('')
  const [submitting,setSubmitting]=useState(false)
  const [verifying,setVerifying]=useState<string|null>(null)
  if(!customer)return null
  const contacts=contactsQuery.data?.items??[]
  const verifyContact=async(contactId:string,status:'verified'|'unverified'|'invalid')=>{
    setVerifying(contactId)
    try{
      await customerApi.verifyContact(customer!.id,contactId,status)
      await Promise.all([queryClient.invalidateQueries({queryKey:['customer-contacts',customer!.id]}),queryClient.invalidateQueries({queryKey:['customers']})])
      showToast(status==='verified'?'已标记为已验证':status==='invalid'?'已标记为无效':'已标记为待验证')
    }catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}
    finally{setVerifying(null)}
  }
  const [stageChanging,setStageChanging]=useState(false)
  const changeStage=async(stage:CustomerStage)=>{
    setStageChanging(true)
    try{
      await customerApi.changeStage(customer!.id,stage)
      await queryClient.invalidateQueries({queryKey:['customers']})
      showToast(`阶段已变更为「${stage}」`)
    }catch(cause){showToast(cause instanceof Error?cause.message:'阶段变更失败')}
    finally{setStageChanging(false)}
  }
  const effectiveScore=customer.scoreOverride??customer.score
  const scoreTier=effectiveScore>=90?{label:'高度匹配',tone:'green' as const,desc:'行业、地区、规模、购买信号高度吻合，建议优先跟进。'}
    :effectiveScore>=85?{label:'值得跟进',tone:'blue' as const,desc:'核心维度匹配，存在明确购买信号，安排主动触达。'}
    :effectiveScore>=70?{label:'继续培育',tone:'orange' as const,desc:'部分维度匹配，需补充关键信息或等待更强信号。'}
    :{label:'待验证',tone:'neutral' as const,desc:'资料不完整或匹配度低，先验证企业与联系人真实性。'}
  const submitOverride=async()=>{
    if(overrideScore<0||overrideScore>100)return showToast('评分必须在 0–100 之间')
    if(!overrideReason.trim())return showToast('请填写修正原因')
    setSubmitting(true)
    try{
      await customerApi.scoreOverride(customer.id,overrideScore,overrideReason.trim())
      await queryClient.invalidateQueries({queryKey:['customers']})
      setOverrideMode(false);setOverrideReason('')
      showToast('评分已修正，审计记录已保存')
    }catch(cause){showToast(cause instanceof Error?cause.message:'评分修正失败')}
    finally{setSubmitting(false)}
  }
  const clearOverride=async()=>{
    setSubmitting(true)
    try{
      await customerApi.scoreOverride(customer.id,null)
      await queryClient.invalidateQueries({queryKey:['customers']})
      setOverrideMode(false)
      showToast('已恢复系统原始评分')
    }catch(cause){showToast(cause instanceof Error?cause.message:'操作失败')}
    finally{setSubmitting(false)}
  }
  return <DetailDrawer className="customer-drawer" open title={customer.company} subtitle={`${customer.region} · ${customer.industry} · ${customer.size}`} onClose={onClose} footer={<><Button onClick={()=>onAddContact(customer)}><Plus size={15}/>添加联系人</Button><Button onClick={()=>onTask(customer)}><CheckCircle2 size={15}/>创建任务</Button><Button variant="primary" disabled={!contacts.length} onClick={()=>onContact(customer)}><Mail size={15}/>联系客户</Button></>}><div className="customer-drawer-body app-detail-drawer-body">
    <section className="customer-detail-overview">
      <div><small>客户匹配分</small><strong style={{color:effectiveScore>=90?'var(--color-success, #16a34a)':effectiveScore>=85?'var(--color-info, #2563eb)':effectiveScore>=70?'var(--color-warning, #ea580c)':'var(--color-text-muted, #6b7280)'}}>{effectiveScore}{customer.scoreOverride!=null&&customer.scoreOverride!==customer.score?<small style={{fontSize:11,textDecoration:'line-through',opacity:0.6,marginLeft:6}}>{customer.score}</small>:null}</strong>{customer.scoreOverride!=null?<span className="override-badge-wrap"><Badge tone="orange"><Pencil size={11}/>人工修正</Badge></span>:null}</div>
      <div><small>预计价值</small><strong>{customer.value}</strong></div>
      <div><small>关系阶段</small><Badge tone={getStageTone(customer.stage)}>{customer.stage}</Badge></div>
    </section>

    <section className="stage-transition-section">
      <h3><GitMerge size={15}/>阶段流转</h3>
      <div className="stage-transition-buttons">
        {CUSTOMER_STAGES.map(s=>{
          const isCurrent=s.value===customer.stage
          return <Button key={s.value} size="sm" variant={isCurrent?'primary':'secondary'} disabled={isCurrent||stageChanging} onClick={()=>changeStage(s.value)}>{s.label}</Button>
        })}
      </div>
      <small className="stage-hint">点击目标阶段即可变更。系统会根据阶段自动更新下一步动作建议；所有变更记入审计日志。</small>
    </section>

    <section className="score-explanation-section">
      <h3><Gauge size={15}/>评分分档说明</h3>
      <div className="score-tier-grid">
        {[
          {range:'90–100',label:'高度匹配',tone:'green'},
          {range:'85–89',label:'值得跟进',tone:'blue'},
          {range:'70–84',label:'继续培育',tone:'orange'},
          {range:'0–69',label:'待验证',tone:'neutral'},
        ].map(tier=><article key={tier.range} className={effectiveScore>=Number(tier.range.split('–')[0])&&effectiveScore<=Number(tier.range.split('–')[1])?'active':''}>
          <Badge tone={tier.tone as 'green'|'blue'|'orange'|'neutral'}>{tier.range}</Badge>
          <strong>{tier.label}</strong>
        </article>)}
      </div>
      <p className="score-tier-desc"><TrendingUp size={13}/>{scoreTier.desc}</p>
      <div className="score-confidence-bar">
        <div className="score-bar-track"><u style={{width:`${effectiveScore}%`}}/></div>
        <small>证据置信度 {customer.confidence}%</small>
      </div>
    </section>

    {customer.scoreOverride!=null?<section className="score-override-history">
      <h3><ShieldAlert size={15}/>人工修正记录</h3>
      <article>
        <span><strong>{customer.scoreOverride} 分</strong><small>原系统评分 {customer.score} 分 · {customer.scoreOverrideByName??'未知成员'} · {customer.scoreOverrideAt?new Date(customer.scoreOverrideAt).toLocaleString('zh-CN'):''}</small></span>
        <p>{customer.scoreOverrideReason}</p>
        <Button size="sm" onClick={clearOverride} disabled={submitting}>恢复系统评分</Button>
      </article>
    </section>:null}

    {!customer.scoreOverride&&!overrideMode?<section className="score-override-actions">
      <Button size="sm" onClick={()=>{setOverrideScore(customer.score);setOverrideMode(true)}}><Pencil size={13}/>人工修正评分</Button>
    </section>:null}

    {overrideMode?<section className="score-override-form">
      <h3><Pencil size={15}/>修正客户匹配分</h3>
      <label>修正后分数（0–100）
        <input type="number" min={0} max={100} value={overrideScore} onChange={e=>setOverrideScore(Number(e.target.value))}/>
      </label>
      <label>修正原因（必填，将记入审计日志）
        <textarea rows={3} value={overrideReason} onChange={e=>setOverrideReason(e.target.value)} placeholder="例如：电话沟通后确认企业实际规模小于系统判断，下调至 70。" maxLength={500}/>
      </label>
      <div className="score-override-form-actions">
        <Button size="sm" onClick={()=>setOverrideMode(false)} disabled={submitting}>取消</Button>
        <Button size="sm" variant="primary" onClick={submitOverride} disabled={submitting}>{submitting?'保存中…':'保存修正'}</Button>
      </div>
    </section>:null}

    <section><h3>客户联系人</h3><div className="contact-verification-filter">
      {([['all','全部'],['verified','已验证'],['unverified','待验证'],['invalid','无效']] as const).map(([value,label])=><button key={value} type="button" className={contactFilter===value?'active':''} onClick={()=>setContactFilter(value)}>{label}</button>)}
    </div><div className="customer-contact-list">{contacts.map(contact=>{
      const vBadge=contact.verificationStatus==='verified'?{tone:'green' as const,text:'已验证'}:contact.verificationStatus==='invalid'?{tone:'red' as const,text:'无效'}:{tone:'orange' as const,text:'待验证'}
      return <article key={contact.id}><i><CircleUserRound size={17}/></i><span><strong>{contact.name}</strong><small>{contact.jobTitle} · {contact.email||contact.phone||'等待补全联系方式'}{contact.verificationSource?<em> · {contact.verificationSource}</em>:null}</small></span><Badge tone={vBadge.tone}>{vBadge.text}</Badge><div className="contact-actions">
        {contact.phone?<Button size="sm" onClick={()=>onWhatsappOptIn(contact)}>{contact.whatsappOptedInAt?'撤销 WhatsApp':'WhatsApp'}</Button>:null}
        {contact.verificationStatus!=='verified'?<Button size="sm" variant="primary" loading={verifying===contact.id} onClick={()=>verifyContact(contact.id,'verified')}>验证</Button>:null}
        {contact.verificationStatus!=='invalid'?<Button size="sm" loading={verifying===contact.id} onClick={()=>verifyContact(contact.id,'invalid')}>无效</Button>:null}
      </div></article>
    })}{!contactsQuery.isLoading&&!contacts.length&&<EmptyState className="compact" title={contactFilter==='all'?'暂无联系人':'该筛选下暂无联系人'} description={contactFilter==='all'?'添加真实联系人后即可创建沟通。':'切换筛选条件查看其他联系人。'} icon={CircleUserRound}/>}</div></section>
    <section><h3>最近动态</h3><div className="customer-timeline"><article><i/><span><strong>{customer.signal}</strong><small>{customer.source} · {customer.interaction}</small></span></article><article><i/><span><strong>客户已保存</strong><small>保留企业研究与来源证据</small></span></article></div></section>
    <section className="customer-detail-action"><h3>下一步建议</h3><p>{customer.next}，建议在 {customer.due} 前完成。</p></section>
  </div></DetailDrawer>
}
