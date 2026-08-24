import { request , type ListResponse } from "./core";
import type { CustomerApiRecord, RadarTaskStatus, RadarCandidateStatus, RadarTaskApiRecord, RadarTaskApiInput, RadarCandidateApiRecord, RadarCandidateApiInput, RadarQueueApiRecord, RadarJobEventApiRecord } from "./types";

export const radarApi = {
  listTasks: (
    params: { status?: RadarTaskStatus; page?: number; pageSize?: number } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<ListResponse<RadarTaskApiRecord>>(
      `/radar/tasks${query.size ? `?${query}` : ""}`,
    );
  },
  createTask: (input: RadarTaskApiInput) =>
    request<RadarTaskApiRecord & { queueItem: RadarQueueApiRecord }>(
      "/radar/tasks",
      { method: "POST", body: JSON.stringify(input) },
    ),
  taskAction: (id: string, action: "pause" | "resume" | "cancel" | "retry") =>
    request<RadarTaskApiRecord>(`/radar/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),
  listTaskEvents: (id: string) =>
    request<{ items: RadarJobEventApiRecord[]; total: number }>(
      `/radar/tasks/${encodeURIComponent(id)}/events`,
    ),
  listCandidates: (
    params: {
      q?: string;
      status?: RadarCandidateStatus;
      taskId?: string;
      minScore?: number;
      page?: number;
      pageSize?: number;
      sort?: "updated_desc" | "score_desc" | "score_asc" | "company_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<RadarCandidateApiRecord>>(
      `/radar/candidates${query.size ? `?${query}` : ""}`,
    );
  },
  createCandidate: (input: RadarCandidateApiInput) =>
    request<RadarCandidateApiRecord>("/radar/candidates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCandidate: (id: string, status: RadarCandidateStatus) =>
    request<RadarCandidateApiRecord>(
      `/radar/candidates/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  archiveCandidate: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/radar/candidates/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  promoteCandidate: (id: string) =>
    request<{
      customer: CustomerApiRecord;
      contact: { email: string | null; phone: string | null; name: string } | null;
      contactCreated: boolean;
      created: boolean;
      reachable: boolean;
    }>(`/radar/candidates/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    }),
  enrichCandidateContacts: (id: string) =>
    request<{
      contacts: RadarCandidateApiRecord["contacts"];
      discovered: number;
      pagesScanned: number;
      errors: string[];
      message: string;
    }>(`/radar/candidates/${encodeURIComponent(id)}/enrich-contacts`, {
      method: "POST",
    }),
  listQueue: (
    params: {
      taskId?: string;
      status?: RadarTaskStatus;
      page?: number;
      pageSize?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ListResponse<RadarQueueApiRecord>>(
      `/radar/queue${query.size ? `?${query}` : ""}`,
    );
  },
};

