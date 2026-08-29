import { request } from "./core";
import type { AiServiceApiRecord, AiServiceKeyApiRecord, AiPolicyApiRecord } from "./types";

export const aiApi = {
  listServices: () => request<{ items: AiServiceApiRecord[] }>("/ai/services"),
  getPolicy: () => request<AiPolicyApiRecord>("/ai/policy"),
  updatePolicy: (input: Omit<AiPolicyApiRecord, "workspaceId" | "updatedAt">) =>
    request<AiPolicyApiRecord>("/ai/policy", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  createService: (input: {
    name: string;
    provider: AiServiceApiRecord["provider"];
    protocol?: AiServiceApiRecord["protocol"];
    model?: string;
    endpoint?: string;
    priority?: number;
  }) =>
    request<AiServiceApiRecord>("/ai/services", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createConnection: (input: {
    name: string;
    protocol: AiServiceApiRecord["protocol"];
    endpoint: string;
    model: string;
    keyName: string;
    secret: string;
    priority?: number;
  }) => request<AiServiceApiRecord>("/ai/services/connections", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  updateService: (
    id: string,
    input: Partial<
      Pick<
        AiServiceApiRecord,
        "name" | "protocol" | "model" | "endpoint" | "priority" | "enabled"
      >
    >,
  ) =>
    request<AiServiceApiRecord>(`/ai/services/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  replaceKey: (id: string, input: { name: string; secret: string }) =>
    request<{ serviceId: string; ending: string; updatedAt: number }>(`/ai/services/${encodeURIComponent(id)}/key`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteService: (id: string) => request<void>(`/ai/services/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listKeys: (serviceId: string) =>
    request<{ items: AiServiceKeyApiRecord[] }>(
      `/ai/services/${encodeURIComponent(serviceId)}/keys`,
    ),
  addKey: (serviceId: string, input: { name: string; secret: string }) =>
    request<AiServiceKeyApiRecord>(
      `/ai/services/${encodeURIComponent(serviceId)}/keys`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  updateKey: (id: string, enabled: boolean) =>
    request<{ id: string; enabled: boolean }>(
      `/ai/keys/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
    ),
  deleteKey: (id: string) =>
    request<void>(`/ai/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testService: (id: string) =>
    request<{ ok: true; latencyMs: number }>(
      `/ai/services/${encodeURIComponent(id)}/test`,
      { method: "POST" },
    ),
};
