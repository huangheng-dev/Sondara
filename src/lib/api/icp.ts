import { request , type ListResponse } from "./core";
import type { BusinessProfileApiRecord, BusinessProfileApiInput, IcpAnalysisResult, KnowledgeItemType, KnowledgeItemStatus, KnowledgeItemApiRecord, KnowledgeItemApiInput } from "./types";

export const icpApi = {
  getProfile: () =>
    request<BusinessProfileApiRecord>("/icp/profile"),
  updateProfile: (input: BusinessProfileApiInput) =>
    request<BusinessProfileApiRecord>("/icp/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  analyzeProfile: () =>
    request<BusinessProfileApiRecord & { analysis: IcpAnalysisResult; mode: "ai" | "local-rules" }>(
      "/icp/profile/analyze",
      { method: "POST" },
    ),
  listKnowledge: (
    params: {
      q?: string;
      itemType?: KnowledgeItemType;
      status?: KnowledgeItemStatus;
      page?: number;
      pageSize?: number;
      sort?:
        | "updated_desc"
        | "updated_asc"
        | "title_asc"
        | "title_desc"
        | "references_desc"
        | "references_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<KnowledgeItemApiRecord>>(
      `/icp/knowledge${query.size ? `?${query}` : ""}`,
    );
  },
  createKnowledge: (input: KnowledgeItemApiInput) =>
    request<KnowledgeItemApiRecord>("/icp/knowledge", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateKnowledge: (id: string, input: Partial<KnowledgeItemApiInput>) =>
    request<KnowledgeItemApiRecord>(
      `/icp/knowledge/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  setKnowledgeStatus: (id: string, status: KnowledgeItemStatus) =>
    request<KnowledgeItemApiRecord>(
      `/icp/knowledge/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  removeKnowledge: (id: string) =>
    request<void>(`/icp/knowledge/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

// ── Attribution / Conversion ──────────────────────────────────────

