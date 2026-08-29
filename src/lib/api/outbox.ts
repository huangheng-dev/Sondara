import { request , type ListResponse } from "./core";
import type { OutboundConnectionApiRecord, ContactSuppressionApiRecord, ChannelWebhookEventApiRecord, OutboxJobApiRecord, WhatsappTemplateApiRecord } from "./types";

export const outboxApi = {
  listConnections: () =>
    request<{ items: OutboundConnectionApiRecord[] }>("/outbox/connections"),
  createConnection: (input: {
    name: string;
    provider: "smtp" | "sendgrid" | "mailgun" | "webhook" | "whatsapp-cloud";
    host: string;
    port: number;
    secure: boolean;
    username: string;
    whatsappBusinessAccountId?: string | null;
    whatsappDefaultTemplateName?: string | null;
    whatsappDefaultTemplateLanguage?: string | null;
    password: string;
    fromName: string;
    fromEmail: string;
    replyTo?: string | null;
    imapEnabled?: boolean;
    imapHost?: string | null;
    imapPort?: number;
    imapSecure?: boolean;
    imapUsername?: string | null;
    imapPassword?: string;
    priority?: number;
    enabled?: boolean;
  }) =>
    request<OutboundConnectionApiRecord & { webhookSecret: string }>(
      "/outbox/connections",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  updateConnection: (
    id: string,
    input: Partial<{
      name: string;
      provider: "smtp" | "sendgrid" | "mailgun" | "webhook" | "whatsapp-cloud";
      host: string;
      port: number;
      secure: boolean;
      username: string;
      whatsappBusinessAccountId: string | null;
      whatsappDefaultTemplateName: string | null;
      whatsappDefaultTemplateLanguage: string | null;
      password: string;
      fromName: string;
      fromEmail: string;
      replyTo: string | null;
      imapEnabled: boolean;
      imapHost: string | null;
      imapPort: number;
      imapSecure: boolean;
      imapUsername: string | null;
      imapPassword: string;
      priority: number;
      enabled: boolean;
    }>,
  ) =>
    request<OutboundConnectionApiRecord>(
      `/outbox/connections/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  testConnection: (id: string) =>
    request<{ ok: true; latencyMs: number; imapLatencyMs: number | null; activatedJobs: number }>(
      `/outbox/connections/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  listWhatsappTemplates: (id: string) => request<{ items: WhatsappTemplateApiRecord[] }>(`/outbox/connections/${encodeURIComponent(id)}/whatsapp/templates`),
  syncWhatsappTemplates: (id: string) => request<{ items: WhatsappTemplateApiRecord[]; syncedAt: number }>(`/outbox/connections/${encodeURIComponent(id)}/whatsapp/templates/sync`, { method: 'POST' }),
  removeConnection: (id: string) =>
    request<void>(`/outbox/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listJobs: (
    params: {
      q?: string;
      status?: OutboxJobApiRecord["status"] | "all";
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<OutboxJobApiRecord> & { pageCount: number }>(
      `/outbox/jobs${query.size ? `?${query}` : ""}`,
    );
  },
  retryJob: (id: string) =>
    request<{ id: string; status: "queued" }>(
      `/outbox/jobs/${encodeURIComponent(id)}/retry`,
      { method: "POST", body: JSON.stringify({ confirmation: true }) },
    ),
  rotateWebhookSecret: (id: string) =>
    request<{
      id: string;
      webhookSecret: string;
      webhookSecretEnding: string;
      webhookUrl: string;
    }>(`/outbox/connections/${encodeURIComponent(id)}/webhook-secret/rotate`, {
      method: "POST",
      body: JSON.stringify({ confirmation: true }),
    }),
  listEvents: () =>
    request<{ items: ChannelWebhookEventApiRecord[] }>("/outbox/events"),
  listSuppressions: (
    params: {
      q?: string;
      status?: "active" | "restored" | "all";
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<
      ListResponse<ContactSuppressionApiRecord> & { pageCount: number }
    >(`/outbox/suppressions${query.size ? `?${query}` : ""}`);
  },
  restoreSuppression: (id: string) =>
    request<{ id: string; active: false }>(
      `/outbox/suppressions/${encodeURIComponent(id)}/restore`,
      { method: "POST", body: JSON.stringify({ confirmation: true }) },
    ),
};
