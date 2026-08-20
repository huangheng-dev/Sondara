import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UnsafeUrlError extends Error {
  retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'UnsafeUrlError'
    this.retryable = retryable
  }
}

const isPrivateAddress = (address: string) => {
  const normalized = address.toLowerCase()
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true
  if (!isIP(address)) return false
  const parts = address.split('.').map(Number)
  if (parts.length !== 4) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)
}

export const assertSafeOutboundUrl = async (rawUrl: string, options: { allowPrivate?: boolean; label?: string } = {}) => {
  const label = options.label ?? '外部地址'
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new UnsafeUrlError(`${label}无效：${rawUrl}`) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError(`${label}仅支持 HTTP 或 HTTPS：${rawUrl}`)
  if (url.username || url.password) throw new UnsafeUrlError(`${label}不能包含登录凭据：${rawUrl}`)
  if (options.allowPrivate) return url
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new UnsafeUrlError(`${label}不允许访问本机或内网地址：${rawUrl}`)
  const addresses = await lookup(host, { all: true }).catch(() => { throw new UnsafeUrlError(`无法解析${label}域名：${host}`, true) })
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new UnsafeUrlError(`${label}域名解析到内网地址，已阻止访问：${host}`)
  return url
}
