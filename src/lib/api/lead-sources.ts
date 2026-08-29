import { request } from "./core";
import type { LeadSourceConnection, LeadSourceEvent, LeadSourceProvider } from "./types";

export const leadSourceApi = {
  listConnections: () => request<{ items: LeadSourceConnection[] }>('/lead-sources/connections'),
  createConnection: (input: { name: string; provider: LeadSourceProvider; accountRef?: string; formRef?: string; clientId?: string; accessToken?: string; verificationSecret?: string; autoCreateCustomer?: boolean; createFollowUpTask?: boolean; enabled?: boolean }) => request<LeadSourceConnection & { webhookUrl: string; webhookToken: string }>('/lead-sources/connections', { method: 'POST', body: JSON.stringify(input) }),
  updateConnection: (id: string, input: Partial<{ name: string; provider: LeadSourceProvider; accountRef: string; formRef: string; clientId: string; accessToken: string; verificationSecret: string; autoCreateCustomer: boolean; createFollowUpTask: boolean; enabled: boolean }>) => request<LeadSourceConnection>(`/lead-sources/connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  removeConnection: (id: string) => request<void>(`/lead-sources/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  regenerateWebhook: (id: string) => request<{ webhookUrl: string; webhookToken: string }>(`/lead-sources/connections/${encodeURIComponent(id)}/regenerate-webhook`, { method: 'POST' }),
  startOAuth: (id: string) => request<{ authorizationUrl: string; redirectUri: string; expiresAt: number }>(`/lead-sources/connections/${encodeURIComponent(id)}/oauth/start`, { method: 'POST' }),
  listEvents: () => request<{ items: LeadSourceEvent[] }>('/lead-sources/events'),
  processEvent: (id: string, input: { company: string; full_name?: string; email?: string; phone?: string; job_title?: string; region?: string; industry?: string; website?: string; message?: string }) => request<{ status: 'processed'; customerId: string; contactId: string; taskId: string | null }>(`/lead-sources/events/${encodeURIComponent(id)}/process`, { method: 'POST', body: JSON.stringify(input) }),
};
