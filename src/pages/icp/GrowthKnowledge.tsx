import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  BookOpenText,
  Building2,
  CheckCircle2,
  ChevronRight,
  Download,
  Globe2,
  Import,
  Layers3,
  Link2,
  PackageSearch,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CreateDialog } from "@/components/ui/CreateDialog";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Panel } from "@/components/ui/Panel";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { usePagination } from "@/hooks/usePagination";
import { downloadCsv } from "@/utils/download";
import { Checkbox, Descriptions, Space, Typography, Upload } from "antd";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageContainer, SelectionBar, TableToolbar } from "@/components/ui/PageModules";
import {
  icpApi,
  type KnowledgeItemApiRecord,
  type KnowledgeItemStatus,
  type KnowledgeItemType,
} from "@/lib/api";

const typeIcons: Record<KnowledgeItemType, typeof Target> = {
  产品与方案: PackageSearch,
  产品知识: PackageSearch,
  应用知识: Layers3,
  合规知识: BadgeCheck,
  公司资料: Building2,
  客户案例: BookOpenText,
  客户判断规则: Target,
  市场知识: Globe2,
  竞争信息: ShieldCheck,
};
const knowledgeTypeOptions: Array<{ value: KnowledgeItemType; label: string; icon: ReactElement }> = [
  { value: "产品与方案", label: "产品与方案", icon: <PackageSearch /> },
  { value: "产品知识", label: "产品知识", icon: <PackageSearch /> },
  { value: "应用知识", label: "应用知识", icon: <Layers3 /> },
  { value: "合规知识", label: "合规知识", icon: <BadgeCheck /> },
  { value: "公司资料", label: "公司资料", icon: <Building2 /> },
  { value: "客户案例", label: "客户案例", icon: <BookOpenText /> },
  { value: "客户判断规则", label: "客户判断规则", icon: <Target /> },
  { value: "市场知识", label: "市场知识", icon: <Globe2 /> },
  { value: "竞争信息", label: "竞争信息", icon: <ShieldCheck /> },
];

const formatUpdated = (value: number | null | undefined) => {
  if (!value) return "尚未更新";
  const diff = Date.now() - value;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(value);
};

export type GrowthKnowledgeHandle = {
  openNew: () => void;
  openUrl: () => void;
  openFile: () => void;
};

type SortKey =
  | "updated_desc"
  | "updated_asc"
  | "title_asc"
  | "title_desc"
  | "references_desc"
  | "references_asc";

export const GrowthKnowledge = forwardRef<
  GrowthKnowledgeHandle,
  { showToast: (message: string) => void; modal?: boolean }
