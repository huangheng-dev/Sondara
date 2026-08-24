import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, campaignAudienceMembers, customerTags, customers, deals, inboxContacts, messageThreads, tasks, users, workspaceMembers } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth } from '../plugins/auth.js'
import {
  customerImportInputSchema,
  customerInputSchema,
  customerListQuerySchema,
  customerMergeInputSchema,
  customerPatchSchema,
} from '../contracts/customers.js'

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string | null, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'customer', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

const requireMergeCustomers = async (workspaceId: string, input: z.infer<typeof customerMergeInputSchema>) => {
  const rows = await db.select().from(customers).where(and(eq(customers.workspaceId, workspaceId), inArray(customers.id, [input.primaryCustomerId, input.duplicateCustomerId])))
  const primary = rows.find(row => row.id === input.primaryCustomerId)
  const duplicate = rows.find(row => row.id === input.duplicateCustomerId)
  if (!primary || !duplicate) throw Object.assign(new Error('要合并的客户不存在或不属于当前工作区。'), { statusCode: 404 })
  return { primary, duplicate }
}

const CUSTOMER_STAGES = ['待补全', '待验证', '培育中', '重点跟进', '有商机', '已成交', '停滞', '已流失'] as const
type CustomerStage = typeof CUSTOMER_STAGES[number]

const STAGE_NEXT_ACTION: Record<CustomerStage, string> = {
  '待补全': '补全企业档案和联系人信息',
  '待验证': '验证企业信息和联系人邮箱',
  '培育中': '发送培育内容或行业洞察',
  '重点跟进': '安排首次深度沟通或产品演示',
  '有商机': '推进报价和合同流程',
  '已成交': '启动交付并确认首单到账',
  '停滞': '设定回访提醒，暂停主动触达',
  '已流失': '记录流失原因，暂停触达',
}

const STAGE_TRANSITIONS: Record<CustomerStage, CustomerStage[]> = {
  '待补全': ['待验证', '培育中'],
  '待验证': ['培育中', '待补全', '已流失'],
  '培育中': ['重点跟进', '停滞', '已流失'],
  '重点跟进': ['有商机', '培育中', '停滞', '已流失'],
  '有商机': ['已成交', '停滞', '已流失', '重点跟进'],
  '已成交': ['重点跟进'],
  '停滞': ['培育中', '重点跟进', '有商机', '已流失'],
  '已流失': ['培育中', '重点跟进'],
}

