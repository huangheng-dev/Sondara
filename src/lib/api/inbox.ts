import { request } from "./core";
import type { OutboxJobApiRecord, InboxReplySuggestionApiRecord, InboxThreadApiRecord, InboxMessageApiRecord } from "./types";

export const inboxApi = {
  listThreads: (
    params: {
      q?: string;
      channel?: string;
      filter?: "all" | "unread" | "high_intent" | "follow_up";
      cursor?: string;
      limit?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<{
      items: InboxThreadApiRecord[];
      total: number;
      unreadTotal: number;
      channels: string[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(`/inbox/threads${query.size ? `?${query}` : ""}`);
  },
  createThread: (input: {
    customerId?: string | null;
    campaignId?: string | null;
    subject?: string;
    channel?: string;
    intent?: InboxThreadApiRecord["intent"];
    initialMessage?: string;
    contact: {
      name: string;
      company: string;
      jobTitle?: string;
      region?: string;
      source?: string;
      primaryChannel?: string;
      email?: string | null;
      phone?: string | null;
    };
  }) =>
    request<InboxThreadApiRecord>("/inbox/threads", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listMessages: (
    threadId: string,
    params: { cursor?: string; limit?: number } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<{
      items: InboxMessageApiRecord[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(
      `/inbox/threads/${encodeURIComponent(threadId)}/messages${query.size ? `?${query}` : ""}`,
    );
  },
  markRead: (threadId: string) =>
    request<{ id: string; unreadCount: number; lastReadAt: number }>(
      `/inbox/threads/${encodeURIComponent(threadId)}/read`,
      { method: "POST" },
    ),
  markAllRead: () =>
    request<{ updated: number; unreadTotal: number }>(
      "/inbox/threads/read-all",
      { method: "POST" },
    ),
  replySuggestion: (threadId: string) =>
    request<InboxReplySuggestionApiRecord>(
      `/inbox/threads/${encodeURIComponent(threadId)}/reply-suggestion`,
      { method: "POST" },
    ),
  confirmReply: (threadId: string, body: string) =>
    request<{
      message: InboxMessageApiRecord;
      delivery: {
        mode: "outbox";
        status: OutboxJobApiRecord["status"];
        jobId: string;
        label: string;
      };
    }>(`/inbox/threads/${encodeURIComponent(threadId)}/replies/confirm`, {
      method: "POST",
      body: JSON.stringify({ body, confirmation: true }),
    }),
  updateThread: (
    threadId: string,
    input: {
      intent?: InboxThreadApiRecord["intent"];
      status?: InboxThreadApiRecord["status"];
    },
  ) =>
    request<InboxThreadApiRecord>(
      `/inbox/threads/${encodeURIComponent(threadId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
};
