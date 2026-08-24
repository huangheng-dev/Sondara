import { request } from "./core";
import type { AuthSession, AuthLoginResult, TwoFactorSetup, TwoFactorStatus } from "./types";

export const authApi = {
  login: (input: { email: string; password: string; remember: boolean }) =>
    request<AuthLoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  register: (input: { displayName: string; email: string; password: string }) =>
    request<AuthSession>("/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  session: () => request<AuthSession>("/auth/session"),
  forgotPassword: (email: string) => request<{ ok: boolean; delivery: "email" | "manual" | "accepted"; resetUrl?: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (input: { token: string; newPassword: string }) => request<{ ok: boolean }>("/auth/reset-password", { method: "POST", body: JSON.stringify(input) }),
  updateProfile: (input: { displayName: string; email: string; locale: "zh-CN" | "en"; timezone: string; currency: "CNY" | "EUR" | "USD"; businessName: string }) => request<AuthSession>("/auth/profile", { method: "PATCH", body: JSON.stringify(input) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listSessions: () => request<{ items: Array<{ id: string; current: boolean; userAgent: string | null; ipAddress: string | null; lastSeenAt: number | null; createdAt: number; expiresAt: number }> }>("/auth/sessions"),
  listWorkspaceMembers: () => request<{ items: Array<{ id: string; displayName: string; email: string; role: string }> }>("/auth/workspace-members"),
  revokeSession: (id: string) => request<void>(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeOtherSessions: () => request<{ removed: number }>("/auth/sessions", { method: "DELETE" }),
  deleteAccount: (input: { currentPassword: string; confirmation: "DELETE" }) => request<void>("/auth/account", { method: "DELETE", body: JSON.stringify(input) }),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  twoFactorStatus: () => request<TwoFactorStatus>("/auth/2fa/status"),
  setup2fa: () =>
    request<TwoFactorSetup | TwoFactorStatus>("/auth/2fa/setup", { method: "POST" }),
  enable2fa: (input: {
    currentPassword: string;
    secret: string;
    code: string;
  }) =>
    request<{
      enabled: true;
      verifiedAt: number;
      recoveryCodes: string[];
    }>("/auth/2fa/enable", { method: "POST", body: JSON.stringify(input) }),
  disable2fa: (input: { currentPassword: string; code: string }) =>
    request<{ enabled: boolean }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  verify2fa: (input: { code: string; remember: boolean }) =>
    request<AuthSession & { usedRecovery?: boolean }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
