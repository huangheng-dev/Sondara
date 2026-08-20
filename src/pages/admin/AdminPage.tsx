import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "antd";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronRight, Download,
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
import { SearchInput } from "@/components/ui/SearchInput";
import { usePagination } from "@/hooks/usePagination";
import { useUiStore } from "@/stores/ui-store";
import { downloadCsv } from "@/utils/download";
import { adminApi, type AdminAuditLogApiRecord, type AdminMemberApiRecord, type AdminRoleApiRecord } from "@/lib/api";

type AdminSection = "users" | "roles" | "audit-logs";
const sectionMeta = {
  users: { label: "用户与成员", description: "管理当前工作区的真实成员、角色和访问状态", icon: UsersRound },
  roles: { label: "角色与权限", description: "查看服务端实际执行的角色权限边界", icon: ShieldCheck },
  "audit-logs": { label: "操作记录", description: "追踪当前工作区的真实关键业务变更", icon: FileClock },
} satisfies Record<AdminSection, { label: string; description: string; icon: typeof UsersRound }>;

const roleValue: Record<string, "admin" | "member" | "viewer"> = { 管理员: "admin", 成员: "member", 只读成员: "viewer" };
const statusLabel = (value: AdminMemberApiRecord["status"]) => value === "active" ? "正常" : "已停用";
const formatDate = (value: number | null, includeTime = false) => value
  ? new Intl.DateTimeFormat("zh-CN", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(value)
  : "尚未登录";
const statusTone = (status: string) => status === "正常" || status === "成功" ? "green" : status === "待验证" ? "orange" : status === "失败" ? "red" : "neutral";
const sortIcon = (active: boolean, descending = false) => <span className="customer-sort-icon" aria-hidden="true">{active ? descending ? <ArrowDown/> : <ArrowUp/> : <ArrowUpDown/>}</span>;
const auditActionLabel = (action: string) => ({
  "member.created": "创建工作区成员", "member.updated": "更新成员权限", "member.removed": "移除工作区成员",
  "customer.created": "创建客户", "customer.updated": "更新客户", "customer.deleted": "删除客户",
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
  const [selectedUser, setSelectedUser] = useState<AdminMemberApiRecord | null>(null);
  const [selectedRole, setSelectedRole] = useState<AdminRoleApiRecord | null>(null);
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogApiRecord | null>(null);
  const membersQuery = useQuery({ queryKey: ["admin-members"], queryFn: adminApi.listMembers, retry: 1 });
  const rolesQuery = useQuery({ queryKey: ["admin-roles"], queryFn: adminApi.listRoles, retry: 1 });
  const logsQuery = useQuery({ queryKey: ["admin-audit-logs"], queryFn: adminApi.listAuditLogs, retry: 1 });
  const meta = sectionMeta[section];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: section === "users" ? ["admin-members"] : section === "roles" ? ["admin-roles"] : ["admin-audit-logs"] });
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
  return <div className="page-content admin-page">
    <PageHeader title={meta.label} description={`管理中心 · ${meta.description}`} actions={section === "users" ? <Button variant="primary" onClick={() => setMemberDialog(true)}><Plus/>添加成员</Button> : undefined}/>
    <section className="admin-workspace"><div className="admin-main">
      {section === "users" && <UsersSection items={membersQuery.data?.items ?? []} loading={membersQuery.isLoading} error={membersQuery.error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} onRefresh={refresh} onOpen={setSelectedUser}/>}
      {section === "roles" && <RolesSection items={rolesQuery.data?.items ?? []} loading={rolesQuery.isLoading} error={rolesQuery.error} onRefresh={refresh} onOpen={setSelectedRole}/>}
      {section === "audit-logs" && <AuditSection items={logsQuery.data?.items ?? []} loading={logsQuery.isLoading} error={logsQuery.error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} onRefresh={refresh} onOpen={setSelectedLog}/>}
    </div></section>

    <CreateDialog open={memberDialog} title="添加工作区成员" description="创建成员账户后，对方可直接使用设置的邮箱和临时密码登录当前工作区。" submitLabel="创建成员" successMessage="成员账户已创建" onClose={() => setMemberDialog(false)} onSubmit={async values => {
      await adminApi.createMember({ displayName: values.displayName, email: values.email, password: values.password, role: roleValue[values.role] ?? "member" });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-members"] }), queryClient.invalidateQueries({ queryKey: ["admin-roles"] }), queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })]);
    }} fields={[{ name: "displayName", label: "显示名称", required: true }, { name: "email", label: "登录邮箱", type: "email", required: true }, { name: "password", label: "临时密码", type: "password", required: true, placeholder: "至少 8 位" }, { name: "role", label: "成员角色", type: "select", required: true, options: ["成员", "只读成员", "管理员"] }]}/>

    <Modal open={Boolean(selectedUser)} title={selectedUser?.displayName ?? "用户详情"} description={selectedUser?.email} onClose={() => setSelectedUser(null)} footer={selectedUser && <><Button onClick={() => setSelectedUser(null)}>关闭</Button>{selectedUser.role !== "owner" && <Button variant={selectedUser.status === "disabled" ? "primary" : "danger"} onClick={() => updateUser(selectedUser, { status: selectedUser.status === "disabled" ? "active" : "disabled" }, selectedUser.status === "disabled" ? "用户已恢复访问" : "用户已停用")}>{selectedUser.status === "disabled" ? "恢复访问" : "停用账户"}</Button>}</>}>
      {selectedUser && <div className="admin-user-detail"><div className="admin-user-identity"><i>{selectedUser.displayName.slice(0, 1)}</i><span><strong>{selectedUser.displayName}</strong><small>{selectedUser.email}</small></span><Badge tone={statusTone(statusLabel(selectedUser.status))}>{statusLabel(selectedUser.status)}</Badge></div><div className="admin-detail-grid"><label><span>用户角色</span><CustomSelect ariaLabel="用户角色" value={selectedUser.roleLabel} disabled={selectedUser.role === "owner"} options={["管理员", "成员", "只读成员"]} onChange={label => updateUser(selectedUser, { role: roleValue[label] }, `已将角色修改为${label}`)}/></label>{[["加入方式", selectedUser.source], ["加入日期", formatDate(selectedUser.joinedAt)], ["最近活动", formatDate(selectedUser.lastSeenAt, true)], ["用户编号", selectedUser.id]].map(item => <div key={item[0]}><small>{item[0]}</small><strong>{item[1]}</strong></div>)}</div></div>}
    </Modal>
    <Modal open={Boolean(selectedRole)} title={selectedRole?.name ?? "角色详情"} description={selectedRole?.note} onClose={() => setSelectedRole(null)} footer={<Button onClick={() => setSelectedRole(null)}>完成</Button>}><div className="admin-permission-list">{selectedRole?.permissions.map(permission => <article key={permission}><i><CheckCircle2/></i><span><strong>{permission}</strong><small>由服务端角色校验强制执行</small></span></article>)}</div></Modal>
    <Modal open={Boolean(selectedLog)} title="审计记录详情" description={selectedLog ? formatDate(selectedLog.createdAt, true) : ""} onClose={() => setSelectedLog(null)} footer={<Button onClick={() => setSelectedLog(null)}>关闭</Button>}><div className="admin-log-detail">{selectedLog && [["操作人", selectedLog.actor], ["操作", auditActionLabel(selectedLog.action)], ["对象", `${selectedLog.entityType} · ${selectedLog.entityId ?? "—"}`], ["类别", auditType(selectedLog.action)], ["结果", "成功"], ["IP 地址", selectedLog.ipAddress], ["记录编号", selectedLog.id]].map(item => <div key={item[0]}><small>{item[0]}</small><strong>{item[1]}</strong></div>)}</div></Modal>
  </div>;
}

