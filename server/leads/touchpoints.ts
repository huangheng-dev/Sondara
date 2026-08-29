import { db } from '../db/client.js'
import { customerTouchpoints } from '../db/schema.js'
import { createId } from '../lib/ids.js'

export type TouchpointInput = {
  workspaceId: string
  customerId: string
  contactId?: string | null
  eventType: string
  source: string
  medium?: string | null
  campaign?: string | null
  content?: string | null
  term?: string | null
  referrer?: string | null
  landingPage?: string | null
  externalId: string
  metadata?: Record<string, unknown>
  occurredAt?: number
}

export const recordCustomerTouchpoint = async (input: TouchpointInput) => {
  const now = Date.now()
  await db.insert(customerTouchpoints).values({
    id: createId('ctp'),
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    contactId: input.contactId ?? null,
    eventType: input.eventType,
    source: input.source.slice(0, 160),
    medium: input.medium?.slice(0, 160) || null,
    campaign: input.campaign?.slice(0, 240) || null,
    content: input.content?.slice(0, 240) || null,
    term: input.term?.slice(0, 240) || null,
    referrer: input.referrer?.slice(0, 1000) || null,
    landingPage: input.landingPage?.slice(0, 1000) || null,
    externalId: input.externalId.slice(0, 300),
    metadataJson: JSON.stringify(input.metadata ?? {}),
    occurredAt: input.occurredAt ?? now,
    createdAt: now,
  }).onConflictDoNothing()
}
