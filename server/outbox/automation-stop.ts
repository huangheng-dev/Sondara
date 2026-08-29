import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { messageEntries, outboxJobs } from '../db/schema.js'

const automatedMetadata = (metadataJson: string) => {
  try {
    return JSON.parse(metadataJson) as Record<string, unknown>
  } catch {
    return {}
  }
}

export const cancelPendingAutomatedMessages = async (input: {
  workspaceId: string
  threadId?: string
  planId?: string
  reason: string
}) => {
  const rows = await db.select({
    jobId: outboxJobs.id,
    messageId: messageEntries.id,
    metadataJson: messageEntries.metadataJson,
  }).from(outboxJobs).innerJoin(messageEntries, eq(messageEntries.id, outboxJobs.messageId)).where(and(
    eq(outboxJobs.workspaceId, input.workspaceId),
    ...(input.threadId ? [eq(outboxJobs.threadId, input.threadId)] : []),
    inArray(outboxJobs.status, ['queued', 'awaiting_configuration']),
    eq(messageEntries.status, 'confirmed'),
  ))
  const automated = rows.filter(row => {
    const metadata = automatedMetadata(row.metadataJson)
    return metadata.automationApprovedByPlan === true && (!input.planId || metadata.acquisitionPlanId === input.planId)
  })
  if (!automated.length) return 0
  const now = Date.now()
  const jobIds = automated.map(row => row.jobId)
  const messageIds = automated.map(row => row.messageId)
  await db.transaction(async tx => {
    await tx.update(outboxJobs).set({
      status: 'cancelled', lastError: input.reason, completedAt: now, updatedAt: now,
    }).where(and(eq(outboxJobs.workspaceId, input.workspaceId), inArray(outboxJobs.id, jobIds)))
    await tx.update(messageEntries).set({ status: 'cancelled', updatedAt: now }).where(and(
      eq(messageEntries.workspaceId, input.workspaceId), inArray(messageEntries.id, messageIds),
    ))
  })
  return automated.length
}

export const cancelPendingAutomatedMessagesForThread = (input: {
  workspaceId: string
  threadId: string
  reason: string
}) => cancelPendingAutomatedMessages(input)
