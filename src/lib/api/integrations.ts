import { request } from "./core";
import type { ExternalConnectorCatalogItem, ExternalConnectorConfiguration, ExternalConnectorRunResult, IntegrationConnectionApiRecord } from "./types";

export const integrationApi = {
  list: () =>
    request<{ items: IntegrationConnectionApiRecord[] }>(
      "/integrations/connections",
    ),
  create: (input: {
    category?: IntegrationConnectionApiRecord["category"];
    name?: string;
    provider: IntegrationConnectionApiRecord["provider"];
    endpoint?: string;
    secret?: string;
    priority?: number;
    resultLimit?: number;
  }) =>
    request<IntegrationConnectionApiRecord>("/integrations/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: {
      name?: string;
      endpoint?: string;
      secret?: string;
      priority?: number;
      enabled?: boolean;
      resultLimit?: number;
    },
  ) =>
    request<IntegrationConnectionApiRecord>(
      `/integrations/connections/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  test: (id: string) =>
    request<{ ok: true; latencyMs: number; resultCount: number }>(
      `/integrations/connections/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
  remove: (id: string) =>
    request<void>(`/integrations/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  catalog: () => request<{ items: ExternalConnectorCatalogItem[] }>("/integrations/catalog"),
  saveExternalConnector: (key: string, input: { name?: string; enabled?: boolean; settings: Record<string, string>; credentials: Record<string, string> }) =>
    request<ExternalConnectorConfiguration>(`/integrations/catalog/${encodeURIComponent(key)}/configuration`, { method: "PUT", body: JSON.stringify(input) }),
  validateExternalConnector: (key: string) =>
    request<{ ok: true; status: "validated"; networkRequest: false; message: string }>(`/integrations/catalog/${encodeURIComponent(key)}/validate`, { method: "POST" }),
  runExternalConnector: (key: string, input: { query?: string; limit?: number; importRecords?: boolean }) =>
    request<ExternalConnectorRunResult>(`/integrations/catalog/${encodeURIComponent(key)}/run`, { method: "POST", body: JSON.stringify(input) }),
  saveExternalConnectorSchedule: (key: string, input: { enabled: boolean; intervalMinutes: number; query?: string; perRunLimit: number; dailyLimit: number }) =>
    request<ExternalConnectorConfiguration>(`/integrations/catalog/${encodeURIComponent(key)}/schedule`, { method: "PUT", body: JSON.stringify(input) }),
  removeExternalConnector: (key: string) =>
    request<void>(`/integrations/catalog/${encodeURIComponent(key)}/configuration`, { method: "DELETE" }),
};
