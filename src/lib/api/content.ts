import { request , type ListResponse } from "./core";
import type { ContentAssetStatus, ContentAssetApiRecord, ContentAssetApiInput, ContentQualityResult, ContentGenerationResult, ContentAnalysisResult } from "./types";

export const contentApi = {
  list: (
    params: {
      q?: string;
      status?: ContentAssetStatus;
      contentType?: string;
      page?: number;
      pageSize?: number;
      sort?:
        | "updated_desc"
        | "updated_asc"
        | "title_asc"
        | "title_desc"
        | "market_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<ContentAssetApiRecord>>(
      `/content/assets${query.size ? `?${query}` : ""}`,
    );
  },
  get: (id: string) =>
    request<
      ContentAssetApiRecord & {
        latestQualityCheck:
          | (ContentQualityResult & { id: string; createdAt: number })
          | null;
      }
    >(`/content/assets/${encodeURIComponent(id)}`),
  create: (input: ContentAssetApiInput) =>
    request<ContentAssetApiRecord>("/content/assets", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<ContentAssetApiInput> & { changeNote?: string },
  ) =>
    request<ContentAssetApiRecord>(
      `/content/assets/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  duplicate: (id: string) =>
    request<ContentAssetApiRecord>(
      `/content/assets/${encodeURIComponent(id)}/duplicate`,
      { method: "POST" },
    ),
  versions: (id: string) =>
    request<{
      items: {
        id: string;
        versionNumber: number;
        title: string;
        body: string;
        changeNote: string;
        createdAt: number;
      }[];
    }>(`/content/assets/${encodeURIComponent(id)}/versions`),
  qualityCheck: (id: string) =>
    request<ContentQualityResult>(
      `/content/assets/${encodeURIComponent(id)}/quality-check`,
      { method: "POST" },
    ),
  linkCampaign: (id: string, campaignId: string) =>
    request<ContentAssetApiRecord>(
      `/content/assets/${encodeURIComponent(id)}/link-campaign`,
      { method: "POST", body: JSON.stringify({ campaignId }) },
    ),
  analyze: (input: {
    title?: string;
    contentType?: string;
    language?: string;
    body: string;
    targetMarket?: string;
    customerRole?: string;
    buyingStage?: string;
    customerSignal?: string;
    sourceMethod?: string;
  }) =>
    request<ContentAnalysisResult>("/content/analyze", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  generate: (
    input: Required<
      Pick<
        ContentAssetApiInput,
        | "title"
        | "contentType"
        | "channel"
        | "language"
        | "targetMarket"
        | "customerRole"
        | "buyingStage"
        | "customerSignal"
        | "sourceMethod"
      >
    > & { saveAsAsset?: boolean; existingBody?: string },
  ) =>
    request<ContentGenerationResult>("/content/generate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

