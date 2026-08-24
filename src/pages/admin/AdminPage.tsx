import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "antd";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronRight, Copy, Download,
  FileClock, MoreHorizontal, Plus, RefreshCw, ShieldCheck, UserCheck,
  UserCog, UsersRound, X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { CreateDialog } from "@/components/ui/CreateDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { SearchInput } from "@/components/ui/SearchInput";
import { usePagination } from "@/hooks/usePagination";
import { useUiStore } from "@/stores/ui-store";
import { downloadCsv } from "@/utils/download";
import { adminApi, approvalApi, type AdminAuditLogApiRecord, type AdminInvitationApiRecord, type AdminMemberApiRecord, type AdminRoleApiRecord, type ApprovalApiRecord } from "@/lib/api";

type AdminSection = "users" | "roles" | "audit-logs" | "approvals";
const sectionMeta = {
  users: { label: "用户与成员", description: "管理当前工作区的真实成员、角色和访问状态", icon: UsersRound },
  roles: { label: "角色与权限", description: "查看服务端实际执行的角色权限边界", icon: ShieldCheck },
  "audit-logs": { label: "操作记录", description: "追踪当前工作区的真实关键业务变更", icon: FileClock },
  approvals: { label: "审批中心", description: "集中处理团队成员提交的业务审批请求", icon: CheckCircle2 },
} satisfies Record<AdminSection, { label: string; description: string; icon: typeof UsersRound }>;

