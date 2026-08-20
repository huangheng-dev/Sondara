import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Check, FileSearch2, RadioTower } from 'lucide-react'
import type { Candidate } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { Checkbox } from 'antd'

export type CandidateSort = '匹配分最高' | '匹配分最低' | '企业名称 A–Z' | '企业名称 Z–A' | '证据置信度最高' | '证据置信度最低' | '预计价值最高' | '预计价值最低' | '最近发现' | '最早发现'

type CandidateListProps = {
  candidates: Candidate[]
  saved: Set<string>
  selected: Set<string>
  sort: CandidateSort
  onSortChange: (sort: CandidateSort) => void
  onSelectionChange: (selected: Set<string>) => void
  onOpen: (candidate: Candidate) => void
  onSave: (candidate: Candidate) => void
}

const sortIcon = (active: boolean, descending: boolean) => <span className="customer-sort-icon" aria-hidden="true">{active ? (descending ? <ArrowDown/> : <ArrowUp/>) : <ArrowUpDown/>}</span>

export function CandidateList({ candidates, saved, selected, sort, onSortChange, onSelectionChange, onOpen, onSave }: CandidateListProps) {
  if (!candidates.length) return <EmptyState className="list-empty-state" title="暂无候选企业" icon={FileSearch2} />
  const allSelected = candidates.length > 0 && candidates.every(candidate => selected.has(candidate.id))
  const togglePage = (checked: boolean) => {
    const next = new Set(selected)
    candidates.forEach(candidate => checked ? next.add(candidate.id) : next.delete(candidate.id))
    onSelectionChange(next)
  }
  const toggleOne = (candidate: Candidate, checked: boolean) => {
    const next = new Set(selected)
    checked ? next.add(candidate.id) : next.delete(candidate.id)
    onSelectionChange(next)
  }

  return <DataTable
    className="customer-table customer-table-pro radar-candidate-table"
    columns={[
      { key: 'select', title: <span className="customer-check"><Checkbox aria-label="选择本页全部候选" checked={allSelected} onChange={event => togglePage(event.target.checked)}/></span>, width: 52 },
      { key: 'company', title: <Button className="customer-sort-head" onClick={() => onSortChange(sort === '企业名称 A–Z' ? '企业名称 Z–A' : '企业名称 A–Z')}>企业档案{sortIcon(sort === '企业名称 A–Z' || sort === '企业名称 Z–A', sort === '企业名称 Z–A')}</Button> },
      { key: 'quality', title: <Button className="customer-sort-head" onClick={() => onSortChange(sort === '匹配分最高' ? '匹配分最低' : '匹配分最高')}>匹配质量{sortIcon(sort === '匹配分最高' || sort === '匹配分最低', sort === '匹配分最高')}</Button> },
      { key: 'signal', title: <Button className="customer-sort-head" onClick={() => onSortChange(sort === '最近发现' ? '最早发现' : '最近发现')}>购买信号{sortIcon(sort === '最近发现' || sort === '最早发现', sort === '最近发现')}</Button> },
      { key: 'research', title: <Button className="customer-sort-head" onClick={() => onSortChange(sort === '预计价值最高' ? '预计价值最低' : '预计价值最高')}>研究与价值{sortIcon(sort === '预计价值最高' || sort === '预计价值最低', sort === '预计价值最高')}</Button> },
      { key: 'decision', title: <Button className="customer-sort-head" onClick={() => onSortChange(sort === '证据置信度最高' ? '证据置信度最低' : '证据置信度最高')}>AI 决策{sortIcon(sort === '证据置信度最高' || sort === '证据置信度最低', sort === '证据置信度最高')}</Button> },
      { key: 'actions', title: '操作', width: 72 },
    ]}
    rows={candidates.map(candidate => ({
      key: candidate.id,
      className: selected.has(candidate.id) ? 'selected' : '',
      cells: [
        <span className="customer-check"><Checkbox aria-label={`选择 ${candidate.company}`} checked={selected.has(candidate.id)} onChange={event => toggleOne(candidate, event.target.checked)}/></span>,
        <Button className="customer-company" onClick={() => onOpen(candidate)}><i>{candidate.company.slice(0, 1)}</i><span><strong>{candidate.company}</strong><small>{candidate.region} · {candidate.industry}</small><em><RadioTower/>{candidate.source} · {candidate.size}</em></span></Button>,
        <div className="customer-match"><header><strong>{candidate.score}</strong><span>{candidate.score >= 92 ? '高度匹配' : candidate.score >= 88 ? '值得跟进' : '继续研究'}</span></header><i><u style={{ width: `${candidate.score}%` }}/></i><small>证据置信度 {candidate.confidence}%</small></div>,
        <div className="customer-signal"><Badge tone={/新建|扩张|招投标/.test(candidate.signal) ? 'green' : 'blue'}>{candidate.signal}</Badge><strong>{candidate.source}</strong><small>发现于 {candidate.updatedAt}</small></div>,
        <div className="customer-relation"><span><Badge tone={saved.has(candidate.id) ? 'green' : 'blue'}>{saved.has(candidate.id) ? '已入客户库' : `${candidate.evidence.length} 条证据`}</Badge><small>{candidate.confidence}% 研究置信度</small></span><div><small>预计价值</small><strong className="money">{candidate.value}</strong></div></div>,
        <Button className="customer-next" aria-label={`查看 AI 决策：${candidate.company}`} onClick={() => onOpen(candidate)}><i><FileSearch2/></i><span><strong>{candidate.score >= 92 ? '优先跟进' : '查看研究结论'}</strong><small>{candidate.reason}</small></span></Button>,
        <Button className={`radar-table-save ${saved.has(candidate.id) ? 'saved' : ''}`} aria-label={saved.has(candidate.id) ? `${candidate.company} 已保存` : `保存 ${candidate.company} 到客户库`} title={saved.has(candidate.id) ? '已保存到客户库' : '保存到客户库'} disabled={saved.has(candidate.id)} onClick={() => onSave(candidate)}>{saved.has(candidate.id) ? <Check/> : <Bookmark/>}</Button>,
      ],
    }))}
  />
}
