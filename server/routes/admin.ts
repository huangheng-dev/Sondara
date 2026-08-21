import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../db/client.js";
import { auditLogs, sessions, users, workspaceInvitations, workspaceMembers } from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { hashPassword } from "../lib/password.js";
import { hashSessionToken } from "../lib/session.js";
import { config } from "../config.js";
import { requireAdmin } from "../plugins/auth.js";

const roles = ["owner", "admin", "member", "viewer"] as const;
const roleLabels: Record<(typeof roles)[number], string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  viewer: "只读成员",
};
const rolePermissions: Record<(typeof roles)[number], string[]> = {
  owner: ["系统配置", "用户与权限", "全部业务数据", "导入与导出"],
  admin: ["用户管理", "业务配置", "全部业务数据", "导入与导出"],
  member: ["客户与商机", "内容与活动", "客户消息", "转化分析"],
  viewer: ["查看客户", "查看活动", "查看分析", "不可编辑"],
};

const audit = async (
  workspaceId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  ipAddress: string,
  metadata: Record<string, unknown> = {},
) => (await db.insert(auditLogs).values({
      id: createId("aud"), workspaceId, actorUserId, action,
      entityType: "workspace_member", entityId,
      metadata: JSON.stringify(metadata), ipAddress, createdAt: Date.now(),
    }));

const memberView = async (workspaceId: string) => Promise.all((await db.select({
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  status: users.status,
  role: workspaceMembers.role,
  joinedAt: workspaceMembers.createdAt,
  createdAt: users.createdAt,
}).from(workspaceMembers)
  .innerJoin(users, eq(users.id, workspaceMembers.userId))
  .where(eq(workspaceMembers.workspaceId, workspaceId)))
  .map(async item => {
    const lastSeenAt = (await db.$first(db.select({ value: sql<number>`max(${sessions.lastSeenAt})` })
          .from(sessions).where(eq(sessions.userId, item.id))))?.value ?? null;
    const role = roles.includes(item.role as (typeof roles)[number]) ? item.role as (typeof roles)[number] : "member";
    return {
      ...item,
      role,
      roleLabel: roleLabels[role],
      status: item.status === "active" ? "active" : "disabled",
      lastSeenAt,
      source: item.joinedAt === item.createdAt ? "首次部署或自主注册" : "管理员创建",
    };
  }));

