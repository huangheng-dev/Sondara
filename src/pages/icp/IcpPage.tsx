import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, Col, Descriptions, Flex, Row, Space, Statistic, Typography } from 'antd'
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  FileText,
  Boxes,
  Globe2,
  Target,
  UserX,
  Import,
  Link2,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PageContainer, PageState } from '@/components/ui/PageModules'
import { CreateDialog } from '@/components/ui/CreateDialog'
import { useUiStore } from '@/stores/ui-store'
import { Modal } from '@/components/ui/Modal'
import { List } from '@/components/ui/List'
import { GrowthKnowledge, type GrowthKnowledgeHandle } from '@/pages/icp/GrowthKnowledge'
import { icpApi, type IcpAnalysisResult } from '@/lib/api'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'

type Market = {
  name: string
  reason: string
  rank: number
  status: '优先开发' | '继续验证'
  profile: string[]
  criteria: string[]
  signals: string[]
}

const parseAnalysis = (summary: string | null | undefined): IcpAnalysisResult | null => {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary) as Partial<IcpAnalysisResult>
    if (!parsed || !Array.isArray(parsed.recommendedMarkets)) return null
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(String) : [],
      recommendedMarkets: parsed.recommendedMarkets
        .map(item => ({
          name: String(item?.name ?? ''),
          reason: String(item?.reason ?? ''),
          profile: Array.isArray(item?.profile) ? item.profile.map(String) : [],
          criteria: Array.isArray(item?.criteria) ? item.criteria.map(String) : [],
          signals: Array.isArray(item?.signals) ? item.signals.map(String) : [],
        }))
        .filter(item => item.name),
      criteria: Array.isArray(parsed.criteria) ? parsed.criteria.map(String) : [],
    }
  } catch {
    return null
  }
}

