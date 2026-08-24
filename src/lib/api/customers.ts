import { request } from "./core";
import type { CustomerApiRecord, CustomerApiInput, CustomerImportRow, CustomerImportResult, CustomerImportHistory, CustomerListResponse, InboxContactApiRecord } from "./types";

export const customerApi = {
  list: (
    params: {
      q?: string;
      region?: string;
      stage?: string;
      minScore?: number;
      includeArchived?: boolean;
      archivedOnly?: boolean;
      page?: number;
      pageSize?: number;
      sort?:
        | "updated_desc"
        | "updated_asc"
        | "score_desc"
        | "score_asc"
        | "company_asc";
    } = {},
  ) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<CustomerListResponse>(
      `/customers${query.size ? `?${query}` : ""}`,
    );
  },
  create: (input: CustomerApiInput) =>
    request<CustomerApiRecord>("/customers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  import: (input: { sourceName: string; sourceType: "行业目录" | "展会名单" | "历史客户" | "其他"; sourceUrl?: string; rows: CustomerImportRow[] }) =>
    request<CustomerImportResult>("/customers/import", { method: "POST", body: JSON.stringify(input) }),
  listImports: () => request<{ items: CustomerImportHistory[] }>("/customers/imports"),
  mergePreview: (primaryCustomerId: string, duplicateCustomerId: string) => request<{ primary: CustomerApiRecord; duplicate: CustomerApiRecord; contacts: { primary: number; duplicate: number; duplicateNames: string[] }; transfers: { tasks: number; deals: number; threads: number; campaignMembers: number } }>("/customers/merge-preview", { method: "POST", body: JSON.stringify({ primaryCustomerId, duplicateCustomerId }) }),
  merge: (primaryCustomerId: string, duplicateCustomerId: string) => request<{ primaryCustomerId: string; archivedCustomerId: string; transferredContacts: number }>("/customers/merge", { method: "POST", body: JSON.stringify({ primaryCustomerId, duplicateCustomerId }) }),
  mergeSuggestions: () => request<{
    items: Array<{
      primaryId: string; duplicateId: string;
      primaryCompany: string; duplicateCompany: string;
      reasons: string[]; confidence: "high" | "medium" | "low";
    }>;
    scanned: number;
  }>("/customers/merge-suggestions"),
  update: (id: string, input: Partial<CustomerApiInput>) =>
    request<CustomerApiRecord>(`/customers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/customers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  archive: (id: string, archived = true) => request<{ id: string; archivedAt: number | null }>(`/customers/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  addTags: (customerIds: string[], name: string, color: "blue" | "green" | "orange" | "gray") =>
    request<{ updated: number }>("/customers/tags/bulk", { method: "POST", body: JSON.stringify({ customerIds, name, color }) }),
  listContacts: (customerId: string, params?: { verificationStatus?: "verified" | "unverified" | "invalid" | "all" }) => {
    const query = new URLSearchParams();
    if (params?.verificationStatus && params.verificationStatus !== "all") query.set("verificationStatus", params.verificationStatus);
    return request<{ items: InboxContactApiRecord[] }>(`/customers/${encodeURIComponent(customerId)}/contacts${query.size ? `?${query}` : ""}`);
  },
  addContact: (customerId: string, input: { name: string; jobTitle?: string; email?: string | null; phone?: string | null; primaryChannel?: string }) =>
    request<InboxContactApiRecord>(`/customers/${encodeURIComponent(customerId)}/contacts`, { method: "POST", body: JSON.stringify(input) }),
  setWhatsappOptIn: (customerId: string, contactId: string, optedIn: boolean, source = "人工确认") => request<InboxContactApiRecord>(`/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}/whatsapp-opt-in`, { method: "POST", body: JSON.stringify({ optedIn, source }) }),
  verifyContact: (customerId: string, contactId: string, status: "verified" | "unverified" | "invalid", source = "人工确认") =>
    request<InboxContactApiRecord>(`/customers/${encodeURIComponent(customerId)}/contacts/${encodeURIComponent(contactId)}/verify`, { method: "POST", body: JSON.stringify({ status, source }) }),
  scoreOverride: (customerId: string, scoreOverride: number | null, reason?: string) =>
    request<CustomerApiRecord>(`/customers/${encodeURIComponent(customerId)}/score-override`, { method: "POST", body: JSON.stringify({ scoreOverride, reason }) }),
  changeStage: (customerId: string, stage: string, nextAction?: string, reason?: string) =>
    request<CustomerApiRecord>(`/customers/${encodeURIComponent(customerId)}/stage`, { method: "POST", body: JSON.stringify({ stage, nextAction, reason }) }),
};
