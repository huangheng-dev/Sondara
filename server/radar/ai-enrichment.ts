import { z } from 'zod'
import { completeWithAi } from '../ai/client.js'
import type { DiscoveredCandidate, RadarTaskContext } from './types.js'

const enrichmentSchema = z.object({
  company: z.string().trim().min(1).max(120).optional(),
  industry: z.string().trim().min(1).max(120),
  region: z.string().trim().min(1).max(80).optional().default('待验证'),
  signal: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(1000),
  score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  dimensions: z.array(z.object({ label: z.string().trim().min(1).max(40), score: z.number().int().min(0).max(100) })).min(5).max(8),
})

const parseJson = (content: string) => {
  const normalized = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return enrichmentSchema.parse(JSON.parse(normalized))
}

export const enrichCandidateWithAi = async (task: RadarTaskContext, candidate: DiscoveredCandidate) => {
  const evidence = candidate.evidence.map(item => ({ title: item.title, source: item.source, sourceUrl: item.sourceUrl }))
  const result = await completeWithAi({
    workspaceId: task.workspaceId,
    timeoutMs: 15_000,
    temperature: 0,
    maxTokens: 900,
    messages: [
      {
        role: 'system',
        content: '你是严格的 B2B 客户准入分析器。只能根据输入的公开证据归纳，不得虚构员工、联系人、营收、规模、地点、客户角色或购买计划。必须分别判断产品应用是否匹配、企业是否属于目标客户角色、证据是否充分；只有名称或泛行业相似不能判为匹配。任一核心项缺乏证据时该项不得超过 55 分，明确不匹配时总分不得超过 49。只返回合法 JSON，不要 Markdown。',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: { icp: task.icp, targetRegion: task.targetRegion, depth: task.depth },
          candidate: { company: candidate.company, currentIndustry: candidate.industry, currentReason: candidate.reason },
          evidence,
          requiredJson: {
            company: '只在公开证据能确认正式企业名称时填写；否则沿用输入名称',
            industry: '基于证据可判断的行业，不能判断则写待验证',
            region: '基于官网、域名或公开证据可判断的国家/地区，不能判断则写待验证',
            signal: '一句话公开信号，不能判断则写仅官网可验证',
            reason: '逐项说明产品应用、企业角色与 ICP 的匹配证据；同时列出不匹配或仍需验证的信息',
            score: '0-100 整数，为严格准入总分；任一核心项低于 60 时总分不得超过 59',
            confidence: '0-100 整数，反映证据完整度',
            dimensions: [{ label: '目标客户符合度', score: 0 }, { label: '产品应用匹配度', score: 0 }, { label: '企业角色匹配度', score: 0 }, { label: '证据可信度', score: 0 }, { label: '购买时机', score: 0 }, { label: '资料完整度', score: 0 }],
          },
        }),
      },
    ],
  })
  const enrichment = parseJson(result.content)
  return {
    candidate: {
      ...candidate,
      company: enrichment.company && enrichment.company !== '待验证' ? enrichment.company : candidate.company,
      industry: enrichment.industry,
      region: enrichment.region === '待验证' ? candidate.region : enrichment.region,
      signal: enrichment.signal,
      reason: `${enrichment.reason}；原始公开证据：${candidate.reason}`.slice(0, 1000),
      score: enrichment.score,
      confidence: enrichment.confidence,
      dimensions: enrichment.dimensions,
      source: `${candidate.source} · AI 研究`,
    } satisfies DiscoveredCandidate,
    serviceName: result.serviceName,
    model: result.model,
    latencyMs: result.latencyMs,
  }
}
