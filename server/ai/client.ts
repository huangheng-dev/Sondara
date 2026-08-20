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
}

export type AiCompletionResult = {
  content: string
  serviceId: string
  serviceName: string
  provider: string
  model: string
  latencyMs: number
}

type CompatibleResponse = {
  error?: { message?: string }
  choices?: { message?: { content?: string } }[]
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

const completionEndpoint = (endpoint: string) => {
  const normalized = endpoint.replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

const callCompatibleApi = async (
  service: typeof aiServices.$inferSelect,
  apiKey: string,
  request: AiCompletionRequest,
) => {
  const started = Date.now()
  const response = await fetch(completionEndpoint(service.endpoint), {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: service.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 900,
      temperature: request.temperature ?? 0.1,
    }),
  })
  const body = await response.json().catch(() => ({})) as CompatibleResponse
  if (!response.ok) throw new Error(redact(body.error?.message || `HTTP ${response.status}`))
  const content = body.choices?.[0]?.message?.content?.trim()
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

export const completeWithAi = async (request: AiCompletionRequest): Promise<AiCompletionResult> => {
  const policy = (await getPolicy(request.workspaceId))
  const serviceConditions = [eq(aiServices.workspaceId, request.workspaceId), eq(aiServices.enabled, true)]
  if (request.serviceId) serviceConditions.push(eq(aiServices.id, request.serviceId))
  const services = await db.select().from(aiServices).where(and(...serviceConditions)).orderBy(asc(aiServices.priority), asc(aiServices.createdAt))
  if (!services.length) throw new AiUnavailableError('NO_CONFIGURATION', '当前工作区没有已启用的 AI 服务。')

  const failures: string[] = []
  let usableKeys = 0
  for (const [serviceIndex, service] of services.entries()) {
    if (serviceIndex > 0 && !policy.failoverEnabled) break
    const now = Date.now()
    const keyQuery = db.select().from(aiServiceKeys).where(and(
      eq(aiServiceKeys.workspaceId, request.workspaceId),
      eq(aiServiceKeys.serviceId, service.id),
      eq(aiServiceKeys.enabled, true),
      or(isNull(aiServiceKeys.cooldownUntil), lte(aiServiceKeys.cooldownUntil, now)),
    ))
    const keys = policy.rotationStrategy === 'failover'
      ? await keyQuery.orderBy(asc(aiServiceKeys.failureCount), asc(aiServiceKeys.createdAt))
      : await keyQuery.orderBy(asc(aiServiceKeys.lastUsedAt), asc(aiServiceKeys.failureCount), asc(aiServiceKeys.createdAt))
    usableKeys += keys.length

    for (const key of keys) {
      let lastMessage = 'AI 服务调用失败'
      for (let attempt = 0; attempt <= policy.retryCount; attempt += 1) {
        try {
          const result = await callCompatibleApi(service, decryptSecret({ ciphertext: key.secretCiphertext, iv: key.secretIv, tag: key.secretTag }), request)
          const completedAt = Date.now()
          await db.transaction(async tx => {
                        await tx.update(aiServiceKeys).set({ failureCount: 0, cooldownUntil: null, lastUsedAt: completedAt, updatedAt: completedAt }).where(eq(aiServiceKeys.id, key.id))
                        await tx.update(aiServices).set({ status: 'available', lastLatencyMs: result.latencyMs, lastError: null, lastTestedAt: completedAt, updatedAt: completedAt }).where(eq(aiServices.id, service.id))
                      })
          return { ...result, serviceId: service.id, serviceName: service.name, provider: service.provider, model: service.model }
        } catch (cause) {
          lastMessage = redact(cause instanceof Error ? cause.message : 'AI 服务调用失败')
          if (attempt < policy.retryCount) {
            const delay = policy.retryBackoff === 'exponential' ? policy.retryDelayMs * 2 ** attempt : policy.retryDelayMs
            await wait(Math.min(delay, 30_000))
          }
        }
      }
      failures.push(`${service.name}: ${lastMessage}`)
      const failedAt = Date.now()
      await db.transaction(async tx => {
                await tx.update(aiServiceKeys).set({ failureCount: key.failureCount + 1, cooldownUntil: failedAt + policy.cooldownMs, lastUsedAt: failedAt, updatedAt: failedAt }).where(eq(aiServiceKeys.id, key.id))
                await tx.update(aiServices).set({ status: 'error', lastLatencyMs: null, lastError: lastMessage, lastTestedAt: failedAt, updatedAt: failedAt }).where(eq(aiServices.id, service.id))
              })
    }
  }

  if (!usableKeys) throw new AiUnavailableError('NO_CONFIGURATION', '已启用的 AI 服务没有当前可用的密钥。')
  throw new AiUnavailableError('ALL_PROVIDERS_FAILED', failures.slice(-3).join('；') || '所有 AI 服务均调用失败。')
}
