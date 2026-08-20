import { and, asc, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { integrationConnections } from '../db/schema.js'
import { decryptSecret } from '../lib/secret-vault.js'
import { assertSafeOutboundUrl } from '../lib/url-safety.js'

export type LocalPlaceResult = {
  externalId: string
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  categories: string[]
  website: string
  phone: string
  businessStatus: string
  source: string
  sourceUrl: string
}

type MapConnection = typeof integrationConnections.$inferSelect

export class MapUnavailableError extends Error {
  code: 'NO_CONFIGURATION' | 'ALL_PROVIDERS_FAILED'
  constructor(code: 'NO_CONFIGURATION' | 'ALL_PROVIDERS_FAILED', message: string) {
    super(message)
    this.name = 'MapUnavailableError'
    this.code = code
  }
}

const redact = (value: string) => value
  .replace(/(key|token|secret|authorization)[=:\s]+[^\s&]+/gi, '$1=[REDACTED]')
  .slice(0, 500)

const connectionSecret = (connection: MapConnection) => {
  if (!connection.secretCiphertext || !connection.secretIv || !connection.secretTag) return ''
  return decryptSecret({ ciphertext: connection.secretCiphertext, iv: connection.secretIv, tag: connection.secretTag })
}

const readJson = async (response: Response, label: string) => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = body.error as { message?: string } | undefined
    throw new Error(redact(error?.message || `${label}返回 HTTP ${response.status}`))
  }
  return body
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const discoverPlacesWithConnection = async (
  connection: MapConnection,
  query: string,
  region: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
) => {
  const endpoint = await assertSafeOutboundUrl(connection.endpoint, { allowPrivate: config.allowPrivateConnectors, label: '地图服务地址' })
  const secret = connectionSecret(connection)
  if (!secret) throw new Error('地图服务连接缺少访问密钥')
  const resultLimit = Math.min(20, Math.max(1, limit))
  const started = Date.now()
  let items: LocalPlaceResult[] = []

  if (connection.provider === 'google-places') {
    const body = await readJson(await fetchImpl(endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': secret,
        'x-goog-fieldmask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.websiteUri,places.nationalPhoneNumber,places.businessStatus,places.googleMapsUri',
      },
      body: JSON.stringify({ textQuery: [query, region].filter(value => value && value !== '全球').join(' '), pageSize: resultLimit }),
    }), 'Google Places')
    const places = body.places as {
      id?: string
      displayName?: { text?: string }
      formattedAddress?: string
      location?: { latitude?: number; longitude?: number }
      types?: string[]
      websiteUri?: string
      nationalPhoneNumber?: string
      businessStatus?: string
      googleMapsUri?: string
    }[] | undefined
    items = (places ?? []).map(place => ({
      externalId: text(place.id),
      name: text(place.displayName?.text),
      address: text(place.formattedAddress),
      latitude: numberOrNull(place.location?.latitude),
      longitude: numberOrNull(place.location?.longitude),
      categories: (place.types ?? []).map(text).filter(Boolean),
      website: text(place.websiteUri),
      phone: text(place.nationalPhoneNumber),
      businessStatus: text(place.businessStatus),
      source: 'Google Places',
      sourceUrl: text(place.googleMapsUri) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${text(place.displayName?.text)} ${text(place.formattedAddress)}`)}`,
    }))
  } else {
    throw new Error(`不支持的地图服务：${connection.provider}`)
  }

  return { items: items.filter(item => item.name).slice(0, resultLimit), latencyMs: Date.now() - started }
}

export const hasMapConfiguration = async (workspaceId: string) => Boolean((await db.$first(db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(
      eq(integrationConnections.workspaceId, workspaceId),
      eq(integrationConnections.category, 'map'),
      eq(integrationConnections.enabled, true),
    )))))

export const discoverPlacesWorkspace = async (workspaceId: string, query: string, region: string, limit: number) => {
  const connections = (await db.select().from(integrationConnections).where(and(
      eq(integrationConnections.workspaceId, workspaceId),
      eq(integrationConnections.category, 'map'),
      eq(integrationConnections.enabled, true),
    )).orderBy(asc(integrationConnections.priority), asc(integrationConnections.createdAt)))
  if (!connections.length) throw new MapUnavailableError('NO_CONFIGURATION', '当前工作区没有已启用的地图数据源。')
  const failures: string[] = []
  for (const connection of connections) {
    try {
      let configuredLimit = 10
      try {
        const parsed = JSON.parse(connection.configJson) as { resultLimit?: number }
        if (parsed.resultLimit) configuredLimit = parsed.resultLimit
      } catch { /* use default */ }
      const result = await discoverPlacesWithConnection(connection, query, region, Math.min(limit, configuredLimit))
      const now = Date.now()
      await db.update(integrationConnections).set({ status: 'available', lastLatencyMs: result.latencyMs, lastError: null, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id))
      return { ...result, connectionId: connection.id, connectionName: connection.name, provider: connection.provider }
    } catch (cause) {
      const message = redact(cause instanceof Error ? cause.message : '地图服务调用失败')
      failures.push(`${connection.name}: ${message}`)
      const now = Date.now()
      await db.update(integrationConnections).set({ status: 'error', lastLatencyMs: null, lastError: message, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, connection.id))
    }
  }
  throw new MapUnavailableError('ALL_PROVIDERS_FAILED', failures.join('；') || '所有地图数据源均不可用。')
}
