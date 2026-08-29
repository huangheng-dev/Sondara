import { request, type ListResponse } from './core'

export type ProcurementProvider = 'ted' | 'sam-gov' | 'ungm' | 'world-bank'
export type ProcurementSubscription = {
  id: string; name: string; provider: ProcurementProvider; keywords: string[]; regions: string[]; noticeTypes: string[]; enabled: boolean
  lastSyncAt: number | null; lastSyncStatus: 'never' | 'success' | 'error'; lastError: string | null; createdAt: number; updatedAt: number
}
export type ProcurementOpportunity = {
  id: string; provider: ProcurementProvider; externalId: string; title: string; buyer: string; description: string; country: string; noticeType: string; status: string
  publishedAt: number | null; deadlineAt: number | null; sourceUrl: string; relevanceScore: number; saved: boolean; syncedAt: number; contact: Record<string, unknown>; metadata: Record<string, unknown>
}
export type ProcurementProviderStatus = { provider: ProcurementProvider; name: string; mode: 'official_api' | 'official_link'; configured: boolean; status?: string; note: string; sourceUrl?: string }
export type ProcurementOpportunitySort = 'relevance_desc' | 'relevance_asc' | 'deadline_asc' | 'deadline_desc' | 'published_desc' | 'published_asc' | 'buyer_asc' | 'buyer_desc' | 'title_asc' | 'title_desc'

export const procurementApi = {
  providers: () => request<{ items: ProcurementProviderStatus[] }>('/procurement/providers'),
  subscriptions: () => request<{ items: ProcurementSubscription[] }>('/procurement/subscriptions'),
  createSubscription: (input: { name: string; provider: ProcurementProvider; keywords: string[]; regions?: string[]; noticeTypes?: string[]; enabled?: boolean }) => request<ProcurementSubscription>('/procurement/subscriptions', { method: 'POST', body: JSON.stringify(input) }),
  updateSubscription: (id: string, input: Partial<{ name: string; provider: ProcurementProvider; keywords: string[]; regions: string[]; noticeTypes: string[]; enabled: boolean }>) => request<ProcurementSubscription>(`/procurement/subscriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeSubscription: (id: string) => request<void>(`/procurement/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sync: (id: string) => request<{ radarTaskId: string; received: number; created: number; updated: number; syncedAt: number }>(`/procurement/subscriptions/${encodeURIComponent(id)}/sync`, { method: 'POST' }),
  opportunities: (query: { q?: string; provider?: ProcurementProvider; saved?: boolean; sort?: ProcurementOpportunitySort; page?: number; pageSize?: number } = {}) => request<ListResponse<ProcurementOpportunity>>(`/procurement/opportunities?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()}`),
  save: (id: string) => request<ProcurementOpportunity & { customerId: string; taskId: string }>(`/procurement/opportunities/${encodeURIComponent(id)}/save`, { method: 'POST' }),
  dismiss: (id: string) => request<void>(`/procurement/opportunities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
