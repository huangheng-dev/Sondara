import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import { aiServiceKeys, aiServices, workspaceAiPolicies } from '../db/schema.js'
import { decryptSecret } from '../lib/secret-vault.js'

type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type AiCompletionRequest = {
  workspaceId: string
  messages: AiMessage[]
  maxTokens?: number
  temperature?: number
  serviceId?: string
  timeoutMs?: number
}

export type AiCompletionResult = {
  content: string
  serviceId: string
  serviceName: string
  provider: string
  model: string
  latencyMs: number
}

type OpenAiChatResponse = {
  error?: { message?: string }
  choices?: { message?: { content?: string | Array<{ type?: string; text?: string }> } }[]
}

type OpenAiResponsesResponse = {
  error?: { message?: string }
  output_text?: string
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
}

type AnthropicMessagesResponse = {
  error?: { message?: string }
  content?: Array<{ type?: string; text?: string }>
}

const redact = (value: string) => value
  .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
  .slice(0, 500)

export class AiUnavailableError extends Error {
  code: 'NO_CONFIGURATION' | 'ALL_PROVIDERS_FAILED'
  constructor(code: 'NO_CONFIGURATION' | 'ALL_PROVIDERS_FAILED', message: string) {
    super(message)
    this.name = 'AiUnavailableError'
    this.code = code
  }
}

const appendEndpointPath = (endpoint: string, path: string) => {
  const normalized = endpoint.replace(/\/+$/, '')
  return normalized.endsWith(path) ? normalized : `${normalized}${path}`
}

const readChatContent = (body: OpenAiChatResponse) => {
  const content = body.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  return content?.filter(part => part.type === 'text' && part.text).map(part => part.text).join('\n').trim() ?? ''
}

const readResponsesContent = (body: OpenAiResponsesResponse) => body.output_text?.trim()
  || body.output?.flatMap(item => item.content ?? []).filter(part => part.type === 'output_text' && part.text).map(part => part.text).join('\n').trim()
  || ''

const readAnthropicContent = (body: AnthropicMessagesResponse) => body.content
  ?.filter(part => part.type === 'text' && part.text)
  .map(part => part.text)
  .join('\n')
  .trim() ?? ''

const callAiApi = async (
  service: typeof aiServices.$inferSelect,
  apiKey: string,
  request: AiCompletionRequest,
  timeoutMs: number,
) => {
  const started = Date.now()
  const protocol = service.protocol || 'openai-chat-completions'
  const isResponses = protocol === 'openai-responses'
  const isAnthropic = protocol === 'anthropic-messages'
  const endpoint = isResponses
    ? appendEndpointPath(service.endpoint, '/responses')
    : isAnthropic
      ? appendEndpointPath(service.endpoint, '/messages')
      : appendEndpointPath(service.endpoint, '/chat/completions')
  const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const body = isResponses
    ? {
        model: service.model,
        input: request.messages,
        max_output_tokens: request.maxTokens ?? 900,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }
    : isAnthropic
      ? {
          model: service.model,
          max_tokens: request.maxTokens ?? 900,
          ...(system ? { system } : {}),
          messages: request.messages.filter(message => message.role !== 'system'),
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        }
      : {
          model: service.model,
          messages: request.messages,
          max_tokens: request.maxTokens ?? 900,
          temperature: request.temperature ?? 0.1,
        }
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: isAnthropic
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const responseBody = await response.json().catch(() => ({})) as OpenAiChatResponse & OpenAiResponsesResponse & AnthropicMessagesResponse
  if (!response.ok) throw new Error(redact(responseBody.error?.message || `HTTP ${response.status}`))
  const content = isResponses
    ? readResponsesContent(responseBody)
    : isAnthropic
      ? readAnthropicContent(responseBody)
      : readChatContent(responseBody)
  if (!content) throw new Error('服务响应缺少消息内容')
  return { content, latencyMs: Date.now() - started }
}