function Toolbar({ query, setQuery, filter, setFilter, options, sort, setSort, sortOptions, defaultSort, label, selectedCount, unit, onClear, actions, onRefresh }: { query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; options: string[]; sort: string; setSort: (value: string) => void; sortOptions: string[]; defaultSort: string; label: string; selectedCount: number; unit: string; onClear: () => void; actions?: ReactNode; onRefresh: () => void }) {
  return <div className="admin-toolbar customer-toolbar module-toolbar standard-list-toolbar"><div className="customer-filter-controls"><SearchInput className="customer-search module-search" ariaLabel={`搜索${label}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${label}`}/><CustomSelect className="admin-filter-select" ariaLabel={`筛选${label}`} value={filter} onChange={setFilter} options={options}/><CustomSelect className="sort-select" ariaLabel={`${label}排序`} value={sort} onChange={setSort} options={sortOptions}/><Button className="customer-refresh" onClick={onRefresh}><RefreshCw/>刷新</Button><Button className="customer-clear module-clear" disabled={!query && filter === options[0] && sort === defaultSort} onClick={() => { setQuery(""); setFilter(options[0]); setSort(defaultSort); }}>清除筛选</Button></div><div className={`customer-selection-tools${selectedCount > 0 ? " has-selection" : " is-empty"}`} aria-hidden={selectedCount === 0}><span><CheckCircle2/><small>已选择</small><strong>{selectedCount}</strong><small>{unit}</small></span><div>{actions}<Button aria-label="取消选择" title="取消选择" onClick={onClear}><X/></Button></div></div></div>;
}