export const adminRoutes: FastifyPluginAsync = async app => {
  app.addHook("preHandler", requireAdmin);

  app.get("/members", async request => ({ items: (await memberView(request.auth.workspaceId)) }));

  app.get("/invitations", async request => ({ items: await db.select({ id: workspaceInvitations.id, email: workspaceInvitations.email, displayName: workspaceInvitations.displayName, role: workspaceInvitations.role, expiresAt: workspaceInvitations.expiresAt, acceptedAt: workspaceInvitations.acceptedAt, revokedAt: workspaceInvitations.revokedAt, createdAt: workspaceInvitations.createdAt }).from(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, request.auth.workspaceId)).orderBy(desc(workspaceInvitations.createdAt)).limit(100) }));

  app.post("/invitations", async (request, reply) => {
    const parsed = z.object({ displayName: z.string().trim().min(2).max(50), email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "member", "viewer"]).default("member") }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    if (parsed.data.role === "admin" && request.auth.role !== "owner") return reply.code(403).send({ error: "FORBIDDEN", message: "只有所有者可以邀请管理员。" });
    if (await db.$first(db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)))) return reply.code(409).send({ error: "EMAIL_EXISTS", message: "该邮箱已有账户。" });
    const pending = await db.$first(db.select({ id: workspaceInvitations.id }).from(workspaceInvitations).where(and(eq(workspaceInvitations.workspaceId, request.auth.workspaceId), eq(workspaceInvitations.email, parsed.data.email), sql`${workspaceInvitations.acceptedAt} is null`, sql`${workspaceInvitations.revokedAt} is null`, sql`${workspaceInvitations.expiresAt} > ${Date.now()}`)));
    if (pending) return reply.code(409).send({ error: "INVITE_EXISTS", message: "该邮箱已有未过期邀请。" });
    const token = randomBytes(32).toString("base64url"); const now = Date.now(); const id = createId("inv");
    await db.insert(workspaceInvitations).values({ id, workspaceId: request.auth.workspaceId, email: parsed.data.email, displayName: parsed.data.displayName, role: parsed.data.role, tokenHash: hashSessionToken(token), invitedByUserId: request.auth.userId, expiresAt: now + 7 * 24 * 60 * 60_000, createdAt: now });
    await audit(request.auth.workspaceId, request.auth.userId, "member.invited", id, request.ip, { email: parsed.data.email, role: parsed.data.role });
    return reply.code(201).send({ id, email: parsed.data.email, role: parsed.data.role, inviteUrl: `${config.webOrigin.replace(/\/$/, "")}/register?invite=${encodeURIComponent(token)}`, expiresAt: now + 7 * 24 * 60 * 60_000 });
  });

  app.post("/invitations/:id/revoke", async (request, reply) => {
    const id = (request.params as { id: string }).id; const invitation = await db.$first(db.select({ id: workspaceInvitations.id, acceptedAt: workspaceInvitations.acceptedAt, revokedAt: workspaceInvitations.revokedAt }).from(workspaceInvitations).where(and(eq(workspaceInvitations.id, id), eq(workspaceInvitations.workspaceId, request.auth.workspaceId))));
    if (!invitation) return reply.code(404).send({ error: "NOT_FOUND", message: "邀请不存在。" });
    if (invitation.acceptedAt || invitation.revokedAt) return reply.code(409).send({ error: "INVITE_CLOSED", message: "邀请已经结束。" });
    await db.update(workspaceInvitations).set({ revokedAt: Date.now() }).where(eq(workspaceInvitations.id, id));
    await audit(request.auth.workspaceId, request.auth.userId, "member.invite_revoked", id, request.ip);
    return { ok: true };
  });

  app.post("/members", async (request, reply) => {
    const parsed = z.object({
      displayName: z.string().trim().min(2).max(50),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(128),
      role: z.enum(["admin", "member", "viewer"]).default("member"),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
    if (parsed.data.role === "admin" && request.auth.role !== "owner") {
      return reply.code(403).send({ error: "FORBIDDEN", message: "只有所有者可以创建管理员。" });
    }
    if ((await db.$first(db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email))))) {
      return reply.code(409).send({ error: "EMAIL_EXISTS", message: "该邮箱已有账户，请使用尚未注册的邮箱创建成员。" });
    }
    const now = Date.now();
    const userId = createId("usr");
    const passwordHash = await hashPassword(parsed.data.password);
    await db.transaction(async tx => {
            await tx.insert(users).values({
                      id: userId, email: parsed.data.email, passwordHash,
                      displayName: parsed.data.displayName, status: "active",
                      createdAt: now, updatedAt: now,
                    });
            await tx.insert(workspaceMembers).values({
                      workspaceId: request.auth.workspaceId, userId,
                      role: parsed.data.role, createdAt: now,
                    });
          });
    await audit(request.auth.workspaceId, request.auth.userId, "member.created", userId, request.ip, { role: parsed.data.role });
    return reply.code(201).send((await memberView(request.auth.workspaceId)).find(item => item.id === userId));
  });

  app.patch("/members/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = z.object({
      role: z.enum(["admin", "member", "viewer"]).optional(),
      status: z.enum(["active", "disabled"]).optional(),
    }).safeParse(request.body);
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: "INVALID_INPUT", message: "没有可更新的成员字段。" });
    const target = (await db.$first(db.select({ role: workspaceMembers.role, status: users.status })
          .from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, id)))));
    if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "成员不存在。" });
    if (target.role === "owner") return reply.code(409).send({ error: "OWNER_PROTECTED", message: "不能通过成员管理修改所有者。" });
    if ((target.role === "admin" || parsed.data.role === "admin") && request.auth.role !== "owner") {
      return reply.code(403).send({ error: "FORBIDDEN", message: "只有所有者可以管理管理员角色。" });
    }
    if (parsed.data.role) await db.update(workspaceMembers).set({ role: parsed.data.role })
          .where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, id)));
    if (parsed.data.status) {
      await db.update(users).set({ status: parsed.data.status, updatedAt: Date.now() }).where(eq(users.id, id));
      if (parsed.data.status === "disabled") await db.delete(sessions).where(eq(sessions.userId, id));
    }
    await audit(request.auth.workspaceId, request.auth.userId, "member.updated", id, request.ip, parsed.data);
    return (await memberView(request.auth.workspaceId)).find(item => item.id === id);
  });

  app.delete("/members/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const target = (await db.$first(db.select({ role: workspaceMembers.role }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, id)))));
    if (!target) return reply.code(404).send({ error: "NOT_FOUND", message: "成员不存在。" });
    if (target.role === "owner") return reply.code(409).send({ error: "OWNER_PROTECTED", message: "不能移除工作区所有者。" });
    if (target.role === "admin" && request.auth.role !== "owner") return reply.code(403).send({ error: "FORBIDDEN", message: "只有所有者可以移除管理员。" });
    await db.transaction(async tx => {
            await tx.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, id)));
            await tx.delete(sessions).where(eq(sessions.userId, id));
            const memberships = (await db.$first(tx.select({ count: sql<number>`count(*)` }).from(workspaceMembers).where(eq(workspaceMembers.userId, id))))?.count ?? 0;
            if (memberships === 0) await tx.delete(users).where(eq(users.id, id));
          });
    await audit(request.auth.workspaceId, request.auth.userId, "member.removed", id, request.ip);
    return reply.code(204).send();
  });

  app.get("/roles", async request => {
    const members = (await memberView(request.auth.workspaceId));
    return { items: roles.map(role => ({
      role, name: roleLabels[role], members: members.filter(item => item.role === role).length,
      permissions: rolePermissions[role],
      note: role === "owner" ? "拥有全部权限，可管理部署、数据和所有管理员。"
        : role === "admin" ? "管理用户与业务配置，但不能转移所有权。"
          : role === "member" ? "完成客户开发和营销工作，不能管理工作区成员。"
            : "查看业务数据和分析结果，不可新增、修改或导出。",
    })) };
  });

  app.get("/audit-logs", async request => {
    const items = (await db.select().from(auditLogs)
          .where(eq(auditLogs.workspaceId, request.auth.workspaceId))
          .orderBy(desc(auditLogs.createdAt)).limit(500));
    const names = new Map((await db.select({ id: users.id, name: users.displayName }).from(users)).map(item => [item.id, item.name]));
    return { items: items.map(item => ({
      id: item.id,
      actorUserId: item.actorUserId,
      actor: item.actorUserId ? names.get(item.actorUserId) ?? "已删除用户" : "系统",
      action: item.action,
      entityType: item.entityType,
      entityId: item.entityId,
      metadata: (() => { try { return JSON.parse(item.metadata) as Record<string, unknown>; } catch { return {}; } })(),
      ipAddress: item.ipAddress ?? "—",
      createdAt: item.createdAt,
      result: "success" as const,
    })) };
  });
};