>(function GrowthKnowledge({ showToast, modal = false }, ref) {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<{ workspace?: { id: string } }>(["auth-session"]);
  const workspaceId = session?.workspace?.id ?? "current";
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"全部类型" | KnowledgeItemType>("全部类型");
  const [status, setStatus] = useState<"全部状态" | KnowledgeItemStatus>("全部状态");
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const [dialog, setDialog] = useState<"new" | "url" | null>(null);
  const [selected, setSelected] = useState<KnowledgeItemApiRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const fileRef = useRef<HTMLDivElement>(null);

  const listQuery = useQuery({
    queryKey: ["icp-knowledge", workspaceId, query, type, status, sort],
    queryFn: () =>
      icpApi.listKnowledge({
        q: query || undefined,
        itemType: type === "全部类型" ? undefined : type,
        status: status === "全部状态" ? undefined : status,
        sort,
        page: 1,
        pageSize: 100,
      }),
    enabled: Boolean(workspaceId),
  });
  const items = listQuery.data?.items ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["icp-knowledge"] });
  const createMutation = useMutation({
    mutationFn: icpApi.createKnowledge,
    onSuccess: invalidate,
    onError: (cause) => showToast(cause instanceof Error ? cause.message : "资料保存失败"),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: KnowledgeItemStatus }) =>
      icpApi.setKnowledgeStatus(id, status),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({ mutationFn: icpApi.removeKnowledge, onSuccess: invalidate });

  useImperativeHandle(ref, () => ({
    openNew: () => setDialog("new"),
    openUrl: () => setDialog("url"),
    openFile: () => fileRef.current?.querySelector<HTMLButtonElement>("button")?.click(),
  }), []);

  const paging = usePagination(items, 6, `${query}|${type}|${status}|${sort}`);
  const pagedItems = paging.pageItems;

  const sortIcon = (active: boolean, descending: boolean) => (
    <span aria-hidden="true">
      {active ? descending ? <ArrowDown /> : <ArrowUp /> : <ArrowUpDown />}
    </span>
  );

  const create = (values: Record<string, string>) => {
    createMutation.mutate(
      {
        title: values.title,
        itemType: (values.type || "市场知识") as KnowledgeItemType,
        summary: values.content || "等待补充知识内容。",
        source: values.source || "手动录入",
        tags: (values.tags || "待整理").split(/[，,]/).map(x => x.trim()).filter(Boolean),
        status: "待复核",
      },
      { onSuccess: () => showToast("资料已保存，等待复核") },
    );
  };
  const addUrl = (values: Record<string, string>) => {
    createMutation.mutate(
      {
        title: values.title,
        itemType: (values.type || "市场知识") as KnowledgeItemType,
        summary: "网页已加入采集队列，当前保存页面地址与用途说明，等待后端提取正文和来源时间。",
        source: `网页 · ${values.url}`,
        sourceUrl: values.url,
        tags: [values.market || "网页来源"],
        status: "待复核",
      },
      { onSuccess: () => showToast("网页已加入知识采集队列") },
    );
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.match(/\.([^.]+)$/)?.[1].toLowerCase() ?? "";
    const textLike = ["txt", "md", "markdown", "csv", "tsv", "json", "log"].includes(extension) || file.type.startsWith("text/");
    const title = file.name.replace(/\.[^.]+$/, "");
    const sizeLabel = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

    if (textLike) {
      const raw = await file.text();
      const normalized = raw
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\u0000/g, "")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (!normalized) {
        showToast("文件内容为空，请选择有文本内容的 TXT/MD/CSV 文件");
        return;
      }
      const maxLength = 7800;
      const summary = normalized.length > maxLength
        ? `${normalized.slice(0, maxLength).trimEnd()}\n\n[文件较大，已保存前 ${maxLength} 字符；原文件共 ${normalized.length} 字符。]`
        : normalized;
      createMutation.mutate(
        {
          title,
          itemType: extension === "csv" || extension === "tsv" ? "市场知识" : "产品与方案",
          summary,
          source: `文件 · ${file.name} · ${sizeLabel} · 文本已提取`,
          tags: ["文件导入", extension ? extension.toUpperCase() : "文本", "待复核"],
          status: "待复核",
        },
        { onSuccess: () => showToast(`${file.name} 已读取并保存，可复核后启用`) },
      );
      return;
    }

    createMutation.mutate(
      {
        title,
        itemType: "产品与方案",
        summary: `已登记二进制文件 ${file.name}（${sizeLabel}）。当前版本可直接提取 TXT/MD/CSV/JSON/LOG 文本；PDF、Word 等格式请先另存为文本，或在详情中手动补充关键内容。`,
        source: `文件 · ${file.name} · ${sizeLabel} · 待人工提取`,
        tags: ["文件导入", extension ? extension.toUpperCase() : "二进制", "待人工提取"],
        status: "待复核",
      },
      { onSuccess: () => showToast(`${file.name} 已登记；请补充文本内容后再启用`) },
    );
  };
  const toggle = (item: KnowledgeItemApiRecord) => {
    const next: KnowledgeItemStatus = item.status === "已启用" ? "已停用" : "已启用";
    statusMutation.mutate({ id: item.id, status: next });
    setSelected(value => value?.id === item.id ? { ...value, status: next } : value);
    showToast(`${item.title}已${next === "已启用" ? "启用" : "停用"}`);
  };
  const remove = () => {
    if (!selected) return;
    removeMutation.mutate(selected.id, { onSuccess: () => showToast("知识条目已删除") });
    setSelected(null);
    setConfirmDelete(false);
  };
  const bulkStatus = (next: KnowledgeItemStatus) => {
    selectedIds.forEach(id => statusMutation.mutate({ id, status: next }));
    showToast(`已更新 ${selectedIds.size} 条资料`);
    setSelectedIds(new Set());
  };
  const bulkRemove = () => {
    selectedIds.forEach(id => removeMutation.mutate(id));
    showToast(`已删除 ${selectedIds.size} 条资料`);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };
  const exportSelected = () => {
    const chosen = items.filter(item => selectedIds.has(item.id));
    downloadCsv("sondara-positioning-data.csv", [
      ["资料标题", "类型", "状态", "来源", "引用次数", "更新时间"],
      ...chosen.map(item => [
        item.title, item.itemType, item.status, item.source,
        item.referenceCount, new Date(item.updatedAt).toLocaleString("zh-CN"),
      ]),
    ]);
    showToast(`已导出 ${chosen.length} 条资料`);
  };

  return (
    <PageContainer>
      {!modal && (
        <PageHeader title="客户定位资料" description="沉淀产品、案例、市场与判断规则，供客户定位和 AI 获客直接引用。" actions={<>
          <Badge tone="green">已接入定位分析</Badge>
            <div ref={fileRef}>
              <Upload
                accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.pdf,.doc,.docx,text/*"
                beforeUpload={(file) => { void onFile(file); return Upload.LIST_IGNORE; }}
                showUploadList={false}
              >
                <Button><Import />导入资料</Button>
              </Upload>
            </div>
            <Button onClick={() => setDialog("url")}><Link2 />添加网页</Button>
            <Button variant="primary" onClick={() => setDialog("new")}><Plus />新增资料</Button>
        </>} />
      )}
      {modal && <div ref={fileRef} hidden>
        <Upload
          accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.pdf,.doc,.docx,text/*"
          beforeUpload={(file) => { void onFile(file); return Upload.LIST_IGNORE; }}
          showUploadList={false}
        >
          <Button><Import />导入资料</Button>
        </Upload>
      </div>}

      <Panel>
          <TableToolbar filters={<>
              <SearchInput ariaLabel="搜索客户定位资料" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索产品、市场、规则或关键词" />
              <CustomSelect ariaLabel="资料类型" value={type} onChange={v => setType(v as typeof type)} options={[
                { value: "全部类型", label: "全部类型", icon: <Layers3 /> },
                ...knowledgeTypeOptions,
              ]} />
              <CustomSelect ariaLabel="资料状态" value={status} onChange={v => setStatus(v as typeof status)} options={[
                { value: "全部状态", label: "全部状态" },
                { value: "已启用", label: "已启用" },
                { value: "待复核", label: "待复核" },
                { value: "已停用", label: "已停用" },
              ]} />
              <CustomSelect ariaLabel="资料排序" value={sort} onChange={v => setSort(v as SortKey)} options={[
                { value: "updated_desc", label: "最近更新", icon: <ArrowUpDown /> },
                { value: "updated_asc", label: "最早更新", icon: <ArrowUpDown /> },
                { value: "title_asc", label: "标题 A–Z", icon: <ArrowDownAZ /> },
                { value: "title_desc", label: "标题 Z–A", icon: <ArrowDownAZ /> },
                { value: "references_desc", label: "引用最多", icon: <ArrowUpDown /> },
                { value: "references_asc", label: "引用最少", icon: <ArrowUpDown /> },
              ]} />
              <Button loading={listQuery.isFetching} onClick={() => { void listQuery.refetch(); showToast("定位资料列表已刷新"); }}>
                {!listQuery.isFetching && <RefreshCw />}刷新
              </Button>
              <Button
                disabled={!query && type === "全部类型" && status === "全部状态" && sort === "updated_desc"}
                onClick={() => { setQuery(""); setType("全部类型"); setStatus("全部状态"); setSort("updated_desc"); }}>
                清除筛选
              </Button>
            </>} selection={selectedIds.size>0 ? <SelectionBar summary={<Space><CheckCircle2/><span>已选择 {selectedIds.size} 条资料</span></Space>} actions={<>
                <Button onClick={() => bulkStatus("已启用")}>启用引用</Button>
                <Button onClick={() => bulkStatus("已停用")}>停用引用</Button>
                <Button onClick={exportSelected}><Download />导出所选</Button>
                <Button onClick={() => setConfirmBulkDelete(true)}>删除所选</Button>
                <Button aria-label="取消选择" title="取消选择" onClick={() => setSelectedIds(new Set())}><X /></Button>
              </>} /> : undefined}/>
          {pagedItems.length ? (
            <>
              <DataTable
                columns={[
                  { key: "select", title: <span><Checkbox aria-label="选择本页全部资料" checked={pagedItems.every(item => selectedIds.has(item.id))} onChange={event => setSelectedIds(current => { const next = new Set(current); pagedItems.forEach(item => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })} /></span>, width: 52 },
                  { key: "title", title: <Button onClick={() => setSort(sort === "title_asc" ? "title_desc" : "title_asc")}>定位资料{sortIcon(sort === "title_asc" || sort === "title_desc", sort === "title_desc")}</Button> },
                  { key: "type", title: "类型" }, { key: "status", title: "状态" }, { key: "source", title: "来源" },
                  { key: "usage", title: <Button onClick={() => setSort(sort === "references_desc" ? "references_asc" : "references_desc")}>使用情况{sortIcon(sort === "references_desc" || sort === "references_asc", sort === "references_desc")}</Button> },
                  { key: "updated", title: <Button onClick={() => setSort(sort === "updated_desc" ? "updated_asc" : "updated_desc")}>更新时间{sortIcon(sort === "updated_desc" || sort === "updated_asc", sort === "updated_desc")}</Button> },
                  { key: "actions", title: "操作", width: 72 },
                ]}
                rows={pagedItems.map(item => { const Icon = typeIcons[item.itemType as KnowledgeItemType] ?? Layers3; return { key: item.id, className: selectedIds.has(item.id) ? "selected" : "", cells: [
                  <Checkbox aria-label={`选择 ${item.title}`} checked={selectedIds.has(item.id)} onChange={event => setSelectedIds(current => { const next = new Set(current); event.target.checked ? next.add(item.id) : next.delete(item.id); return next; })} />,
                  <Button type="link" onClick={() => setSelected(item)}><Icon /><Space direction="vertical" size={0}><Typography.Text strong>{item.title}</Typography.Text><Typography.Text type="secondary" ellipsis>{item.summary}</Typography.Text></Space></Button>,
                  <Badge tone="blue">{item.itemType}</Badge>,
                  <Badge tone={item.status === "已启用" ? "green" : item.status === "待复核" ? "orange" : "neutral"}>{item.status}</Badge>,
                  <Space direction="vertical" size={0}><Typography.Text strong>{item.source}</Typography.Text><Typography.Text type="secondary">{item.sourceUrl || "保留来源记录"}</Typography.Text></Space>,
                  <Space direction="vertical" size={0}><Typography.Text strong>{item.referenceCount} 次</Typography.Text><Typography.Text type="secondary">累计引用</Typography.Text></Space>,
                  <Typography.Text>{formatUpdated(item.updatedAt)}</Typography.Text>,
                  <Button aria-label={`查看 ${item.title}`} title="查看资料" onClick={() => setSelected(item)}><ChevronRight /></Button>,
                ] }; })}
              />
              <Pagination
                page={paging.page} pageSize={paging.pageSize} total={items.length}
                onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize}
                pageSizeOptions={[6, 10, 20]} itemName="条资料"
              />
            </>
          ) : listQuery.isLoading ? (
            <EmptyState spinning title="正在加载定位资料" description="从工作区读取中…" icon={RefreshCw} />
          ) : (
            <EmptyState title="暂无定位资料" icon={BookOpenText} />
          )}
      </Panel>

      <CreateDialog open={dialog === "new"} title="新增客户定位资料"
        description="创建后先进入待复核状态，确认无误再用于客户定位和 AI 获客。"
        submitLabel="保存资料" successMessage="资料已保存，等待复核"
        onClose={() => setDialog(null)} onSubmit={create}
        fields={[
          { name: "title", label: "资料标题", required: true },
          { name: "type", label: "资料类型", type: "select", required: true, options: knowledgeTypeOptions.map(option => option.label) },
          { name: "content", label: "资料内容", type: "textarea", required: true },
          { name: "tags", label: "关键词标签", placeholder: "德国，食品设备，扩产信号" },
          { name: "source", label: "来源说明", placeholder: "例如：产品手册 2026 版" },
        ]} />
      <CreateDialog open={dialog === "url"} title="添加网页来源"
        description="保存网址和用途，后端接入后自动采集正文、发布时间和来源快照。"
        submitLabel="加入采集队列" successMessage="网页已加入知识采集队列"
        onClose={() => setDialog(null)} onSubmit={addUrl}
        fields={[
          { name: "title", label: "来源名称", required: true },
          { name: "url", label: "网页地址", required: true, placeholder: "https://example.com/article" },
          { name: "type", label: "知识类型", type: "select", required: true, options: knowledgeTypeOptions.map(option => option.label) },
          { name: "market", label: "适用市场", placeholder: "例如：德国食品设备" },
        ]} />
      <Modal open={Boolean(selected) && !confirmDelete}
        title={selected?.title ?? ""}
        description={`${selected?.itemType ?? ""} · ${selected?.source ?? ""}`}
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 />删除</Button>
            <Button onClick={() => selected && toggle(selected)}>
              {selected?.status === "已启用" ? "停用引用" : "启用引用"}
            </Button>
            <Button variant="primary" onClick={() => setSelected(null)}>完成</Button>
          </>
        }>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Space wrap>
            <Badge tone={selected?.status === "已启用" ? "green" : "orange"}>{selected?.status}</Badge>
            <Typography.Text type="secondary">更新于 {formatUpdated(selected?.updatedAt)}</Typography.Text>
            <Typography.Text type="secondary">已被客户研究引用 {selected?.referenceCount} 次</Typography.Text>
          </Space>
          <Typography.Paragraph>{selected?.summary}</Typography.Paragraph>
          <Space wrap>
            {selected?.tags.map(tag => <Badge key={tag} tone="blue">{tag}</Badge>)}
          </Space>
          <Descriptions bordered column={1} items={[
            {key:"stages",label:"参与环节",children:"搜索策略、客户匹配、证据判断、沟通建议"},
            {key:"source",label:"来源",children:`${selected?.source ?? ""}${selected?.sourceUrl ? ` · ${selected.sourceUrl}` : ""}`},
            {key:"rule",label:"引用原则",children:"仅启用状态参与 AI 判断，所有结论仍需保留外部事实证据。"},
          ]}/>
        </Space>
      </Modal>
      <Modal open={confirmDelete} title="删除知识条目" description="删除后不会再参与后续客户研究。"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>取消</Button>
            <Button variant="danger" onClick={remove}>确认删除</Button>
          </>
        }>
        <Typography.Paragraph>历史客户研究结果会保留，但将失去这条知识的后续引用。你也可以选择停用，以便将来恢复。</Typography.Paragraph>
      </Modal>
      <Modal open={confirmBulkDelete} title="删除所选资料" description={`将删除已选择的 ${selectedIds.size} 条资料。`}
        onClose={() => setConfirmBulkDelete(false)}
        footer={
          <>
            <Button onClick={() => setConfirmBulkDelete(false)}>取消</Button>
            <Button variant="danger" onClick={bulkRemove}>确认删除</Button>
          </>
        }>
        <Typography.Paragraph>删除后这些资料不会再参与客户定位和 AI 获客，历史引用记录仍会保留。</Typography.Paragraph>
      </Modal>
    </PageContainer>
  );
});
