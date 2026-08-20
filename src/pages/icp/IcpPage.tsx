import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
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
import { CreateDialog } from '@/components/ui/CreateDialog'
import { useUiStore } from '@/stores/ui-store'
import { Modal } from '@/components/ui/Modal'
import { GrowthKnowledge, type GrowthKnowledgeHandle } from '@/pages/icp/GrowthKnowledge'
import { icpApi, type IcpAnalysisResult } from '@/lib/api'

const fallbackMarkets = [
  { name: '德国食品设备', region: '欧洲', companies: '12.6万', tam: '€4.8B', score: 92, signal: 80, status: '优先开发', opportunity: '高', profile: ['食品工厂', '200+ 人', '自动化改造'] },
  { name: '华东制药装备', region: '中国', companies: '8.9万', tam: '¥21B', score: 86, signal: 74, status: '优先开发', opportunity: '高', profile: ['制药企业', 'GMP 认证', '扩产信号'] },
  { name: '北美阀门经销', region: '北美', companies: '4.2万', tam: '$6.2B', score: 78, signal: 66, status: '继续验证', opportunity: '中', profile: ['区域经销商', '10+ 品牌', '工程项目'] },
  { name: '东南亚乳品工程', region: '东南亚', companies: '2.7万', tam: '$1.9B', score: 71, signal: 59, status: '资料不足', opportunity: '待验证', profile: ['乳品工程', '新建产线', '本地服务'] },
]

type Market = (typeof fallbackMarkets)[number]

const customerProfile = [
  ['优先行业', '食品加工、制药、乳品工程与工业流体设备'],
  ['企业特征', '200 人以上，拥有工厂、工程团队或区域渠道能力'],
  ['购买信号', '扩产、新建项目、技术升级、招聘验证或自动化岗位'],
  ['关键联系人', '采购负责人、技术负责人、工厂负责人、企业所有者'],
  ['排除条件', '停止经营、无有效业务信息、消费品公司或产品完全不相关'],
]

