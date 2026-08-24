import { request , type ListResponse } from "./core";
import type { TaskApiRecord, TaskApiInput } from "./types";

export const taskApi = {
  list: (
    params: {
      q?: string;
      status?: "open" | "completed";
      page?: number;
      pageSize?: number;
      sort?: "created_desc" | "due_asc" | "priority_desc";
      includeArchived?: boolean;
      archivedOnly?: boolean;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    return request<ListResponse<TaskApiRecord>>(
      `/tasks${query.size ? `?${query}` : ""}`,
    );
  },
  create: (input: TaskApiInput) =>
    request<TaskApiRecord>("/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: Partial<TaskApiInput> & { status?: "open" | "completed" },
  ) =>
    request<TaskApiRecord>(`/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  archive: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/tasks/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
};