const formatAnalyzedAt = (value: number | null) => {
  if (!value) return '尚未分析'
  const diff = Date.now() - value
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

export function IcpPage() {
  const [businessDialog, setBusinessDialog] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [marketDetail, setMarketDetail] = useState<Market | null>(null)
  const knowledgeManagerRef = useRef<GrowthKnowledgeHandle>(null)
  const showToast = useUiStore(s => s.showToast)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canWrite } = useWorkspaceAccess()

  const profileQuery = useQuery({
    queryKey: ['icp-profile'],
    queryFn: icpApi.getProfile,
    staleTime: 30_000,
  })
  const profile = profileQuery.data

  const updateMutation = useMutation({
    mutationFn: icpApi.updateProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['icp-profile'] }),
  })
  const analyzeMutation = useMutation({
    mutationFn: icpApi.analyzeProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['icp-profile'] }),
  })

  const [selectedMarketName, setSelectedMarketNameState] = useState('')
  useEffect(() => {
    if (profile?.selectedMarket) setSelectedMarketNameState(profile.selectedMarket)
  }, [profile?.selectedMarket])
  const setSelectedMarketName = (name: string) => {
    setSelectedMarketNameState(name)
    if (canWrite) updateMutation.mutate({ selectedMarket: name })
  }

  const analysis = parseAnalysis(profile?.analysisSummary)
  const analysisRunning =
    analyzeMutation.isPending || profile?.analysisStatus === 'running'
  const markets: Market[] = analysis?.recommendedMarkets?.map((item, index) => {
    const segment = item.name.replace(/^海外|^全球/, '').replace(/(客户|市场)$/, '')
    const marketProfile = item.profile?.length ? item.profile : [segment, '业务场景与当前细分市场直接匹配', '官网与公开经营信息可核验']
    const marketSignals = item.signals?.length ? item.signals : (analysis.signals ?? [])
    const marketCriteria = item.criteria?.length ? item.criteria : [
      `主营业务、产品组合或项目场景与「${segment}」直接匹配`,
      marketProfile[0] ? `企业类型符合：${marketProfile[0]}` : '',
      marketProfile[1] ? `核心应用或能力符合：${marketProfile[1]}` : '',
      marketSignals[0] ? `近期出现“${marketSignals[0]}”等可核验需求信号` : '',
      marketSignals[1] ? `近期出现“${marketSignals[1]}”等采购窗口信号` : '',
      '官网、法人主体、经营地区和业务身份可由可信公开来源交叉核验',
      profile?.exclusions ? `排除：${profile.exclusions}` : '排除业务不匹配、停止经营或无法核验公开来源的企业',
    ].filter(Boolean)
    return {
      name: item.name,
      reason: item.reason,
      rank: index + 1,
      status: index === 0 ? '优先开发' : '继续验证',
      profile: marketProfile.slice(0, 5),
      criteria: marketCriteria.slice(0, 8),
      signals: marketSignals.slice(0, 5),
    }
  }) ?? []

  const selectedMarket =
    markets.find(market => market.name === selectedMarketName) ?? markets[0]

  const selectedReason = selectedMarket?.reason

  const startRadar = (market: Market) => {
    if (!canWrite) return
    setSelectedMarketName(market.name)
    navigate('/radar?create=1')
  }

  const runAnalysis = () => {
    if (analysisRunning || !canWrite) return
    analyzeMutation.mutate(undefined, {
      onSuccess: data => {
        showToast(
          data.mode === 'ai'
            ? 'AI 已生成新的定位结果'
            : '已基于业务资料更新定位结果',
        )
      },
      onError: cause => {
        showToast(cause instanceof Error ? cause.message : '分析失败，请稍后重试。')
      },
    })
  }

  const saveBusinessProfile = (values: Record<string, string>) => {
    updateMutation.mutate(
      {
        company: values.company,
        website: values.website,
        products: values.products,
        regions: values.regions,
        customers: values.customers,
        exclusions: values.exclusions,
      },
      {
        onSuccess: () => {
          showToast('业务资料已保存，正在重新分析客户定位')
          runAnalysis()
        },
        onError: cause => {
          showToast(cause instanceof Error ? cause.message : '业务资料保存失败。')
        },
      },
    )
  }

  if (profileQuery.isLoading) {
    return <PageContainer><PageHeader title="客户定位" description="提供你的业务资料，AI 自动分析应该开发哪些市场和客户。"/><PageState status="loading" loadingVariant="page" title="正在读取业务资料…" description="正在读取客户定位和增长知识。"/></PageContainer>
  }
  if (profileQuery.isError || !profile) {
    return <PageContainer><PageHeader title="客户定位" description="提供你的业务资料，AI 自动分析应该开发哪些市场和客户。"/><PageState status="error" title="业务资料读取失败" description="请确认 API 服务可用后重试。" onRetry={() => profileQuery.refetch()}/></PageContainer>
  }

  const lastAnalyzedLabel = formatAnalyzedAt(profile.analyzedAt)
  const criteriaRows = (selectedMarket?.criteria ?? analysis?.criteria ?? []).slice(0, 8)
  const profileItems = [
    {key:'products',label:'产品与解决方案',value:profile.products||'待补充',icon:Boxes,tone:'violet'},
    {key:'regions',label:'主要销售地区',value:profile.regions||'待补充',icon:Globe2,tone:'blue'},
    {key:'customers',label:'理想客户',value:profile.customers||'待补充',icon:Target,tone:'green'},
    {key:'exclusions',label:'排除对象',value:profile.exclusions||'未设置',icon:UserX,tone:'orange'},
  ]

  return <PageContainer>
    <PageHeader title="客户定位" description="提供你的业务资料，AI 自动分析应该开发哪些市场和客户。" actions={<>
      <Button disabled={!canWrite} onClick={() => setBusinessDialog(true)}><FileText size={16} />编辑业务资料</Button>
      <Button onClick={() => setKnowledgeOpen(true)}><BookOpenText size={16} />定位资料</Button>
      <Button variant="primary" disabled={!canWrite} loading={analysisRunning} onClick={runAnalysis}>{!analysisRunning && <RefreshCw size={16} />}{analysisRunning ? '正在分析…' : '重新分析'}</Button>
    </>} />

    <Card className="icp-profile-card" title={<Space size={10}><span className="icp-section-icon"><FileText size={18}/></span><span>当前业务资料 · {profile.company || '尚未填写公司或品牌名称'}</span></Space>} extra={<Badge tone={profile.analysisStatus === 'complete' ? 'green' : 'neutral'}>{profile.analysisStatus === 'complete' ? `已分析 · ${lastAnalyzedLabel}` : profile.analysisStatus === 'running' ? '分析中…' : '尚未分析'}</Badge>}>
      <Row gutter={[12,12]}>
        {profileItems.map(({key,label,value,icon:Icon,tone})=><Col xs={24} md={12} key={key}>
          <Card className={`icp-profile-item icp-tone--${tone}`} size="small">
            <Flex align="flex-start" gap={12}>
              <span className="icp-profile-item__icon"><Icon size={18}/></span>
              <Flex vertical gap={4} className="icp-profile-item__copy">
                <Typography.Text className="icp-profile-item__label">{label}</Typography.Text>
                <Typography.Paragraph ellipsis={{rows:2,expandable:true,symbol:'展开'}}>{value}</Typography.Paragraph>
              </Flex>
            </Flex>
          </Card>
        </Col>)}
      </Row>
    </Card>

    <Row className="icp-result-grid" gutter={[16, 16]} aria-label="客户定位结果">
      <Col xs={24} xl={8}>
        <Panel className="icp-market-panel" title="推荐市场排行" subtitle={analysis?.recommendedMarkets?.length ? '仅根据业务资料和启用中的知识生成，不展示未经核实的市场规模' : '保存业务资料并运行分析后生成'} action={<Badge tone="blue">{markets.length} 个候选市场</Badge>}>
          {markets.length ? <List className="icp-market-list" dataSource={markets} renderItem={market=><List.Item className={market.name===selectedMarket?.name?'is-selected':''}><Button type="text" block className="icp-market-option" aria-label={`查看${market.name}`} onClick={()=>setSelectedMarketName(market.name)}><span className="icp-market-option__rank">{market.rank}</span><span className="icp-market-option__copy"><Typography.Text strong>{market.name}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:market.reason}}>{market.reason}</Typography.Text></span><Badge tone={market.rank===1?'green':'blue'}>优先级 {market.rank}</Badge><ArrowRight size={15}/></Button></List.Item>}/>:<PageState status="empty" title="尚无定位结果" description="请先完善业务资料并运行分析。"/>}
        </Panel>
      </Col>
      <Col xs={24} xl={16}>
        <Panel className="icp-portrait-panel" title={`${selectedMarket?.name ?? '待选择市场'} · 理想客户画像`} subtitle="切换左侧市场后，画像、信号和筛选条件会同步更新" action={<Badge tone={selectedMarket?.status === '优先开发' ? 'green' : selectedMarket?.status === '继续验证' ? 'orange' : 'neutral'}>{selectedMarket?.status}</Badge>}>
          <Flex className="icp-portrait-content" vertical gap={16}>
            <Card className="icp-conclusion-card" size="small" title={<Space size={8}><Sparkles size={17}/>AI 定位结论</Space>}><Typography.Text strong>{analysisRunning ? '正在重新分析业务资料…' : selectedReason || '等待生成定位结论'}</Typography.Text><Typography.Paragraph type="secondary">{analysisRunning ? '正在结合产品、案例和市场资料生成最新结果。' : selectedMarket?.profile.join('、') || '完成分析后会显示该市场的推荐依据。'}</Typography.Paragraph></Card>
            <Row className="icp-stat-grid" gutter={[10,10]}>
              <Col xs={12} md={6}><Card size="small"><Statistic title="推荐顺序" value={selectedMarket?`第 ${selectedMarket.rank} 位`:'—'}/></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="重点信号" value={selectedMarket?.signals.length??0} suffix="项"/></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="筛选条件" value={criteriaRows.length} suffix="项"/></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Statistic title="资料状态" value={profile.analysisStatus==='complete'?'已分析':'待分析'}/></Card></Col>
            </Row>
            <div className="icp-feature-block"><Typography.Text className="icp-feature-block__label">企业特征</Typography.Text><Flex wrap gap={8}>{selectedMarket?.profile.map(tag => <Badge key={tag} tone="blue">{tag}</Badge>)}</Flex></div>
            <div className="icp-feature-block"><Typography.Text className="icp-feature-block__label">重点信号</Typography.Text><Flex wrap gap={8}>{selectedMarket?.signals.map(tag => <Badge key={tag} tone="green">{tag}</Badge>)}</Flex></div>
            <div className="icp-criteria-block">
              <List className="icp-criteria-list" header={<Typography.Text strong>客户筛选条件 · {criteriaRows.length} 项</Typography.Text>} dataSource={criteriaRows} renderItem={(value,index)=><List.Item><span className="icp-criteria-list__check"><CheckCircle2 size={16}/></span><Typography.Text><Typography.Text type="secondary">{String(index+1).padStart(2,'0')}</Typography.Text> · {value}</Typography.Text></List.Item>}/>
            </div>
            <Flex className="icp-portrait-actions" justify="flex-end" wrap gap={8}><Button onClick={() => setMarketDetail(selectedMarket ?? null)}>查看完整画像</Button><Button variant="primary" disabled={!canWrite || analysisRunning || !selectedMarket} onClick={() => selectedMarket && startRadar(selectedMarket)}>按此定位找客户<ArrowRight size={14} /></Button></Flex>
          </Flex>
        </Panel>
      </Col>
    </Row>

    <CreateDialog open={businessDialog} title="编辑业务资料" description="只需提供你知道的信息，系统会自动提取市场和客户特征。" submitLabel="保存并分析" successMessage="业务资料已保存，正在重新分析客户定位" onClose={() => setBusinessDialog(false)} onSubmit={saveBusinessProfile} initialValues={{
      company: profile.company,
      website: profile.website,
      products: profile.products,
      regions: profile.regions,
      customers: profile.customers,
      exclusions: profile.exclusions,
    }} fields={[
      { name: 'company', label: '公司或品牌名称', required: true },
      { name: 'website', label: '官方网站', placeholder: 'https://example.com' },
      { name: 'products', label: '产品与解决方案', type: 'textarea', required: true, placeholder: '介绍你销售的产品、应用场景和优势' },
      { name: 'regions', label: '主要销售地区', placeholder: '例如：中国、欧洲、北美' },
      { name: 'customers', label: '已成交或理想客户示例', type: 'textarea', placeholder: '填写客户行业、类型或公司名称' },
      { name: 'exclusions', label: '不希望开发的客户', type: 'textarea', placeholder: '系统会自动将这些企业排除' },
    ]} />

    <Modal open={knowledgeOpen} width={1360} title="客户定位资料" description="管理供客户定位、AI 获客和客户研究引用的产品、案例、市场与判断规则。" onClose={() => setKnowledgeOpen(false)} actions={<><Button onClick={() => knowledgeManagerRef.current?.openFile()}><Import size={16} />导入资料</Button><Button onClick={() => knowledgeManagerRef.current?.openUrl()}><Link2 size={16} />添加网页</Button><Button variant="primary" onClick={() => knowledgeManagerRef.current?.openNew()}><Plus size={16} />新增资料</Button></>}><GrowthKnowledge ref={knowledgeManagerRef} showToast={showToast} modal /></Modal>

    <Modal open={Boolean(marketDetail)} title={`${marketDetail?.name ?? ''} · 理想客户画像`} description="以下结论由你的业务资料自动生成，AI 获客会据此判断匹配度。" onClose={() => setMarketDetail(null)} footer={<><Button onClick={() => setMarketDetail(null)}>关闭</Button><Button variant="primary" disabled={!canWrite} onClick={() => marketDetail && startRadar(marketDetail)}>按此画像找客户</Button></>}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Row gutter={[16,16]}>
          <Col span={8}><Statistic title="推荐顺序" value={marketDetail?`第 ${marketDetail.rank} 位`:'—'}/></Col>
          <Col span={8}><Statistic title="重点信号" value={marketDetail?.signals.length??0} suffix="项"/></Col>
          <Col span={8}><Statistic title="筛选条件" value={marketDetail?.criteria.length ?? 0} suffix="项"/></Col>
        </Row>
        <Space orientation="vertical"><Typography.Text strong>企业特征</Typography.Text><Space wrap>{marketDetail?.profile.map(x => <Badge key={x} tone="blue">{x}</Badge>)}</Space></Space>
        <Descriptions bordered column={1} items={[
          {key:'signals',label:'重点信号',children:marketDetail?.signals.join('、') || '扩产、新建项目、技术升级、经销网络调整'},
          {key:'criteria',label:'筛选条件',children:marketDetail?.criteria.join('；') || '业务和项目场景与当前市场匹配'},
          {key:'contacts',label:'优先联系人',children:'采购负责人、技术负责人、工厂负责人'},
          {key:'exclude',label:'排除条件',children:profile.exclusions || '无官网、业务范围不匹配、近 12 个月停止经营'},
        ]}/>
      </Space>
    </Modal>
  </PageContainer>
}
