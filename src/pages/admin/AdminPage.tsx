import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, Badge as AntBadge, Checkbox, Descriptions, Form, Input, Segmented, Space, Tabs, Typography } from "antd";
import {
  ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ChevronRight,
  FileClock, Plus, RefreshCw, ShieldCheck,
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
import { List } from "@/components/ui/List";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { SearchInput } from "@/components/ui/SearchInput";
import { PageContainer, SelectionBar, TableToolbar } from "@/components/ui/PageModules";
import { ContentSkeleton } from "@/components/ui/LoadingState";
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
const sortIcon = (active: boolean, descending = false) => <span className="table-sort-indicator" data-sort-active={active} aria-hidden="true">{active ? descending ? <ArrowDown/> : <ArrowUp/> : <ArrowUpDown/>}</span>;
const auditActionLabels: Record<string, string> = {
  "member.created": "创建工作区成员", "member.updated": "更新成员权限", "member.removed": "移除工作区成员",
  "member.invited": "发出成员邀请", "member.invite_revoked": "撤销成员邀请",
  "approval.requested": "提交审批请求", "approval.approved": "批准审批请求", "approval.rejected": "驳回审批请求",
  "customer.archived": "归档客户", "customer.unarchived": "恢复客户", "task.archived": "归档任务", "deal.archived": "归档商机",
  "customer.created": "创建客户", "customer.updated": "更新客户", "customer.deleted": "删除客户", "customer.imported": "批量导入客户",
  "radar.task.created": "创建获客任务", "radar.candidate.promoted": "候选保存为客户",
  "ai.service.created": "添加 AI 服务", "ai.service.updated": "更新 AI 服务", "ai.key.created": "添加 AI 密钥",
  "integration.created": "添加数据源", "integration.updated": "更新数据源", "data.export": "导出工作区数据", "data.backup": "创建数据库备份",
  "icp.profile.updated": "更新客户定位资料", "icp.profile.analyzed": "重新分析客户定位",
  "radar.candidate.created": "发现获客候选", "radar.candidate.updated": "更新候选状态", "radar.candidate.archived": "归档获客候选", "radar.candidate.unarchived": "恢复获客候选", "radar.candidate.contacts_enriched": "补全候选联系人",
  "task.created": "创建跟进任务", "task.updated": "更新跟进任务", "task.unarchived": "恢复跟进任务",
  "deal.created": "创建商机", "deal.updated": "更新商机", "deal.unarchived": "恢复商机",
  "content.created": "创建内容资产", "content.updated": "更新内容资产", "content.duplicated": "复制内容资产", "content.quality_checked": "检查内容质量", "content.campaign_linked": "内容加入营销活动", "content.generated": "生成内容资产",
  "customer.merged": "合并重复客户", "customer.score_override": "人工修正客户评分", "customer.stage_changed": "更新客户阶段", "customer.tags_added": "添加客户标签", "customer.contact_created": "添加客户联系人", "customer.contact_updated": "更新客户联系人", "customer.contact_verified": "验证客户联系人",
};
const auditEntityLabels: Record<string, string> = { member: "成员", approval: "审批", customer: "客户", task: "任务", deal: "商机", content: "内容", campaign: "活动", radar: "获客", ai: "AI 配置", integration: "数据源", data: "数据", icp: "客户定位", lead_source: "线索渠道", outbox: "发送服务", inbox: "客户消息", channel_cost: "渠道成本", attribution: "转化分析" };
const auditVerbLabels: Record<string, string> = { created: "创建", updated: "更新", deleted: "删除", archived: "归档", unarchived: "恢复", tested: "测试", executed: "执行", requested: "提交", approved: "批准", rejected: "驳回", linked: "关联", analyzed: "分析", generated: "生成", received: "接收", rotated: "轮换", validated: "验证" };
const auditActionLabel = (action: string) => {
  if (auditActionLabels[action]) return auditActionLabels[action];
  const parts = action.split(".");
  const verb = auditVerbLabels[parts.at(-1) ?? ""] ?? "记录";
  const entity = auditEntityLabels[parts[0] ?? ""] ?? "系统操作";
  return `${verb}${entity}`;
};
const auditType = (action: string) => action.startsWith("member.") ? "用户管理" : action.startsWith("ai.") || action.startsWith("integration.") ? "系统设置" : action.startsWith("data.") ? "数据操作" : "业务操作";
const approvalStatusLabel = (status: ApprovalApiRecord["status"]) => status === "pending" ? "待审批" : status === "approved" ? "已通过" : status === "rejected" ? "已驳回" : "已取消";
type InvitationFilter = "待接受" | "全部" | "已过期";
const invitationStatus = (item: AdminInvitationApiRecord) => item.acceptedAt ? "已接受" : item.revokedAt ? "已撤销" : item.expiresAt <= Date.now() ? "已过期" : "待接受";
const invitationRoleLabel = (role: AdminInvitationApiRecord["role"]) => role === "admin" ? "管理员" : role === "viewer" ? "只读成员" : "成员";

export function AdminPage() {
  const params = useParams();
  const queryClient = useQueryClient();
  const showToast = useUiStore(state => state.showToast);
  const section = (Object.hasOwn(sectionMeta, params.section ?? "") ? params.section : "users") as AdminSection;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部状态");
  const [sort, setSort] = useState("最近活动");
  const [memberDialog, setMemberDialog] = useState(false);
  const [invitationPanelOpen, setInvitationPanelOpen] = useState(false);
  const [invitationTab, setInvitationTab] = useState<"create" | "records">("create");
  const [invitationFilter, setInvitationFilter] = useState<InvitationFilter>("待接受");
  const [inviteResult, setInviteResult] = useState<AdminInvitationApiRecord | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteForm] = Form.useForm<{ displayName: string; email: string; role: string }>();
  const [selectedUser, setSelectedUser] = useState<AdminMemberApiRecord | null>(null);
  const [selectedRole, setSelectedRole] = useState<AdminRoleApiRecord | null>(null);
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogApiRecord | null>(null);
  const membersQuery = useQuery({ queryKey: ["admin-members"], queryFn: adminApi.listMembers, retry: 1 });
  const rolesQuery = useQuery({ queryKey: ["admin-roles"], queryFn: adminApi.listRoles, retry: 1 });
  const logsQuery = useQuery({ queryKey: ["admin-audit-logs"], queryFn: adminApi.listAuditLogs, retry: 1 });
  const approvalsQuery = useQuery({ queryKey: ["approvals"], queryFn: approvalApi.list, retry: 1, enabled: section === "approvals" });
  const invitationsQuery = useQuery({ queryKey: ["admin-invitations"], queryFn: adminApi.listInvitations, retry: 1, enabled: section === "users" });
  const invitations = invitationsQuery.data?.items ?? [];
  const pendingInvitations = useMemo(() => invitations.filter(item => invitationStatus(item) === "待接受"), [invitations]);
  const filteredInvitations = useMemo(() => invitations.filter(item => invitationFilter === "全部" || invitationStatus(item) === invitationFilter), [invitations, invitationFilter]);
  const invitationPaging = usePagination(filteredInvitations, 10, invitationFilter);
  const meta = sectionMeta[section];
  useEffect(() => {
    setQuery("");
    if (section === "audit-logs") { setFilter("全部类型"); setSort("时间最新"); }
    else { setFilter("全部状态"); setSort("最近活动"); }
  }, [section]);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: section === "users" ? ["admin-members"] : section === "roles" ? ["admin-roles"] : section === "approvals" ? ["approvals"] : ["admin-audit-logs"] });
    showToast(`${meta.label}已重新加载`);
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
  const closeInvitationPanel = () => {
    setInvitationPanelOpen(false);
    setInviteResult(null);
    inviteForm.resetFields();
  };
  const submitInvitation = async () => {
    let values: { displayName: string; email: string; role: string };
    try { values = await inviteForm.validateFields(); } catch { return; }
    setInviteSubmitting(true);
    try {
      const invite = await adminApi.createInvitation({ displayName: values.displayName, email: values.email, role: roleValue[values.role] ?? "member" });
      setInviteResult(invite);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-invitations"] }), queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })]);
      showToast("邀请链接已生成");
    } catch (cause) { showToast(cause instanceof Error ? cause.message : "生成邀请链接失败"); }
    finally { setInviteSubmitting(false); }
  };
  return <PageContainer>
    <PageHeader title={meta.label} description={`管理中心 · ${meta.description}`} actions={section === "users" ? <><AntBadge count={pendingInvitations.length} size="small" overflowCount={99}><Button onClick={() => { setInvitationTab("create"); setInviteResult(null); setInvitationPanelOpen(true); }}><UsersRound size={16}/>邀请成员</Button></AntBadge><Button variant="primary" onClick={() => setMemberDialog(true)}><Plus size={16}/>直接创建</Button></> : undefined}/>
    <Panel>
      {section === "users" && <UsersSection items={membersQuery.data?.items ?? []} loading={membersQuery.isLoading} error={membersQuery.error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} onRefresh={refresh} onOpen={setSelectedUser} onBulkStatus={async(ids,status)=>{const editable=(membersQuery.data?.items??[]).filter(item=>ids.includes(item.id)&&item.role!=="owner");await Promise.all(editable.map(item=>adminApi.updateMember(item.id,{status})));await Promise.all([queryClient.invalidateQueries({queryKey:["admin-members"]}),queryClient.invalidateQueries({queryKey:["admin-roles"]}),queryClient.invalidateQueries({queryKey:["admin-audit-logs"]})]);showToast(`${editable.length} 位成员已${status==="active"?"恢复访问":"停用"}`)}}/>}
      {section === "roles" && <RolesSection items={rolesQuery.data?.items ?? []} loading={rolesQuery.isLoading} error={rolesQuery.error} onRefresh={refresh} onOpen={setSelectedRole}/>}
      {section === "audit-logs" && <AuditSection items={logsQuery.data?.items ?? []} loading={logsQuery.isLoading} error={logsQuery.error} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} onRefresh={refresh} onOpen={setSelectedLog}/>}
      {section === "approvals" && (
        <ApprovalsSection items={approvalsQuery.data?.items ?? []} loading={approvalsQuery.isLoading} error={approvalsQuery.error} onRefresh={refresh} onReview={async (id, status) => { try { await approvalApi.review(id, { status }); await queryClient.invalidateQueries({ queryKey: ["approvals"] }); showToast(status === "approved" ? "审批已通过" : "审批已处理"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "审批操作失败"); } }}/>
      )}
    </Panel>

    <CreateDialog open={memberDialog} title="添加工作区成员" description="创建成员账户后，对方可直接使用设置的邮箱和临时密码登录当前工作区。" submitLabel="创建成员" successMessage="成员账户已创建" onClose={() => setMemberDialog(false)} onSubmit={async values => {
      await adminApi.createMember({ displayName: values.displayName, email: values.email, password: values.password, role: roleValue[values.role] ?? "member" });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-members"] }), queryClient.invalidateQueries({ queryKey: ["admin-roles"] }), queryClient.invalidateQueries({ queryKey: ["admin-audit-logs"] })]);
    }} fields={[{ name: "displayName", label: "显示名称", required: true }, { name: "email", label: "登录邮箱", type: "email", required: true }, { name: "password", label: "临时密码", type: "password", required: true, placeholder: "至少 8 位" }, { name: "role", label: "成员角色", type: "select", required: true, options: ["成员", "只读成员", "管理员"] }]}/>
    <Modal open={invitationPanelOpen} width={680} title="邀请成员" description="发起成员邀请，并集中查看邀请的接受状态。" onClose={closeInvitationPanel} footer={invitationTab === "records" ? <Button onClick={closeInvitationPanel}>关闭</Button> : inviteResult ? <><Button onClick={closeInvitationPanel}>关闭</Button><Button onClick={() => { setInviteResult(null); inviteForm.resetFields(); }}>继续邀请</Button><Button variant="primary" onClick={async () => { if (inviteResult.inviteUrl) await navigator.clipboard.writeText(inviteResult.inviteUrl); showToast("邀请链接已复制"); }}>复制链接</Button></> : <><Button onClick={closeInvitationPanel}>取消</Button><Button variant="primary" loading={inviteSubmitting} onClick={submitInvitation}>生成邀请链接</Button></>}>
      <Tabs activeKey={invitationTab} onChange={key => setInvitationTab(key as "create" | "records")} items={[
        { key: "create", label: "发起邀请", children: inviteResult ? <Space orientation="vertical" size="middle" style={{width:"100%"}}><Badge tone="green">邀请链接已生成</Badge><Descriptions bordered column={1} items={[{key:"email",label:"受邀邮箱",children:inviteResult.email},{key:"expires",label:"有效期至",children:formatDate(inviteResult.expiresAt,true)},{key:"url",label:"注册链接",children:<Typography.Text copyable>{inviteResult.inviteUrl}</Typography.Text>},{key:"note",label:"说明",children:"请仅发送给受邀人员；链接使用一次后自动失效。"}]}/></Space> : <Form form={inviteForm} layout="vertical" initialValues={{role:"成员"}}><Form.Item name="displayName" label="显示名称" rules={[{required:true,message:"请输入显示名称"},{min:2,message:"显示名称至少 2 个字符"}]}><Input autoFocus placeholder="输入成员姓名"/></Form.Item><Form.Item name="email" label="邀请邮箱" rules={[{required:true,message:"请输入邀请邮箱"},{type:"email",message:"请输入有效的邮箱地址"}]}><Input type="email" placeholder="name@example.com"/></Form.Item><Form.Item name="role" label="成员角色" rules={[{required:true,message:"请选择成员角色"}]}><CustomSelect ariaLabel="成员角色" options={["成员","只读成员","管理员"]}/></Form.Item></Form> },
        { key: "records", label: <AntBadge count={pendingInvitations.length} size="small" offset={[8,0]}>邀请记录</AntBadge>, children: <Space orientation="vertical" size="middle" style={{width:"100%"}}><Segmented block aria-label="邀请状态" value={invitationFilter} options={["待接受", "全部", "已过期"]} onChange={value => setInvitationFilter(value as InvitationFilter)}/>{invitationsQuery.isLoading ? <EmptyState title="正在读取邀请记录" icon={RefreshCw} spinning/> : filteredInvitations.length ? <><List dataSource={invitationPaging.pageItems} renderItem={item => { const status = invitationStatus(item); return <List.Item actions={status === "待接受" ? [<Button key="revoke" variant="danger" onClick={async () => { try { await adminApi.revokeInvitation(item.id); await queryClient.invalidateQueries({ queryKey: ["admin-invitations"] }); showToast("邀请已撤销"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "撤销邀请失败"); } }}>撤销</Button>] : [<Badge key="status" tone={status === "已接受" ? "green" : status === "已过期" ? "orange" : "neutral"}>{status}</Badge>]}><List.Item.Meta avatar={<UsersRound/>} title={item.displayName || item.email} description={`${item.email} · ${invitationRoleLabel(item.role)} · ${status === "待接受" ? "有效期至" : "原有效期至"} ${formatDate(item.expiresAt, true)}`}/></List.Item> }}/><Pagination page={invitationPaging.page} pageSize={invitationPaging.pageSize} total={filteredInvitations.length} onPageChange={invitationPaging.setPage} onPageSizeChange={invitationPaging.setPageSize} itemName="条邀请"/></> : <EmptyState title={invitationFilter === "待接受" ? "暂无待接受邀请" : invitationFilter === "已过期" ? "暂无已过期邀请" : "暂无邀请记录"} description="生成邀请链接后会显示在这里。" icon={UsersRound}/>}</Space> },
      ]}/>
    </Modal>

    <Modal open={Boolean(selectedUser)} title={selectedUser?.displayName ?? "用户详情"} description={selectedUser?.email} onClose={() => setSelectedUser(null)} footer={selectedUser && <><Button onClick={() => setSelectedUser(null)}>关闭</Button>{selectedUser.role !== "owner" && <Button variant={selectedUser.status === "disabled" ? "primary" : "danger"} onClick={() => updateUser(selectedUser, { status: selectedUser.status === "disabled" ? "active" : "disabled" }, selectedUser.status === "disabled" ? "用户已恢复访问" : "用户已停用")}>{selectedUser.status === "disabled" ? "恢复访问" : "停用账户"}</Button>}</>}>
      {selectedUser && <Space orientation="vertical" size="middle" style={{width:'100%'}}><Space><Avatar>{selectedUser.displayName.slice(0, 1)}</Avatar><Space orientation="vertical" size={0}><Typography.Text strong>{selectedUser.displayName}</Typography.Text><Typography.Text type="secondary">{selectedUser.email}</Typography.Text></Space><Badge tone={statusTone(statusLabel(selectedUser.status))}>{statusLabel(selectedUser.status)}</Badge></Space><Form layout="vertical"><Form.Item label="用户角色"><CustomSelect ariaLabel="用户角色" value={selectedUser.roleLabel} disabled={selectedUser.role === "owner"} options={["管理员", "成员", "只读成员"]} onChange={label => updateUser(selectedUser, { role: roleValue[label] }, `已将角色修改为${label}`)}/></Form.Item></Form><Descriptions bordered column={1} items={[["加入方式", selectedUser.source], ["加入日期", formatDate(selectedUser.joinedAt)], ["最近活动", formatDate(selectedUser.lastSeenAt, true)], ["用户编号", selectedUser.id]].map(item=>({key:item[0],label:item[0],children:item[1]}))}/></Space>}
    </Modal>
    <Modal open={Boolean(selectedRole)} title={selectedRole?.name ?? "角色详情"} description={selectedRole?.note} onClose={() => setSelectedRole(null)} footer={<Button onClick={() => setSelectedRole(null)}>完成</Button>}><List dataSource={selectedRole?.permissions??[]} renderItem={permission=><List.Item><List.Item.Meta avatar={<CheckCircle2/>} title={permission} description="由服务端角色校验强制执行"/></List.Item>}/></Modal>
    <Modal open={Boolean(selectedLog)} title="审计记录详情" description={selectedLog ? formatDate(selectedLog.createdAt, true) : ""} onClose={() => setSelectedLog(null)} footer={<Button onClick={() => setSelectedLog(null)}>关闭</Button>}>{selectedLog&&<Descriptions bordered column={1} items={[["操作人", selectedLog.actor], ["操作", auditActionLabel(selectedLog.action)], ["对象", `${selectedLog.entityType} · ${selectedLog.entityId ?? "—"}`], ["类别", auditType(selectedLog.action)], ["结果", "成功"], ["IP 地址", selectedLog.ipAddress], ["记录编号", selectedLog.id]].map(item=>({key:item[0],label:item[0],children:item[1]}))}/>}</Modal>
  </PageContainer>;
}

