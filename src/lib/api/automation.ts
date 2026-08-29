import { request } from './core'
import type {
  AutomationRunApiRecord, InboxReplySuggestionApiRecord, LearningVersionApiRecord, SalesRecommendationApiRecord, WorkspaceNotificationApiRecord,
} from './types'

export const automationApi = {
  notifications: () => request<{ items: WorkspaceNotificationApiRecord[]; unreadTotal: number; total: number }>('/automation/notifications'),
  readNotification: (id: string) => request<{ id: string; readAt: number }>(`/automation/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  readAllNotifications: () => request<{ readAt: number }>('/automation/notifications/read-all', { method: 'POST' }),
  outcomes: () => request<{ items: unknown[]; total: number }>('/automation/outcomes'),
  recordOutcome: (input: { customerId?: string | null; dealId?: string | null; threadId?: string | null; outcome: string; reasonCode?: string | null; note?: string }) => request('/automation/outcomes', { method: 'POST', body: JSON.stringify(input) }),
  replySuggestion: (threadId: string) => request<InboxReplySuggestionApiRecord>(`/automation/reply-suggestions/${encodeURIComponent(threadId)}`),
  regenerateReplySuggestion: (threadId: string) => request<InboxReplySuggestionApiRecord>(`/automation/reply-suggestions/${encodeURIComponent(threadId)}/generate`, { method: 'POST' }),
  dealRecommendation: (dealId: string) => request<SalesRecommendationApiRecord>(`/automation/deals/${encodeURIComponent(dealId)}/recommendation`),
  regenerateDealRecommendation: (dealId: string) => request<SalesRecommendationApiRecord>(`/automation/deals/${encodeURIComponent(dealId)}/recommendation/regenerate`, { method: 'POST' }),
  acceptRecommendation: (id: string) => request<{ id: string; taskId: string; actionPath: string }>(`/automation/recommendations/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  runs: () => request<{ items: AutomationRunApiRecord[]; total: number }>('/automation/runs'),
  run: (id: string) => request<AutomationRunApiRecord>(`/automation/runs/${encodeURIComponent(id)}`),
  retryRun: (id: string) => request(`/automation/runs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  simulatePlan: (planId: string) => request<{ id: string; traceId: string; status: string; safe: boolean; steps: Array<{ key: string; status: string; title: string; description: string }> }>(`/automation/plans/${encodeURIComponent(planId)}/simulate`, { method: 'POST' }),
  learningVersions: (planId: string) => request<{ items: LearningVersionApiRecord[]; total: number }>(`/automation/plans/${encodeURIComponent(planId)}/learning-versions`),
  learningAction: (id: string, action: 'activate' | 'freeze') => request<LearningVersionApiRecord>(`/automation/learning-versions/${encodeURIComponent(id)}/${action}`, { method: 'POST' }),
}
