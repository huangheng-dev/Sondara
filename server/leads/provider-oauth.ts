import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { leadSourceConnections } from '../db/schema.js'
import { decryptSecret, encryptSecret } from '../lib/secret-vault.js'

type Connection = typeof leadSourceConnections.$inferSelect
type Fetcher = typeof fetch

const decryptOptional = (ciphertext: string | null, iv: string | null, tag: string | null) => ciphertext && iv && tag
  ? decryptSecret({ ciphertext, iv, tag })
  : ''

export const hashOauthState = (state: string) => createHash('sha256').update(state).digest('hex')

export const oauthRedirectUri = (provider: string) =>
  `${config.webOrigin.replace(/\/$/, '')}/api/lead-sources/oauth/${encodeURIComponent(provider)}/callback`

export const buildLeadSourceAuthorizationUrl = ({
  connection,
  state,
  redirectUri = oauthRedirectUri(connection.provider),
}: {
  connection: Connection
  state: string
  redirectUri?: string
}) => {
  if (!connection.clientId) throw new Error('连接缺少 Client / App ID。')
  if (connection.provider === 'linkedin-lead-gen') {
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', connection.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('scope', 'r_marketing_leadgen_automation')
    return url.toString()
  }
  if (connection.provider === 'meta-lead-ads') {
    const url = new URL(`https://www.facebook.com/${config.metaGraphApiVersion}/dialog/oauth`)
    url.searchParams.set('client_id', connection.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('scope', 'leads_retrieval,pages_show_list,pages_manage_metadata')
    return url.toString()
  }
  throw new Error('当前线索来源不支持 OAuth 授权。')
}

type TokenPayload = {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope?: string
  error?: string | { message?: string }
  error_description?: string
}

const tokenError = (payload: TokenPayload, fallback: string) =>
  payload.error_description
  || (typeof payload.error === 'object' ? payload.error.message : payload.error)
  || fallback

const requestToken = async (url: string, init: RequestInit, fetcher: Fetcher) => {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) })
  const payload = await response.json().catch(() => ({})) as TokenPayload
  if (!response.ok || !payload.access_token) throw new Error(tokenError(payload, `OAuth Token 请求失败（HTTP ${response.status}）。`))
  return payload
}

const persistToken = async (connection: Connection, payload: TokenPayload, now = Date.now()) => {
  const accessToken = payload.access_token!
  const access = encryptSecret(accessToken)
  const refresh = payload.refresh_token ? encryptSecret(payload.refresh_token) : null
  await db.update(leadSourceConnections).set({
    accessTokenCiphertext: access.ciphertext,
    accessTokenIv: access.iv,
    accessTokenTag: access.tag,
    accessTokenEnding: accessToken.slice(-4).toUpperCase(),
    accessTokenExpiresAt: payload.expires_in ? now + payload.expires_in * 1000 : null,
    ...(refresh ? {
      refreshTokenCiphertext: refresh.ciphertext,
      refreshTokenIv: refresh.iv,
      refreshTokenTag: refresh.tag,
      refreshTokenEnding: payload.refresh_token!.slice(-4).toUpperCase(),
      refreshTokenExpiresAt: payload.refresh_token_expires_in ? now + payload.refresh_token_expires_in * 1000 : null,
    } : {}),
    oauthScopes: payload.scope ?? connection.oauthScopes,
    status: 'ready',
    lastError: null,
    updatedAt: now,
  }).where(eq(leadSourceConnections.id, connection.id))
  return accessToken
}

export const exchangeLeadSourceAuthorizationCode = async ({
  connection,
  code,
  redirectUri,
  fetcher = fetch,
}: {
  connection: Connection
  code: string
  redirectUri: string
  fetcher?: Fetcher
}) => {
  if (!connection.clientId) throw new Error('连接缺少 Client / App ID。')
  const clientSecret = decryptOptional(connection.verificationSecretCiphertext, connection.verificationSecretIv, connection.verificationSecretTag)
  if (!clientSecret) throw new Error('连接缺少 Client / App Secret。')

  if (connection.provider === 'linkedin-lead-gen') {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: connection.clientId, client_secret: clientSecret, redirect_uri: redirectUri })
    const payload = await requestToken('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, fetcher)
    return persistToken(connection, payload)
  }
  if (connection.provider === 'meta-lead-ads') {
    const url = new URL(`https://graph.facebook.com/${config.metaGraphApiVersion}/oauth/access_token`)
    url.searchParams.set('client_id', connection.clientId)
    url.searchParams.set('client_secret', clientSecret)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('code', code)
    const shortLived = await requestToken(url.toString(), { method: 'GET' }, fetcher)
    const exchange = new URL(`https://graph.facebook.com/${config.metaGraphApiVersion}/oauth/access_token`)
    exchange.searchParams.set('grant_type', 'fb_exchange_token')
    exchange.searchParams.set('client_id', connection.clientId)
    exchange.searchParams.set('client_secret', clientSecret)
    exchange.searchParams.set('fb_exchange_token', shortLived.access_token!)
    const longLived = await requestToken(exchange.toString(), { method: 'GET' }, fetcher).catch(() => shortLived)
    return persistToken(connection, longLived)
  }
  throw new Error('当前线索来源不支持 OAuth 授权。')
}

export const resolveLeadSourceAccessToken = async (connection: Connection, fetcher: Fetcher = fetch) => {
  const accessToken = decryptOptional(connection.accessTokenCiphertext, connection.accessTokenIv, connection.accessTokenTag)
  const now = Date.now()
  if (accessToken && (!connection.accessTokenExpiresAt || connection.accessTokenExpiresAt > now + 5 * 60_000)) return accessToken

  const refreshToken = decryptOptional(connection.refreshTokenCiphertext, connection.refreshTokenIv, connection.refreshTokenTag)
  if (connection.provider === 'linkedin-lead-gen' && refreshToken && (!connection.refreshTokenExpiresAt || connection.refreshTokenExpiresAt > now)) {
    if (!connection.clientId) throw new Error('LinkedIn 连接缺少 Client ID。')
    const clientSecret = decryptOptional(connection.verificationSecretCiphertext, connection.verificationSecretIv, connection.verificationSecretTag)
    if (!clientSecret) throw new Error('LinkedIn 连接缺少 Client Secret。')
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: connection.clientId, client_secret: clientSecret })
    const payload = await requestToken('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, fetcher)
    return persistToken(connection, { ...payload, refresh_token: payload.refresh_token ?? refreshToken })
  }
  if (accessToken && !connection.accessTokenExpiresAt) return accessToken
  await db.update(leadSourceConnections).set({ status: 'authorization_expired', lastError: '平台授权已过期，请重新授权。', updatedAt: now }).where(eq(leadSourceConnections.id, connection.id))
  throw new Error('平台授权已过期，请重新授权。')
}
