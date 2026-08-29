import assert from 'node:assert/strict'
import { eq, sql } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import {
  campaignAudienceMembers,
  campaigns,
  customerTags,
  deals,
  messageThreads,
  tasks,
  users,
} from '../db/schema.js'
import { createId } from '../lib/ids.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

type CustomerLinkedTable = typeof tasks | typeof deals | typeof campaignAudienceMembers | typeof messageThreads

const countForCustomer = async (table: CustomerLinkedTable, customerId: string) =>
  (await db.select({ count: sql<number>`count(*)` }).from(table).where(eq(table.customerId, customerId)))[0]?.count ?? 0

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `customer-governance-${suffix}@integration.local`
  let userId = ''
  try {
    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: '客户治理测试', email: ownerEmail, password: 'Governance@2026' },
    })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const workspaceId = register.json().workspace.id
    const headers = { cookie: cookieValue(register.headers['set-cookie']) }

    const primary = await app.inject({
      method: 'POST',
      url: '/api/customers',
      headers,
      payload: {
        company: `主客户-${suffix}`,
        region: '德国',
        industry: '工业设备',
        score: 72,
        confidence: 65,
        estimatedValue: 120000,
        interaction: '已确认需求',
      },
    })
    assert.equal(primary.statusCode, 201, primary.body)
    const primaryId = primary.json().id

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/customers',
      headers,
      payload: {
        company: `重复客户-${suffix}`,
        region: '法国',
        industry: '自动化',
        score: 88,
        confidence: 91,
        estimatedValue: 240000,
        interaction: '等待报价',
      },
    })
    assert.equal(duplicate.statusCode, 201, duplicate.body)
    const duplicateId = duplicate.json().id

    const archive = await app.inject({ method: 'POST', url: `/api/customers/${duplicateId}/archive`, headers })
    assert.equal(archive.statusCode, 200, archive.body)
    assert.ok(archive.json().archivedAt)

    const activeList = await app.inject({ method: 'GET', url: '/api/customers?pageSize=100', headers })
    assert.equal(activeList.statusCode, 200, activeList.body)
    assert.equal(activeList.json().total, 1)
    assert.equal(activeList.json().items[0].id, primaryId)

    const archivedList = await app.inject({ method: 'GET', url: '/api/customers?archivedOnly=true&pageSize=100', headers })
    assert.equal(archivedList.statusCode, 200, archivedList.body)
    assert.equal(archivedList.json().total, 1)
    assert.equal(archivedList.json().items[0].id, duplicateId)

    const allList = await app.inject({ method: 'GET', url: '/api/customers?includeArchived=true&pageSize=100', headers })
    assert.equal(allList.statusCode, 200, allList.body)
    assert.equal(allList.json().total, 2)

    const unarchive = await app.inject({ method: 'POST', url: `/api/customers/${duplicateId}/archive`, headers, payload: { archived: false } })
    assert.equal(unarchive.statusCode, 200, unarchive.body)
    assert.equal(unarchive.json().archivedAt, null)

    const primarySharedContact = await app.inject({
      method: 'POST',
      url: `/api/customers/${primaryId}/contacts`,
      headers,
      payload: { name: 'Anna Meyer', email: 'anna@primary.example.com' },
    })
    assert.equal(primarySharedContact.statusCode, 201, primarySharedContact.body)
    const verifiedContact = await app.inject({
      method: 'POST',
      url: `/api/customers/${primaryId}/contacts/${primarySharedContact.json().id}/verify`,
      headers,
      payload: { status: 'verified', source: '测试验证' },
    })
    assert.equal(verifiedContact.statusCode, 200, verifiedContact.body)
    assert.equal(verifiedContact.json().verificationStatus, 'verified')
    const editedContact = await app.inject({
      method: 'PATCH',
      url: `/api/customers/${primaryId}/contacts/${primarySharedContact.json().id}`,
      headers,
      payload: { jobTitle: '采购负责人', email: 'anna.updated@primary.example.com' },
    })
    assert.equal(editedContact.statusCode, 200, editedContact.body)
    assert.equal(editedContact.json().jobTitle, '采购负责人')
    assert.equal(editedContact.json().email, 'anna.updated@primary.example.com')
    assert.equal(editedContact.json().verificationStatus, 'unverified')
    assert.equal(editedContact.json().verifiedAt, null)
    const duplicateSharedContact = await app.inject({
      method: 'POST',
      url: `/api/customers/${duplicateId}/contacts`,
      headers,
      payload: { name: 'Anna Meyer', phone: '+49 555 0100' },
    })
    assert.equal(duplicateSharedContact.statusCode, 201, duplicateSharedContact.body)
    const duplicateUniqueContact = await app.inject({
      method: 'POST',
      url: `/api/customers/${duplicateId}/contacts`,
      headers,
      payload: { name: 'Pierre Dupont', email: 'pierre@example.test' },
    })
    assert.equal(duplicateUniqueContact.statusCode, 201, duplicateUniqueContact.body)

    const primaryTag = await app.inject({
      method: 'POST',
      url: '/api/customers/tags/bulk',
      headers,
      payload: { customerIds: [primaryId], name: '主客户重点', color: 'blue' },
    })
    assert.equal(primaryTag.statusCode, 201, primaryTag.body)
    const duplicateTag = await app.inject({
      method: 'POST',
      url: '/api/customers/tags/bulk',
      headers,
      payload: { customerIds: [duplicateId], name: '展会来源', color: 'green' },
    })
    assert.equal(duplicateTag.statusCode, 201, duplicateTag.body)

    const task = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: { customerId: duplicateId, title: `重复客户任务-${suffix}`, company: duplicate.json().company },
    })
    assert.equal(task.statusCode, 201, task.body)
    const deal = await app.inject({
      method: 'POST',
      url: '/api/deals',
      headers,
      payload: {
        customerId: duplicateId,
        company: duplicate.json().company,
        stage: '需求确认',
        valueAmount: 180000,
        source: '专项测试',
      },
    })
    assert.equal(deal.statusCode, 201, deal.body)

    const now = Date.now()
    const campaignId = createId('cam')
    await db.insert(campaigns).values({
      id: campaignId,
      workspaceId,
      name: `客户治理活动-${suffix}`,
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(campaignAudienceMembers).values({
      id: createId('cam'),
      workspaceId,
      campaignId,
      customerId: duplicateId,
      company: duplicate.json().company,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(messageThreads).values({
      id: createId('thr'),
      workspaceId,
      contactId: duplicateUniqueContact.json().id,
      customerId: duplicateId,
      campaignId,
      subject: '需要合并的对话',
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    })

    const preview = await app.inject({
      method: 'POST',
      url: '/api/customers/merge-preview',
      headers,
      payload: { primaryCustomerId: primaryId, duplicateCustomerId: duplicateId },
    })
    assert.equal(preview.statusCode, 200, preview.body)
    assert.equal(preview.json().contacts.primary, 1)
    assert.equal(preview.json().contacts.duplicate, 2)
    assert.deepEqual(preview.json().contacts.duplicateNames, ['Anna Meyer'])
    assert.equal(preview.json().transfers.tasks, 1)
    assert.equal(preview.json().transfers.deals, 1)
    assert.equal(preview.json().transfers.threads, 1)
    assert.equal(preview.json().transfers.campaignMembers, 1)

    const sameIdMerge = await app.inject({
      method: 'POST',
      url: '/api/customers/merge',
      headers,
      payload: { primaryCustomerId: primaryId, duplicateCustomerId: primaryId },
    })
    assert.equal(sameIdMerge.statusCode, 400, sameIdMerge.body)

    const merged = await app.inject({
      method: 'POST',
      url: '/api/customers/merge',
      headers,
      payload: { primaryCustomerId: primaryId, duplicateCustomerId: duplicateId },
    })
    assert.equal(merged.statusCode, 200, merged.body)
    assert.equal(merged.json().primaryCustomerId, primaryId)
    assert.equal(merged.json().archivedCustomerId, duplicateId)
    assert.equal(merged.json().transferredContacts, 2)

    const primaryContacts = await app.inject({ method: 'GET', url: `/api/customers/${primaryId}/contacts`, headers })
    assert.equal(primaryContacts.statusCode, 200, primaryContacts.body)
    assert.equal(primaryContacts.json().items.length, 2)
    const mergedShared = primaryContacts.json().items.find((item: { name: string }) => item.name === 'Anna Meyer')
    assert.equal(mergedShared.email, 'anna.updated@primary.example.com')
    assert.equal(mergedShared.phone, '+49 555 0100')
    const duplicateContacts = await app.inject({ method: 'GET', url: `/api/customers/${duplicateId}/contacts`, headers })
    assert.equal(duplicateContacts.statusCode, 200, duplicateContacts.body)
    assert.equal(duplicateContacts.json().items.length, 0)

    assert.equal(await countForCustomer(tasks, primaryId), 1)
    assert.equal(await countForCustomer(tasks, duplicateId), 0)
    assert.equal(await countForCustomer(deals, primaryId), 1)
    assert.equal(await countForCustomer(deals, duplicateId), 0)
    assert.equal(await countForCustomer(campaignAudienceMembers, primaryId), 1)
    assert.equal(await countForCustomer(campaignAudienceMembers, duplicateId), 0)
    assert.equal(await countForCustomer(messageThreads, primaryId), 1)
    assert.equal(await countForCustomer(messageThreads, duplicateId), 0)

    const primaryTags = await db.select().from(customerTags).where(eq(customerTags.customerId, primaryId))
    const duplicateTags = await db.select().from(customerTags).where(eq(customerTags.customerId, duplicateId))
    assert.equal(primaryTags.length, 2)
    assert.ok(primaryTags.some(tag => tag.name === '主客户重点'))
    assert.ok(primaryTags.some(tag => tag.name === '展会来源'))
    assert.equal(duplicateTags.length, 0)

    const customerList = await app.inject({ method: 'GET', url: '/api/customers?includeArchived=true&pageSize=100', headers })
    assert.equal(customerList.statusCode, 200, customerList.body)
    const primaryItem = customerList.json().items.find((item: { id: string }) => item.id === primaryId)
    const duplicateItem = customerList.json().items.find((item: { id: string }) => item.id === duplicateId)
    assert.equal(primaryItem.score, 88)
    assert.equal(primaryItem.confidence, 91)
    assert.equal(primaryItem.estimatedValue, 180000)
    assert.match(primaryItem.interaction, /已合并/)
    assert.ok(duplicateItem.archivedAt)
    assert.match(duplicateItem.nextAction, /已合并/)

    console.log('Customer governance integration passed: archive filters, restore, merge preview, contact/task/deal/thread/audience/tag transfers and duplicate archival verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