const defaultPolicy = {
  rotationStrategy: 'failover',
  retryCount: 2,
  retryBackoff: 'exponential',
  retryDelayMs: 1000,
  cooldownMs: 300_000,
  failoverEnabled: true,
} as const

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

const getPolicy = async (workspaceId: string) => await db.$first(db.select().from(workspaceAiPolicies)
  .where(eq(workspaceAiPolicies.workspaceId, workspaceId))) ?? { workspaceId, ...defaultPolicy, updatedAt: 0 }

export const hasAiConfiguration = async (workspaceId: string) => {
  const now = Date.now()
  return Boolean(await db.$first(db.select({ id: aiServiceKeys.id }).from(aiServiceKeys)
          .innerJoin(aiServices, eq(aiServices.id, aiServiceKeys.serviceId))
          .where(and(
            eq(aiServices.workspaceId, workspaceId),
            eq(aiServices.enabled, true),
            eq(aiServiceKeys.enabled, true),
            or(isNull(aiServiceKeys.cooldownUntil), lte(aiServiceKeys.cooldownUntil, now)),
          ))))
}

export type AiReadiness = {
  configured: boolean
  ready: boolean
  serviceCount: number
  healthyServiceCount: number
  message: string
}

export const getAiReadiness = async (workspaceId: string): Promise<AiReadiness> => {
  const now = Date.now()
  const rows = await db.select({
    serviceId: aiServices.id,
    serviceName: aiServices.name,
    status: aiServices.status,
    keyId: aiServiceKeys.id,
    cooldownUntil: aiServiceKeys.cooldownUntil,
  }).from(aiServices)
    .leftJoin(aiServiceKeys, and(
      eq(aiServiceKeys.serviceId, aiServices.id),
      eq(aiServiceKeys.workspaceId, workspaceId),
      eq(aiServiceKeys.enabled, true),
    ))
    .where(and(eq(aiServices.workspaceId, workspaceId), eq(aiServices.enabled, true)))

  const services = new Map<string, { name: string; status: string; usableKey: boolean }>()
  for (const row of rows) {
    const current = services.get(row.serviceId) ?? { name: row.serviceName, status: row.status, usableKey: false }
    current.usableKey ||= Boolean(row.keyId && (!row.cooldownUntil || row.cooldownUntil <= now))
    services.set(row.serviceId, current)
  }
  const configured = [...services.values()].filter(service => service.usableKey)
  const healthy = configured.filter(service => ['available', 'degraded'].includes(service.status))
  if (!configured.length) return { configured: false, ready: false, serviceCount: services.size, healthyServiceCount: 0, message: '没有已启用且可用的 AI 密钥。' }
  if (!healthy.length) return { configured: true, ready: false, serviceCount: configured.length, healthyServiceCount: 0, message: 'AI 已配置，但健康检查未通过；自动计划会等待服务恢复。' }
  return { configured: true, ready: true, serviceCount: configured.length, healthyServiceCount: healthy.length, message: `${healthy.length} 个 AI 服务可用于自动研究。` }
}

