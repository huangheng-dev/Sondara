import { useEffect, useState, type ReactNode } from 'react'
import { BrainCircuit, Check, CheckCircle2, ExternalLink, FileSearch2, Mail, Phone, SearchCheck, Sparkles, UserRoundSearch } from 'lucide-react'
import type { Candidate } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DetailDrawer } from '@/components/ui/DetailDrawer'
import { useUiStore } from '@/stores/ui-store'
import { Alert, Card, Col, Descriptions, Flex, List, Progress, Row, Space, Statistic, Typography } from 'antd'

export function CompanyDecisionDrawer({ candidate, open, onClose, onSave, onEnrich, onCreateTask }: { candidate: Candidate | null; open: boolean; onClose: () => void; onSave: (candidate: Candidate) => void | Promise<void>; onEnrich: (candidate: Candidate) => void | Promise<void | string>; onCreateTask: (candidate: Candidate) => void | Promise<void> }) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [brief, setBrief] = useState(false)
  const [evidenceOpen,setEvidenceOpen]=useState<string|null>(null)
  const showToast = useUiStore(s => s.showToast)
  useEffect(() => { if (open) { setDone(new Set()); setBrief(false) } }, [open, candidate?.id])
  if (!candidate) return null
  const complete = (key: string, message: string) => { setDone(value => new Set(value).add(key)); showToast(message) }
  const runAction = async (key: string, title: string) => {
    setBusy(value=>new Set(value).add(key))
    try {
      let resultMessage = ''
      if(key==='save')await onSave(candidate)
      if(key==='enrich')resultMessage=(await onEnrich(candidate))??''
      if(key==='task')await onCreateTask(candidate)
      complete(key,resultMessage||`${title}已完成`)
    } catch(cause) {
      showToast(cause instanceof Error?cause.message:'操作失败，请稍后重试。')
    } finally {
      setBusy(value=>{const next=new Set(value);next.delete(key);return next})
    }
  }
  return <DetailDrawer open={open} onClose={onClose} title={candidate.company} subtitle={`${candidate.industry} · ${candidate.region} · 更新于 ${candidate.updatedAt}`} width={720}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={8}><Statistic title="综合机会分" value={candidate.score} suffix="分"/><Progress aria-label={`${candidate.company}研究置信度`} percent={candidate.confidence} size="small" format={value=>`置信度 ${value}%`}/></Col>
            <Col xs={24} sm={16}><Space wrap><Badge tone="green">建议优先跟进</Badge><Badge tone="blue">预计价值 {candidate.value}</Badge></Space><Typography.Paragraph strong>为什么值得现在跟进</Typography.Paragraph><Typography.Paragraph>{candidate.reason}</Typography.Paragraph></Col>
          </Row>
        </Card>
        <DecisionSection title="评分拆解" subtitle="匹配度、意向、时机与商业价值共同计算" icon={<BrainCircuit size={18} />}>
          <List dataSource={candidate.dimensions} renderItem={item=><List.Item extra={<Typography.Text strong>{item.score}</Typography.Text>}><Flex vertical gap={4} style={{ width: '100%' }}><Typography.Text>{item.label}</Typography.Text><Progress aria-label={`${item.label}评分`} percent={item.score} showInfo={false}/></Flex></List.Item>}/>
        </DecisionSection>
        <DecisionSection title="购买信号与证据链" subtitle="每个判断都能回溯到来源和时间" icon={<FileSearch2 size={18} />}>
          <List dataSource={candidate.evidence} renderItem={item=><List.Item actions={[<Badge key="strength" tone={item.strength === '强' ? 'green' : 'blue'}>{item.strength}信号</Badge>,<Button key="open" onClick={() => setEvidenceOpen(evidenceOpen===item.title?null:item.title)}>{evidenceOpen===item.title?'收起':'查看'}</Button>]}><List.Item.Meta avatar={<CheckCircle2/>} title={item.title} description={<Space direction="vertical" size={4}><Typography.Text type="secondary">{item.source} · {item.time}</Typography.Text>{evidenceOpen===item.title&&<Alert type="info" showIcon message="证据摘要" description={`公开来源显示该企业近期出现“${item.title}”相关变化，与当前目标市场的购买窗口一致。来源：${item.source}，采集时间：${item.time}。`}/>}</Space>}/></List.Item>}/>
        </DecisionSection>
        <DecisionSection title="公开联系人" subtitle="仅展示可回溯到公开页面的邮箱、电话和社交主页" icon={<UserRoundSearch size={18} />}>
          {candidate.contacts.length ? <List dataSource={candidate.contacts} renderItem={person=><List.Item><List.Item.Meta title={<Space><Typography.Text strong>{person.name}</Typography.Text><Badge tone={person.verificationStatus === 'verified' ? 'green' : 'blue'}>{person.verificationStatus === 'verified' ? '域名已验证' : '公开来源'}</Badge></Space>} description={<Space direction="vertical" size={2}><Typography.Text>{person.role}</Typography.Text>{person.email ? <a href={`mailto:${person.email}`}><Mail size={14}/> {person.email}</a> : person.phone ? <a href={`tel:${person.phone}`}><Phone size={14}/> {person.phone}</a> : person.socialUrl ? <a href={person.socialUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> 查看公开主页</a> : null}<Typography.Text type="secondary">置信度 {person.confidence}% · <a href={person.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></Typography.Text></Space>}/></List.Item>}/> : <List dataSource={candidate.committee} renderItem={person=><List.Item extra={<Badge tone={person.name === '待补全' ? 'orange' : 'blue'}>{person.influence}</Badge>}><List.Item.Meta title={person.name} description={`${person.role} · ${person.contact}`}/></List.Item>}/>}
        </DecisionSection>
        <DecisionSection title="关系与风险" subtitle="避免只看分数，保留竞争和未知信息" icon={<SearchCheckIcon />}>
          <Descriptions bordered column={1} items={candidate.relationships.map(item=>({key:item.label,label:item.label,children:item.value}))}/>
        </DecisionSection>
        <DecisionSection title="下一步最佳动作" subtitle="把研究结果直接变成可执行任务" icon={<Sparkles size={18} />}>
          <List dataSource={[['save', '保存至客户库', '在本地建立企业档案并保留全部证据'], ['enrich', '补全公开联系人', '扫描企业官网与联系页并验证公开联系方式'], ['task', '创建 48 小时跟进任务', '加入我的个人待办']]} renderItem={([key,title,desc])=><List.Item actions={[<Button key="run" size="sm" loading={busy.has(key)} onClick={() => runAction(key,title)} disabled={done.has(key)}>{done.has(key) ? '已完成' : '执行'}</Button>]}><List.Item.Meta avatar={done.has(key) ? <Check/> : <Sparkles/>} title={title} description={desc}/></List.Item>}/>
          <List dataSource={['brief']} renderItem={()=><List.Item actions={[<Button key="brief" size="sm" onClick={() => setBrief(value => !value)}>{brief ? '收起' : '生成'}</Button>]}><List.Item.Meta avatar={<BrainCircuit/>} title="生成首次沟通简报" description="只生成建议，不自动外发"/></List.Item>}/>
          {brief && <Alert type="info" showIcon message="沟通切入建议" description={`围绕“${candidate.signal}”展开，先确认项目阶段和现有供应商，再提供与 ${candidate.industry} 场景匹配的案例、验证文件和交付计划。避免直接推销产品。`}/>}
        </DecisionSection>
        <Card size="small"><Flex align="center" justify="space-between" wrap gap={8}><Typography.Text>结果是否符合你的判断？反馈将用于优化后续排序。</Typography.Text><Space><Button size="sm" disabled={done.has('feedback')} onClick={() => complete('feedback','已记录为符合')}>{done.has('feedback')?'已记录':'符合'}</Button><Button size="sm" onClick={() => complete('feedback','已标记不匹配并进入复核')}>不匹配</Button></Space></Flex></Card>
      </Space>
  </DetailDrawer>
}

function DecisionSection({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return <Card size="small" title={<Space>{icon}<Space direction="vertical" size={0}><Typography.Text strong>{title}</Typography.Text><Typography.Text type="secondary">{subtitle}</Typography.Text></Space></Space>}>{children}</Card>
}

function SearchCheckIcon() { return <SearchCheck size={18} /> }
