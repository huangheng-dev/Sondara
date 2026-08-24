import { request , type ListResponse } from "./core";
import type { AttributionPeriod, AttributionOverview, ChannelCostApiRecord, ChannelCostApiInput } from "./types";

export const attributionApi = {
  overview: (params: { period?: AttributionPeriod; currency?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.period) query.set("period", params.period);
    if (params.currency) query.set("currency", params.currency);
    return request<AttributionOverview>(
      `/attribution/overview${query.size ? `?${query}` : ""}`,
    );
  },
  listCosts: (
    params: {
      channel?: string;
      start?: number;
      end?: number;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") query.set(k, String(v));
    });
    return request<ListResponse<ChannelCostApiRecord>>(
      `/attribution/costs${query.size ? `?${query}` : ""}`,
    );
  },
  createCost: (input: ChannelCostApiInput) =>
    request<ChannelCostApiRecord>("/attribution/costs", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCost: (id: string, input: Partial<ChannelCostApiInput>) =>
    request<ChannelCostApiRecord>(
      `/attribution/costs/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  removeCost: (id: string) =>
    request<void>(`/attribution/costs/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  createOptimizeTasks: (input: {
    period?: AttributionPeriod;
    channels?: string[];
  }) =>
    request<{ created: number; taskIds: string[] }>(
      "/attribution/optimize-tasks",
      { method: "POST", body: JSON.stringify(input) },
    ),
  quality: () =>
    request<{
      items: { label: string; pct: number; detail: string }[];
    }>("/attribution/quality"),
};

