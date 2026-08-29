import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bold,
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  CopyPlus,
  Download,
  FileText,
  Files,
  Image,
  Languages,
  Link2,
  ListChecks,
  Mail,
  MessageCircle,
  MessageSquareText,
  PhoneCall,
  Mic2,
  Newspaper,
  PenLine,
  Presentation,
  Send,
  Sparkles,
  Target,
  Upload,
  Video,
  WandSparkles,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { Panel } from '@/components/ui/Panel'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { useUiStore } from '@/stores/ui-store'
import { CustomSelect } from '@/components/ui/CustomSelect'
import { Modal } from '@/components/ui/Modal'
import { downloadText } from '@/utils/download'
import { Pagination } from '@/components/ui/Pagination'
import { SearchInput } from '@/components/ui/SearchInput'
import { List } from '@/components/ui/List'
import { usePagination } from '@/hooks/usePagination'
import { campaignApi, contentApi, icpApi, type ContentAssetApiRecord, type ContentAssetStatus, type ContentQualityResult } from '@/lib/api'
import { Card, Checkbox, Col, Flex, Form, Input, Progress, Row, Space, Statistic, Typography } from 'antd'
import { PageContainer, PageState, SelectionBar, TableToolbar } from '@/components/ui/PageModules'
import { StatusNotice } from '@/components/ui/StatusNotice'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
type ContentTemplate = {label:string;icon:typeof Mail;desc:string}
type AssetSort = '最近更新' | '最早更新' | '标题 A–Z' | '标题 Z–A' | '市场 A–Z'
type AssetItem = [title:string,market:string,role:string,status:ContentAssetStatus,updatedAt:string,id:string,body:string,version:number,quality:number]

const creationGroups: {label:string;items:ContentTemplate[]}[] = [
  {label:'客户触达',items:[
    {label:'首次触达邮件',icon:Mail,desc:'基于客户信号建立低阻力联系'},
    {label:'跟进邮件',icon:Send,desc:'承接回复、会议或资料发送节点'},
    {label:'LinkedIn 私信',icon:MessageSquareText,desc:'适合社交平台的短消息触达'},
    {label:'WhatsApp 消息',icon:MessageCircle,desc:'生成简短、自然的即时沟通内容'},
    {label:'短信',icon:MessageSquareText,desc:'生成适合手机阅读的简短行动提醒'},
    {label:'电话话术',icon:PhoneCall,desc:'准备开场、提问、异议和下一步'},
    {label:'语音留言',icon:Mic2,desc:'形成 30 秒内可说清价值的留言'},
  ]},
  {label:'专业内容',items:[
    {label:'LinkedIn 帖子',icon:Newspaper,desc:'发布行业观点与客户洞察'},
    {label:'行业洞察',icon:PenLine,desc:'围绕趋势和购买信号形成观点'},
    {label:'技术文章',icon:BookOpenText,desc:'解释产品、场景和技术方案'},
    {label:'常见问题',icon:CircleHelp,desc:'把客户疑问整理为可复用回答'},
    {label:'落地页',icon:Link2,desc:'组织价值主张、证据和转化行动'},
    {label:'网络研讨会邀请',icon:Presentation,desc:'生成主题、议程与报名邀请'},
  ]},
  {label:'销售资料',items:[
    {label:'案例研究',icon:FileText,desc:'用证据说明相似项目结果'},
    {label:'产品选型指南',icon:ListChecks,desc:'帮助技术角色完成方案比较'},
    {label:'一页式方案',icon:Presentation,desc:'用一页概括问题、方案与价值'},
    {label:'提案摘要',icon:ClipboardList,desc:'快速形成商务提案核心内容'},
  ]},
  {label:'视频视觉',items:[
    {label:'短视频脚本',icon:Video,desc:'生成开场、主体和行动引导'},
    {label:'演示讲稿',icon:Mic2,desc:'为演示文稿生成逐页讲述内容'},
    {label:'信息图文案',icon:Image,desc:'提炼适合视觉化呈现的数据与观点'},
  ]},
]

