import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customers, deals, messageThreads, tasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const GUARDIAN_SOURCE = '商机推进守护'

const stageStaleDays: Record<string, number> = {
  线索确认: 3,
  需求确认: 7,
  方案评估: 10,
  商务谈判: 7,
}

export type SalesGuardianResult = {
  highIntentTasksCreated: number
  followUpTasksCreated: number
  overdueTasksEscalated: number
  missingDealsCreated: number
  staleDealTasksCreated: number
  resolvedGuardianTasks: number
}

const emptyResult = (): SalesGuardianResult => ({
  highIntentTasksCreated: 0, followUpTasksCreated: 0, overdueTasksEscalated: 0,
  missingDealsCreated: 0, staleDealTasksCreated: 0, resolvedGuardianTasks: 0,
})

const customerKey = (workspaceId: string, customerId: string | null) => `${workspaceId}:${customerId ?? ''}`
const companyKey = (workspaceId: string, company: string) => `${workspaceId}:${company.trim().toLocaleLowerCase()}`

export const reconcileSalesProgression = async (options: { now?: number; workspaceId?: string } = {}): Promise<SalesGuardianResult> => {
  const now = options.now ?? Date.now()
  const result = emptyResult()
  const [threadRows, customerRows, taskRows, dealRows] = await Promise.all([
    db.select().from(messageThreads).limit(2_000),
    db.select().from(customers).limit(2_000),
    db.select().from(tasks).where(and(eq(tasks.status, 'open'), isNull(tasks.archivedAt))).limit(4_000),
    db.select().from(deals).where(isNull(deals.archivedAt)).limit(2_000),
  ])
  const withinWorkspace = <T extends { workspaceId: string }>(rows: T[]) => options.workspaceId ? rows.filter(row => row.workspaceId === options.workspaceId) : rows
  const threads = withinWorkspace(threadRows)
  const customerList = withinWorkspace(customerRows)
  const openTasks = withinWorkspace(taskRows)
  const dealList = withinWorkspace(dealRows)
  const customerById = new Map(customerList.map(customer => [customerKey(customer.workspaceId, customer.id), customer]))
  const tasksByCustomer = new Map<string, typeof openTasks>()
  for (const task of openTasks) if (task.customerId) tasksByCustomer.set(customerKey(task.workspaceId, task.customerId), [...(tasksByCustomer.get(customerKey(task.workspaceId, task.customerId)) ?? []), task])
  const dealsByCustomer = new Map(dealList.filter(deal => deal.customerId).map(deal => [customerKey(deal.workspaceId, deal.customerId), deal]))
  const dealsByCompany = new Map(dealList.map(deal => [companyKey(deal.workspaceId, deal.company), deal]))

  for (const thread of threads.filter(item => item.status === 'open' && ['高意向', '待跟进'].includes(item.intent) && item.customerId)) {
    const customer = customerById.get(customerKey(thread.workspaceId, thread.customerId))
    if (!customer) continue
    const highIntent = thread.intent === '高意向'
    const dueAt = (thread.lastInboundAt ?? thread.updatedAt) + (highIntent ? 4 : 24) * HOUR
    const matchingTasks = (tasksByCustomer.get(customerKey(thread.workspaceId, customer.id)) ?? []).filter(task =>
      ['AI 回复识别', '客户回复', GUARDIAN_SOURCE].includes(task.source) && (/回复|高意向|客户接管/.test(task.title)),
    )
    const existing = matchingTasks.sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER))[0]
    if (!existing) {
      const task = {
        id: createId('tsk'), workspaceId: thread.workspaceId, customerId: customer.id,
        entityType: 'message_thread', entityId: thread.id, actionPath: `/inbox?thread=${encodeURIComponent(thread.id)}`,
        title: highIntent ? `客户接管 · ${customer.company}` : `跟进客户回复 · ${customer.company}`,
        priority: highIntent ? '高' : '中', dueAt,
        dueLabel: dueAt <= now ? '已逾期 · 立即处理' : highIntent ? '4 小时内' : '24 小时内',
        company: customer.company, nextAction: customer.nextAction || (highIntent ? '确认需求、预算、时间和决策链' : '按客户要求安排下一次沟通'),
        impact: highIntent ? '客户已明确表达采购、报价、资料或会议意向' : '客户已回复，等待人工确认后续节奏',
        source: GUARDIAN_SOURCE, status: 'open', archivedAt: null, ownerUserId: customer.ownerUserId ?? thread.assigneeUserId,
        createdAt: now, updatedAt: now,
      }
      await db.insert(tasks).values(task)
      tasksByCustomer.set(customerKey(thread.workspaceId, customer.id), [...(tasksByCustomer.get(customerKey(thread.workspaceId, customer.id)) ?? []), task])
      if (highIntent) result.highIntentTasksCreated += 1
      else result.followUpTasksCreated += 1
    } else if (dueAt <= now && (existing.priority !== '高' || existing.dueLabel !== '已逾期 · 立即处理')) {
      await db.update(tasks).set({ priority: '高', dueLabel: '已逾期 · 立即处理', updatedAt: now }).where(eq(tasks.id, existing.id))
      result.overdueTasksEscalated += 1
    }

    if (highIntent && !dealsByCustomer.has(customerKey(thread.workspaceId, customer.id)) && !dealsByCompany.has(companyKey(thread.workspaceId, customer.company))) {
      const deal = {
        id: createId('dea'), workspaceId: thread.workspaceId, customerId: customer.id, company: customer.company,
        stage: '线索确认', probability: 30, valueAmount: customer.estimatedValue, currency: 'CNY', ownerLabel: '负责人',
        nextAction: customer.nextAction || '确认需求、预算、时间和决策链', expectedCloseAt: now + 60 * DAY,
        risk: '需要人工确认真实需求、预算和决策链', source: '客户高意向回复', stageEnteredAt: now,
        outcomeReason: null, closedAt: null,
        archivedAt: null, ownerUserId: customer.ownerUserId ?? thread.assigneeUserId, createdAt: now, updatedAt: now,
      }
      await db.insert(deals).values(deal)
      dealsByCustomer.set(customerKey(thread.workspaceId, customer.id), deal)
      dealsByCompany.set(companyKey(thread.workspaceId, customer.company), deal)
      result.missingDealsCreated += 1
    }
  }

  for (const deal of dealList) {
    const guardianTasks = openTasks.filter(task => task.workspaceId === deal.workspaceId && task.source === GUARDIAN_SOURCE && (task.customerId === deal.customerId || task.company === deal.company) && /停滞商机/.test(task.title))
    if (['赢单', '输单'].includes(deal.stage)) {
      for (const task of guardianTasks) {
        await db.update(tasks).set({ status: 'completed', dueLabel: deal.stage === '赢单' ? '商机已赢单' : '商机已关闭', updatedAt: now }).where(eq(tasks.id, task.id))
        result.resolvedGuardianTasks += 1
      }
      continue
    }
    const staleDays = stageStaleDays[deal.stage] ?? 14
    const ageDays = Math.floor((now - deal.stageEnteredAt) / DAY)
    if (ageDays < staleDays || guardianTasks.length) continue
    await db.insert(tasks).values({
      id: createId('tsk'), workspaceId: deal.workspaceId, customerId: deal.customerId,
      entityType: 'deal', entityId: deal.id, actionPath: `/pipeline?open=${encodeURIComponent(deal.id)}`,
      title: `推进停滞商机 · ${deal.company}`, priority: '高', dueAt: now + DAY, dueLabel: '24 小时内',
      company: deal.company, nextAction: deal.nextAction || '确认商机是否继续、调整下一步或关闭',
      impact: `${deal.stage}已停留 ${ageDays} 天${deal.valueAmount > 0 ? ` · ${deal.currency} ${deal.valueAmount.toLocaleString()}` : ''}`,
      source: GUARDIAN_SOURCE, status: 'open', archivedAt: null, ownerUserId: deal.ownerUserId,
      createdAt: now, updatedAt: now,
    })
    result.staleDealTasksCreated += 1
  }
  return result
}

