import { request } from "./core";
import type { ApprovalApiRecord } from "./types";

export const approvalApi = {
  list: () => request<{ items: ApprovalApiRecord[] }>("/approvals"),
  create: (input: { entityType: string; entityId: string; action: string; note?: string }) => request<ApprovalApiRecord>("/approvals", { method: "POST", body: JSON.stringify(input) }),
  review: (id: string, input: { status: "approved" | "rejected" | "cancelled"; note?: string }) => request<ApprovalApiRecord>(`/approvals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
};
