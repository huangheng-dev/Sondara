import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Check, FileSearch2 } from 'lucide-react'
import type { Candidate } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { Avatar, Checkbox, Flex, Progress, Space, Typography } from 'antd'

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

const sortIcon = (active: boolean, descending: boolean) => <span className="table-sort-indicator" data-sort-active={active} aria-hidden="true">{active ? (descending ? <ArrowDown size={14}/> : <ArrowUp size={14}/>) : <ArrowUpDown size={14}/>}</span>

export function CandidateList({ candidates, saved, selected, sort, onSortChange, onSelectionChange, onOpen, onSave }: CandidateListProps) {
  if (!candidates.length) return <EmptyState title="暂无候选企业" icon={FileSearch2} />
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
    className="candidate-table"
    minWidth={900}
    columns={[
      { key: 'select', title: <Checkbox aria-label="选择本页全部候选" checked={allSelected} onChange={event => togglePage(event.target.checked)}/>, width: 52, fixed: 'left' },
      { key: 'company', title: <Button onClick={() => onSortChange(sort === '企业名称 A–Z' ? '企业名称 Z–A' : '企业名称 A–Z')}>企业档案{sortIcon(sort === '企业名称 A–Z' || sort === '企业名称 Z–A', sort === '企业名称 Z–A')}</Button>, width: 320, fixed: 'left' },
      { key: 'quality', title: <Button onClick={() => onSortChange(sort === '匹配分最高' ? '匹配分最低' : '匹配分最高')}>匹配质量{sortIcon(sort === '匹配分最高' || sort === '匹配分最低', sort === '匹配分最高')}</Button>, width: 170 },
      { key: 'signal', title: '购买信号', width: 220 },
      { key: 'value', title: <Button onClick={() => onSortChange(sort === '预计价值最高' ? '预计价值最低' : '预计价值最高')}>价值评估{sortIcon(sort === '预计价值最高' || sort === '预计价值最低', sort === '预计价值最高')}</Button>, width: 190 },
      { key: 'decision', title: <Button onClick={() => onSortChange(sort === '证据置信度最高' ? '证据置信度最低' : '证据置信度最高')}>AI 决策{sortIcon(sort === '证据置信度最高' || sort === '证据置信度最低', sort === '证据置信度最高')}</Button>, width: 330 },
      { key: 'actions', title: '操作', width: 72, fixed: 'right' },
    ]}
    rows={candidates.map(candidate => ({
      key: candidate.id,
      className: selected.has(candidate.id) ? 'selected' : '',
      cells: [
        <Checkbox aria-label={`选择 ${candidate.company}`} checked={selected.has(candidate.id)} onChange={event => toggleOne(candidate, event.target.checked)}/>,
        <Button className="company-profile-link" type="link" onClick={() => onOpen(candidate)}><Avatar>{candidate.company.slice(0, 1)}</Avatar><Space className="company-profile-copy" orientation="vertical" size={0}><Typography.Text strong ellipsis={{tooltip:candidate.company}}>{candidate.company}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:`${candidate.region} · ${candidate.industry}`}}>{candidate.region} · {candidate.industry}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:`${candidate.source} · ${candidate.size}`}}>{candidate.source} · {candidate.size}</Typography.Text></Space></Button>,
        <Space orientation="vertical" size={2}><Flex justify="space-between"><Typography.Text strong>{candidate.score}</Typography.Text><Typography.Text>{candidate.score >= 92 ? '高度匹配' : candidate.score >= 88 ? '值得跟进' : '继续研究'}</Typography.Text></Flex><Progress aria-label={`${candidate.company}匹配度`} percent={candidate.score} showInfo={false}/><Typography.Text type="secondary">证据置信度 {candidate.confidence}%</Typography.Text></Space>,
        <Space orientation="vertical" size={3}><Badge tone={/新建|扩张|招投标/.test(candidate.signal) ? 'green' : 'blue'}>{candidate.signal}</Badge><Typography.Text type="secondary" ellipsis={{tooltip:candidate.source}}>{candidate.source}</Typography.Text></Space>,
        <Space orientation="vertical" size={2}><Typography.Text strong>{candidate.value}</Typography.Text><Typography.Text type="secondary">{candidate.evidence.length} 条有效证据</Typography.Text><Typography.Text type="secondary">发现于 {candidate.updatedAt}</Typography.Text></Space>,
        <Button className="table-summary-link" type="link" aria-label={`查看 AI 决策：${candidate.company}`} onClick={() => onOpen(candidate)}><FileSearch2/><Space className="table-summary-copy" orientation="vertical" size={0}><Typography.Text strong>{candidate.score >= 92 ? '优先跟进' : '查看研究结论'}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:candidate.reason}}>{candidate.reason}</Typography.Text></Space></Button>,
        <Button aria-label={saved.has(candidate.id) ? `${candidate.company} 已保存` : `保存 ${candidate.company} 到客户库`} title={saved.has(candidate.id) ? '已保存到客户库' : '保存到客户库'} disabled={saved.has(candidate.id)} onClick={() => onSave(candidate)}>{saved.has(candidate.id) ? <Check/> : <Bookmark/>}</Button>,
      ],
    }))}
  />
}
