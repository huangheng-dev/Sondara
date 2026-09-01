import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCandidateQualification } from '../radar/qualification.js'
import type { DiscoveredCandidate, RadarTaskContext } from '../radar/types.js'

const task: Pick<RadarTaskContext, 'icp' | 'strategy' | 'targetRegion'> = {
  icp: 'Hygienic and aseptic process equipment distributors, EPC contractors and system integrators for pharmaceutical and food plants',
  strategy: '寻找渠道商与工程项目客户',
  targetRegion: '德国（Germany）',
}

const candidate = (input: Partial<DiscoveredCandidate> = {}): DiscoveredCandidate => ({
  company: 'Verified Process GmbH', region: '德国（Germany）',
  industry: 'Hygienic process equipment distributor and system integrator', size: '51-200', score: 92,
  signal: 'Official pharmaceutical process project', source: '企业官网 · AI 研究', estimatedValue: 0,
  currency: 'EUR', confidence: 88,
  reason: 'Official pages describe hygienic and aseptic equipment integration for pharmaceutical and food plants.',
  dimensions: [
    { label: '独立证据匹配度', score: 90 },
    { label: '目标客户符合度', score: 90 }, { label: '产品应用匹配度', score: 92 },
    { label: '企业角色匹配度', score: 86 }, { label: '证据可信度', score: 88 },
    { label: '购买时机', score: 65 }, { label: '资料完整度', score: 82 },
  ],
  evidence: [
    { title: 'Hygienic process solutions', source: 'verified-process.de', time: '2026-08-30', strength: '强', sourceUrl: 'https://verified-process.de/solutions' },
    { title: 'Pharmaceutical projects', source: 'verified-process.de', time: '2026-08-30', strength: '中', sourceUrl: 'https://verified-process.de/projects' },
  ],
  committee: [], relationships: [{ label: '企业官网', value: 'https://verified-process.de/' }],
  ...input,
})

test('产品应用、客户角色和公开证据均匹配时允许准入', () => {
  const result = assessCandidateQualification(task, candidate())
  assert.equal(result.allowed, true, result.reason)
  assert.ok(result.metrics.qualificationScore >= 70)
  assert.ok(result.candidate.dimensions.some(item => item.label === '准入综合分'))
})

test('连接器原始分很高也不能让无关企业准入', () => {
  const result = assessCandidateQualification(task, candidate({
    company: 'Talent Cloud GmbH', industry: 'Recruitment software and staffing agency', score: 98, confidence: 95,
    signal: 'Official website available', source: '搜索发现',
    reason: 'Recruitment platform for job seekers and human resources teams.',
    dimensions: [],
    evidence: [{ title: 'Recruitment software platform', source: 'talent.example', time: '2026-08-30', strength: '强', sourceUrl: 'https://talent.example/' }],
    relationships: [{ label: '企业官网', value: 'https://talent.example/' }],
  }))
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'application_mismatch')
})

test('只有一条弱证据时不能准入', () => {
  const result = assessCandidateQualification(task, candidate({
    evidence: [{ title: 'Search result', source: 'search', time: '2026-08-30', strength: '弱', sourceUrl: 'https://search.example/result' }],
    relationships: [],
  }))
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'insufficient_evidence')
})

test('产品相关但企业角色不符合时不能准入', () => {
  const distributorTask = { ...task, icp: 'Hygienic valve distributors and resellers for pharmaceutical plants' }
  const result = assessCandidateQualification(distributorTask, candidate({
    industry: 'Hygienic valve manufacturer',
    reason: 'Manufactures hygienic valves for pharmaceutical plants; no distribution, reseller or buyer activity is stated.',
    dimensions: [
      { label: '独立证据匹配度', score: 88 },
      { label: '目标客户符合度', score: 75 }, { label: '产品应用匹配度', score: 90 },
      { label: '企业角色匹配度', score: 42 }, { label: '证据可信度', score: 88 }, { label: '资料完整度', score: 80 },
    ],
  }))
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'role_mismatch')
})

test('AI 高分不能覆盖公开结论中的明确不匹配', () => {
  const result = assessCandidateQualification(task, candidate({
    score: 99, confidence: 99,
    reason: 'The company is unrelated and not a match for the requested pharmaceutical process equipment ICP.',
  }))
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'entity_mismatch')
})
