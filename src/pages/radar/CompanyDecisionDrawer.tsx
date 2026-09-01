import { useEffect, useState } from 'react'
import { BrainCircuit, Check, CheckCircle2, ExternalLink, Sparkles } from 'lucide-react'
import type { Candidate } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DetailDrawer, DetailSection } from '@/components/ui/DetailDrawer'
import { List } from '@/components/ui/List'
import { useUiStore } from '@/stores/ui-store'
import { Avatar, Card, Col, Descriptions, Flex, Progress, Row, Space, Statistic, Typography } from 'antd'
import { StatusNotice } from '@/components/ui/StatusNotice'

export function CompanyDecisionDrawer({ candidate, open, canWrite = true, onClose, onSave, onEnrich, onCreateTask, onFeedback }: { candidate: Candidate | null; open: boolean; canWrite?: boolean; onClose: () => void; onSave: (candidate: Candidate) => void | Promise<void>; onEnrich: (candidate: Candidate) => void | Promise<void | string>; onCreateTask: (candidate: Candidate) => void | Promise<void>; onFeedback: (candidate: Candidate, value: 'match' | 'mismatch') => void | Promise<void> }) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [brief, setBrief] = useState(false)
  const [feedback, setFeedback] = useState<'match' | 'mismatch' | null>(null)
  const [evidenceOpen,setEvidenceOpen]=useState<string|null>(null)
  const showToast = useUiStore(s => s.showToast)
  useEffect(() => { if (open) { setDone(new Set()); setBrief(false); setFeedback(null) } }, [open, candidate?.id])
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
  const submitFeedback = async (value: 'match' | 'mismatch') => {
    if (!canWrite) return
    setBusy(current => new Set(current).add('feedback'))
    try {
      await onFeedback(candidate, value)
      setFeedback(value)
      showToast(value === 'match' ? '已记录为符合，候选进入人工复核' : '已记录为不符合，系统会用于后续画像学习')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '反馈保存失败，请稍后重试。')
    } finally {
      setBusy(current => { const next = new Set(current); next.delete('feedback'); return next })
    }
  }
  return <DetailDrawer
    open={open}
    onClose={onClose}
    title={candidate.company}
    subtitle={`${candidate.industry} · ${candidate.region} · 更新于 ${candidate.updatedAt}`}
    width={720}
    footer={<>
      <Button loading={busy.has('feedback')} disabled={!canWrite||Boolean(feedback)} onClick={() => submitFeedback('mismatch')}>{feedback === 'mismatch' ? '已标记不符合' : '不符合'}</Button>
      <Button variant="primary" loading={busy.has('feedback')} disabled={!canWrite||Boolean(feedback)} onClick={() => submitFeedback('match')}>{feedback === 'match' ? '已标记符合' : '符合'}</Button>
    </>}
  >
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <DetailSection title="机会判断" subtitle="综合匹配度、研究置信度和公开购买信号">
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} sm={8}><Statistic title="综合机会分" value={candidate.score} suffix="分"/><Progress aria-label={`${candidate.company}研究置信度`} percent={candidate.confidence} size="small" format={value=>`置信度 ${value}%`}/></Col>
            <Col xs={24} sm={16}><Space wrap><Badge tone="green">建议优先跟进</Badge><Badge tone="blue">预计价值 {candidate.value}</Badge></Space><Typography.Paragraph strong>为什么值得现在跟进</Typography.Paragraph><Typography.Paragraph>{candidate.reason}</Typography.Paragraph></Col>
          </Row>
        </DetailSection>
        <DetailSection title="评分拆解" subtitle="匹配度、意向、时机与商业价值共同计算">
          <List dataSource={candidate.dimensions} renderItem={item=><List.Item extra={<Typography.Text strong>{item.score}</Typography.Text>}><Flex vertical gap={4} style={{ width: '100%' }}><Typography.Text>{item.label}</Typography.Text><Progress aria-label={`${item.label}评分`} percent={item.score} showInfo={false}/></Flex></List.Item>}/>
        </DetailSection>
        <DetailSection title="购买信号与证据链" subtitle="每个判断都能回溯到来源和时间">
          {candidate.intentSignals.length > 0 && (
            <Card size="small" variant="borderless" style={{ marginBottom: 12, background: 'var(--sondara-canvas)' }}>
              <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                <Typography.Text strong>已识别 {candidate.intentSignals.length} 条有来源的意向信号</Typography.Text>
                <Space wrap size={[12, 4]} separator={<Typography.Text type="secondary">·</Typography.Text>}>
                  {candidate.intentSignals.map(signal=><Space size={4} key={signal.id}><a href={signal.sourceUrl} target="_blank" rel="noreferrer">{signal.signalType}</a><Typography.Text type="secondary">+{signal.scoreBoost}</Typography.Text></Space>)}
                </Space>
              </Space>
            </Card>
          )}
          <List dataSource={candidate.evidence} renderItem={item=><List.Item actions={[<Badge key="strength" tone={item.strength === '强' ? 'green' : 'blue'}>{item.strength}信号</Badge>,item.sourceUrl?<Button key="source" type="link" href={item.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/>原文</Button>:null,<Button key="open" onClick={() => setEvidenceOpen(evidenceOpen===item.title?null:item.title)}>{evidenceOpen===item.title?'收起':'查看'}</Button>].filter(Boolean)}><List.Item.Meta avatar={<CheckCircle2/>} title={item.title} description={<Space orientation="vertical" size={4}><Typography.Text type="secondary">{item.source} · {item.time}</Typography.Text>{evidenceOpen===item.title&&<StatusNotice tone="info" title="证据摘要" description={`公开来源显示该企业近期出现“${item.title}”相关变化。该信号仅用于排序，仍需人工打开原文确认时效和业务含义。`}/>}</Space>}/></List.Item>}/>
        </DetailSection>
        <DetailSection title="公开联系人" subtitle="仅展示可回溯到公开页面的邮箱、电话和社交主页">
          {candidate.contacts.length ? (
            <List
              dataSource={candidate.contacts}
              renderItem={person=><List.Item>
                <Row gutter={[16,12]} align="middle" style={{width:'100%'}}>
                  <Col xs={24} md={7}>
                    <Space size={10} align="center" style={{width:'100%'}}>
                      <Avatar>{person.name.trim().slice(0,1) || '联'}</Avatar>
                      <Space orientation="vertical" size={0} style={{minWidth:0}}>
                        <Typography.Text strong ellipsis={{tooltip:person.name}}>{person.name}</Typography.Text>
                        <Typography.Text type="secondary" ellipsis={{tooltip:person.role}}>{person.role}</Typography.Text>
                      </Space>
                    </Space>
                  </Col>
                  <Col xs={24} md={8}>
                    <Space orientation="vertical" size={2} style={{width:'100%',minWidth:0}}>
                      {person.email?<a href={`mailto:${person.email}`} title={person.email} style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{person.email}</a>:<Typography.Text type="secondary">邮箱待补全</Typography.Text>}
                      {person.phone&&<a href={`tel:${person.phone}`}>{person.phone}</a>}
                      {person.socialUrl&&<a href={person.socialUrl} target="_blank" rel="noreferrer">查看公开主页</a>}
                    </Space>
                  </Col>
                  <Col xs={12} md={5}>
                    <Space orientation="vertical" size={3} style={{width:'100%'}}>
                      <Flex justify="space-between" gap={8}><Typography.Text type="secondary">置信度</Typography.Text><Typography.Text strong>{person.confidence}%</Typography.Text></Flex>
                      <Progress aria-label={`${person.name}联系人置信度`} percent={person.confidence} showInfo={false} size="small"/>
                      <a href={person.sourceUrl} target="_blank" rel="noreferrer">查看公开来源</a>
                    </Space>
                  </Col>
                  <Col xs={12} md={4} style={{textAlign:'right'}}>
                    <Badge tone={person.verificationStatus === 'verified' ? 'green' : person.verificationStatus === 'needs_review' ? 'orange' : 'blue'}>{person.verificationStatus === 'verified' ? '域名已验证' : person.verificationStatus === 'needs_review' ? '待复核' : '公开来源'}</Badge>
                  </Col>
                </Row>
              </List.Item>}
            />
          ) : (
            <List dataSource={candidate.committee} renderItem={person=><List.Item extra={<Badge tone={person.name === '待补全' ? 'orange' : 'blue'}>{person.influence}</Badge>}><List.Item.Meta avatar={<Avatar>{person.name.trim().slice(0,1) || '联'}</Avatar>} title={<Typography.Text strong>{person.name}</Typography.Text>} description={<Space orientation="vertical" size={2}><Typography.Text type="secondary">{person.role}</Typography.Text><Typography.Text>{person.contact}</Typography.Text></Space>}/></List.Item>}/>
          )}
        </DetailSection>
        <DetailSection title="关系与风险" subtitle="避免只看分数，保留竞争和未知信息">
          <Descriptions bordered column={1} items={candidate.relationships.map(item=>({key:item.label,label:item.label,children:item.value}))}/>
        </DetailSection>
        <DetailSection title="下一步最佳动作" subtitle="把研究结果直接变成可执行任务">
          <List dataSource={[['save', '保存至客户库', '在本地建立企业档案并保留全部证据'], ['enrich', '补全公开联系人', '扫描企业官网与联系页并验证公开联系方式'], ['task', '创建 48 小时跟进任务', '加入我的个人待办']]} renderItem={([key,title,desc])=><List.Item actions={[<Button key="run" size="sm" loading={busy.has(key)} onClick={() => runAction(key,title)} disabled={!canWrite||done.has(key)}>{done.has(key) ? '已完成' : '执行'}</Button>]}><List.Item.Meta avatar={done.has(key) ? <Check/> : <Sparkles/>} title={title} description={desc}/></List.Item>}/>
          <List dataSource={['brief']} renderItem={()=><List.Item actions={[<Button key="brief" size="sm" onClick={() => setBrief(value => !value)}>{brief ? '收起' : '生成'}</Button>]}><List.Item.Meta avatar={<BrainCircuit/>} title="生成首次沟通简报" description="只生成建议，不自动外发"/></List.Item>}/>
          {brief && <StatusNotice tone="info" icon={<Sparkles size={17}/>} title="沟通切入建议" description={`围绕“${candidate.signal}”展开，先确认项目阶段和现有供应商，再提供与 ${candidate.industry} 场景匹配的案例、验证文件和交付计划。避免直接推销产品。`}/>}
        </DetailSection>
      </Space>
  </DetailDrawer>
}
