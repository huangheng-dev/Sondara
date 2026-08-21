import assert from 'node:assert/strict'
import { and, eq, sql } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import {
  approvalRequests,
  auditLogs,
  campaignAudienceMembers,
  campaignSteps,
  customers,
  tasks,
  users,
} from '../db/schema.js'
import { createId } from '../lib/ids.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const countTable = async (table: any, where?: any) => {
  const query = db.select({ count: sql<number>`count(*)` }).from(table)
  const rows = where ? await query.where(where) : await query
  return rows[0]?.count ?? 0
}

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `approval-owner-${suffix}@sondara.local`
  const memberEmail = `approval-member-${suffix}@sondara.local`
  const viewerEmail = `approval-viewer-${suffix}@sondara.local`
  let ownerId = ''
  let memberId = ''
  let viewerId = ''
  try {
    const ownerRegister = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { displayName: '审批所有者', email: ownerEmail, password: 'ApprovalOwner@2026' },
    })
    assert.equal(ownerRegister.statusCode, 201, ownerRegister.body)
    ownerId = ownerRegister.json().user.id
    const workspaceId = ownerRegister.json().workspace.id
    const ownerHeaders = { cookie: cookieValue(ownerRegister.headers['set-cookie']) }

    const createMember = async (email: string, name: string, role: 'member' | 'viewer') => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/members',
        headers: ownerHeaders,
        payload: { displayName: name, email, password: 'ApprovalMember@2026', role },
      })
      assert.equal(response.statusCode, 201, response.body)
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'ApprovalMember@2026', remember: true },
      })
      assert.equal(login.statusCode, 200, login.body)
      return { id: response.json().id, cookie: cookieValue(login.headers['set-cookie']) }
    }

    const member = await createMember(memberEmail, '审批申请人', 'member')
    memberId = member.id
    const viewer = await createMember(viewerEmail, '审批只读员', 'viewer')
    viewerId = viewer.id

    const invalidRequest = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: { cookie: member.cookie },
      payload: { entityType: 'x', entityId: 'entity-1', action: 'go' },
    })
    assert.equal(invalidRequest.statusCode, 400, invalidRequest.body)

    const viewerRequest = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: { cookie: viewer.cookie },
      payload: { entityType: 'export', entityId: 'export-1', action: 'bulk_export' },
    })
    assert.equal(viewerRequest.statusCode, 403, viewerRequest.body)

    const requested = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: { cookie: member.cookie },
      payload: { entityType: 'campaign_step', entityId: `step-manual-${suffix}`, action: 'campaign.bulk_execute', note: '成员申请大批量发送' },
    })
    assert.equal(requested.statusCode, 201, requested.body)
    const manualApprovalId = requested.json().id
    assert.equal(requested.json().status, 'pending')

    const memberReview = await app.inject({
      method: 'PATCH',
      url: `/api/approvals/${manualApprovalId}`,
      headers: { cookie: member.cookie },
      payload: { status: 'approved' },
    })
    assert.equal(memberReview.statusCode, 403, memberReview.body)

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/api/approvals/${manualApprovalId}`,
      headers: ownerHeaders,
      payload: { status: 'rejected', note: '缺少发送依据' },
    })
    assert.equal(rejected.statusCode, 200, rejected.body)
    assert.equal(rejected.json().status, 'rejected')
    assert.equal(rejected.json().reviewedByUserId, ownerId)
    assert.equal(rejected.json().note, '缺少发送依据')

    const closeAgain = await app.inject({
      method: 'PATCH',
      url: `/api/approvals/${manualApprovalId}`,
      headers: ownerHeaders,
      payload: { status: 'approved' },
    })
    assert.equal(closeAgain.statusCode, 409, closeAgain.body)

    const now = Date.now()
    const customerRows = Array.from({ length: 100 }, (_, index) => ({
      id: createId('cus'),
      workspaceId,
      company: `审批客户 ${suffix}-${index + 1}`,
      region: '德国',
      industry: '工业设备',
      score: 60,
      confidence: 60,
      signal: '审批流测试',
      source: '集成测试',
      estimatedValue: 10000,
      size: '50-100',
      stage: '待验证',
      contacts: 0,
      validContacts: 0,
      interaction: '待触达',
      nextAction: '等待审批后触达',
      ownerUserId: ownerId,
      archivedAt: null,
      createdAt: now + index,
      updatedAt: now + index,
    }))
    await db.insert(customers).values(customerRows)

    const campaign = await app.inject({
      method: 'POST',
      url: '/api/campaigns',
      headers: { cookie: member.cookie },
      payload: {
        name: `大批量审批活动-${suffix}`,
        channel: 'WhatsApp',
        audienceLabel: '100 位测试客户',
        audienceCustomerIds: customerRows.map(customer => customer.id),
      },
    })
    assert.equal(campaign.statusCode, 201, campaign.body)
    const campaignId = campaign.json().id

    const step = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/steps`,
      headers: { cookie: member.cookie },
      payload: { name: '人工确认首触达', channel: 'WhatsApp', status: 'scheduled' },
    })
    assert.equal(step.statusCode, 201, step.body)
    const stepId = step.json().steps.at(-1).id

    const beforeApprovals = await countTable(approvalRequests, and(eq(approvalRequests.entityType, 'campaign_step'), eq(approvalRequests.entityId, stepId)))
    const firstExecute = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/steps/${stepId}/execute`,
      headers: { cookie: member.cookie },
      payload: { confirmation: true },
    })
    assert.equal(firstExecute.statusCode, 409, firstExecute.body)
    assert.equal(firstExecute.json().error, 'APPROVAL_REQUIRED')
    assert.ok(firstExecute.json().approvalId)
    const campaignApprovalId = firstExecute.json().approvalId as string
    const afterFirstApprovals = await countTable(approvalRequests, and(eq(approvalRequests.entityType, 'campaign_step'), eq(approvalRequests.entityId, stepId)))
    assert.equal(afterFirstApprovals, beforeApprovals + 1)

    const secondExecute = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/steps/${stepId}/execute`,
      headers: { cookie: member.cookie },
      payload: { confirmation: true },
    })
    assert.equal(secondExecute.statusCode, 409, secondExecute.body)
    assert.equal(secondExecute.json().approvalId, campaignApprovalId)
    const afterSecondApprovals = await countTable(approvalRequests, and(eq(approvalRequests.entityType, 'campaign_step'), eq(approvalRequests.entityId, stepId)))
    assert.equal(afterSecondApprovals, afterFirstApprovals)

    const list = await app.inject({ method: 'GET', url: '/api/approvals', headers: ownerHeaders })
    assert.equal(list.statusCode, 200, list.body)
    assert.ok(list.json().items.some((item: { id: string; requester: string }) => item.id === campaignApprovalId && item.requester === '审批申请人'))

    const approve = await app.inject({
      method: 'PATCH',
      url: `/api/approvals/${campaignApprovalId}`,
      headers: ownerHeaders,
      payload: { status: 'approved', note: '确认名单和内容合规' },
    })
    assert.equal(approve.statusCode, 200, approve.body)
    assert.equal(approve.json().status, 'approved')
    assert.equal(approve.json().note, '确认名单和内容合规')

    const approvedExecute = await app.inject({
      method: 'POST',
      url: `/api/campaigns/${campaignId}/steps/${stepId}/execute`,
      headers: { cookie: member.cookie },
      payload: { confirmation: true },
    })
    assert.equal(approvedExecute.statusCode, 202, approvedExecute.body)
    assert.equal(approvedExecute.json().recipientCount, 100)
    assert.equal(approvedExecute.json().manualTasks, 100)
    assert.equal(await countTable(tasks, eq(tasks.workspaceId, workspaceId)), 100)

    const [stepRecord] = await db.select().from(campaignSteps).where(eq(campaignSteps.id, stepId)).limit(1)
    assert.equal(stepRecord.status, 'running')
    const pendingAudience = await db.select({ count: sql<number>`count(*)` }).from(campaignAudienceMembers).where(and(eq(campaignAudienceMembers.campaignId, campaignId), eq(campaignAudienceMembers.status, 'pending')))
    assert.equal(pendingAudience[0]?.count ?? 0, 0)

    const auditCount = await countTable(auditLogs, and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, 'approval.approved')))
    assert.ok(auditCount >= 1)

    console.log('Approval integration passed: request permissions, review lifecycle, closed request conflict, campaign bulk approval gate, duplicate pending prevention and approved execution verified.')
  } finally {
    if (viewerId) await db.delete(users).where(eq(users.id, viewerId))
    if (memberId) await db.delete(users).where(eq(users.id, memberId))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)