function UsersSection({ items, loading, error, query, setQuery, filter, setFilter, sort, setSort, onRefresh, onOpen }: { items: AdminMemberApiRecord[]; loading: boolean; error: Error | null; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; onRefresh: () => void; onOpen: (value: AdminMemberApiRecord) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter(item => (!query || `${item.displayName}${item.email}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部状态" || statusLabel(item.status) === filter)).sort((a, b) => sort === "姓名 A–Z" ? a.displayName.localeCompare(b.displayName, "zh-CN") : sort === "姓名 Z–A" ? b.displayName.localeCompare(a.displayName, "zh-CN") : sort === "加入最早" ? a.joinedAt - b.joinedAt : sort === "加入最新" ? b.joinedAt - a.joinedAt : (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)), [items, query, filter, sort]);
  const paging = usePagination(rows, 6, `${query}|${filter}|${sort}`);
  if (loading) return <EmptyState className="list-empty-state" title="正在读取工作区成员" icon={RefreshCw}/>;
  if (error) return <EmptyState className="list-empty-state" title="成员数据加载失败" description={error.message} icon={UsersRound} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部状态", "正常", "已停用"]} sort={sort} setSort={setSort} sortOptions={["最近活动", "姓名 A–Z", "姓名 Z–A", "加入最新", "加入最早"]} defaultSort="最近活动" label="姓名或邮箱" selectedCount={selected.size} unit="位" onClear={() => setSelected(new Set())} onRefresh={onRefresh} actions={<Button onClick={() => downloadCsv("sondara-selected-users.csv", [["姓名", "邮箱", "角色", "状态", "最近活动"], ...rows.filter(item => selected.has(item.id)).map(item => [item.displayName, item.email, item.roleLabel, statusLabel(item.status), formatDate(item.lastSeenAt, true)])])}><Download/>导出所选</Button>}/><DataTable className="customer-table customer-table-pro admin-customer-table" columns={[{ key: "select", title: <Checkbox aria-label="选择本页全部用户" checked={paging.pageItems.length > 0 && paging.pageItems.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); paging.pageItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })}/>, width: 52 }, { key: "user", title: <Button className="customer-sort-head" onClick={() => setSort(sort === "姓名 A–Z" ? "姓名 Z–A" : "姓名 A–Z")}>用户档案{sortIcon(sort.startsWith("姓名"), sort === "姓名 Z–A")}</Button> }, { key: "role", title: "角色" }, { key: "status", title: "状态" }, { key: "activity", title: "最近活动" }, { key: "joined", title: "加入信息" }, { key: "actions", title: "操作", width: 72 }]} rows={paging.pageItems.map(item => ({ key: item.id, className: selected.has(item.id) ? "selected" : "", cells: [<Checkbox aria-label={`选择 ${item.displayName}`} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/>, <Button className="customer-company admin-user-company" onClick={() => onOpen(item)}><i>{item.displayName.slice(0, 1)}</i><span><strong>{item.displayName}</strong><small>{item.email}</small><em><UserCheck/>{item.id}</em></span></Button>, <Badge tone={item.role === "owner" ? "blue" : item.role === "admin" ? "green" : "neutral"}>{item.roleLabel}</Badge>, <Badge tone={statusTone(statusLabel(item.status))}>{statusLabel(item.status)}</Badge>, <div className="standard-cell-stack"><strong>{formatDate(item.lastSeenAt, true)}</strong><small>最近访问</small></div>, <div className="standard-cell-stack"><strong>{formatDate(item.joinedAt)}</strong><small>{item.source}</small></div>, <Button className="customer-more" aria-label={`管理 ${item.displayName}`} onClick={() => onOpen(item)}><MoreHorizontal/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="位用户"/></>;
}

function RolesSection({ items, loading, error, onRefresh, onOpen }: { items: AdminRoleApiRecord[]; loading: boolean; error: Error | null; onRefresh: () => void; onOpen: (value: AdminRoleApiRecord) => void }) {
  if (loading) return <EmptyState className="list-empty-state" title="正在读取角色权限" icon={RefreshCw}/>;
  if (error) return <EmptyState className="list-empty-state" title="角色权限加载失败" description={error.message} icon={ShieldCheck} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><div className="admin-toolbar customer-toolbar module-toolbar"><Button className="customer-refresh" onClick={onRefresh}><RefreshCw/>刷新权限</Button></div><DataTable className="customer-table customer-table-pro admin-customer-table admin-role-table" columns={[{ key: "role", title: "角色" }, { key: "members", title: "成员" }, { key: "note", title: "角色说明" }, { key: "permissions", title: "权限范围" }, { key: "actions", title: "操作", width: 72 }]} rows={items.map(item => ({ key: item.role, cells: [<Button className="customer-company admin-user-company" onClick={() => onOpen(item)}><i><UserCog/></i><span><strong>{item.name}</strong><small>服务端固定角色</small><em><ShieldCheck/>权限已强制执行</em></span></Button>, <div className="standard-value"><strong>{item.members}</strong><small>位用户</small></div>, <span className="admin-role-note">{item.note}</span>, <div className="admin-permission-chips">{item.permissions.slice(0, 3).map(permission => <span key={permission}>{permission}</span>)}</div>, <Button className="customer-more" aria-label={`查看 ${item.name} 权限`} onClick={() => onOpen(item)}><ChevronRight/></Button>] }))}/></>;
}

function AuditSection({ items, loading, error, query, setQuery, filter, setFilter, sort, setSort, onRefresh, onOpen }: { items: AdminAuditLogApiRecord[]; loading: boolean; error: Error | null; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; onRefresh: () => void; onOpen: (value: AdminAuditLogApiRecord) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter(item => (!query || `${item.actor}${item.action}${item.entityId ?? ""}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部类型" || auditType(item.action) === filter)).sort((a, b) => sort === "时间最早" ? a.createdAt - b.createdAt : sort === "操作人 A–Z" ? a.actor.localeCompare(b.actor, "zh-CN") : b.createdAt - a.createdAt), [items, query, filter, sort]);
  const paging = usePagination(rows, 6, `${query}|${filter}|${sort}`);
  if (loading) return <EmptyState className="list-empty-state" title="正在读取审计记录" icon={RefreshCw}/>;
  if (error) return <EmptyState className="list-empty-state" title="审计记录加载失败" description={error.message} icon={FileClock} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部类型", "用户管理", "系统设置", "数据操作", "业务操作"]} sort={sort} setSort={setSort} sortOptions={["时间最新", "时间最早", "操作人 A–Z"]} defaultSort="时间最新" label="操作记录" selectedCount={selected.size} unit="条" onClear={() => setSelected(new Set())} onRefresh={onRefresh} actions={<Button onClick={() => downloadCsv("sondara-selected-audit-logs.csv", [["时间", "操作人", "操作", "对象", "类别", "结果", "IP"], ...rows.filter(item => selected.has(item.id)).map(item => [formatDate(item.createdAt, true), item.actor, auditActionLabel(item.action), item.entityId ?? "—", auditType(item.action), "成功", item.ipAddress])])}><Download/>导出所选</Button>}/><DataTable className="customer-table customer-table-pro admin-customer-table admin-audit-table" columns={[{ key: "select", title: <Checkbox aria-label="选择本页全部记录" checked={paging.pageItems.length > 0 && paging.pageItems.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); paging.pageItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })}/>, width: 52 }, { key: "time", title: "时间" }, { key: "actor", title: "操作人" }, { key: "action", title: "操作与对象" }, { key: "type", title: "类别" }, { key: "result", title: "结果" }, { key: "details", title: "详情", width: 72 }]} rows={paging.pageItems.map(item => ({ key: item.id, className: selected.has(item.id) ? "selected" : "", cells: [<Checkbox aria-label={`选择 ${item.id}`} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/>, <div className="standard-cell-stack"><strong>{formatDate(item.createdAt, true)}</strong><small>{item.ipAddress}</small></div>, <div className="admin-actor"><i>{item.actor.slice(0, 1)}</i><span><strong>{item.actor}</strong><small>{item.actorUserId ?? "system"}</small></span></div>, <div className="standard-cell-stack"><strong>{auditActionLabel(item.action)}</strong><small>{item.entityType} · {item.entityId ?? "—"}</small></div>, <Badge tone="blue">{auditType(item.action)}</Badge>, <Badge tone="green">成功</Badge>, <Button className="customer-more" aria-label={`查看审计详情 ${item.id}`} onClick={() => onOpen(item)}><ChevronRight/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="条记录"/></>;
}