export const getSalesProgressionSummary = async (workspaceId: string, now = Date.now()) => {
  const staleBoundary = now - 7 * DAY
  const [highIntent, overdue, stale, guardian] = await Promise.all([
    db.$first(db.select({ count: sql<number>`count(*)` }).from(messageThreads).where(and(
      eq(messageThreads.workspaceId, workspaceId), eq(messageThreads.status, 'open'), eq(messageThreads.intent, '高意向'),
    ))),
    db.$first(db.select({ count: sql<number>`count(*)` }).from(tasks).where(and(
      eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'open'), isNull(tasks.archivedAt), sql`${tasks.dueAt} is not null and ${tasks.dueAt} < ${now}`,
    ))),
    db.$first(db.select({ count: sql<number>`count(*)` }).from(deals).where(and(
      eq(deals.workspaceId, workspaceId), isNull(deals.archivedAt), sql`${deals.stage} not in ('赢单','输单')`, sql`${deals.stageEnteredAt} < ${staleBoundary}`,
    ))),
    db.$first(db.select({ count: sql<number>`count(*)` }).from(tasks).where(and(
      eq(tasks.workspaceId, workspaceId), eq(tasks.status, 'open'), eq(tasks.source, GUARDIAN_SOURCE), isNull(tasks.archivedAt),
    ))),
  ])
  return { highIntentOpen: highIntent?.count ?? 0, overdueTasks: overdue?.count ?? 0, staleDeals: stale?.count ?? 0, guardianTasks: guardian?.count ?? 0 }
}
