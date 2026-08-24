import { request , type ListResponse } from "./core";
import type { CampaignStatus, CampaignApiRecord, CampaignApiInput } from "./types";

export const campaignApi = {
  list: (
    params: {
      q?: string;
      status?: CampaignStatus;
      page?: number;
      pageSize?: number;
      sort?:
        | "progress_desc"
        | "name_asc"
        | "name_desc"
        | "sent_desc"
        | "opportunities_desc"
        | "updated_desc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<CampaignApiRecord>>(
      `/campaigns${query.size ? `?${query}` : ""}`,
    );
  },
  get: (id: string) =>
    request<
      CampaignApiRecord & {
        events: {
          id: string;
          eventType: string;
          status: string;
          recipientCount: number;
          metadata: Record<string, unknown>;
          createdAt: number;
        }[];
      }
    >(`/campaigns/${encodeURIComponent(id)}`),
  create: (input: CampaignApiInput) =>
    request<CampaignApiRecord>("/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<
      Omit<CampaignApiInput, "contentAssetId" | "audienceCustomerIds">
    > & {
      progress?: number;
      sentCount?: number;
      replyCount?: number;
      opportunityCount?: number;
      revenueAmount?: number;
    },
  ) =>
    request<CampaignApiRecord>(`/campaigns/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  schedule: () =>
    request<{
      items: {
        id: string;
        campaignId: string;
        campaignName: string;
        name: string;
        channel: string;
        status: string;
        scheduledAt: number | null;
        position: number;
      }[];
      total: number;
    }>("/campaigns/schedule"),
  addStep: (
    id: string,
    input: {
      name: string;
      channel?: string;
      contentAssetId?: string | null;
      scheduledAt?: number | null;
      status?: "draft" | "scheduled" | "running" | "completed" | "cancelled";
      position?: number;
      note?: string;
    },
  ) =>
    request<CampaignApiRecord>(`/campaigns/${encodeURIComponent(id)}/steps`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  executeStep: (id: string, stepId: string) =>
    request<{
      campaignId: string;
      stepId: string;
      recipientCount: number;
      queued: number;
      awaitingConfiguration: number;
      suppressed: number;
      manualTasks?: number;
      jobIds: string[];
      taskIds?: string[];
    }>(
      `/campaigns/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/execute`,
      { method: "POST", body: JSON.stringify({ confirmation: true }) },
    ),
  linkContent: (id: string, contentAssetId: string, purpose?: string) =>
    request<CampaignApiRecord>(`/campaigns/${encodeURIComponent(id)}/content`, {
      method: "POST",
      body: JSON.stringify({ contentAssetId, purpose }),
    }),
  addAudience: (id: string, customerIds: string[]) =>
    request<CampaignApiRecord>(
      `/campaigns/${encodeURIComponent(id)}/audience`,
      { method: "POST", body: JSON.stringify({ customerIds }) },
    ),
};