const roleValue: Record<string, "admin" | "member" | "viewer"> = { 管理员: "admin", 成员: "member", 只读成员: "viewer" };
const statusLabel = (value: AdminMemberApiRecord["status"]) => value === "active" ? "正常" : "已停用";
const formatDate = (value: number | null, includeTime = false) => value
  ? new Intl.DateTimeFormat("zh-CN", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(value)
  : "尚未登录";
const statusTone = (status: string) => status === "正常" || status === "成功" ? "green" : status === "待验证" ? "orange" : status === "失败" ? "red" : "neutral";
const sortIcon = (active: boolean, descending = false) => <span aria-hidden="true">{active ? descending ? <ArrowDown/> : <ArrowUp/> : <ArrowUpDown/>}</span>;
const auditActionLabel = (action: string) => ({
  "member.created": "创建工作区成员", "member.updated": "更新成员权限", "member.removed": "移除工作区成员",
  "member.invited": "发出成员邀请", "member.invite_revoked": "撤销成员邀请",
  "approval.requested": "提交审批请求", "approval.approved": "批准审批请求", "approval.rejected": "驳回审批请求",
  "customer.archived": "归档客户", "customer.unarchived": "恢复客户", "task.archived": "归档任务", "deal.archived": "归档商机",
  "customer.created": "创建客户", "customer.updated": "更新客户", "customer.deleted": "删除客户", "customer.imported": "批量导入客户",
  "radar.task.created": "创建获客任务", "radar.candidate.promoted": "候选保存为客户",
  "ai.service.created": "添加 AI 服务", "ai.service.updated": "更新 AI 服务", "ai.key.created": "添加 AI 密钥",
  "integration.created": "添加数据源", "integration.updated": "更新数据源", "data.export": "导出工作区数据", "data.backup": "创建数据库备份",
}[action] ?? action);
const auditType = (action: string) => action.startsWith("member.") ? "用户管理" : action.startsWith("ai.") || action.startsWith("integration.") ? "系统设置" : action.startsWith("data.") ? "数据操作" : "业务操作";

export function AdminPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const showToast = useUiStore(state => state.showToast);
  const section = (Object.hasOwn(sectionMeta, params.section ?? "") ? params.section : "users") as AdminSection;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部状态");
  const [sort, setSort] = useState("最近活动");
  const [memberDialog, setMemberDialog] = useState(false);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [inviteResult, setInviteResult] = useState<AdminInvitationApiRecord | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminMemberApiRecord | null>(null);
  const [selectedRole, setSelectedRole] = useState<AdminRoleApiRecord | null>(null);
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogApiRecord | null>(null);
  const membersQuery = useQuery({ queryKey: ["admin-members"], queryFn: adminApi.listMembers, retry: 1 });
  const rolesQuery = useQuery({ queryKey: ["admin-roles"], queryFn: adminApi.listRoles, retry: 1 });
  const logsQuery = useQuery({ queryKey: ["admin-audit-logs"], queryFn: adminApi.listAuditLogs, retry: 1 });
  const approvalsQuery = useQuery({ queryKey: ["approvals"], queryFn: approvalApi.list, retry: 1, enabled: section === "approvals" });
  const invitationsQuery = useQuery({ queryKey: ["admin-invitations"], queryFn: adminApi.listInvitations, retry: 1, enabled: section === "users" });
  const meta = sectionMeta[section];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: section === "users" ? ["admin-members"] : section === "roles" ? ["admin-roles"] : section === "approvals" ? ["approvals"] : ["admin-audit-logs"] });
    showToast(`${meta.label}已刷新`);
  };
  const updateUser = async (user: AdminMemberApiRecord, changes: { role?: "admin" | "member" | "viewer"; status?: "active" | "disabled" }, message: string) => {
    try {
      const next = await adminApi.updateMember(user.id, changes);
      setSelectedUser(next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-members"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] }),
      ]);
      showToast(message);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : "成员更新失败"); }
  };
  return <div>
    <PageHeader title={meta.label} description={`管理中心 · ${meta.description}`} actions={section === "users" ? <><Button onClick={() => setInviteDialog(true)}><UsersRound size={16}/>邀请成员</Button><Button variant="primary" onClick={() => setMemberDialog(true)}><Plus size={16}/>直接创建</Button></> : undefined}/>
    <section><div>
      {section === "users" && <UsersSection items={membersQuery.data?.items ?? []} loading={membersQuery.isLoading} error={membersQuery.error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} onRefresh={refresh} onOpen={setSelectedUser}/>}
      {section === "users" && <InvitationsSection items={invitationsQuery.data?.items ?? []} loading={invitationsQuery.isLoading} onRevoke={async id => { try { await adminApi.revokeInvitation(id); await queryClient.invalidateQueries({ queryKey: ["admin-invitations"] }); showToast("邀请已撤销"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "撤销邀请失败"); } }}/>}
      {section === "roles" && <RolesSection items={rolesQuery.data?.items ?? []} loading={rolesQuery.isLoading} error={rolesQuery.error} onRefresh={refresh} onOpen={setSelectedRole}/>}
      {section === "audit-logs" && <AuditSection items={logsQuery.data?.items ?? []} loading={logsQuery.isLoading} error={logsQuery.error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} onRefresh={refresh} onOpen={setSelectedLog}/>}
      {section === "approvals" && (
        <ApprovalsSection items={approvalsQuery.data?.items ?? []} loading={approvalsQuery.isLoading} error={approvalsQuery.error} onRefresh={refresh} onReview={async (id, status) => { try { await approvalApi.review(id, { status }); await queryClient.invalidateQueries({ queryKey: ["approvals"] }); showToast(status === "approved" ? "审批已通过" : "审批已处理"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "审批操作失败"); } }}/>
      )}
    </div></section>

    <CreateDialog open={memberDialog} title="添加工作区成员" description="创建成员账户后，对方可直接使用设置的邮箱和临时密码登录当前工作区。" submitLabel="创建成员" successMessage="成员账户已创建" onClose={() => setMemberDialog(false)} onSubmit={async values => {
      await adminApi.createMember({ displayName: values.displayName, email: values.email, password: values.password, role: roleValue[values.role] ?? "member" });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-members"] }), queryClient.invalidateQueries({ queryKey: ["admin-roles"] }), queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })]);
    }} fields={[{ name: "displayName", label: "显示名称", required: true }, { name: "email", label: "登录邮箱", type: "email", required: true }, { name: "password", label: "临时密码", type: "password", required: true, placeholder: "至少 8 位" }, { name: "role", label: "成员角色", type: "select", required: true, options: ["成员", "只读成员", "管理员"] }]}/>
    <CreateDialog open={inviteDialog} title="邀请工作区成员" description="系统会生成 7 天有效的注册链接；复制后通过你现有的邮件、WhatsApp 或其他渠道发送给对方。" submitLabel="生成邀请链接" successMessage="邀请链接已生成" onClose={() => setInviteDialog(false)} onSubmit={async values => { const invite = await adminApi.createInvitation({ displayName: values.displayName, email: values.email, role: roleValue[values.role] ?? "member" }); setInviteResult(invite); await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-invitations"] }), queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })]); }} fields={[{ name: "displayName", label: "显示名称", required: true }, { name: "email", label: "邀请邮箱", type: "email", required: true }, { name: "role", label: "成员角色", type: "select", required: true, options: ["成员", "只读成员", "管理员"] }]}/>
    <Modal open={Boolean(inviteResult)} title="邀请链接已生成" description={`${inviteResult?.email ?? ""} · 有效期至 ${inviteResult ? formatDate(inviteResult.expiresAt, true) : ""}`} onClose={() => setInviteResult(null)} footer={<><Button onClick={() => setInviteResult(null)}>关闭</Button><Button variant="primary" onClick={async () => { if (inviteResult?.inviteUrl) await navigator.clipboard.writeText(inviteResult.inviteUrl); showToast("邀请链接已复制"); }}><Copy/>复制链接</Button></>}><div><div><small>注册链接</small><strong style={{ wordBreak: "break-all" }}>{inviteResult?.inviteUrl}</strong></div><div><small>说明</small><strong>请仅发送给受邀人员；链接使用一次后自动失效。</strong></div></div></Modal>

    <Modal open={Boolean(selectedUser)} title={selectedUser?.displayName ?? "用户详情"} description={selectedUser?.email} onClose={() => setSelectedUser(null)} footer={selectedUser && <><Button onClick={() => setSelectedUser(null)}>关闭</Button>{selectedUser.role !== "owner" && <Button variant={selectedUser.status === "disabled" ? "primary" : "danger"} onClick={() => updateUser(selectedUser, { status: selectedUser.status === "disabled" ? "active" : "disabled" }, selectedUser.status === "disabled" ? "用户已恢复访问" : "用户已停用")}>{selectedUser.status === "disabled" ? "恢复访问" : "停用账户"}</Button>}</>}>
      {selectedUser && <div><div><i>{selectedUser.displayName.slice(0, 1)}</i><span><strong>{selectedUser.displayName}</strong><small>{selectedUser.email}</small></span><Badge tone={statusTone(statusLabel(selectedUser.status))}>{statusLabel(selectedUser.status)}</Badge></div><div><label><span>用户角色</span><CustomSelect ariaLabel="用户角色" value={selectedUser.roleLabel} disabled={selectedUser.role === "owner"} options={["管理员", "成员", "只读成员"]} onChange={label => updateUser(selectedUser, { role: roleValue[label] }, `已将角色修改为${label}`)}/></label>{[["加入方式", selectedUser.source], ["加入日期", formatDate(selectedUser.joinedAt)], ["最近活动", formatDate(selectedUser.lastSeenAt, true)], ["用户编号", selectedUser.id]].map(item => <div key={item[0]}><small>{item[0]}</small><strong>{item[1]}</strong></div>)}</div></div>}
    </Modal>
    <Modal open={Boolean(selectedRole)} title={selectedRole?.name ?? "角色详情"} description={selectedRole?.note} onClose={() => setSelectedRole(null)} footer={<Button onClick={() => setSelectedRole(null)}>完成</Button>}><div>{selectedRole?.permissions.map(permission => <article key={permission}><i><CheckCircle2/></i><span><strong>{permission}</strong><small>由服务端角色校验强制执行</small></span></article>)}</div></Modal>
    <Modal open={Boolean(selectedLog)} title="审计记录详情" description={selectedLog ? formatDate(selectedLog.createdAt, true) : ""} onClose={() => setSelectedLog(null)} footer={<Button onClick={() => setSelectedLog(null)}>关闭</Button>}><div>{selectedLog && [["操作人", selectedLog.actor], ["操作", auditActionLabel(selectedLog.action)], ["对象", `${selectedLog.entityType} · ${selectedLog.entityId ?? "—"}`], ["类别", auditType(selectedLog.action)], ["结果", "成功"], ["IP 地址", selectedLog.ipAddress], ["记录编号", selectedLog.id]].map(item => <div key={item[0]}><small>{item[0]}</small><strong>{item[1]}</strong></div>)}</div></Modal>
  </div>;
}

function Toolbar({ query, setQuery, filter, setFilter, options, sort, setSort, sortOptions, defaultSort, label, selectedCount, unit, onClear, actions, onRefresh, refreshing }: { query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; options: string[]; sort: string; setSort: (value: string) => void; sortOptions: string[]; defaultSort: string; label: string; selectedCount: number; unit: string; onClear: () => void; actions?: ReactNode; onRefresh: () => void; refreshing?: boolean }) {
  return <div><div><SearchInput ariaLabel={`搜索${label}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${label}`}/><CustomSelect ariaLabel={`筛选${label}`} value={filter} onChange={setFilter} options={options}/><CustomSelect ariaLabel={`${label}排序`} value={sort} onChange={setSort} options={sortOptions}/><Button onClick={onRefresh} disabled={refreshing}><RefreshCw className="is-spinning"/>刷新</Button><Button disabled={!query && filter === options[0] && sort === defaultSort} onClick={() => { setQuery(""); setFilter(options[0]); setSort(defaultSort); }}>清除筛选</Button></div><div aria-hidden={selectedCount === 0}><span><CheckCircle2/><small>已选择</small><strong>{selectedCount}</strong><small>{unit}</small></span><div>{actions}<Button aria-label="取消选择" title="取消选择" onClick={onClear}><X/></Button></div></div></div>;
}

function UsersSection({ items, loading, error, query, setQuery, filter, setFilter, sort, setSort, onRefresh, onOpen }: { items: AdminMemberApiRecord[]; loading: boolean; error: Error | null; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; onRefresh: () => void; onOpen: (value: AdminMemberApiRecord) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter(item => (!query || `${item.displayName}${item.email}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部状态" || statusLabel(item.status) === filter)).sort((a, b) => sort === "姓名 A–Z" ? a.displayName.localeCompare(b.displayName, "zh-CN") : sort === "姓名 Z–A" ? b.displayName.localeCompare(a.displayName, "zh-CN") : sort === "加入最早" ? a.joinedAt - b.joinedAt : sort === "加入最新" ? b.joinedAt - a.joinedAt : (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)), [items, query, filter, sort]);
  const paging = usePagination(rows, 6, `${query}|${filter}|${sort}`);
  if (loading) return <EmptyState title="正在读取工作区成员" icon={RefreshCw} spinning/>;
  if (error) return <EmptyState title="成员数据加载失败" description={error.message} icon={UsersRound} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部状态", "正常", "已停用"]} sort={sort} setSort={setSort} sortOptions={["最近活动", "姓名 A–Z", "姓名 Z–A", "加入最新", "加入最早"]} defaultSort="最近活动" label="姓名或邮箱" selectedCount={selected.size} unit="位" onClear={() => setSelected(new Set())} onRefresh={onRefresh} actions={<Button onClick={() => downloadCsv("sondara-selected-users.csv", [["姓名", "邮箱", "角色", "状态", "最近活动"], ...rows.filter(item => selected.has(item.id)).map(item => [item.displayName, item.email, item.roleLabel, statusLabel(item.status), formatDate(item.lastSeenAt, true)])])}><Download/>导出所选</Button>}/><DataTable columns={[{ key: "select", title: <Checkbox aria-label="选择本页全部用户" checked={paging.pageItems.length > 0 && paging.pageItems.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); paging.pageItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })}/>, width: 52 }, { key: "user", title: <Button onClick={() => setSort(sort === "姓名 A–Z" ? "姓名 Z–A" : "姓名 A–Z")}>用户档案{sortIcon(sort.startsWith("姓名"), sort === "姓名 Z–A")}</Button> }, { key: "role", title: "角色" }, { key: "status", title: "状态" }, { key: "activity", title: "最近活动" }, { key: "joined", title: "加入信息" }, { key: "actions", title: "操作", width: 72 }]} rows={paging.pageItems.map(item => ({ key: item.id, className: selected.has(item.id) ? "selected" : "", cells: [<Checkbox aria-label={`选择 ${item.displayName}`} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/>, <Button onClick={() => onOpen(item)}><i>{item.displayName.slice(0, 1)}</i><span><strong>{item.displayName}</strong><small>{item.email}</small><em><UserCheck/>{item.id}</em></span></Button>, <Badge tone={item.role === "owner" ? "blue" : item.role === "admin" ? "green" : "neutral"}>{item.roleLabel}</Badge>, <Badge tone={statusTone(statusLabel(item.status))}>{statusLabel(item.status)}</Badge>, <div><strong>{formatDate(item.lastSeenAt, true)}</strong><small>最近访问</small></div>, <div><strong>{formatDate(item.joinedAt)}</strong><small>{item.source}</small></div>, <Button aria-label={`管理 ${item.displayName}`} onClick={() => onOpen(item)}><MoreHorizontal/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="位用户"/></>;
}

function InvitationsSection({ items, loading, onRevoke }: { items: AdminInvitationApiRecord[]; loading: boolean; onRevoke: (id: string) => Promise<void> }) {
  const pending = items.filter(item => !item.acceptedAt && !item.revokedAt && item.expiresAt > Date.now());
  return (
    <Panel title="待接受邀请" subtitle="邀请链接不会自动发送；复制链接并通过你的既有沟通渠道发送即可。">
      {loading ? <EmptyState title="正在读取邀请记录" icon={RefreshCw} spinning/> : pending.length ? <div>{pending.map(item => <article key={item.id}><i><UsersRound/></i><span><strong>{item.displayName || item.email}</strong><small>{item.email} · {item.role === "admin" ? "管理员" : item.role === "viewer" ? "只读成员" : "成员"} · 截止 {formatDate(item.expiresAt, true)}</small></span><Button size="sm" variant="danger" onClick={() => onRevoke(item.id)}>撤销</Button></article>)}</div> : <EmptyState title="暂无待接受邀请" description="生成邀请链接后会显示在这里。" icon={UsersRound}/>}
    </Panel>
  );
}

function RolesSection({ items, loading, error, onRefresh, onOpen }: { items: AdminRoleApiRecord[]; loading: boolean; error: Error | null; onRefresh: () => void; onOpen: (value: AdminRoleApiRecord) => void }) {
  if (loading) return <EmptyState title="正在读取角色权限" icon={RefreshCw} spinning/>;
  if (error) return <EmptyState title="角色权限加载失败" description={error.message} icon={ShieldCheck} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><div><Button onClick={onRefresh}><RefreshCw size={14}/>刷新权限</Button></div><DataTable columns={[{ key: "role", title: "角色" }, { key: "members", title: "成员" }, { key: "note", title: "角色说明" }, { key: "permissions", title: "权限范围" }, { key: "actions", title: "操作", width: 72 }]} rows={items.map(item => ({ key: item.role, cells: [<Button onClick={() => onOpen(item)}><i><UserCog/></i><span><strong>{item.name}</strong><small>服务端固定角色</small><em><ShieldCheck/>权限已强制执行</em></span></Button>, <div><strong>{item.members}</strong><small>位用户</small></div>, <span>{item.note}</span>, <div>{item.permissions.slice(0, 3).map(permission => <span key={permission}>{permission}</span>)}</div>, <div><Button aria-label={`查看 ${item.name} 权限`} title="查看权限" onClick={() => onOpen(item)}><ChevronRight/></Button></div>] }))}/></>;
}

function AuditSection({ items, loading, error, query, setQuery, filter, setFilter, sort, setSort, onRefresh, onOpen }: { items: AdminAuditLogApiRecord[]; loading: boolean; error: Error | null; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; onRefresh: () => void; onOpen: (value: AdminAuditLogApiRecord) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter(item => (!query || `${item.actor}${item.action}${item.entityId ?? ""}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部类型" || auditType(item.action) === filter)).sort((a, b) => sort === "时间最早" ? a.createdAt - b.createdAt : sort === "操作人 A–Z" ? a.actor.localeCompare(b.actor, "zh-CN") : b.createdAt - a.createdAt), [items, query, filter, sort]);
  const paging = usePagination(rows, 6, `${query}|${filter}|${sort}`);
  if (loading) return <EmptyState title="正在读取审计记录" icon={RefreshCw} spinning/>;
  if (error) return <EmptyState title="审计记录加载失败" description={error.message} icon={FileClock} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部类型", "用户管理", "系统设置", "数据操作", "业务操作"]} sort={sort} setSort={setSort} sortOptions={["时间最新", "时间最早", "操作人 A–Z"]} defaultSort="时间最新" label="操作记录" selectedCount={selected.size} unit="条" onClear={() => setSelected(new Set())} onRefresh={onRefresh} actions={<Button onClick={() => downloadCsv("sondara-selected-audit-logs.csv", [["时间", "操作人", "操作", "对象", "类别", "结果", "IP"], ...rows.filter(item => selected.has(item.id)).map(item => [formatDate(item.createdAt, true), item.actor, auditActionLabel(item.action), item.entityId ?? "—", auditType(item.action), "成功", item.ipAddress])])}><Download/>导出所选</Button>}/><DataTable columns={[{ key: "select", title: <Checkbox aria-label="选择本页全部记录" checked={paging.pageItems.length > 0 && paging.pageItems.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); paging.pageItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })}/>, width: 52 }, { key: "time", title: "时间" }, { key: "actor", title: "操作人" }, { key: "action", title: "操作与对象" }, { key: "type", title: "类别" }, { key: "result", title: "结果" }, { key: "details", title: "详情", width: 72 }]} rows={paging.pageItems.map(item => ({ key: item.id, className: selected.has(item.id) ? "selected" : "", cells: [<Checkbox aria-label={`选择 ${item.id}`} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/>, <div><strong>{formatDate(item.createdAt, true)}</strong><small>{item.ipAddress}</small></div>, <div><i>{item.actor.slice(0, 1)}</i><span><strong>{item.actor}</strong><small>{item.actorUserId ?? "system"}</small></span></div>, <div><strong>{auditActionLabel(item.action)}</strong><small>{item.entityType} · {item.entityId ?? "—"}</small></div>, <Badge tone="blue">{auditType(item.action)}</Badge>, <Badge tone="green">成功</Badge>, <Button aria-label={`查看审计详情 ${item.id}`} onClick={() => onOpen(item)}><ChevronRight/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="条记录"/></>;
}

function ApprovalsSection({ items, loading, error, onRefresh, onReview }: { items: ApprovalApiRecord[]; loading: boolean; error: Error | null; onRefresh: () => void; onReview: (id: string, status: 'approved' | 'rejected') => Promise<void> }) {
  if (loading) return <EmptyState title="正在读取审批请求" icon={RefreshCw} spinning/>;
  if (error) return <EmptyState title="审批请求加载失败" description={error.message} icon={CheckCircle2} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><div><Button onClick={onRefresh}><RefreshCw size={14}/>刷新审批</Button></div><DataTable columns={[{ key: 'request', title: '请求' }, { key: 'requester', title: '申请人' }, { key: 'status', title: '状态' }, { key: 'time', title: '提交时间' }, { key: 'actions', title: '操作' }]} rows={items.map(item => ({ key: item.id, cells: [<div><strong>{item.action}</strong><small>{item.entityType} · {item.entityId}</small></div>, <span>{item.requester ?? item.requestedByUserId}</span>, <Badge tone={item.status === 'pending' ? 'orange' : item.status === 'approved' ? 'green' : 'neutral'}>{item.status === 'pending' ? '待审批' : item.status === 'approved' ? '已通过' : item.status === 'rejected' ? '已驳回' : '已取消'}</Badge>, <span>{formatDate(item.createdAt, true)}</span>, item.status === 'pending' ? <div><Button variant="primary" onClick={() => void onReview(item.id, 'approved')}>通过</Button><Button variant="danger" onClick={() => void onReview(item.id, 'rejected')}>驳回</Button></div> : <span>—</span>] }))}/></>;
}
