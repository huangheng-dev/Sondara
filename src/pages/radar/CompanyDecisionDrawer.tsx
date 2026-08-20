import { useEffect, useState, type ReactNode } from 'react'
import { BrainCircuit, Check, CheckCircle2, ExternalLink, FileSearch2, Mail, Phone, SearchCheck, Sparkles, UserRoundSearch } from 'lucide-react'
import type { Candidate } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DetailDrawer } from '@/components/ui/DetailDrawer'
import { useUiStore } from '@/stores/ui-store'

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
  return <DetailDrawer className="decision-drawer" open={open} onClose={onClose} title={candidate.company} subtitle={`${candidate.industry} · ${candidate.region} · 更新于 ${candidate.updatedAt}`} width={720}>
      <div className="drawer-body">
        <section className="decision-summary"><div className="score-hero"><strong>{candidate.score}</strong><span>综合机会分</span><small>置信度 {candidate.confidence}%</small></div><div className="decision-reason"><div><Badge tone="green">建议优先跟进</Badge><Badge tone="blue">预计价值 {candidate.value}</Badge></div><h3>为什么值得现在跟进</h3><p>{candidate.reason}</p></div></section>
        <DecisionSection title="评分拆解" subtitle="匹配度、意向、时机与商业价值共同计算" icon={<BrainCircuit size={18} />}>{candidate.dimensions.map(item => <div className="score-row" key={item.label}><span>{item.label}</span><div className="progress"><i style={{ width: `${item.score}%` }} /></div><strong>{item.score}</strong></div>)}</DecisionSection>
        <DecisionSection title="购买信号与证据链" subtitle="每个判断都能回溯到来源和时间" icon={<FileSearch2 size={18} />}>{candidate.evidence.map(item => <div className="evidence-row" key={item.title}><div className="evidence-marker"><CheckCircle2 size={17} /></div><div><strong>{item.title}</strong><p>{item.source} · {item.time}</p></div><div><Badge tone={item.strength === '强' ? 'green' : 'blue'}>{item.strength}信号</Badge><Button onClick={() => setEvidenceOpen(evidenceOpen===item.title?null:item.title)} aria-label="查看证据">查看</Button></div>{evidenceOpen===item.title&&<article className="evidence-snapshot"><strong>证据摘要</strong><p>公开来源显示该企业近期出现“{item.title}”相关变化，与当前目标市场的购买窗口一致。来源：{item.source}，采集时间：{item.time}。</p><small>此处保留来源、时间和摘要，后端接入后可打开原始网页快照。</small></article>}</div>)}</DecisionSection>
        <DecisionSection title="公开联系人" subtitle="仅展示可回溯到公开页面的邮箱、电话和社交主页" icon={<UserRoundSearch size={18} />}>
          {candidate.contacts.length ? <div className="committee-grid contact-grid">{candidate.contacts.map(person => <article key={person.id}><strong>{person.name}</strong><span>{person.role}</span><Badge tone={person.verificationStatus === 'verified' ? 'green' : 'blue'}>{person.verificationStatus === 'verified' ? '域名已验证' : '公开来源'}</Badge>{person.email ? <a href={`mailto:${person.email}`}><Mail />{person.email}</a> : person.phone ? <a href={`tel:${person.phone}`}><Phone />{person.phone}</a> : person.socialUrl ? <a href={person.socialUrl} target="_blank" rel="noreferrer"><ExternalLink />查看公开主页</a> : null}<small>置信度 {person.confidence}% · <a href={person.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></small></article>)}</div> : <div className="committee-grid">{candidate.committee.map(person => <article key={`${person.name}-${person.role}`}><strong>{person.name}</strong><span>{person.role}</span><Badge tone={person.name === '待补全' ? 'orange' : 'blue'}>{person.influence}</Badge><small>{person.contact}</small></article>)}</div>}
        </DecisionSection>
        <DecisionSection title="关系与风险" subtitle="避免只看分数，保留竞争和未知信息" icon={<SearchCheckIcon />}>{candidate.relationships.map(item => <div className="relationship-row" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</DecisionSection>
        <DecisionSection title="下一步最佳动作" subtitle="把研究结果直接变成可执行任务" icon={<Sparkles size={18} />}>
          {[['save', '保存至客户库', '在本地建立企业档案并保留全部证据'], ['enrich', '补全公开联系人', '扫描企业官网与联系页并验证公开联系方式'], ['task', '创建 48 小时跟进任务', '加入我的个人待办']].map(([key, title, desc]) => <div className={`next-action ${done.has(key) ? 'done' : ''}`} key={key}><div>{done.has(key) ? <Check size={17} /> : <Sparkles size={17} />}</div><span><strong>{title}</strong><small>{desc}</small></span><Button size="sm" onClick={() => runAction(key,title)} disabled={done.has(key)||busy.has(key)}>{busy.has(key)?'执行中…':done.has(key) ? '已完成' : '执行'}</Button></div>)}
          <div className="next-action"><div><BrainCircuit size={17} /></div><span><strong>生成首次沟通简报</strong><small>只生成建议，不自动外发</small></span><Button size="sm" onClick={() => setBrief(value => !value)}>{brief ? '收起' : '生成'}</Button></div>
          {brief && <div className="outreach-brief"><strong>沟通切入建议</strong><p>围绕“{candidate.signal}”展开，先确认项目阶段和现有供应商，再提供与 {candidate.industry} 场景匹配的案例、验证文件和交付计划。避免直接推销产品。</p></div>}
        </DecisionSection>
        <footer className="decision-feedback"><span>结果是否符合你的判断？反馈将用于优化后续排序。</span><div><Button size="sm" disabled={done.has('feedback')} onClick={() => complete('feedback','已记录为符合')}>{done.has('feedback')?'已记录':'符合'}</Button><Button size="sm" variant="ghost" onClick={() => complete('feedback','已标记不匹配并进入复核')}>不匹配</Button></div></footer>
      </div>
  </DetailDrawer>
}

function DecisionSection({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return <section className="decision-section"><header><div className="section-icon">{icon}</div><div><h3>{title}</h3><p>{subtitle}</p></div></header>{children}</section>
}

function SearchCheckIcon() { return <SearchCheck size={18} /> }
