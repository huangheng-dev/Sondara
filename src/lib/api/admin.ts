import { request } from "./core";
import type { AdminMemberApiRecord, AdminRoleApiRecord, AdminAuditLogApiRecord, AdminInvitationApiRecord } from "./types";

export const adminApi = {
  listMembers: () => request<{ items: AdminMemberApiRecord[] }>("/admin/members"),
  createMember: (input: { displayName: string; email: string; password: string; role: "admin" | "member" | "viewer" }) =>
    request<AdminMemberApiRecord>("/admin/members", { method: "POST", body: JSON.stringify(input) }),
  updateMember: (id: string, input: { role?: "admin" | "member" | "viewer"; status?: "active" | "disabled" }) =>
    request<AdminMemberApiRecord>(`/admin/members/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  removeMember: (id: string) => request<void>(`/admin/members/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listRoles: () => request<{ items: AdminRoleApiRecord[] }>("/admin/roles"),
  listAuditLogs: () => request<{ items: AdminAuditLogApiRecord[] }>("/admin/audit-logs"),
  listInvitations: () => request<{ items: AdminInvitationApiRecord[] }>("/admin/invitations"),
  createInvitation: (input: { displayName: string; email: string; role: "admin" | "member" | "viewer" }) => request<AdminInvitationApiRecord>("/admin/invitations", { method: "POST", body: JSON.stringify(input) }),
  revokeInvitation: (id: string) => request<{ ok: boolean }>(`/admin/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
};
