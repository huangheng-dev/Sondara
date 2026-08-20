import { resolveMx } from 'node:dns/promises'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { candidateContacts, candidateEvidence, radarCandidates } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { fetchPublicPage } from './connectors/website-seed.js'

export type PublicContact = {
  name: string
  role: string
  email: string | null
  phone: string | null
  socialUrl: string | null
  sourceUrl: string
  verificationStatus: 'verified' | 'public' | 'needs_review'
  confidence: number
}

const cleanText = (value: string) => value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
const normalizeEmail = (value: string) => value.trim().replace(/^mailto:/i, '').split('?')[0].toLowerCase()
const normalizePhone = (value: string) => value.trim().replace(/^tel:/i, '').replace(/\s+/g, ' ').replace(/[()]/g, '')
const assetEmailPattern = /\.(?:png|jpe?g|gif|svg|webp|css|js|ico|bmp|tiff?)$/i
const emailValid = (email: string) => /^[a-z0-9.!#$%&'*+=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email) && !/[/\s]/.test(email) && !assetEmailPattern.test(email)
const phoneValid = (phone: string) => { const digits = phone.replace(/\D/g, ''); return digits.length >= 7 && digits.length <= 18 }
const baseDomain = (host: string) => host.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.')
const roleFromAddress = (email: string | null) => {
  const local = email?.split('@')[0] ?? ''
  if (/purchas|procure|buy|sourc|采购|供应/.test(local)) return '采购与供应链'
  if (/sales|business|bd|market|商务|销售/.test(local)) return '商务与销售'
  if (/tech|engineer|support|技术|工程/.test(local)) return '技术与工程'
  if (/hr|career|job|人事|招聘/.test(local)) return '人力与招聘'
  if (/info|contact|office|admin|service|hello/.test(local)) return '企业公共联系人'
  return '企业公开联系方式'
}
const displayName = (email: string | null, phone: string | null, socialUrl: string | null) => {
  if (email) { const local = email.split('@')[0]; if (!/^(info|contact|office|admin|sales|business|support|service|hello|hr|career|jobs?)$/i.test(local)) return local.split(/[._-]+/).filter(Boolean).map(part => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ') }
  if (phone) return '公开电话'
  if (socialUrl) return '公开社交主页'
  return '公开联系人'
}

const mxCache = new Map<string, boolean>()
const hasMailExchange = async (domain: string) => {
  if (mxCache.has(domain)) return mxCache.get(domain)!
  const result = await Promise.race([
    resolveMx(domain).then(records => records.length > 0).catch(() => false),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1800)),
  ])
  mxCache.set(domain, result)
  return result
}

const contactLinks = (html: string, pageUrl: URL) => {
  const results: string[] = []
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(linkPattern)) {
    const label = cleanText(match[2] ?? '')
    const href = match[1] ?? ''
    if (!/(contact|about|team|people|impressum|kontakt|联系我们|关于我们|团队)/i.test(`${label} ${href}`)) continue
    try {
      const url = new URL(href, pageUrl)
      if (url.hostname !== pageUrl.hostname || !['http:', 'https:'].includes(url.protocol)) continue
      url.hash = ''
      results.push(url.toString())
    } catch { /* ignore malformed links */ }
  }
  return [...new Set(results)].slice(0, 3)
}