function Toolbar({ query, setQuery, filter, setFilter, options, sort, setSort, sortOptions, defaultSort, label, selectedCount, unit, onClear, actions }: { query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; options: string[]; sort: string; setSort: (value: string) => void; sortOptions: string[]; defaultSort: string; label: string; selectedCount: number; unit: string; onClear: () => void; actions?: ReactNode; onRefresh: () => void }) {
  return <TableToolbar
    filters={<><SearchInput ariaLabel={`搜索${label}`} value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${label}`}/><CustomSelect ariaLabel={`筛选${label}`} value={filter} onChange={setFilter} options={options}/><CustomSelect ariaLabel={`${label}排序`} value={sort} onChange={setSort} options={sortOptions}/><Button disabled={!query && filter === options[0] && sort === defaultSort} onClick={() => { setQuery(""); setFilter(options[0]); setSort(defaultSort); }}>清除筛选</Button></>}
    selection={selectedCount > 0 ? <SelectionBar count={selectedCount} unit={unit} actions={<>{actions}<Button aria-label="取消选择" title="取消选择" onClick={onClear}><X/></Button></>}/> : undefined}
  />;
}

function UsersSection({ items, loading, error, query, setQuery, filter, setFilter, sort, setSort, onRefresh, onOpen, onBulkStatus }: { items: AdminMemberApiRecord[]; loading: boolean; error: Error | null; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; onRefresh: () => void; onOpen: (value: AdminMemberApiRecord) => void; onBulkStatus:(ids:string[],status:"active"|"disabled")=>Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter(item => (!query || `${item.displayName}${item.email}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部状态" || statusLabel(item.status) === filter)).sort((a, b) => sort === "姓名 A–Z" ? a.displayName.localeCompare(b.displayName, "zh-CN") : sort === "姓名 Z–A" ? b.displayName.localeCompare(a.displayName, "zh-CN") : sort === "加入最早" ? a.joinedAt - b.joinedAt : sort === "加入最新" ? b.joinedAt - a.joinedAt : (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)), [items, query, filter, sort]);
  const paging = usePagination(rows, 10, `${query}|${filter}|${sort}`);
  const selectablePage = paging.pageItems.filter(item => item.role !== "owner");
  if (loading) return <ContentSkeleton rows={6}/>;
  if (error) return <EmptyState title="成员数据加载失败" description={error.message} icon={UsersRound} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部状态", "正常", "已停用"]} sort={sort} setSort={setSort} sortOptions={["最近活动", "姓名 A–Z", "姓名 Z–A", "加入最新", "加入最早"]} defaultSort="最近活动" label="姓名或邮箱" selectedCount={selected.size} unit="位成员" onClear={() => setSelected(new Set())} onRefresh={onRefresh} actions={<><Button onClick={async()=>{await onBulkStatus([...selected],"active");setSelected(new Set())}}>恢复访问</Button><Button variant="danger" onClick={async()=>{await onBulkStatus([...selected],"disabled");setSelected(new Set())}}>停用成员</Button><Button onClick={() => downloadCsv("sondara-selected-users.csv", [["姓名", "邮箱", "角色", "状态", "最近活动"], ...rows.filter(item => selected.has(item.id)).map(item => [item.displayName, item.email, item.roleLabel, statusLabel(item.status), formatDate(item.lastSeenAt, true)])])}>导出所选</Button></>}/><DataTable ariaLabel="用户与成员表格" className="admin-users-table" minWidth={1050} columns={[{ key: "select", title: <Checkbox aria-label="选择本页可管理用户" checked={selectablePage.length > 0 && selectablePage.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); selectablePage.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })}/>, width: 52, fixed: "left" }, { key: "user", title: <Button onClick={() => setSort(sort === "姓名 A–Z" ? "姓名 Z–A" : "姓名 A–Z")}>成员档案{sortIcon(sort.startsWith("姓名"), sort === "姓名 Z–A")}</Button>, width: 300, fixed: "left" }, { key: "role", title: "角色", width: 140 }, { key: "status", title: "访问状态", width: 130 }, { key: "activity", title: "最近活动", width: 190 }, { key: "joined", title: "加入信息", width: 166 }, { key: "actions", title: "操作", width: 72, fixed: "right" }]} rows={paging.pageItems.map(item => ({ key: item.id, className: selected.has(item.id) ? "selected" : "", cells: [<Checkbox aria-label={item.role==="owner"?`${item.displayName} 是所有者，不可批量管理`:`选择 ${item.displayName}`} disabled={item.role==="owner"} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/>, <Button className="admin-user-profile" type="link" onClick={() => onOpen(item)}><Avatar>{item.displayName.slice(0, 1)}</Avatar><Space className="admin-user-profile__copy" orientation="vertical" size={0}><Typography.Text strong ellipsis={{ tooltip: item.displayName }}>{item.displayName}</Typography.Text><Typography.Text type="secondary" ellipsis={{ tooltip: item.email }}>{item.email}</Typography.Text></Space></Button>, <Badge tone={item.role === "owner" ? "blue" : item.role === "admin" ? "green" : "neutral"}>{item.roleLabel}</Badge>, <Badge tone={statusTone(statusLabel(item.status))}>{statusLabel(item.status)}</Badge>, <Space orientation="vertical" size={0}><Typography.Text strong>{formatDate(item.lastSeenAt, true)}</Typography.Text><Typography.Text type="secondary">最近访问</Typography.Text></Space>, <Space orientation="vertical" size={0}><Typography.Text strong>{formatDate(item.joinedAt)}</Typography.Text><Typography.Text type="secondary" ellipsis={{ tooltip: item.source }}>{item.source}</Typography.Text></Space>, <Button aria-label={`查看和管理 ${item.displayName}`} title="查看详情" onClick={() => onOpen(item)}><ChevronRight/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="位成员"/></>;
}

function RolesSection({ items, loading, error, onRefresh, onOpen }: { items: AdminRoleApiRecord[]; loading: boolean; error: Error | null; onRefresh: () => void; onOpen: (value: AdminRoleApiRecord) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部角色");
  const [sort, setSort] = useState("成员最多");
  const rows = useMemo(() => items
    .filter(item => (!query || `${item.name}${item.note}${item.permissions.join("")}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部角色" || item.name === filter))
    .sort((a, b) => sort === "角色名称 A–Z" ? a.name.localeCompare(b.name, "zh-CN") : sort === "成员最少" ? a.members - b.members : b.members - a.members), [items, query, filter, sort]);
  const paging = usePagination(rows, 10, `${query}|${filter}|${sort}`);
  if (loading) return <ContentSkeleton rows={5}/>;
  if (error) return <EmptyState title="角色权限加载失败" description={error.message} icon={ShieldCheck} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部角色", ...items.map(item => item.name)]} sort={sort} setSort={setSort} sortOptions={["成员最多", "成员最少", "角色名称 A–Z"]} defaultSort="成员最多" label="角色或权限" selectedCount={0} unit="个角色" onClear={()=>{}} onRefresh={onRefresh}/><DataTable ariaLabel="角色与权限表格" className="admin-roles-table" minWidth={980} columns={[{ key: "select", title: <Checkbox disabled aria-label="系统固定角色不可选择"/>, width: 52 }, { key: "role", title: <Button onClick={()=>setSort("角色名称 A–Z")}>角色{sortIcon(sort === "角色名称 A–Z")}</Button>, width: 250 }, { key: "members", title: <Button onClick={()=>setSort(sort === "成员最多" ? "成员最少" : "成员最多")}>成员{sortIcon(sort === "成员最多" || sort === "成员最少", sort === "成员最多")}</Button>, width: 130 }, { key: "note", title: "角色说明", width: 260 }, { key: "permissions", title: "权限范围", width: 240 }, { key: "actions", title: "操作", width: 72 }]} rows={paging.pageItems.map(item => ({ key: item.role, cells: [<Checkbox disabled aria-label={`${item.name}是系统固定角色，不可选择`}/>, <Button type="link" onClick={() => onOpen(item)}><UserCog/><Space orientation="vertical" size={0}><Typography.Text strong>{item.name}</Typography.Text><Typography.Text type="secondary">系统固定角色</Typography.Text></Space></Button>, <Typography.Text strong>{item.members} 位成员</Typography.Text>, <Typography.Text>{item.note}</Typography.Text>, <Space wrap>{item.permissions.slice(0, 3).map(permission => <Badge key={permission} tone="blue">{permission}</Badge>)}</Space>, <Button aria-label={`查看 ${item.name} 权限`} title="查看权限" onClick={() => onOpen(item)}><ChevronRight/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="个角色"/></>;
}

function AuditSection({ items, loading, error, query, setQuery, filter, setFilter, sort, setSort, onRefresh, onOpen }: { items: AdminAuditLogApiRecord[]; loading: boolean; error: Error | null; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; sort: string; setSort: (value: string) => void; onRefresh: () => void; onOpen: (value: AdminAuditLogApiRecord) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items.filter(item => (!query || `${item.actor}${item.action}${item.entityId ?? ""}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部类型" || auditType(item.action) === filter)).sort((a, b) => sort === "时间最早" ? a.createdAt - b.createdAt : sort === "操作人 A–Z" ? a.actor.localeCompare(b.actor, "zh-CN") : b.createdAt - a.createdAt), [items, query, filter, sort]);
  const paging = usePagination(rows, 10, `${query}|${filter}|${sort}`);
  if (loading) return <ContentSkeleton rows={6}/>;
  if (error) return <EmptyState title="审计记录加载失败" description={error.message} icon={FileClock} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部类型", "用户管理", "系统设置", "数据操作", "业务操作"]} sort={sort} setSort={setSort} sortOptions={["时间最新", "时间最早", "操作人 A–Z"]} defaultSort="时间最新" label="操作记录" selectedCount={selected.size} unit="条记录" onClear={() => setSelected(new Set())} onRefresh={onRefresh} actions={<Button onClick={() => downloadCsv("sondara-selected-audit-logs.csv", [["时间", "操作人", "操作", "对象", "类别", "结果", "IP"], ...rows.filter(item => selected.has(item.id)).map(item => [formatDate(item.createdAt, true), item.actor, auditActionLabel(item.action), item.entityId ?? "—", auditType(item.action), "成功", item.ipAddress])])}>导出所选</Button>}/><DataTable ariaLabel="操作记录表格" className="admin-audit-table" minWidth={1050} columns={[{ key: "select", title: <Checkbox aria-label="选择本页全部记录" checked={paging.pageItems.length > 0 && paging.pageItems.every(item => selected.has(item.id))} onChange={event => setSelected(current => { const next = new Set(current); paging.pageItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })}/>, width: 52 }, { key: "time", title: <Button onClick={()=>setSort(sort === "时间最新" ? "时间最早" : "时间最新")}>时间{sortIcon(sort === "时间最新" || sort === "时间最早", sort === "时间最新")}</Button>, width: 180 }, { key: "actor", title: <Button onClick={()=>setSort("操作人 A–Z")}>操作人{sortIcon(sort === "操作人 A–Z")}</Button>, width: 240 }, { key: "action", title: "操作与对象", width: 300 }, { key: "type", title: "类别", width: 130 }, { key: "result", title: "结果", width: 96 }, { key: "details", title: "详情", width: 72 }]} rows={paging.pageItems.map(item => ({ key: item.id, className: selected.has(item.id) ? "selected" : "", cells: [<Checkbox aria-label={`选择 ${item.id}`} checked={selected.has(item.id)} onChange={event => setSelected(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })}/>, <Typography.Text strong className="admin-audit-table__time">{formatDate(item.createdAt, true)}</Typography.Text>, <Space className="admin-audit-table__actor" align="center"><Avatar>{item.actor.slice(0, 1)}</Avatar><Space className="admin-audit-table__copy" orientation="vertical" size={0}><Typography.Text strong ellipsis={{ tooltip: item.actor }}>{item.actor}</Typography.Text><Typography.Text type="secondary">{item.actorUserId ? "工作区成员" : "系统任务"}</Typography.Text></Space></Space>, <Space className="admin-audit-table__copy" orientation="vertical" size={0}><Typography.Text strong ellipsis={{ tooltip: auditActionLabel(item.action) }}>{auditActionLabel(item.action)}</Typography.Text><Typography.Text type="secondary" ellipsis={{ tooltip: `${auditEntityLabels[item.entityType] ?? item.entityType} · ${item.entityId ?? "—"}` }}>{auditEntityLabels[item.entityType] ?? item.entityType}{item.entityId ? ` · ${item.entityId}` : ""}</Typography.Text></Space>, <Badge tone="blue">{auditType(item.action)}</Badge>, <Badge tone="green">成功</Badge>, <Button aria-label={`查看审计详情 ${item.id}`} title="查看详情" onClick={() => onOpen(item)}><ChevronRight/></Button>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="条记录"/></>;
}

function ApprovalsSection({ items, loading, error, onRefresh, onReview }: { items: ApprovalApiRecord[]; loading: boolean; error: Error | null; onRefresh: () => void; onReview: (id: string, status: 'approved' | 'rejected') => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部状态");
  const [sort, setSort] = useState("时间最新");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = useMemo(() => items
    .filter(item => (!query || `${item.action}${item.entityType}${item.entityId}${item.requester ?? item.requestedByUserId}`.toLowerCase().includes(query.toLowerCase())) && (filter === "全部状态" || approvalStatusLabel(item.status) === filter))
    .sort((a, b) => sort === "时间最早" ? a.createdAt - b.createdAt : sort === "申请人 A–Z" ? (a.requester ?? a.requestedByUserId).localeCompare(b.requester ?? b.requestedByUserId, "zh-CN") : b.createdAt - a.createdAt), [items, query, filter, sort]);
  const paging = usePagination(rows, 10, `${query}|${filter}|${sort}`);
  const selectablePage = paging.pageItems.filter(item => item.status === "pending");
  const reviewSelected = async (status: 'approved' | 'rejected') => {
    const ids = [...selected].filter(id => items.some(item => item.id === id && item.status === "pending"));
    for (const id of ids) await onReview(id, status);
    setSelected(new Set());
  };
  if (loading) return <ContentSkeleton rows={6}/>;
  if (error) return <EmptyState title="审批请求加载失败" description={error.message} icon={CheckCircle2} action={<Button onClick={onRefresh}>重新加载</Button>}/>;
  return <><Toolbar query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} options={["全部状态", "待审批", "已通过", "已驳回", "已取消"]} sort={sort} setSort={setSort} sortOptions={["时间最新", "时间最早", "申请人 A–Z"]} defaultSort="时间最新" label="审批请求" selectedCount={selected.size} unit="条待审批" onClear={()=>setSelected(new Set())} onRefresh={onRefresh} actions={<><Button variant="primary" onClick={()=>void reviewSelected('approved')}>批量通过</Button><Button variant="danger" onClick={()=>void reviewSelected('rejected')}>批量驳回</Button></>}/><DataTable ariaLabel="审批请求表格" className="admin-approvals-table" minWidth={1020} columns={[{key:'select',title:<Checkbox aria-label="选择本页待审批请求" checked={selectablePage.length>0&&selectablePage.every(item=>selected.has(item.id))} onChange={event=>setSelected(current=>{const next=new Set(current);selectablePage.forEach(item=>event.target.checked?next.add(item.id):next.delete(item.id));return next})}/>,width:52},{ key: 'request', title: '请求', width: 300 }, { key: 'requester', title: <Button onClick={()=>setSort('申请人 A–Z')}>申请人{sortIcon(sort==='申请人 A–Z')}</Button>, width: 200 }, { key: 'status', title: '状态', width: 130 }, { key: 'time', title: <Button onClick={()=>setSort(sort==='时间最新'?'时间最早':'时间最新')}>提交时间{sortIcon(sort==='时间最新'||sort==='时间最早',sort==='时间最新')}</Button>, width: 170 }, { key: 'actions', title: '操作', width:168 }]} rows={paging.pageItems.map(item => ({ key: item.id, className:selected.has(item.id)?'selected':'', cells: [<Checkbox aria-label={`选择审批请求 ${item.id}`} disabled={item.status!=='pending'} checked={selected.has(item.id)} onChange={event=>setSelected(current=>{const next=new Set(current);event.target.checked?next.add(item.id):next.delete(item.id);return next})}/>, <Space orientation="vertical" size={0}><Typography.Text strong ellipsis={{ tooltip: item.action }}>{item.action}</Typography.Text><Typography.Text type="secondary" ellipsis={{ tooltip: `${item.entityType} · ${item.entityId}` }}>{item.entityType} · {item.entityId}</Typography.Text></Space>, <Typography.Text ellipsis={{ tooltip: item.requester ?? item.requestedByUserId }}>{item.requester ?? item.requestedByUserId}</Typography.Text>, <Badge tone={item.status === 'pending' ? 'orange' : item.status === 'approved' ? 'green' : 'neutral'}>{approvalStatusLabel(item.status)}</Badge>, <Typography.Text>{formatDate(item.createdAt, true)}</Typography.Text>, item.status === 'pending' ? <Space><Button variant="primary" onClick={() => void onReview(item.id, 'approved')}>通过</Button><Button variant="danger" onClick={() => void onReview(item.id, 'rejected')}>驳回</Button></Space> : <Typography.Text type="secondary">已处理</Typography.Text>] }))}/><Pagination page={paging.page} pageSize={paging.pageSize} total={rows.length} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} itemName="条审批"/></>;
}
