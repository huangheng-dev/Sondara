import { request } from "./core";
import type { LeadSourceConnection, LeadSourceEvent } from "./types";

export const leadSourceApi = {
  listConnections: () => request<{ items: LeadSourceConnection[] }>('/lead-sources/connections'),
  createConnection: (input: { name: string; provider: 'linkedin-lead-gen' | 'meta-lead-ads'; accountRef?: string; formRef?: string; clientId?: string; accessToken?: string; enabled?: boolean }) => request<LeadSourceConnection & { webhookUrl: string; webhookToken: string }>('/lead-sources/connections', { method: 'POST', body: JSON.stringify(input) }),
  updateConnection: (id: string, input: Partial<{ name: string; provider: 'linkedin-lead-gen' | 'meta-lead-ads'; accountRef: string; formRef: string; clientId: string; accessToken: string; enabled: boolean }>) => request<LeadSourceConnection>(`/lead-sources/connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),
  regenerateWebhook: (id: string) => request<{ webhookUrl: string; webhookToken: string }>(`/lead-sources/connections/${encodeURIComponent(id)}/regenerate-webhook`, { method: 'POST' }),
  listEvents: () => request<{ items: LeadSourceEvent[] }>('/lead-sources/events'),
};