const contactsFromPage = async (html: string, pageUrl: URL): Promise<PublicContact[]> => {
  const decoded = html.replace(/&#64;|&commat;/gi, '@').replace(/&#46;|&period;/gi, '.')
  const text = cleanText(decoded)
  const emailValues = new Set<string>()
  const phoneValues = new Set<string>()
  const socialValues = new Set<string>()
  for (const match of decoded.matchAll(/(?:mailto:)?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const email = normalizeEmail(match[1])
    if (emailValid(email) && !/example\.(com|org|net)$|domain\.com$|email\.com$/i.test(email)) emailValues.add(email)
  }
  for (const match of decoded.matchAll(/href=["']tel:([^"']+)["']/gi)) { const phone = normalizePhone(match[1]); if (phoneValid(phone)) phoneValues.add(phone) }
  if (!phoneValues.size) for (const match of text.matchAll(/(?:\+?\d[\d\s().-]{5,}\d)/g)) { const phone = normalizePhone(match[0]); if (phoneValid(phone)) phoneValues.add(phone) }
  for (const match of decoded.matchAll(/https?:\/\/(?:www\.)?(?:linkedin\.com\/(?:company|in)\/[^\s"'<>]+|x\.com\/[^\s"'<>]+|facebook\.com\/[^\s"'<>]+)/gi)) socialValues.add(match[0].replace(/[),.;]+$/, ''))

  const contacts: PublicContact[] = []
  for (const email of [...emailValues].slice(0, 8)) {
    const domain = email.split('@')[1]
    const sameDomain = baseDomain(domain) === baseDomain(pageUrl.hostname)
    const mx = await hasMailExchange(domain)
    contacts.push({ name: displayName(email, null, null), role: roleFromAddress(email), email, phone: null, socialUrl: null, sourceUrl: pageUrl.toString(), verificationStatus: mx ? 'verified' : 'public', confidence: Math.min(96, 62 + (sameDomain ? 18 : 0) + (mx ? 14 : 0)) })
  }
  for (const phone of [...phoneValues].slice(0, 5)) contacts.push({ name: displayName(null, phone, null), role: '企业公开电话', email: null, phone, socialUrl: null, sourceUrl: pageUrl.toString(), verificationStatus: 'public', confidence: 72 })
  for (const socialUrl of [...socialValues].slice(0, 5)) contacts.push({ name: displayName(null, null, socialUrl), role: /linkedin\.com\/in\//i.test(socialUrl) ? '公开人员主页' : '企业社交主页', email: null, phone: null, socialUrl, sourceUrl: pageUrl.toString(), verificationStatus: 'public', confidence: 68 })
  return contacts
}

export const discoverPublicContacts = async (sourceUrls: string[]) => {
  const pages: { url: URL; html: string }[] = []
  const errors: string[] = []
  for (const rawUrl of [...new Set(sourceUrls)].slice(0, 3)) {
    try {
      const home = await fetchPublicPage(rawUrl)
      pages.push(home)
      for (const link of contactLinks(home.html, home.url)) {
        try { pages.push(await fetchPublicPage(link)) } catch { /* a missing contact subpage must not discard the homepage */ }
      }
    } catch (cause) { errors.push(cause instanceof Error ? cause.message : `无法访问 ${rawUrl}`) }
  }
  const contacts = (await Promise.all(pages.slice(0, 6).map(page => contactsFromPage(page.html, page.url)))).flat()
  const seen = new Set<string>()
  const unique = contacts.filter(contact => {
    const key = contact.email || contact.phone || contact.socialUrl || ''
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { contacts: unique, pagesScanned: pages.length, errors }
}

export const enrichCandidateContacts = async (workspaceId: string, candidateId: string) => {
  const candidate = (await db.$first(db.select().from(radarCandidates).where(and(eq(radarCandidates.id, candidateId), eq(radarCandidates.workspaceId, workspaceId)))))
  if (!candidate) return null
  const evidence = (await db.select().from(candidateEvidence).where(and(eq(candidateEvidence.workspaceId, workspaceId), eq(candidateEvidence.candidateId, candidateId))))
  const relationships = (() => { try { return JSON.parse(candidate.relationshipsJson) as { label: string; value: string }[] } catch { return [] } })()
  const sourceUrls = [
    ...relationships.filter(item => /企业官网|企业公开页面|官方网站/.test(item.label)).map(item => item.value),
    ...evidence.filter(item => /官网|official website/i.test(`${item.title} ${item.source}`)).map(item => item.sourceUrl),
  ].filter((value): value is string => Boolean(value && /^https?:\/\//i.test(value)))
  const result = await discoverPublicContacts(sourceUrls)
  const existing = (await db.select().from(candidateContacts).where(and(eq(candidateContacts.workspaceId, workspaceId), eq(candidateContacts.candidateId, candidateId))))
  const known = new Set(existing.map(item => item.email || item.phone || item.socialUrl).filter(Boolean))
  const fresh = result.contacts.filter(item => !known.has(item.email || item.phone || item.socialUrl))
  const all = [...existing.map(item => ({ name: item.name, role: item.role, email: item.email, phone: item.phone, socialUrl: item.socialUrl, sourceUrl: item.sourceUrl, verificationStatus: item.verificationStatus as PublicContact['verificationStatus'], confidence: item.confidence })), ...fresh]
  const committee = all.slice(0, 12).map(contact => ({ name: contact.name, role: contact.role, influence: contact.verificationStatus === 'verified' ? '已验证' : '公开来源', contact: contact.email || contact.phone || contact.socialUrl || '待复核' }))
  const now = Date.now()
  await db.transaction(async tx => {
        if (fresh.length) await tx.insert(candidateContacts).values(fresh.map(contact => ({ id: createId('con'), workspaceId, candidateId, ...contact, createdAt: now, updatedAt: now })))
        await tx.update(radarCandidates).set({
                committeeJson: JSON.stringify(committee.length ? committee : [{ name: '待补全', role: '采购或技术负责人', influence: '待判断', contact: '未发现公开联系方式' }]),
                confidence: Math.min(100, candidate.confidence + (fresh.length ? Math.min(8, fresh.length * 2) : 0)),
                updatedAt: now,
              }).where(and(eq(radarCandidates.id, candidateId), eq(radarCandidates.workspaceId, workspaceId)))
        if (fresh.length) await tx.insert(candidateEvidence).values({ id: createId('evd'), workspaceId, candidateId, title: `发现 ${fresh.length} 条公开联系方式`, source: '企业官网公开页面', observedLabel: new Date(now).toISOString(), strength: fresh.some(item => item.verificationStatus === 'verified') ? '强' : '中', sourceUrl: fresh[0].sourceUrl, createdAt: now })
      })
  return { contacts: all, discovered: fresh.length, pagesScanned: result.pagesScanned, errors: result.errors }
}