export const customerRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/', async (request, reply) => {
    const parsed = customerListQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(customers.workspaceId, request.auth.workspaceId)]
    if (query.archivedOnly) conditions.push(isNotNull(customers.archivedAt))
    else if (!query.includeArchived) conditions.push(isNull(customers.archivedAt))
    if (query.q) conditions.push(or(like(customers.company, `%${query.q}%`), like(customers.industry, `%${query.q}%`), like(customers.signal, `%${query.q}%`))!)
    if (query.region) conditions.push(eq(customers.region, query.region))
    if (query.stage) conditions.push(eq(customers.stage, query.stage))
    if (query.minScore !== undefined) conditions.push(gte(customers.score, query.minScore))
    const where = and(...conditions)
    const orderBy = query.sort === 'updated_asc' ? asc(customers.updatedAt)
      : query.sort === 'score_desc' ? desc(customers.score)
      : query.sort === 'score_asc' ? asc(customers.score)
      : query.sort === 'company_asc' ? asc(customers.company)
      : desc(customers.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(customers).where(where)))?.count ?? 0
    const names = new Map((await db.select({ id: users.id, name: users.displayName }).from(users)).map(item => [item.id, item.name]))
    const tags = (await db.select().from(customerTags).where(eq(customerTags.workspaceId, request.auth.workspaceId)))
    const tagsByCustomer = new Map<string, Array<{ id: string; name: string; color: string }>>()
    tags.forEach(tag => tagsByCustomer.set(tag.customerId, [...(tagsByCustomer.get(tag.customerId) ?? []), { id: tag.id, name: tag.name, color: tag.color }]))
    const items = (await db.select().from(customers).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(item => ({ ...item, ownerName: item.ownerUserId ? names.get(item.ownerUserId) ?? '未分配' : '未分配', scoreOverrideByName: item.scoreOverrideByUserId ? names.get(item.scoreOverrideByUserId) ?? null : null, tags: tagsByCustomer.get(item.id) ?? [] }))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/', async (request, reply) => {
    const parsed = customerInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const requestedOwner = parsed.data.ownerUserId ?? request.auth.userId
    if (requestedOwner && !(await db.$first(db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, requestedOwner)))))) return reply.code(400).send({ error: 'INVALID_OWNER', message: '负责人不是当前工作区成员。' })
    const record = { id: createId('cus'), workspaceId: request.auth.workspaceId, createdAt: now, updatedAt: now, ...parsed.data, ownerUserId: requestedOwner }
    try { await db.insert(customers).values(record) } catch { return reply.code(409).send({ error: 'CUSTOMER_EXISTS', message: '该工作区已存在同名客户。' }) }
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.created', record.id, { company: record.company })
    return reply.code(201).send(record)
  })

  app.post('/import', async (request, reply) => {
    const parsed = customerImportInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const existingRows = await db.select({ id: customers.id, company: customers.company, contacts: customers.contacts, validContacts: customers.validContacts }).from(customers).where(eq(customers.workspaceId, request.auth.workspaceId))
    const customerByCompany = new Map(existingRows.map(item => [item.company.trim().toLocaleLowerCase(), item]))
    const seen = new Set<string>()
    let created = 0; let duplicates = 0; let contactsCreated = 0; let invalid = 0
    const source = `${parsed.data.sourceType} · ${parsed.data.sourceName}${parsed.data.sourceUrl ? ` · ${parsed.data.sourceUrl}` : ''}`.slice(0, 120)
    await db.transaction(async tx => {
      for (const row of parsed.data.rows) {
        const key = row.company.trim().toLocaleLowerCase()
        if (seen.has(key)) { duplicates += 1; continue }
        seen.add(key)
        let customer = customerByCompany.get(key)
        if (!customer) {
          const id = createId('cus')
          await tx.insert(customers).values({ id, workspaceId: request.auth.workspaceId, company: row.company, region: row.region, industry: row.industry, score: row.score, confidence: row.confidence, signal: row.signal, source, estimatedValue: row.estimatedValue, size: row.size, stage: '待验证', contacts: 0, validContacts: 0, interaction: '刚刚导入，待验证', nextAction: row.nextAction || '验证企业与联系人信息', dueAt: row.dueAt ?? null, ownerUserId: request.auth.userId, archivedAt: null, createdAt: now, updatedAt: now })
          customer = { id, company: row.company, contacts: 0, validContacts: 0 }
          customerByCompany.set(key, customer); created += 1
        } else duplicates += 1
        if (!row.contactName) continue
        const contactExists = await db.$first(tx.select({ id: inboxContacts.id }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.company, customer.company), eq(inboxContacts.name, row.contactName))))
        if (contactExists) continue
        await tx.insert(inboxContacts).values({ id: createId('ict'), workspaceId: request.auth.workspaceId, customerId: customer.id, name: row.contactName, company: customer.company, jobTitle: row.contactTitle || '待验证', region: row.region, source, primaryChannel: row.contactPhone ? 'WhatsApp' : '邮件', email: row.contactEmail ?? null, phone: row.contactPhone ?? null, externalRef: row.website ?? null, createdAt: now, updatedAt: now })
        contactsCreated += 1
        customer.contacts += 1
        if (row.contactEmail || row.contactPhone) customer.validContacts += 1
        await tx.update(customers).set({ contacts: customer.contacts, validContacts: customer.validContacts, updatedAt: now }).where(eq(customers.id, customer.id))
      }
    })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.imported', null, { sourceName: parsed.data.sourceName, sourceType: parsed.data.sourceType, sourceUrl: parsed.data.sourceUrl ?? null, total: parsed.data.rows.length, created, duplicates, contactsCreated, invalid })
    return reply.code(201).send({ total: parsed.data.rows.length, created, duplicates, contactsCreated, invalid })
  })

  app.get('/imports', async request => {
    const rows = await db.select().from(auditLogs).where(and(eq(auditLogs.workspaceId, request.auth.workspaceId), eq(auditLogs.action, 'customer.imported'))).orderBy(desc(auditLogs.createdAt)).limit(100)
    return { items: rows.map(row => ({ id: row.id, createdAt: row.createdAt, ...(JSON.parse(row.metadata) as { sourceName: string; sourceType: string; sourceUrl: string | null; total: number; created: number; duplicates: number; contactsCreated: number }) })) }
  })

  app.get('/merge-suggestions', async request => {
    const allCustomers = await db.select({
      id: customers.id, company: customers.company, region: customers.region,
      industry: customers.industry, score: customers.score, stage: customers.stage,
      contacts: customers.contacts, validContacts: customers.validContacts,
      source: customers.source, createdAt: customers.createdAt, updatedAt: customers.updatedAt,
    }).from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), isNull(customers.archivedAt)))

    // Fetch all contacts for email/phone matching
    const allContacts = await db.select({
      customerId: inboxContacts.customerId, email: inboxContacts.email,
      phone: inboxContacts.phone,
    }).from(inboxContacts).where(eq(inboxContacts.workspaceId, request.auth.workspaceId))

    const contactsByCustomer = new Map<string, Array<{ email: string | null; phone: string | null }>>()
    for (const c of allContacts) {
      if (!c.customerId) continue
      const arr = contactsByCustomer.get(c.customerId) ?? []
      arr.push({ email: c.email, phone: c.phone })
      contactsByCustomer.set(c.customerId, arr)
    }

    const normalizeCompany = (name: string) => name
      .toLowerCase()
      .replace(/[（(【\[].*?[)）\]】]/g, '')
      .replace(/\b(co[\.,]?\s*ltd|inc|llc|gmbh|co[\.,]?\s*kg|ag|sa|sarl|bv|nv|plc|limited|corp[\.,]?|corporation|company|technologies|technology|tech|group|holding[s]?)\b\.?/gi, '')
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
      .trim()

    const emailDomain = (email: string | null) => {
      if (!email) return null
      const parts = email.toLowerCase().split('@')
      return parts[1] ? parts[1] : null
    }

    const phoneDigits = (phone: string | null) => phone ? phone.replace(/\D/g, '').slice(-10) : null

    const suggestions: Array<{
      primaryId: string; duplicateId: string;
      primaryCompany: string; duplicateCompany: string;
      reasons: string[]; confidence: 'high' | 'medium' | 'low';
    }> = []

    const seen = new Set<string>()
    for (let i = 0; i < allCustomers.length; i++) {
      for (let j = i + 1; j < allCustomers.length; j++) {
        const a = allCustomers[i]
        const b = allCustomers[j]
        const key = [a.id, b.id].sort().join('-')
        if (seen.has(key)) continue
        const reasons: string[] = []

        // 1. Normalized company name exact match
        const na = normalizeCompany(a.company)
        const nb = normalizeCompany(b.company)
        if (na && nb && na === nb && a.company !== b.company) {
          reasons.push('企业名称（去除后缀后）一致')
        }

        // 2. Same contact email domain
        const aContacts = contactsByCustomer.get(a.id) ?? []
        const bContacts = contactsByCustomer.get(b.id) ?? []
        const aDomains = new Set(aContacts.map(c => emailDomain(c.email)).filter(Boolean))
        const bDomains = new Set(bContacts.map(c => emailDomain(c.email)).filter(Boolean))
        const sharedDomains = [...aDomains].filter(d => bDomains.has(d))
        if (sharedDomains.length) reasons.push(`相同邮箱域名：${sharedDomains[0]}`)

        // 3. Same phone (last 10 digits)
        const aPhones = new Set(aContacts.map(c => phoneDigits(c.phone)).filter(Boolean))
        const bPhones = new Set(bContacts.map(c => phoneDigits(c.phone)).filter(Boolean))
        const sharedPhones = [...aPhones].filter(p => bPhones.has(p))
        if (sharedPhones.length) reasons.push('相同联系电话')

        if (reasons.length === 0) continue
        seen.add(key)

        const hasNameMatch = na && nb && na === nb && a.company !== b.company
        const hasPhoneMatch = sharedPhones.length > 0
        const confidence: 'high' | 'medium' | 'low' =
          reasons.length >= 2 ? 'high' :
          hasNameMatch || hasPhoneMatch ? 'high' :
          'medium'
        // Primary = higher score, then more contacts, then newer
        const aScore = a.score * 100 + a.validContacts * 10 + (a.updatedAt > b.updatedAt ? 1 : 0)
        const bScore = b.score * 100 + b.validContacts * 10 + (b.updatedAt > a.updatedAt ? 1 : 0)
        const [primary, duplicate] = aScore >= bScore ? [a, b] : [b, a]
        suggestions.push({
          primaryId: primary.id, duplicateId: duplicate.id,
          primaryCompany: primary.company, duplicateCompany: duplicate.company,
          reasons, confidence,
        })
      }
    }

    suggestions.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.confidence] - order[b.confidence]
    })

    return { items: suggestions.slice(0, 100), scanned: allCustomers.length }
  })

  app.post('/merge-preview', async (request, reply) => {
    const parsed = customerMergeInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const { primary, duplicate } = await requireMergeCustomers(request.auth.workspaceId, parsed.data)
    const [primaryContacts, duplicateContacts, transferTasks, transferDeals, transferThreads, transferAudience] = await Promise.all([
      db.select({ id: inboxContacts.id, name: inboxContacts.name, email: inboxContacts.email, phone: inboxContacts.phone }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, primary.id))),
      db.select({ id: inboxContacts.id, name: inboxContacts.name, email: inboxContacts.email, phone: inboxContacts.phone }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, duplicate.id))),
      db.select({ count: sql<number>`count(*)` }).from(tasks).where(and(eq(tasks.workspaceId, request.auth.workspaceId), eq(tasks.customerId, duplicate.id))),
      db.select({ count: sql<number>`count(*)` }).from(deals).where(and(eq(deals.workspaceId, request.auth.workspaceId), eq(deals.customerId, duplicate.id))),
      db.select({ count: sql<number>`count(*)` }).from(messageThreads).where(and(eq(messageThreads.workspaceId, request.auth.workspaceId), eq(messageThreads.customerId, duplicate.id))),
      db.select({ count: sql<number>`count(*)` }).from(campaignAudienceMembers).where(and(eq(campaignAudienceMembers.workspaceId, request.auth.workspaceId), eq(campaignAudienceMembers.customerId, duplicate.id))),
    ])
    const primaryNames = new Set(primaryContacts.map(contact => contact.name.trim().toLocaleLowerCase()))
    return {
      primary, duplicate,
      contacts: { primary: primaryContacts.length, duplicate: duplicateContacts.length, duplicateNames: duplicateContacts.filter(contact => primaryNames.has(contact.name.trim().toLocaleLowerCase())).map(contact => contact.name) },
      transfers: { tasks: transferTasks[0]?.count ?? 0, deals: transferDeals[0]?.count ?? 0, threads: transferThreads[0]?.count ?? 0, campaignMembers: transferAudience[0]?.count ?? 0 },
    }
  })

  app.post('/merge', async (request, reply) => {
    const parsed = customerMergeInputSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const { primary, duplicate } = await requireMergeCustomers(request.auth.workspaceId, parsed.data)
    const now = Date.now()
    const sourceContacts = await db.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, duplicate.id)))
    const targetContacts = await db.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, primary.id)))
    const byName = new Map(targetContacts.map(contact => [contact.name.trim().toLocaleLowerCase(), contact]))
    await db.transaction(async tx => {
      for (const sourceContact of sourceContacts) {
        const target = byName.get(sourceContact.name.trim().toLocaleLowerCase())
        if (target) {
          await tx.update(messageThreads).set({ contactId: target.id, customerId: primary.id, updatedAt: now }).where(and(eq(messageThreads.workspaceId, request.auth.workspaceId), eq(messageThreads.contactId, sourceContact.id)))
          await tx.update(inboxContacts).set({ email: target.email ?? sourceContact.email, phone: target.phone ?? sourceContact.phone, externalRef: target.externalRef ?? sourceContact.externalRef, updatedAt: now }).where(eq(inboxContacts.id, target.id))
          await tx.delete(inboxContacts).where(eq(inboxContacts.id, sourceContact.id))
        } else {
          await tx.update(inboxContacts).set({ customerId: primary.id, company: primary.company, region: primary.region, updatedAt: now }).where(eq(inboxContacts.id, sourceContact.id))
          byName.set(sourceContact.name.trim().toLocaleLowerCase(), sourceContact)
        }
      }
      // Keep these independent moves serial within the transaction
      // so newer pg clients never receive concurrent queries on that client.
      await tx.update(tasks).set({ customerId: primary.id, company: primary.company, updatedAt: now }).where(and(eq(tasks.workspaceId, request.auth.workspaceId), eq(tasks.customerId, duplicate.id)))
      await tx.update(deals).set({ customerId: primary.id, company: primary.company, updatedAt: now }).where(and(eq(deals.workspaceId, request.auth.workspaceId), eq(deals.customerId, duplicate.id)))
      await tx.update(messageThreads).set({ customerId: primary.id, updatedAt: now }).where(and(eq(messageThreads.workspaceId, request.auth.workspaceId), eq(messageThreads.customerId, duplicate.id)))
      await tx.update(campaignAudienceMembers).set({ customerId: primary.id, updatedAt: now }).where(and(eq(campaignAudienceMembers.workspaceId, request.auth.workspaceId), eq(campaignAudienceMembers.customerId, duplicate.id)))
      const sourceTags = await tx.select().from(customerTags).where(and(eq(customerTags.workspaceId, request.auth.workspaceId), eq(customerTags.customerId, duplicate.id)))
      if (sourceTags.length) {
        await tx.insert(customerTags).values(sourceTags.map(tag => ({ id: createId('ctg'), workspaceId: tag.workspaceId, customerId: primary.id, name: tag.name, color: tag.color, createdAt: now }))).onConflictDoNothing()
        await tx.delete(customerTags).where(and(eq(customerTags.workspaceId, request.auth.workspaceId), eq(customerTags.customerId, duplicate.id)))
      }
      const [counts] = await tx.select({ total: sql<number>`count(*)`, valid: sql<number>`sum(case when ${inboxContacts.email} is not null or ${inboxContacts.phone} is not null then 1 else 0 end)` }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, primary.id)))
      await tx.update(customers).set({ contacts: counts?.total ?? 0, validContacts: counts?.valid ?? 0, score: Math.max(primary.score, duplicate.score), confidence: Math.max(primary.confidence, duplicate.confidence), estimatedValue: Math.max(primary.estimatedValue, duplicate.estimatedValue), interaction: `刚刚 · 已合并 ${duplicate.company}`, nextAction: primary.nextAction || duplicate.nextAction, updatedAt: now }).where(eq(customers.id, primary.id))
      await tx.update(customers).set({ archivedAt: now, interaction: `已合并至 ${primary.company}`, nextAction: '已合并，不再单独跟进', updatedAt: now }).where(eq(customers.id, duplicate.id))
    })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.merged', primary.id, { duplicateCustomerId: duplicate.id, duplicateCompany: duplicate.company, transferredContacts: sourceContacts.length })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.merged_into', duplicate.id, { primaryCustomerId: primary.id, primaryCompany: primary.company })
    return { primaryCustomerId: primary.id, archivedCustomerId: duplicate.id, transferredContacts: sourceContacts.length }
  })

  app.patch('/:id', async (request, reply) => {
    const id = z.string().min(1).parse((request.params as { id: string }).id)
    const parsed = customerPatchSchema.safeParse(request.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const changes = pickProvided(request.body, parsed.data)
    if (!Object.keys(changes).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    if (changes.ownerUserId && !(await db.$first(db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, changes.ownerUserId)))))) return reply.code(400).send({ error: 'INVALID_OWNER', message: '负责人不是当前工作区成员。' })
    await db.update(customers).set({ ...changes, updatedAt: Date.now() }).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.updated', id, { fields: Object.keys(changes) })
    const updated = await db.$first(db.select().from(customers).where(eq(customers.id, id)))
    if (!updated) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const allUsers = new Map((await db.select({ id: users.id, name: users.displayName }).from(users)).map(item => [item.id, item.name]))
    return { ...updated, scoreOverrideByName: updated.scoreOverrideByUserId ? allUsers.get(updated.scoreOverrideByUserId) ?? null : null }
  })

  app.delete('/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = (await db.$first(db.select({ id: customers.id, company: customers.company }).from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    await db.delete(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.deleted', id, { company: existing.company })
    return reply.code(204).send()
  })

  app.post('/:id/archive', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = await db.$first(db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const archivedAt = (request.body as { archived?: boolean } | undefined)?.archived === false ? null : Date.now()
    await db.update(customers).set({ archivedAt, updatedAt: Date.now() }).where(eq(customers.id, id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, archivedAt ? 'customer.archived' : 'customer.unarchived', id)
    return { id, archivedAt }
  })

  app.post('/:id/score-override', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = z.object({
      scoreOverride: z.number().int().min(0).max(100).nullable(),
      reason: z.string().trim().min(1).max(500).optional(),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = await db.$first(db.select().from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const now = Date.now()
    if (parsed.data.scoreOverride === null) {
      await db.update(customers).set({ scoreOverride: null, scoreOverrideReason: null, scoreOverrideByUserId: null, scoreOverrideAt: null, updatedAt: now }).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
      await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.score_override_cleared', id, { originalScore: existing.score })
    } else {
      if (!parsed.data.reason) return reply.code(400).send({ error: 'INVALID_INPUT', message: '修正评分时必须填写原因。' })
      await db.update(customers).set({ scoreOverride: parsed.data.scoreOverride, scoreOverrideReason: parsed.data.reason, scoreOverrideByUserId: request.auth.userId, scoreOverrideAt: now, updatedAt: now }).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
      await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.score_override', id, { originalScore: existing.score, overrideScore: parsed.data.scoreOverride, reason: parsed.data.reason })
    }
    const result = await db.$first(db.select().from(customers).where(eq(customers.id, id)))
    if (!result) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const overrideNames = new Map((await db.select({ id: users.id, name: users.displayName }).from(users)).map(item => [item.id, item.name]))
    return { ...result, scoreOverrideByName: result.scoreOverrideByUserId ? overrideNames.get(result.scoreOverrideByUserId) ?? null : null }
  })

  app.post('/:id/stage', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = z.object({
      stage: z.enum(CUSTOMER_STAGES),
      nextAction: z.string().trim().max(200).optional(),
      reason: z.string().trim().max(500).optional(),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = await db.$first(db.select().from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const allowed = STAGE_TRANSITIONS[existing.stage as CustomerStage]
    if (existing.stage !== parsed.data.stage && allowed && !allowed.includes(parsed.data.stage)) {
      return reply.code(409).send({ error: 'INVALID_TRANSITION', message: `不允许从「${existing.stage}」直接变更为「${parsed.data.stage}」。允许的下一阶段：${allowed.join('、')}。` })
    }
    const now = Date.now()
    const nextAction = parsed.data.nextAction ?? STAGE_NEXT_ACTION[parsed.data.stage]
    await db.update(customers).set({ stage: parsed.data.stage, nextAction, interaction: `阶段变更为 ${parsed.data.stage}`, updatedAt: now }).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.stage_changed', id, { from: existing.stage, to: parsed.data.stage, reason: parsed.data.reason ?? null, nextAction })
    return await db.$first(db.select().from(customers).where(eq(customers.id, id)))
  })

  app.post('/tags/bulk', async (request, reply) => {
    const parsed = z.object({ customerIds: z.array(z.string().min(1)).min(1).max(500), name: z.string().trim().min(1).max(50), color: z.enum(['blue', 'green', 'orange', 'gray']).default('blue') }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const validCustomers = (await db.select({ id: customers.id }).from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), inArray(customers.id, parsed.data.customerIds))))
    if (validCustomers.length !== new Set(parsed.data.customerIds).size) return reply.code(404).send({ error: 'CUSTOMER_NOT_FOUND', message: '部分客户不存在或不属于当前工作区。' })
    const now = Date.now()
    await Promise.all(validCustomers.map(async customer => (await db.insert(customerTags).values({ id: createId('ctg'), workspaceId: request.auth.workspaceId, customerId: customer.id, name: parsed.data.name, color: parsed.data.color, createdAt: now }).onConflictDoUpdate({ target: [customerTags.customerId, customerTags.name], set: { color: parsed.data.color } }))))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.tags_added', validCustomers.map(item => item.id).join(','), { name: parsed.data.name, count: validCustomers.length })
    return reply.code(201).send({ updated: validCustomers.length })
  })

  app.get('/:id/contacts', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const customer = (await db.$first(db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!customer) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const parsed = z.object({ verificationStatus: z.enum(['verified', 'unverified', 'invalid', 'all']).default('all') }).safeParse(request.query)
    const conditions = [eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, id)]
    if (parsed.success && parsed.data.verificationStatus !== 'all') conditions.push(eq(inboxContacts.verificationStatus, parsed.data.verificationStatus))
    return { items: (await db.select().from(inboxContacts).where(and(...conditions)).orderBy(desc(inboxContacts.updatedAt))) }
  })

  app.post('/:id/contacts', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const customer = (await db.$first(db.select().from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!customer) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const parsed = z.object({ name: z.string().trim().min(1).max(100), jobTitle: z.string().trim().max(120).default('待补全'), email: z.string().trim().email().nullable().optional(), phone: z.string().trim().max(50).nullable().optional(), primaryChannel: z.string().trim().max(50).default('邮件') }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const record = { id: createId('ict'), workspaceId: request.auth.workspaceId, customerId: id, name: parsed.data.name, company: customer.company, jobTitle: parsed.data.jobTitle, region: customer.region, source: '客户库手动添加', primaryChannel: parsed.data.primaryChannel, email: parsed.data.email ?? null, phone: parsed.data.phone ?? null, externalRef: null, verificationStatus: 'unverified' as const, verifiedAt: null, verificationSource: null, createdAt: now, updatedAt: now }
    try { await db.insert(inboxContacts).values(record) } catch { return reply.code(409).send({ error: 'CONTACT_EXISTS', message: '该客户已存在同名联系人。' }) }
    const counts = (await db.$first(db.select({ total: sql<number>`count(*)`, valid: sql<number>`sum(case when ${inboxContacts.email} is not null or ${inboxContacts.phone} is not null then 1 else 0 end)` }).from(inboxContacts).where(eq(inboxContacts.customerId, id))))
    await db.update(customers).set({ contacts: counts?.total ?? 0, validContacts: counts?.valid ?? 0, updatedAt: now }).where(eq(customers.id, id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.contact_created', record.id, { customerId: id })
    return reply.code(201).send(record)
  })

  app.post('/:id/contacts/:contactId/whatsapp-opt-in', async (request, reply) => {
    const customerId = (request.params as { id: string }).id
    const contactId = (request.params as { contactId: string }).contactId
    const parsed = z.object({ optedIn: z.boolean(), source: z.string().trim().min(2).max(120).default('人工确认') }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const contact = await db.$first(db.select().from(inboxContacts).where(and(eq(inboxContacts.id, contactId), eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, customerId))))
    if (!contact) return reply.code(404).send({ error: 'NOT_FOUND', message: '联系人不存在。' })
    const now = Date.now()
    await db.update(inboxContacts).set({ whatsappOptedInAt: parsed.data.optedIn ? now : null, whatsappOptInSource: parsed.data.optedIn ? parsed.data.source : null, updatedAt: now }).where(eq(inboxContacts.id, contactId))
    await writeAudit(request.auth.workspaceId, request.auth.userId, parsed.data.optedIn ? 'customer.whatsapp_opt_in' : 'customer.whatsapp_opt_out', contactId, { customerId, source: parsed.data.source })
    return await db.$first(db.select().from(inboxContacts).where(eq(inboxContacts.id, contactId)))
  })

  app.post('/:id/contacts/:contactId/verify', async (request, reply) => {
    const customerId = (request.params as { id: string }).id
    const contactId = (request.params as { contactId: string }).contactId
    const parsed = z.object({
      status: z.enum(['verified', 'unverified', 'invalid']),
      source: z.string().trim().min(2).max(120).default('人工确认'),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const contact = await db.$first(db.select().from(inboxContacts).where(and(eq(inboxContacts.id, contactId), eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, customerId))))
    if (!contact) return reply.code(404).send({ error: 'NOT_FOUND', message: '联系人不存在。' })
    const now = Date.now()
    const isVerified = parsed.data.status === 'verified'
    await db.update(inboxContacts).set({
      verificationStatus: parsed.data.status,
      verifiedAt: isVerified ? now : null,
      verificationSource: isVerified ? parsed.data.source : null,
      updatedAt: now,
    }).where(eq(inboxContacts.id, contactId))
    const counts = (await db.$first(db.select({ total: sql<number>`count(*)`, reachable: sql<number>`sum(case when ${inboxContacts.email} is not null or ${inboxContacts.phone} is not null then 1 else 0 end)` }).from(inboxContacts).where(eq(inboxContacts.customerId, customerId))))
    await db.update(customers).set({ contacts: counts?.total ?? 0, validContacts: counts?.reachable ?? 0, updatedAt: now }).where(eq(customers.id, customerId))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.contact_verified', contactId, { customerId, status: parsed.data.status, source: parsed.data.source })
    return await db.$first(db.select().from(inboxContacts).where(eq(inboxContacts.id, contactId)))
  })
}
