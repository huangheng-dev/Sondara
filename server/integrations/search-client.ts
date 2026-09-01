import { and, asc, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { integrationConnections } from '../db/schema.js'
import { decryptSecret } from '../lib/secret-vault.js'
import { assertSafeOutboundUrl } from '../lib/url-safety.js'

export type SearchResult = { title: string; url: string; description: string; source: string }
export type SearchOptions = { market?: string; countryCode?: string; language?: string }
type SearchConnection = typeof integrationConnections.$inferSelect

class SearchUnavailableError extends Error {
  code: 'NO_CONFIGURATION' | 'ALL_PROVIDERS_FAILED'
  constructor(code: 'NO_CONFIGURATION' | 'ALL_PROVIDERS_FAILED', message: string) {
    super(message)
    this.name = 'SearchUnavailableError'
    this.code = code
  }
}

const redact = (value: string) => value
  .replace(/\b(?:BSA|sk|tvly)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
  .replace(/([?&](?:api_key|apikey|key)=)[^&\s"']+/gi, '$1[REDACTED]')
  .replace(/("(?:api_key|apikey|key)"\s*:\s*")[^"]+/gi, '$1[REDACTED]')
  .slice(0, 500)

const connectionSecret = (connection: SearchConnection) => {
  if (!connection.secretCiphertext || !connection.secretIv || !connection.secretTag) return ''
  return decryptSecret({ ciphertext: connection.secretCiphertext, iv: connection.secretIv, tag: connection.secretTag })
}

const readJson = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = body.error as { message?: string } | undefined
    throw new Error(redact(error?.message || `搜索服务返回 HTTP ${response.status}`))
  }
  return body
}

export const searchWithConnection = async (connection: SearchConnection, query: string, limit: number, fetchImpl: typeof fetch = fetch, options: SearchOptions = {}) => {
  const endpoint = await assertSafeOutboundUrl(connection.endpoint, { allowPrivate: config.allowPrivateConnectors, label: '搜索服务地址' })
  const started = Date.now()
  let results: SearchResult[] = []
  if (connection.provider === 'brave') {
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('count', String(Math.min(20, Math.max(1, limit))))
    endpoint.searchParams.set('safesearch', 'moderate')
    endpoint.searchParams.set('extra_snippets', 'true')
    if (options.countryCode) endpoint.searchParams.set('country', options.countryCode.toLowerCase())
    if (options.language) endpoint.searchParams.set('search_lang', options.language)
    const secret = connectionSecret(connection)
    if (!secret) throw new Error('Brave Search 连接缺少访问密钥')
    const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json', 'x-subscription-token': secret } }))
    const web = body.web as { results?: { title?: string; url?: string; description?: string }[] } | undefined
    results = (web?.results ?? []).map(item => ({ title: item.title?.trim() ?? '', url: item.url?.trim() ?? '', description: item.description?.trim() ?? '', source: 'Brave Search' }))
  } else if (connection.provider === 'tavily') {
    const secret = connectionSecret(connection)
    if (!secret) throw new Error('Tavily 连接缺少访问密钥')
    const body = await readJson(await fetchImpl(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: secret,
        query,
        max_results: Math.min(20, Math.max(1, limit)),
        search_depth: 'basic',
        topic: 'general',
        include_answer: false,
      }),
    }))
    const items = body.results as { title?: string; url?: string; content?: string }[] | undefined
    results = (items ?? []).map(item => ({ title: item.title?.trim() ?? '', url: item.url?.trim() ?? '', description: item.content?.trim() ?? '', source: 'Tavily Search' }))
  } else if (connection.provider === 'google') {
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('num', String(Math.min(10, Math.max(1, limit))))
    if (options.countryCode) endpoint.searchParams.set('gl', options.countryCode.toLowerCase())
    if (options.language) endpoint.searchParams.set('hl', options.language)
    const secret = connectionSecret(connection)
    if (!secret) throw new Error('Google Custom Search 连接缺少访问密钥')
    endpoint.searchParams.set('key', secret)
    const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } }))
    const items = body.items as { title?: string; link?: string; snippet?: string }[] | undefined
    results = (items ?? []).map(item => ({ title: item.title?.trim() ?? '', url: item.link?.trim() ?? '', description: item.snippet?.trim() ?? '', source: 'Google Custom Search' }))
  } else if (connection.provider === 'bing') {
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('count', String(Math.min(20, Math.max(1, limit))))
    endpoint.searchParams.set('mkt', options.market || 'zh-CN')
    endpoint.searchParams.set('safeSearch', 'Moderate')
    const secret = connectionSecret(connection)
    if (!secret) throw new Error('Bing Web Search 连接缺少访问密钥')
    const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json', 'Ocp-Apim-Subscription-Key': secret } }))
    const items = (body as { webPages?: { value?: { name?: string; url?: string; snippet?: string }[] } }).webPages?.value as { name?: string; url?: string; snippet?: string }[] | undefined
    results = (items ?? []).map(item => ({ title: item.name?.trim() ?? '', url: item.url?.trim() ?? '', description: item.snippet?.trim() ?? '', source: 'Bing Web Search' }))
  } else if (connection.provider === 'serpapi') {
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('engine', 'google')
    endpoint.searchParams.set('num', String(Math.min(20, Math.max(1, limit))))
    if (options.countryCode) endpoint.searchParams.set('gl', options.countryCode.toLowerCase())
    if (options.language) endpoint.searchParams.set('hl', options.language)
    const secret = connectionSecret(connection)
    if (!secret) throw new Error('SerpAPI 连接缺少访问密钥')
    endpoint.searchParams.set('api_key', secret)
    const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } }))
    const items = body.organic_results as { title?: string; link?: string; snippet?: string }[] | undefined
    results = (items ?? []).map(item => ({ title: item.title?.trim() ?? '', url: item.link?.trim() ?? '', description: item.snippet?.trim() ?? '', source: 'SerpAPI · Google' }))
  } else if (connection.provider === 'searxng') {
    if (!endpoint.pathname.endsWith('/search')) endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/search`
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('format', 'json')
    endpoint.searchParams.set('safesearch', '1')
    const secret = connectionSecret(connection)
    const headers: Record<string, string> = { accept: 'application/json' }
    if (secret) headers.authorization = `Bearer ${secret}`
    const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(20_000), headers }))
    const items = body.results as { title?: string; url?: string; content?: string; engine?: string }[] | undefined
    results = (items ?? []).map(item => ({ title: item.title?.trim() ?? '', url: item.url?.trim() ?? '', description: item.content?.trim() ?? '', source: item.engine ? `SearXNG · ${item.engine}` : 'SearXNG' }))
  } else {
    throw new Error(`不支持的搜索服务：${connection.provider}`)
  }
  const normalized = results.filter(item => {
    try { const url = new URL(item.url); return Boolean(item.title && ['http:', 'https:'].includes(url.protocol)) } catch { return false }
  }).slice(0, limit)
  return { items: normalized, latencyMs: Date.now() - started }
}

export const hasSearchConfiguration = async (workspaceId: string) => Boolean((await db.$first(db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.category, 'search'), eq(integrationConnections.enabled, true))))))

export const searchWorkspace = async (workspaceId: string, query: string, limit: number, options: SearchOptions = {}) => {
  const connections = (await db.select().from(integrationConnections).where(and(eq(integrationConnections.workspaceId, workspaceId), eq(integrationConnections.category, 'search'), eq(integrationConnections.enabled, true))).orderBy(asc(integrationConnections.priority), asc(integrationConnections.createdAt)))
  if (!connections.length) throw new SearchUnavailableError('NO_CONFIGURATION', '当前工作区没有已启用的搜索数据源。')
  const failures: string[] = []
  for (const connection of connections) {
    try {
      let configuredLimit = 10
      try { const parsed = JSON.parse(connection.configJson) as { resultLimit?: number }; if (parsed.resultLimit) configuredLimit = parsed.resultLimit } catch { /* use default */ }
      const result = await searchWithConnection(connection, query, Math.min(limit, configuredLimit), fetch, options)
      const now = Date.now()
      await db.update(integrationConnections).set({ status: 'available', lastLatencyMs: result.latencyMs, lastError: null, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id))
      return { ...result, connectionId: connection.id, connectionName: connection.name, provider: connection.provider }
    } catch (cause) {
      const message = redact(cause instanceof Error ? cause.message : '搜索服务调用失败')
      failures.push(`${connection.name}: ${message}`)
      const now = Date.now()
      await db.update(integrationConnections).set({ status: 'error', lastLatencyMs: null, lastError: message, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id))
    }
  }
  throw new SearchUnavailableError('ALL_PROVIDERS_FAILED', failures.join('；') || '所有搜索数据源均不可用。')
}