export const completeWithAi = async (request: AiCompletionRequest): Promise<AiCompletionResult> => {
  const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 30_000, 5_000), 120_000)
  const deadlineAt = Date.now() + timeoutMs
  const policy = (await getPolicy(request.workspaceId))
  const serviceConditions = [eq(aiServices.workspaceId, request.workspaceId), eq(aiServices.enabled, true)]
  if (request.serviceId) serviceConditions.push(eq(aiServices.id, request.serviceId))
  const services = await db.select().from(aiServices).where(and(...serviceConditions)).orderBy(asc(aiServices.priority), asc(aiServices.createdAt))
  if (!services.length) throw new AiUnavailableError('NO_CONFIGURATION', '当前工作区没有已启用的 AI 模型连接。')

  const now = Date.now()
  const candidates: Array<{ service: typeof aiServices.$inferSelect; key: typeof aiServiceKeys.$inferSelect }> = []
  for (const service of services) {
    const key = await db.$first(db.select().from(aiServiceKeys).where(and(
      eq(aiServiceKeys.workspaceId, request.workspaceId),
      eq(aiServiceKeys.serviceId, service.id),
      eq(aiServiceKeys.enabled, true),
      or(isNull(aiServiceKeys.cooldownUntil), lte(aiServiceKeys.cooldownUntil, now)),
    )).orderBy(asc(aiServiceKeys.createdAt)))
    if (key) candidates.push({ service, key })
  }
  if (policy.rotationStrategy === 'round-robin') {
    candidates.sort((a, b) => (a.key.lastUsedAt ?? 0) - (b.key.lastUsedAt ?? 0) || a.service.priority - b.service.priority)
  } else if (policy.rotationStrategy === 'least-used') {
    candidates.sort((a, b) => a.key.failureCount - b.key.failureCount || (a.key.lastUsedAt ?? 0) - (b.key.lastUsedAt ?? 0) || a.service.priority - b.service.priority)
  }

  const failures: string[] = []
  serviceLoop: for (const [serviceIndex, { service, key }] of candidates.entries()) {
    if (serviceIndex > 0 && !policy.failoverEnabled) break
    let lastMessage = 'AI 模型连接调用失败'
    let attempted = false
    for (let attempt = 0; attempt <= policy.retryCount; attempt += 1) {
      const remainingMs = deadlineAt - Date.now()
      if (remainingMs <= 0) break
      attempted = true
      try {
        const result = await callAiApi(service, decryptSecret({ ciphertext: key.secretCiphertext, iv: key.secretIv, tag: key.secretTag }), request, Math.min(20_000, remainingMs))
        const completedAt = Date.now()
        await db.transaction(async tx => {
          await tx.update(aiServiceKeys).set({ failureCount: 0, cooldownUntil: null, lastUsedAt: completedAt, updatedAt: completedAt }).where(eq(aiServiceKeys.id, key.id))
          await tx.update(aiServices).set({ status: result.latencyMs > 10_000 ? 'degraded' : 'available', lastLatencyMs: result.latencyMs, lastError: null, lastTestedAt: completedAt, updatedAt: completedAt }).where(eq(aiServices.id, service.id))
        })
        return { ...result, serviceId: service.id, serviceName: service.name, provider: service.provider, model: service.model }
      } catch (cause) {
        lastMessage = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')
          ? 'AI 服务响应超时'
          : redact(cause instanceof Error ? cause.message : 'AI 模型连接调用失败')
        if (attempt < policy.retryCount) {
          const delay = policy.retryBackoff === 'exponential' ? policy.retryDelayMs * 2 ** attempt : policy.retryDelayMs
          const remainingForDelay = deadlineAt - Date.now()
          if (remainingForDelay <= 0) break
          await wait(Math.min(delay, 30_000, remainingForDelay))
        }
      }
    }
    if (!attempted) break serviceLoop
    failures.push(`${service.name}: ${lastMessage}`)
    const failedAt = Date.now()
    await db.transaction(async tx => {
      await tx.update(aiServiceKeys).set({ failureCount: key.failureCount + 1, cooldownUntil: failedAt + policy.cooldownMs, lastUsedAt: failedAt, updatedAt: failedAt }).where(eq(aiServiceKeys.id, key.id))
      await tx.update(aiServices).set({ status: 'error', lastLatencyMs: null, lastError: lastMessage, lastTestedAt: failedAt, updatedAt: failedAt }).where(eq(aiServices.id, service.id))
    })
  }

  if (!candidates.length) throw new AiUnavailableError('NO_CONFIGURATION', '已启用的 AI 模型连接没有当前可用的密钥。')
  if (Date.now() >= deadlineAt) failures.push(`AI 请求超过 ${Math.round(timeoutMs / 1000)} 秒时间预算`)
  throw new AiUnavailableError('ALL_PROVIDERS_FAILED', failures.slice(-3).join('；') || '所有 AI 服务均调用失败。')
}