const sourceMethods = [
  {label:'客户信号',icon:Sparkles},
  {label:'产品资料',icon:FileText},
  {label:'网页改写',icon:Link2},
  {label:'文档转内容',icon:Upload},
  {label:'复用资产',icon:Files},
  {label:'批量变体',icon:CopyPlus},
] as const

export function ContentPage() {
  const { canWrite } = useWorkspaceAccess()
  const [searchParams,setSearchParams]=useSearchParams()
  const showToast=useUiStore(s=>s.showToast)
  const queryClient=useQueryClient()
  const [creatorOpen,setCreatorOpen]=useState(false)
  const [contextCustomer,setContextCustomer]=useState('')
  const [template,setTemplate]=useState('首次触达邮件')
  const [creationGroup,setCreationGroup]=useState('客户触达')
  const [sourceMethod,setSourceMethod]=useState<(typeof sourceMethods)[number]['label']>('客户信号')
  const [title,setTitle]=useState('DONJOY 高洁净流体解决方案首次触达')
  const [editor,setEditor]=useState('您好，\n\n我们注意到贵司正在推进高洁净生产、过程设备或流体控制相关项目。DONJOY 提供卫生级泵、无菌与卫生级阀门、阀门控制和高洁净管路解决方案，可根据介质、流量、压力、温度、清洗要求及适用标准提供针对性的选型资料。\n\n如果这与你们当前的项目、设备配套或区域渠道规划相关，我可以先发送一份简要的英文产品与应用资料供内部评估。')
  const [market,setMarket]=useState('全球油气与石化项目业主及 EPC')
  const [role,setRole]=useState('采购负责人')
  const [stage,setStage]=useState('问题认知')
  const [signal,setSignal]=useState('产品线扩张')
  const [language,setLanguage]=useState('中文')
  const [preview,setPreview]=useState(false)
  const [assetDialog,setAssetDialog]=useState<'assets'|'campaign'|'language'|'versions'|'link'|null>(null)
  const [selectedAsset,setSelectedAsset]=useState<AssetItem|null>(null)
  const [versionAssetId,setVersionAssetId]=useState<string|null>(null)
  const [activeAssetId,setActiveAssetId]=useState<string|null>(null)
  const [saving,setSaving]=useState(false)
  const [generating,setGenerating]=useState(false)
  const [quality,setQuality]=useState<ContentQualityResult>({overallScore:86,customerRelevance:92,evidenceScore:78,actionClarity:88,findings:['建议补充一个量化客户结果，可信度会更高。']})
  const [languageTips,setLanguageTips]=useState<{label:string;tone:'good'|'warning';detail:string}[]>([])
  const [checkingLanguage,setCheckingLanguage]=useState(false)
  const [assetQuery,setAssetQuery]=useState('')
  const [assetStatus,setAssetStatus]=useState('全部状态')
  const [assetSort,setAssetSort]=useState<AssetSort>('最近更新')
  const [selectedAssets,setSelectedAssets]=useState<Set<string>>(new Set())
  const [campaignAssetIds,setCampaignAssetIds]=useState<string[]|null>(null)
  useEffect(()=>{
    if(searchParams.get('create')!=='1'||!canWrite)return
    const customer=searchParams.get('customer')?.trim()
    const customerMarket=searchParams.get('market')?.trim()
    if(customer){setContextCustomer(customer);setTitle(`${customer} · 首次触达`)}
    if(customerMarket)setMarket(customerMarket)
    setSourceMethod('客户信号')
    setActiveAssetId(null)
    setCreatorOpen(true)
    setSearchParams({}, {replace:true})
  },[searchParams,setSearchParams,canWrite])
  const contentQuery=useQuery({queryKey:['content-assets'],queryFn:()=>contentApi.list({pageSize:100,sort:'updated_desc'}),retry:1})
  const campaignQuery=useQuery({queryKey:['campaigns'],queryFn:()=>campaignApi.list({pageSize:100,sort:'updated_desc'}),retry:1})
  const profileQuery=useQuery({queryKey:['icp-profile'],queryFn:icpApi.getProfile,retry:1,staleTime:30_000})
  const marketOptions=useMemo(()=>{try{const parsed=JSON.parse(profileQuery.data?.analysisSummary??'{}') as {recommendedMarkets?:Array<{name?:unknown}>};return [...new Set([profileQuery.data?.selectedMarket,...(parsed.recommendedMarkets??[]).map(item=>String(item.name??'').trim())].filter((value):value is string=>Boolean(value)))]}catch{return profileQuery.data?.selectedMarket?[profileQuery.data.selectedMarket]:[]}},[profileQuery.data])
  useEffect(()=>{if(contextCustomer)return;const selected=profileQuery.data?.selectedMarket;if(selected&&market!==selected){setMarket(selected);if(title==='DONJOY 高洁净流体解决方案首次触达')setTitle(`${selected}首次触达`)}},[profileQuery.data?.selectedMarket,contextCustomer,market,title])
  const campaigns=campaignQuery.data?.items??[]
  const versionsQuery=useQuery({queryKey:['content-versions',versionAssetId],queryFn:()=>contentApi.versions(versionAssetId!),enabled:Boolean(versionAssetId&&assetDialog==='versions'),retry:1})
  const contentAssets=contentQuery.data?.items??[]
  const formatUpdated=(value:number)=>{const diff=Date.now()-value;if(diff<60_000)return '刚刚';if(diff<3_600_000)return `${Math.max(1,Math.floor(diff/60_000))} 分钟前`;if(diff<86_400_000)return `${Math.floor(diff/3_600_000)} 小时前`;return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric'}).format(value)}
  const allAssetItems=useMemo<AssetItem[]>(()=>contentAssets.map(asset=>[asset.title,asset.targetMarket,asset.customerRole,asset.status,formatUpdated(asset.updatedAt),asset.id,asset.body,asset.currentVersion,asset.qualityScore]),[contentAssets])
  const assetItems=useMemo(()=>{const filtered=allAssetItems.filter(item=>(!assetQuery||`${item[0]}${item[1]}${item[2]}`.toLowerCase().includes(assetQuery.toLowerCase()))&&(assetStatus==='全部状态'||item[3]===assetStatus));if(assetSort==='最早更新')return [...filtered].reverse();if(assetSort==='标题 A–Z')return [...filtered].sort((a,b)=>a[0].localeCompare(b[0],'zh-CN'));if(assetSort==='标题 Z–A')return [...filtered].sort((a,b)=>b[0].localeCompare(a[0],'zh-CN'));if(assetSort==='市场 A–Z')return [...filtered].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN'));return filtered},[allAssetItems,assetQuery,assetStatus,assetSort])
  const assetPaging=usePagination(assetItems,10,`${assetQuery}|${assetStatus}|${assetSort}`)
  const linkedCampaigns=contentAssets.find(asset=>asset.id===activeAssetId)?.linkedCampaignIds.length??0
  const wordCount=useMemo(()=>editor.replace(/\s/g,'').length,[editor])
  const selectTemplate=(next:string)=>{setTemplate(next);setTitle(`${market}${next}`);setEditor(`${next}草稿：围绕“${signal}”信号，向${role}说明验证依据、业务价值和低阻力下一步。`);setPreview(false)}
  const refineContent=async()=>{setGenerating(true);try{const result=await contentApi.generate({title,contentType:`${template}润色`,channel:template.includes('邮件')?'邮件':template.includes('LinkedIn')?'LinkedIn':template.includes('WhatsApp')?'WhatsApp':'内容资产',language,targetMarket:market,customerRole:role,buyingStage:stage,customerSignal:signal,sourceMethod:'编辑器润色',existingBody:editor});setEditor(result.body);setQuality(result.quality);showToast(result.generationMode==='ai'?`已通过 ${result.serviceName??'AI 服务'} 优化内容`:'已按本地规则优化内容')}catch(error){showToast(error instanceof Error?error.message:'内容优化失败')}finally{setGenerating(false)}}
  const openLanguageCheck=async()=>{setAssetDialog('language');setCheckingLanguage(true);try{const result=await contentApi.analyze({title,contentType:template,language,body:editor,targetMarket:market,customerRole:role,buyingStage:stage,customerSignal:signal,sourceMethod});setLanguageTips(result.tips);setQuality(result.quality)}catch(error){showToast(error instanceof Error?error.message:'语言检查失败')}finally{setCheckingLanguage(false)}}
  const generate=async()=>{setGenerating(true);try{const result=await contentApi.generate({title,contentType:template,channel:template.includes('邮件')?'邮件':template.includes('LinkedIn')?'LinkedIn':template.includes('WhatsApp')?'WhatsApp':'内容资产',language,targetMarket:market,customerRole:role,buyingStage:stage,customerSignal:signal,sourceMethod});setEditor(result.body);setQuality(result.quality);showToast(result.generationMode==='ai'?`已通过 ${result.serviceName??'AI 服务'} 生成${template}`:`已通过本地规则生成${template}`)}catch(error){showToast(error instanceof Error?error.message:'内容生成失败')}finally{setGenerating(false)}}
  const saveDraft=async()=>{setSaving(true);try{const input={title,contentType:template,channel:template.includes('邮件')?'邮件':'内容资产',status:'草稿' as const,language,body:editor,summary:editor.replace(/\s+/g,' ').slice(0,160),targetMarket:market,customerRole:role,buyingStage:stage,customerSignal:signal,sourceMethod};const saved=activeAssetId?await contentApi.update(activeAssetId,{...input,changeNote:'编辑器保存'}):await contentApi.create(input);setActiveAssetId(saved.id);setQuality({overallScore:saved.qualityScore,customerRelevance:saved.customerRelevance,evidenceScore:saved.evidenceScore,actionClarity:saved.actionClarity,findings:quality.findings});await queryClient.invalidateQueries({queryKey:['content-assets']});showToast(`内容草稿已保存为版本 ${saved.currentVersion}`)}catch(error){showToast(error instanceof Error?error.message:'保存内容失败')}finally{setSaving(false)}}
  const loadAsset=(asset:ContentAssetApiRecord|AssetItem)=>{if(Array.isArray(asset)){setTitle(asset[0]);setMarket(asset[1]);setRole(asset[2]);setEditor(asset[6]);setActiveAssetId(asset[5]);setQuality(value=>({...value,overallScore:asset[8]}));return}setTitle(asset.title);setTemplate(asset.contentType);setMarket(asset.targetMarket);setRole(asset.customerRole);setStage(asset.buyingStage);setSignal(asset.customerSignal);setLanguage(asset.language);setEditor(asset.body);setActiveAssetId(asset.id);setQuality({overallScore:asset.qualityScore,customerRelevance:asset.customerRelevance,evidenceScore:asset.evidenceScore,actionClarity:asset.actionClarity,findings:quality.findings})}
  const activeTemplates=creationGroups.find(group=>group.label===creationGroup)?.items??creationGroups[0].items
  const assetSortIcon=(active:boolean,descending:boolean)=><span aria-hidden="true">{active?(descending?<ArrowDown/>:<ArrowUp/>):<ArrowUpDown/>}</span>
  const clearAssetFilters=()=>{setAssetQuery('');setAssetStatus('全部状态');setAssetSort('最近更新')}

  return <PageContainer>
    <PageHeader title="内容创作" description="集中管理、复用和发布已经生成的营销内容。" actions={<Button variant="primary" disabled={!canWrite} onClick={()=>{setActiveAssetId(null);setCreatorOpen(true)}}><WandSparkles size={16}/>AI 创作</Button>}/>

    <Modal open={creatorOpen} title="AI 创作" description="选择创作方式、生成内容并保存到内容资产。" width={1440} onClose={()=>{setCreatorOpen(false);setContextCustomer('')}}>
      {contextCustomer&&<StatusNotice className="content-context-notice" tone="info" title={`正在为 ${contextCustomer} 创建内容`} description="客户名称和市场上下文已自动带入；保存后可以继续加入营销活动。"/>}
      <Row gutter={[16,16]}>
        <Col xs={24} xl={6}><Space orientation="vertical" size="middle" style={{width:'100%'}}><Card title="生成手段" extra={<Badge tone="blue">{sourceMethods.length} 种</Badge>}><Space wrap>{sourceMethods.map(({label,icon:Icon})=><Button variant={sourceMethod===label?'primary':'secondary'} onClick={()=>{setSourceMethod(label);showToast(`已切换为${label}`)}} key={label}><Icon size={14}/>{label}</Button>)}</Space></Card><Card title="内容形式" extra={<Badge tone="blue">{activeTemplates.length} 种</Badge>}><Space orientation="vertical" style={{width:'100%'}}><CustomSelect ariaLabel="内容形式分类" value={creationGroup} onChange={setCreationGroup} options={creationGroups.map(group=>({value:group.label,label:group.label,icon:group.label==='客户触达'?<MessageSquareText/>:group.label==='专业内容'?<BookOpenText/>:group.label==='销售资料'?<ClipboardList/>:<Video/>}))}/><List dataSource={activeTemplates} renderItem={({label,icon:Icon,desc})=><List.Item actions={template===label?[<CheckCircle2 key="selected"/>]:undefined} onClick={()=>selectTemplate(label)}><List.Item.Meta avatar={<Icon/>} title={label} description={desc}/></List.Item>}/></Space></Card></Space></Col>
        <Col xs={24} xl={12}><Card title={<Space orientation="vertical" size={0}><Typography.Text strong>编辑与发布</Typography.Text><Typography.Text type="secondary">{template} · {activeAssetId?'已载入服务端版本':'尚未保存'}</Typography.Text></Space>} extra={<Space><Button onClick={()=>setPreview(value=>!value)}>{preview?'继续编辑':'预览'}</Button><Button variant="primary" loading={saving} onClick={saveDraft}>保存草稿</Button></Space>}><Space orientation="vertical" size="middle" style={{width:'100%'}}><Input aria-label="内容标题" value={title} onChange={e=>setTitle(e.target.value)}/><Flex wrap gap={8}><Button aria-label="加粗" onClick={()=>setEditor(value=>`**${value}**`)}><Bold size={15}/></Button><Button aria-label="插入链接" onClick={()=>setAssetDialog('link')}><Link2 size={15}/></Button><Button loading={generating} onClick={refineContent}>{!generating&&<WandSparkles size={14}/>}AI 优化</Button><Button onClick={openLanguageCheck}><Languages size={14}/>语言检查</Button></Flex>{preview?<Card size="small"><Badge tone="blue">预览</Badge><Typography.Title level={2}>{title}</Typography.Title>{editor.split('\n').map((line,index)=><Typography.Paragraph key={index}>{line||' '}</Typography.Paragraph>)}</Card>:<Input.TextArea rows={20} aria-label="内容编辑器" value={editor} onChange={e=>setEditor(e.target.value)}/>}<Flex justify="space-between" align="center" wrap gap={8}><Typography.Text type="secondary">{wordCount} 字 · {language} · 版本 {contentAssets.find(asset=>asset.id===activeAssetId)?.currentVersion??'未保存'}</Typography.Text><Space wrap><Button onClick={async()=>{if(activeAssetId){const copy=await contentApi.duplicate(activeAssetId);loadAsset(copy);await queryClient.invalidateQueries({queryKey:['content-assets']});showToast('已创建并打开服务端副本')}else{setTitle(`${title}（副本）`);showToast('已创建未保存副本')}}}>创建副本</Button><Button onClick={()=>{downloadText(`${title}.txt`,`${title}\n\n${editor}`);showToast('内容文档已下载')}}><Download size={14}/>导出</Button><Button onClick={()=>{setCampaignAssetIds(null);setAssetDialog('campaign')}}><Send size={14}/>加入营销活动{linkedCampaigns>0?` · ${linkedCampaigns}`:''}</Button></Space></Flex></Space></Card></Col>
        <Col xs={24} xl={6}><Space orientation="vertical" size="middle" style={{width:'100%'}}><Card title="生成设置"><Form layout="vertical"><Form.Item label="目标市场"><CustomSelect ariaLabel="目标市场" value={market} onChange={setMarket} options={marketOptions.length?marketOptions:[market]}/></Form.Item><Form.Item label="客户角色"><CustomSelect ariaLabel="客户角色" value={role} onChange={setRole} options={['采购负责人','技术负责人','企业负责人']}/></Form.Item><Form.Item label="购买阶段"><CustomSelect ariaLabel="购买阶段" value={stage} onChange={setStage} options={['问题认知','方案比较','采购决策']}/></Form.Item><Form.Item label="客户信号"><CustomSelect ariaLabel="客户信号" value={signal} onChange={setSignal} options={['项目建设','检修替换','招投标活跃','渠道合作']}/></Form.Item><Form.Item label="输出语言"><CustomSelect ariaLabel="输出语言" value={language} onChange={setLanguage} options={['中文','English','Deutsch']}/></Form.Item><Button block variant="primary" loading={generating} onClick={generate}>{!generating&&<WandSparkles size={15}/>}根据设置重新生成</Button></Form></Card><Card title="内容质量" extra={<Statistic value={quality.overallScore} suffix="分"/>}><Space orientation="vertical" style={{width:'100%'}}>{[['客户相关性',quality.customerRelevance],['证据充分度',quality.evidenceScore],['行动清晰度',quality.actionClarity]].map(item=><Flex vertical gap={2} key={item[0]}><Flex justify="space-between"><Typography.Text>{item[0]}</Typography.Text><Typography.Text strong>{item[1]}</Typography.Text></Flex><Progress aria-label={`${item[0]}评分`} percent={Number(item[1])} showInfo={false}/></Flex>)}<StatusNotice tone="info" icon={<Target size={17}/>} title="质量建议" description={quality.findings[0]??'内容结构完整，可进入审核。'}/></Space></Card></Space></Col>
      </Row>
    </Modal>

    <Panel>
      <TableToolbar filters={<>
          <SearchInput ariaLabel="搜索内容资产" value={assetQuery} onChange={event=>setAssetQuery(event.target.value)} placeholder="搜索标题、市场或角色"/>
          {contentAssets.length>4&&<><CustomSelect ariaLabel="内容状态" value={assetStatus} onChange={setAssetStatus} options={['全部状态','草稿','待审核','已发布','可复用','已归档'].map(label=>({value:label,label,icon:label==='全部状态'?<Activity/>:label==='已发布'?<CheckCircle2/>:label==='待审核'?<ClipboardList/>:label==='可复用'?<CopyPlus/>:label==='已归档'?<Files/>:<FileText/>}))}/>
          <CustomSelect ariaLabel="内容资产排序" value={assetSort} onChange={value=>setAssetSort(value as AssetSort)} options={(['最近更新','最早更新','标题 A–Z','标题 Z–A','市场 A–Z'] as AssetSort[]).map(label=>({value:label,label,icon:<ArrowUpDown/>}))}/></>}
          {(assetQuery||assetStatus!=='全部状态'||assetSort!=='最近更新')&&<Button onClick={clearAssetFilters}>清除筛选</Button>}
        </>} selection={selectedAssets.size>0?<SelectionBar count={selectedAssets.size} unit="个内容资产" actions={<><Button onClick={()=>{setCampaignAssetIds([...selectedAssets]);setAssetDialog('campaign')}}><Send/>加入活动</Button><Button onClick={()=>{const chosen=contentAssets.filter(asset=>selectedAssets.has(asset.id));downloadText('sondara-content-assets.txt',chosen.map(asset=>`${asset.title}\n\n${asset.body}`).join('\n\n---\n\n'));showToast(`已导出 ${chosen.length} 个内容资产`)}}><Download/>导出所选</Button><Button aria-label="取消选择" title="取消选择" onClick={()=>setSelectedAssets(new Set())}><X/></Button></>}/>:undefined}/>
      {contentQuery.isError?<PageState status="error" title="内容资产载入失败" description={contentQuery.error instanceof Error?contentQuery.error.message:'请稍后重试。'} onRetry={()=>contentQuery.refetch()}/>:<><DataTable
        loading={contentQuery.isFetching}
        emptyText={<EmptyState title={assetQuery||assetStatus!=='全部状态'?"没有符合条件的内容资产":"暂无内容资产"} description={assetQuery||assetStatus!=='全部状态'?"可以调整搜索词或状态筛选后重新查看。":"从客户定位或营销目标开始，让 AI 生成第一份可复用内容。"} icon={Files}/>}
        columns={[
          {key:'select',title:<Checkbox disabled={!canWrite} aria-label="选择本页全部内容资产" checked={assetPaging.pageItems.length>0&&assetPaging.pageItems.every(item=>selectedAssets.has(item[5]))} onChange={event=>setSelectedAssets(current=>{const next=new Set(current);assetPaging.pageItems.forEach(item=>event.target.checked?next.add(item[5]):next.delete(item[5]));return next})}/>,width:52},
          {key:'title',title:<Button onClick={()=>setAssetSort(assetSort==='标题 A–Z'?'标题 Z–A':'标题 A–Z')}>内容标题{assetSortIcon(assetSort==='标题 A–Z'||assetSort==='标题 Z–A',assetSort==='标题 Z–A')}</Button>},
          {key:'market',title:<Button onClick={()=>setAssetSort('市场 A–Z')}>目标市场{assetSortIcon(assetSort==='市场 A–Z',false)}</Button>},
          {key:'role',title:'客户角色'},
          {key:'status',title:'状态'},
          {key:'updated',title:<Button onClick={()=>setAssetSort(assetSort==='最近更新'?'最早更新':'最近更新')}>更新时间{assetSortIcon(assetSort==='最近更新'||assetSort==='最早更新',assetSort==='最近更新')}</Button>},
          {key:'actions',title:'操作',width:104},
        ]}
        rows={assetPaging.pageItems.map(item=>({key:item[5],className:selectedAssets.has(item[5])?'selected':'',cells:[
          <Checkbox disabled={!canWrite} aria-label={`选择 ${item[0]}`} checked={selectedAssets.has(item[5])} onChange={event=>setSelectedAssets(current=>{const next=new Set(current);event.target.checked?next.add(item[5]):next.delete(item[5]);return next})}/>,
          <Button type="link" onClick={()=>setSelectedAsset(item)}><FileText/><Typography.Text strong>{item[0]}</Typography.Text></Button>,
          <Typography.Text strong>{item[1]}</Typography.Text>,
          <Typography.Text>{item[2]}</Typography.Text>,
          <Badge tone={item[3]==='已发布'?'green':item[3]==='待审核'?'orange':'blue'}>{item[3]}</Badge>,
          <Typography.Text strong>{item[4]}</Typography.Text>,
          <Button aria-label={`打开${item[0]}`} title="查看内容" onClick={()=>setSelectedAsset(item)}><ChevronRight/></Button>,
        ]}))}
      />{!contentQuery.isLoading&&assetItems.length>0&&<Pagination page={assetPaging.page} pageSize={assetPaging.pageSize} total={assetItems.length} onPageChange={assetPaging.setPage} onPageSizeChange={assetPaging.setPageSize} itemName="个内容资产"/>}</>}
    </Panel>
    <CreateDialog open={assetDialog==='link'} title="插入链接" description="补充链接地址与显示文本，链接会追加到当前编辑内容。" submitLabel="插入链接" successMessage="链接已插入内容" onClose={()=>setAssetDialog(null)} onSubmit={values=>{const url=values.url.trim();const linkText=values.text.trim()||url;setEditor(value=>`${value}\n\n[${linkText}](${url})`)}} initialValues={{url:'https://'}} fields={[{name:'url',label:'链接地址',placeholder:'https://example.com',required:true},{name:'text',label:'显示文本',placeholder:'例如：查看产品资料'}]}/>
    <CreateDialog open={assetDialog==='campaign'} title="加入营销活动" description={campaignAssetIds?.length?`将所选 ${campaignAssetIds.length} 个内容分别创建为真实活动执行节点。`:'选择活动与执行节点，内容会加入对应序列。'} submitLabel="加入活动" successMessage="内容已加入营销活动待执行队列" onClose={()=>{setAssetDialog(null);setCampaignAssetIds(null)}} onSubmit={async values=>{const campaign=campaigns.find(item=>item.name===values.campaign);if(!campaign)throw new Error('请选择有效活动');const scheduledAt=values.date?new Date(values.date).getTime():null;let assetIds=campaignAssetIds??[];if(!assetIds.length){let assetId=activeAssetId;if(!assetId){const created=await contentApi.create({title,contentType:template,channel:'内容资产',status:'草稿',language,body:editor,targetMarket:market,customerRole:role,buyingStage:stage,customerSignal:signal,sourceMethod});assetId=created.id;setActiveAssetId(assetId)}assetIds=[assetId]}for(const [index,assetId] of assetIds.entries()){const asset=contentAssets.find(item=>item.id===assetId);await campaignApi.addStep(campaign.id,{name:assetIds.length>1?`${values.step} · ${asset?.title??index+1}`:values.step,channel:campaign.channel,contentAssetId:assetId,scheduledAt:Number.isFinite(scheduledAt)?scheduledAt:null})}setSelectedAssets(new Set());setCampaignAssetIds(null);await Promise.all([queryClient.invalidateQueries({queryKey:['content-assets']}),queryClient.invalidateQueries({queryKey:['campaigns']}),queryClient.invalidateQueries({queryKey:['campaign-schedule']})])}} fields={[{name:'campaign',label:'营销活动',type:'select',required:true,options:campaigns.map(item=>item.name)},{name:'step',label:'执行节点',type:'select',required:true,options:['首次触达','第二轮案例','高意向跟进']},{name:'date',label:'计划日期',type:'date'}]}/>
    <Modal open={assetDialog==='language'} title="语言与语气检查" description={`${language} · ${wordCount} 字`} onClose={()=>setAssetDialog(null)} footer={<><Button onClick={()=>setAssetDialog(null)}>关闭</Button><Button variant="primary" loading={generating} onClick={async()=>{await refineContent();setAssetDialog(null)}}>应用优化</Button></>}>{checkingLanguage?<PageState status="loading" title="正在分析语言、语气和行动请求…"/>:<List dataSource={languageTips} renderItem={tip=><List.Item><List.Item.Meta avatar={tip.tone==='good'?<CheckCircle2/>:<CircleHelp/>} title={tip.label} description={tip.detail}/></List.Item>}/>}</Modal>
    <Modal open={assetDialog==='versions'} title="历史版本" description="保留每次正文或标题变更，可追溯内容演进。" onClose={()=>{setAssetDialog(null);setVersionAssetId(null)}}>{versionsQuery.isLoading?<PageState status="loading" title="正在读取版本…"/>:versionsQuery.data?.items.length?<List dataSource={versionsQuery.data.items} renderItem={version=><List.Item extra={<Badge tone="blue">{version.body.replace(/\s+/g,'').length} 字</Badge>}><List.Item.Meta avatar={<FileText/>} title={`版本 ${version.versionNumber} · ${version.changeNote}`} description={new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(version.createdAt)}/></List.Item>}/>:<EmptyState title="暂无历史版本" icon={FileText}/>}</Modal>
    <Modal open={Boolean(selectedAsset)} title={selectedAsset?.[0]??''} description={`${selectedAsset?.[1]??''} · ${selectedAsset?.[2]??''}`} onClose={()=>setSelectedAsset(null)} footer={<><Button onClick={()=>setSelectedAsset(null)}>关闭</Button><Button onClick={()=>{if(selectedAsset){setVersionAssetId(selectedAsset[5]);setSelectedAsset(null);setAssetDialog('versions')}}}>历史版本</Button>{canWrite&&<><Button onClick={async()=>{if(!selectedAsset)return;await contentApi.update(selectedAsset[5],{status:'已归档'});setSelectedAsset(null);await queryClient.invalidateQueries({queryKey:['content-assets']});showToast('内容已归档')}}>归档</Button><Button variant="primary" onClick={()=>{if(selectedAsset)loadAsset(selectedAsset);setSelectedAsset(null);setCreatorOpen(true)}}>载入编辑器</Button></>}</>}><Space orientation="vertical" size="middle"><Badge tone="blue">{selectedAsset?.[3]}</Badge><Typography.Paragraph>{selectedAsset?.[6]||'该内容可继续修改、复用或加入营销活动。'}</Typography.Paragraph><Typography.Text type="secondary">版本 {selectedAsset?.[7]} · 质量评分 {selectedAsset?.[8]} · 最近更新：{selectedAsset?.[4]}</Typography.Text></Space></Modal>
  </PageContainer>
}