const parseAnalysis = (summary: string | null | undefined): IcpAnalysisResult | null => {
  if (!summary) return null
  try {
    const parsed = JSON.parse(summary) as Partial<IcpAnalysisResult>
    if (!parsed || !Array.isArray(parsed.recommendedMarkets)) return null
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(String) : [],
      recommendedMarkets: parsed.recommendedMarkets
        .map(item => ({ name: String(item?.name ?? ''), reason: String(item?.reason ?? '') }))
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

  const selectedMarketName = profile?.selectedMarket || '德国食品设备'
  const setSelectedMarketName = (name: string) => {
    updateMutation.mutate({ selectedMarket: name })
  }

  const analysis = parseAnalysis(profile?.analysisSummary)
  const analysisRunning =
    analyzeMutation.isPending || profile?.analysisStatus === 'running'
  const markets: Market[] = analysis?.recommendedMarkets?.length
    ? analysis.recommendedMarkets.map((item, index) => {
        const known = fallbackMarkets.find(market => market.name === item.name)
        if (known) return known
        return {
          name: item.name,
          region: '待识别',
          companies: '待核实',
          tam: '待核实',
          score: Math.max(60, 90 - index * 6),
          signal: Math.max(50, 78 - index * 6),
          status: index === 0 ? '优先开发' : '继续验证',
          opportunity: index === 0 ? '高' : '中',
          profile: [item.reason],
        }
      })
    : fallbackMarkets

  const selectedMarket =
    markets.find(market => market.name === selectedMarketName) ?? markets[0]

  const selectedReason =
    analysis?.recommendedMarkets?.find(item => item.name === selectedMarket?.name)?.reason

  const startRadar = (market: Market) => {
    setSelectedMarketName(market.name)
    navigate('/radar?create=1')
  }

  const runAnalysis = () => {
    if (analysisRunning) return
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
    return <div className="page-content icp-page"><Panel title="客户定位" subtitle="正在读取业务资料…"> </Panel></div>
  }
  if (profileQuery.isError || !profile) {
    return <div className="page-content icp-page">
      <Panel title="客户定位" subtitle="业务资料读取失败。">
        <Button onClick={() => profileQuery.refetch()}>重试</Button>
      </Panel>
    </div>
  }

  const lastAnalyzedLabel = formatAnalyzedAt(profile.analyzedAt)
  const criteriaRows = (analysis?.criteria?.length
    ? analysis.criteria
    : customerProfile.map(([, v]) => v)
  ).slice(0, 5)

  return <div className="page-content icp-page positioning-page">
    <PageHeader title="客户定位" description="提供你的业务资料，AI 自动分析应该开发哪些市场和客户。" actions={<>
      <Button onClick={() => setBusinessDialog(true)}><FileText size={16} />编辑业务资料</Button>
      <Button onClick={() => setKnowledgeOpen(true)}><BookOpenText size={16} />定位资料</Button>
      <Button variant="primary" disabled={analysisRunning} onClick={runAnalysis}><RefreshCw size={16} className={analysisRunning ? 'is-spinning' : ''} />{analysisRunning ? '正在分析…' : '重新分析'}</Button>
    </>} />

    <section className="icp-business-hero" aria-label="当前业务资料">
      <div className="icp-business-hero__head">
        <div className="icp-business-hero__identity">
          <i><FileText /></i>
          <span>
            <small>当前业务资料</small>
            <strong>{profile.company || '尚未填写公司或品牌名称'}</strong>
            <em>{profile.website || `最近分析：${lastAnalyzedLabel}`}</em>
          </span>
        </div>
        <Badge tone={profile.analysisStatus === 'complete' ? 'green' : 'neutral'}>
          {profile.analysisStatus === 'complete' ? `已分析 · ${lastAnalyzedLabel}` : profile.analysisStatus === 'running' ? '分析中…' : '尚未分析'}
        </Badge>
      </div>
      <dl className="icp-business-hero__grid">
        <div>
          <dt><i><Boxes /></i><span>产品与解决方案</span></dt>
          <dd title={profile.products}>{profile.products || '待补充'}</dd>
        </div>
        <div>
          <dt><i><Globe2 /></i><span>主要销售地区</span></dt>
          <dd title={profile.regions}>{profile.regions || '待补充'}</dd>
        </div>
        <div>
          <dt><i><Target /></i><span>理想客户</span></dt>
          <dd title={profile.customers}>{profile.customers || '待补充'}</dd>
        </div>
        <div>
          <dt><i><UserX /></i><span>排除对象</span></dt>
          <dd title={profile.exclusions}>{profile.exclusions || '未设置'}</dd>
        </div>
      </dl>
    </section>

    <section className="positioning-result-grid" aria-label="客户定位结果">
      <Panel className="positioning-market-ranking" title="推荐市场排行" subtitle={analysis?.recommendedMarkets?.length ? '由业务资料和启用中的知识生成' : '根据你的业务资料自动排序'} action={<Badge tone="blue">{markets.length} 个候选市场</Badge>}>
        <div className="positioning-market-list">{markets.map((market, index) => <Button className={selectedMarket?.name === market.name ? 'active' : ''} aria-pressed={selectedMarket?.name === market.name} key={market.name} onClick={() => setSelectedMarketName(market.name)}>
          <i>{index + 1}</i><span><strong>{market.name}</strong><small>{market.region} · {market.profile.join(' · ')}</small></span><b>{market.score}</b><ArrowRight />
        </Button>)}</div>
      </Panel>

      <Panel className="positioning-profile-card" title={`${selectedMarket?.name ?? '待选择市场'} · 理想客户画像`} subtitle="系统自动归纳，无需手动设置评分参数" action={<Badge tone={selectedMarket?.status === '优先开发' ? 'green' : selectedMarket?.status === '继续验证' ? 'orange' : 'neutral'}>{selectedMarket?.status}</Badge>}>
        <div className="positioning-profile-workspace">
          <section className="positioning-profile-summary"><div className="positioning-profile-lead" aria-busy={analysisRunning}><i><Sparkles /></i><span><small>AI 定位结论</small><strong>{analysisRunning ? '正在重新分析业务资料…' : analysis?.summary || `优先开发${selectedMarket?.name ?? '目标市场'}相关企业`}</strong><p>{analysisRunning ? '正在结合产品、案例和市场资料生成最新结果。' : (selectedReason || `该市场与你的产品能力和既有客户特征匹配，当前机会强度为${selectedMarket?.opportunity ?? '中'}。`)}</p></span><div><small>定位置信度</small><strong>{analysisRunning ? '—' : selectedMarket?.score}</strong></div></div><div className="positioning-profile-overview"><span><small>潜在企业</small><strong>{selectedMarket?.companies ?? '—'}</strong></span><span><small>市场规模</small><strong>{selectedMarket?.tam ?? '—'}</strong></span><span><small>机会强度</small><strong>{selectedMarket?.opportunity ?? '—'}</strong></span></div><div className="positioning-profile-tags">{selectedMarket?.profile.map(tag => <Badge key={tag} tone="blue">{tag}</Badge>)}</div></section>
          <section className="positioning-profile-criteria"><header><span><strong>客户筛选条件</strong><small>用于 AI 获客和候选客户排序</small></span><Badge>{criteriaRows.length} 项条件</Badge></header><div className="positioning-profile-compact">{criteriaRows.map(value => <article key={value}><i><CheckCircle2 /></i><span><strong>{value}</strong></span></article>)}</div></section>
        </div>
        <footer><Button onClick={() => setMarketDetail(selectedMarket ?? null)}>查看完整画像</Button><Button variant="primary" disabled={analysisRunning || !selectedMarket} onClick={() => selectedMarket && startRadar(selectedMarket)}>按此定位找客户<ArrowRight size={14} /></Button></footer>
      </Panel>
    </section>

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

    <Modal open={knowledgeOpen} width={1360} title="客户定位资料" description="管理供客户定位、AI 获客和客户研究引用的产品、案例、市场与判断规则。" onClose={() => setKnowledgeOpen(false)} actions={<><Button onClick={() => knowledgeManagerRef.current?.openFile()}><Import />导入资料</Button><Button onClick={() => knowledgeManagerRef.current?.openUrl()}><Link2 />添加网页</Button><Button variant="primary" onClick={() => knowledgeManagerRef.current?.openNew()}><Plus />新增资料</Button></>}><GrowthKnowledge ref={knowledgeManagerRef} showToast={showToast} modal /></Modal>

    <Modal open={Boolean(marketDetail)} title={`${marketDetail?.name ?? ''} · 理想客户画像`} description="以下结论由你的业务资料自动生成，AI 获客会据此判断匹配度。" onClose={() => setMarketDetail(null)} footer={<><Button onClick={() => setMarketDetail(null)}>关闭</Button><Button variant="primary" onClick={() => marketDetail && startRadar(marketDetail)}>按此画像找客户</Button></>}><div className="icp-profile-dialog"><section><span><small>定位置信度</small><strong>{marketDetail?.score}</strong></span><span><small>潜在企业</small><strong>{marketDetail?.companies}</strong></span><span><small>市场规模</small><strong>{marketDetail?.tam}</strong></span></section><div><h3>企业特征</h3>{marketDetail?.profile.map(x => <Badge key={x} tone="blue">{x}</Badge>)}</div><dl><div><dt>重点信号</dt><dd>{analysis?.signals?.join('、') || '扩产、新建项目、技术升级、经销网络调整'}</dd></div><div><dt>优先联系人</dt><dd>采购负责人、技术负责人、工厂负责人</dd></div><div><dt>排除条件</dt><dd>{profile.exclusions || '无官网、业务范围不匹配、近 12 个月停止经营'}</dd></div></dl></div></Modal>
  </div>
}
