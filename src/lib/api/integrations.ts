import { request } from "./core";
import type { IntegrationConnectionApiRecord } from "./types";

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
};
