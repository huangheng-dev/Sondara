import { request , type ListResponse } from "./core";
import type { DealApiRecord, DealApiInput } from "./types";

export const dealApi = {
  list: (
    params: {
      q?: string;
      stage?: DealApiRecord["stage"];
      page?: number;
      pageSize?: number;
      sort?: "updated_desc" | "value_desc" | "probability_desc" | "close_asc";
      includeArchived?: boolean;
      archivedOnly?: boolean;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<ListResponse<DealApiRecord>>(
      `/deals${query.size ? `?${query}` : ""}`,
    );
  },
  create: (input: DealApiInput) =>
    request<DealApiRecord>("/deals", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<DealApiInput>) =>
    request<DealApiRecord>(`/deals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  archive: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/deals/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
};

