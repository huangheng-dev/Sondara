import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  CheckCircle2,
  Copy,
  Database,
  Download,
  KeyRound,
  LockKeyhole,
  Mail,
  MapPinned,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useUiStore } from "@/stores/ui-store";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { CreateDialog } from "@/components/ui/CreateDialog";
import { integrationServices } from "@/data/channels";
import { useBusinessStore } from "@/stores/business-store";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/ui/DataTable";
import { usePagination } from "@/hooks/usePagination";
import { Checkbox, Input, Switch } from "antd";
import {
  aiApi,
  authApi,
  integrationApi,
  outboxApi,
  systemApi,
  type AiServiceApiRecord,
  type AiServiceKeyApiRecord,
  type ChannelWebhookEventApiRecord,
  type ContactSuppressionApiRecord,
  type OutboundConnectionApiRecord,
} from "@/lib/api";

const sections = {
  profile: "个人资料",
  ai: "AI 模型配置",
  integrations: "数据源与集成",
  data: "数据与备份",
  security: "登录与安全",
} as const;
const sectionMeta = {
  个人资料: {
    title: "个人资料与偏好",
    description: "设置显示身份、语言、时区和经营数据的默认口径。",
    icon: UserRound,
  },
  "AI 模型配置": {
    title: "AI 模型配置",
    description: "管理多模型服务、密钥池、轮转重试与自动故障切换。",
    icon: Bot,
  },
  数据源与集成: {
    title: "数据源与外部服务",
    description: "管理客户发现、触达发送、联系人补全与自动化连接。",
    icon: KeyRound,
  },
  数据与备份: {
    title: "数据与备份",
    description: "查看数据位置与隔离状态，并导出当前账户的完整备份。",
    icon: Database,
  },
  登录与安全: {
    title: "登录与安全",
    description: "管理密码、双重验证、活动会话和账户危险操作。",
    icon: LockKeyhole,
  },
} as const;

type AiServiceStatus = "可用" | "未验证" | "停用" | "异常";
type AiServiceSort =
  | "优先级最高"
  | "服务名称 A–Z"
  | "服务名称 Z–A"
  | "延迟最低"
  | "密钥最多";
type AiService = {
  id: string;
  name: string;
  provider: string;
  model: string;
  endpoint: string;
  keyCount: number;
  status: AiServiceStatus;
  priority: number;
  latency: string;
};
type AiKeyRecord = {
  id: string;
  serviceId: string;
  name: string;
  ending: string;
  status: "启用" | "停用";
  lastUsed: string;
};
const providerLabel = (provider: AiServiceApiRecord["provider"]) =>
  provider === "deepseek"
    ? "DeepSeek"
    : provider === "dashscope"
      ? "阿里云百炼"
      : "OpenAI 兼容服务";
const mapAiService = (service: AiServiceApiRecord): AiService => ({
  id: service.id,
  name: service.name,
  provider: providerLabel(service.provider),
  model: service.model,
  endpoint: service.endpoint,
  keyCount: service.keyCount,
  status: !service.enabled
    ? "停用"
    : service.keyCount === 0
      ? "未验证"
    : service.status === "available"
      ? "可用"
      : service.status === "error"
        ? "异常"
        : "未验证",
  priority: service.priority,
  latency: service.lastLatencyMs ? `${service.lastLatencyMs} ms` : "—",
});
const mapAiKey = (key: AiServiceKeyApiRecord): AiKeyRecord => ({
  id: key.id,
  serviceId: key.serviceId,
  name: key.name,
  ending: key.ending,
  status: key.enabled ? "启用" : "停用",
  lastUsed: key.lastUsedAt
    ? new Date(key.lastUsedAt).toLocaleString("zh-CN")
    : "尚未使用",
});
const integrationGroups = [
  {
    title: "客户发现与验证",
    description: "用于寻找企业、补全联系人并核验公开商业信号",
    services: integrationServices.filter((service) => service.name !== "邮件发送服务"),
  },
  {
    title: "邮件触达与投递治理",
    description: "用于人工确认发送、退信退订处理与入站回复同步",
    services: integrationServices.filter((service) => service.name === "邮件发送服务"),
  },
];
const builtInIntegrations = new Set(["联系人补全 API", "行业与招投标数据"]);
type ConfigurableIntegration = "搜索与网页 API" | "地图 API";
const aiSortIcon = (active: boolean, descending = false) => (
  <span className="customer-sort-icon" aria-hidden="true">
    {active ? descending ? <ArrowDown /> : <ArrowUp /> : <ArrowUpDown />}
  </span>
);

function OutboundSettings() {
  const showToast = useUiStore((state) => state.showToast);
  const [editing, setEditing] = useState<
    OutboundConnectionApiRecord | "new" | null
  >(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [governanceOpen, setGovernanceOpen] = useState(false);
  const [governanceView, setGovernanceView] = useState("抑制名单");
  const [suppressionStatus, setSuppressionStatus] = useState("active");
  const [suppressionQuery, setSuppressionQuery] = useState("");
  const [webhookConnection, setWebhookConnection] =
    useState<OutboundConnectionApiRecord | null>(null);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [jobStatus, setJobStatus] = useState("all");
  const connections = useQuery({
    queryKey: ["outbound-connections"],
    queryFn: outboxApi.listConnections,
    retry: 1,
  });
  const jobs = useQuery({
    queryKey: ["outbox-jobs", jobStatus],
    queryFn: () =>
      outboxApi.listJobs({
        status: jobStatus as
          | "all"
          | "awaiting_configuration"
          | "queued"
          | "processing"
          | "sent"
          | "failed"
          | "cancelled",
        pageSize: 20,
      }),
    enabled: queueOpen,
    retry: 1,
  });
  const suppressions = useQuery({
    queryKey: ["outbox-suppressions", suppressionStatus, suppressionQuery],
    queryFn: () =>
      outboxApi.listSuppressions({
        q: suppressionQuery,
        status: suppressionStatus as "active" | "restored" | "all",
        pageSize: 50,
      }),
    enabled: governanceOpen && governanceView === "抑制名单",
    retry: 1,
  });
  const channelEvents = useQuery({
    queryKey: ["outbox-channel-events"],
    queryFn: outboxApi.listEvents,
    enabled: governanceOpen && governanceView === "渠道事件",
    retry: 1,
  });
  const current = editing === "new" ? null : editing;
  const save = async (values: Record<string, string>) => {
    const providerMap = { SMTP: "smtp", SendGrid: "sendgrid", Mailgun: "mailgun", Webhook: "webhook", "WhatsApp Cloud API": "whatsapp-cloud" } as const;
    const input = {
      name: values.name,
      provider: providerMap[values.provider as keyof typeof providerMap] ?? "smtp",
      host: values.host,
      port: Number(values.port) || 587,
      secure: values.security === "SSL / TLS",
      username: values.username,
      password: values.password,
      fromName: values.fromName,
      fromEmail: values.fromEmail,
      replyTo: values.replyTo || null,
      imapEnabled: values.imapEnabled === "启用",
      imapHost: values.imapHost || null,
      imapPort: Number(values.imapPort) || 993,
      imapSecure: values.imapSecurity !== "明文 / STARTTLS",
      imapUsername: values.imapUsername || null,
      imapPassword: values.imapPassword,
      priority: Number(values.priority) || 1,
    };
    if (current) {
      const { password, imapPassword, ...rest } = input;
      await outboxApi.updateConnection(current.id, {
        ...rest,
        ...(password ? { password } : {}),
        ...(imapPassword ? { imapPassword } : {}),
      });
    } else {
      if (!input.password) throw new Error("首次配置必须填写发送服务密钥或密码。");
      const created = await outboxApi.createConnection(input);
      setWebhookConnection(created);
      setWebhookSecret(created.webhookSecret);
    }
    await connections.refetch();
  };
  const statusLabel = (status: OutboundConnectionApiRecord["status"]) =>
    status === "available" ? "可用" : status === "error" ? "异常" : "待测试";
  return (
    <section className="outbound-settings-section">
      <header>
        <span>
          <strong>消息发送、收件与队列</strong>
          <small>
            支持 SMTP、SendGrid、Mailgun、WhatsApp Cloud API 与合规 Webhook；每个邮件服务可独立配置 IMAP 收件
          </small>
        </span>
        <div>
          <Button size="sm" onClick={() => setGovernanceOpen(true)}>
            <ShieldCheck size={14} />
            发送治理
          </Button>
          <Button size="sm" onClick={() => setQueueOpen(true)}>
            <Route size={14} />
            发送队列
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus size={14} />
            添加发送服务
          </Button>
        </div>
      </header>
      <div className="outbound-connection-grid">
        {connections.data?.items.length ? (
          connections.data.items.map((connection) => (
            <article key={connection.id}>
              <i>
                <Mail size={18} />
              </i>
              <span>
                <strong>{connection.name}</strong>
                <small>
                  {connection.provider.toUpperCase()} · {connection.host}{connection.provider === "smtp" ? `:${connection.port}` : ""} · {connection.fromEmail}
                </small>
                <em>
                  优先级 {connection.priority}
                  {connection.lastLatencyMs
                    ? ` · ${connection.lastLatencyMs} ms`
                    : ""}
                </em>
              </span>
              <div>
                <Badge
                  tone={
                    connection.status === "available"
                      ? "green"
                      : connection.status === "error"
                        ? "red"
                        : "orange"
                  }
                >
                  {statusLabel(connection.status)}
                </Badge>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const result = await outboxApi.testConnection(
                        connection.id,
                      );
                      await Promise.all([
                        connections.refetch(),
                        jobs.refetch(),
                      ]);
                      showToast(
                        `发送服务正常 · ${result.latencyMs} ms${result.imapLatencyMs ? ` · IMAP ${result.imapLatencyMs} ms` : ""}${result.activatedJobs ? `，已激活 ${result.activatedJobs} 个待发送任务` : ""}`,
                      );
                    } catch (cause) {
                      await connections.refetch();
                      showToast(
                        cause instanceof Error
                          ? cause.message
                          : "发送服务连接测试失败",
                      );
                    }
                  }}
                >
                  测试
                </Button>
                <Button size="sm" onClick={() => setEditing(connection)}>
                  管理
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setWebhookConnection(connection);
                    setWebhookSecret("");
                  }}
                >
                  回调
                </Button>
              </div>
            </article>
          ))
        ) : (
          <EmptyState
            className="list-empty-state"
            title="暂无邮件发送配置"
            icon={Mail}
          />
        )}
      </div>
      <CreateDialog
        open={Boolean(editing)}
        title={current ? "管理发送与收件服务" : "添加发送与收件服务"}
        description="密钥、密码和 IMAP 凭据仅发送到本部署并加密保存；Webhook 可承接 LinkedIn、WhatsApp 等已获授权的渠道适配器。"
        submitLabel={current ? "保存修改" : "保存服务"}
        successMessage="发送服务已保存，请执行连接测试"
        onClose={() => setEditing(null)}
        onSubmit={save}
        initialValues={
          current
            ? {
                name: current.name,
                provider: current.provider === "smtp" ? "SMTP" : current.provider === "sendgrid" ? "SendGrid" : current.provider === "mailgun" ? "Mailgun" : current.provider === "whatsapp-cloud" ? "WhatsApp Cloud API" : "Webhook",
                host: current.host,
                port: String(current.port),
                security: current.secure ? "SSL / TLS" : "STARTTLS",
                username: current.username,
                password: "",
                fromName: current.fromName,
                fromEmail: current.fromEmail,
                replyTo: current.replyTo ?? "",
                priority: String(current.priority),
                imapEnabled: current.imapEnabled ? "启用" : "关闭",
                imapHost: current.imapHost ?? "",
                imapPort: String(current.imapPort),
                imapSecurity: current.imapSecure ? "SSL / TLS" : "明文 / STARTTLS",
                imapUsername: current.imapUsername ?? "",
                imapPassword: "",
              }
            : {
                port: "587",
                provider: "SMTP",
                security: "STARTTLS",
                priority: String((connections.data?.items.length ?? 0) + 1),
                imapEnabled: "关闭",
                imapPort: "993",
                imapSecurity: "SSL / TLS",
              }
        }
        fields={[
          {
            name: "name",
            label: "服务名称",
            required: true,
            placeholder: "例如：企业邮箱主服务",
          },
          { name: "provider", label: "发送方式", type: "select", required: true, options: ["SMTP", "SendGrid", "Mailgun", "WhatsApp Cloud API", "Webhook"] },
          {
            name: "host",
            label: "SMTP 主机或 API 地址",
            required: true,
            placeholder: "smtp.example.com 或 https://api.example.com",
          },
          { name: "port", label: "端口", type: "number", required: true },
          {
            name: "security",
            label: "连接安全",
            type: "select",
            required: true,
            options: ["STARTTLS", "SSL / TLS"],
          },
          {
            name: "username",
            label: "登录账号",
            required: true,
            placeholder: "通常为完整邮箱地址",
          },
          {
            name: "password",
            label: current
              ? `发送密钥/密码（当前 •••• ${current.secretEnding}）`
              : "发送密钥/密码",
            required: !current,
            placeholder: current
              ? "留空保留现有密码"
              : "输入 API Key、Token、授权码或 SMTP 密码",
          },
          {
            name: "fromName",
            label: "发件人名称",
            required: true,
            placeholder: "例如：Sondara 增长团队",
          },
          {
            name: "fromEmail",
            label: "发件邮箱",
            required: true,
            placeholder: "growth@example.com",
          },
          {
            name: "replyTo",
            label: "回复邮箱",
            placeholder: "可选；留空使用发件邮箱",
          },
          {
            name: "priority",
            label: "调用优先级",
            type: "number",
            required: true,
          },
          { name: "imapEnabled", label: "IMAP 自动收件", type: "select", required: true, options: ["关闭", "启用"] },
          { name: "imapHost", label: "IMAP 主机", placeholder: "imap.example.com；未启用可留空" },
          { name: "imapPort", label: "IMAP 端口", type: "number" },
          { name: "imapSecurity", label: "IMAP 安全", type: "select", options: ["SSL / TLS", "明文 / STARTTLS"] },
          { name: "imapUsername", label: "IMAP 账号", placeholder: "通常为完整邮箱地址" },
          { name: "imapPassword", label: current?.hasImapSecret ? `IMAP 密码（当前 •••• ${current.imapSecretEnding}）` : "IMAP 密码", placeholder: current?.hasImapSecret ? "留空保留现有密码" : "启用 IMAP 时填写" },
        ]}
      />
      <Modal
        open={queueOpen}
        title="邮件发送队列"
        description="统一查看待配置、发送中、已发送与失败任务；失败重试仍需人工确认。"
        width={1120}
        onClose={() => setQueueOpen(false)}
        footer={<Button onClick={() => setQueueOpen(false)}>关闭</Button>}
      >
        <div className="outbox-modal">
          <div className="outbox-toolbar">
            <CustomSelect
              ariaLabel="发送状态"
              value={jobStatus}
              onChange={setJobStatus}
              options={[
                { label: "全部状态", value: "all" },
                { label: "等待配置", value: "awaiting_configuration" },
                { label: "待发送", value: "queued" },
                { label: "发送中", value: "processing" },
                { label: "已发送", value: "sent" },
                { label: "失败", value: "failed" },
              ]}
            />
            <Button size="sm" onClick={() => jobs.refetch()}>
              <RefreshCw size={14} />
              刷新
            </Button>
            <span>共 {jobs.data?.total ?? 0} 个任务</span>
          </div>
          {jobs.data?.items.length ? <DataTable
            className="customer-table customer-table-pro outbox-table"
            columns={[{key:"recipient",title:"收件人"},{key:"message",title:"主题与内容"},{key:"status",title:"状态"},{key:"attempts",title:"尝试"},{key:"updated",title:"更新时间"},{key:"actions",title:"操作",width:72}]}
            rows={jobs.data.items.map(job=>({key:job.id,cells:[
              <div className="standard-cell-stack"><strong>{job.contact.name}</strong><small>{job.contact.company} · {job.contact.email??"缺少邮箱"}</small></div>,
              <div className="standard-cell-stack"><strong>{job.thread.subject}</strong><small>{job.message.body}</small></div>,
              <div className="standard-cell-stack"><Badge tone={job.status==="sent"?"green":job.status==="failed"?"red":job.status==="awaiting_configuration"?"orange":"blue"}>{{awaiting_configuration:"等待配置",queued:"待发送",processing:"发送中",sent:"已发送",failed:"失败",cancelled:"已取消"}[job.status]}</Badge>{job.lastError&&<small title={job.lastError}>{job.lastError}</small>}</div>,
              <span>{job.attempts} / {job.maxAttempts}</span>,<span>{new Date(job.updatedAt).toLocaleString("zh-CN")}</span>,
              <div className="standard-row-actions">{["failed","awaiting_configuration"].includes(job.status)&&<Button title="确认重试" onClick={async()=>{try{await outboxApi.retryJob(job.id);await jobs.refetch();showToast("发送任务已重新进入队列")}catch(cause){showToast(cause instanceof Error?cause.message:"任务重试失败")}}}><RefreshCw/></Button>}</div>,
            ]}))}
          />:<EmptyState className="list-empty-state compact" title="暂无发送任务" icon={Mail}/>}
        </div>
      </Modal>
      <Modal
        open={governanceOpen}
        title="发送治理"
        description="退信、投诉和退订地址会自动进入抑制名单；恢复发送前必须确认已重新获得联系人许可。"
        width={1120}
        onClose={() => setGovernanceOpen(false)}
        footer={<Button onClick={() => setGovernanceOpen(false)}>关闭</Button>}
      >
        <div className="outbox-modal">
          <div className="outbox-toolbar governance-toolbar">
            <CustomSelect
              ariaLabel="治理内容"
              value={governanceView}
              onChange={setGovernanceView}
              options={["抑制名单", "渠道事件"]}
            />
            {governanceView === "抑制名单" && (
              <>
                <label className="customer-search module-search">
                  <Search />
                  <Input
                    aria-label="搜索抑制名单"
                    value={suppressionQuery}
                    onChange={(event) =>
                      setSuppressionQuery(event.target.value)
                    }
                    placeholder="搜索邮箱或原因"
                  />
                </label>
                <CustomSelect
                  ariaLabel="抑制状态"
                  value={suppressionStatus}
                  onChange={setSuppressionStatus}
                  options={[
                    { label: "当前抑制", value: "active" },
                    { label: "已恢复", value: "restored" },
                    { label: "全部状态", value: "all" },
                  ]}
                />
                <Button size="sm" onClick={() => suppressions.refetch()}>
                  <RefreshCw size={14} />
                  刷新
                </Button>
                <span>共 {suppressions.data?.total ?? 0} 条记录</span>
              </>
            )}
            {governanceView === "渠道事件" && (
              <>
                <Button size="sm" onClick={() => channelEvents.refetch()}>
                  <RefreshCw size={14} />
                  刷新
                </Button>
                <span>最近 {channelEvents.data?.items.length ?? 0} 条事件</span>
              </>
            )}
          </div>
          {governanceView === "抑制名单" ? (
            suppressions.data?.items.length ? <DataTable className="customer-table customer-table-pro outbox-table governance-table" columns={[{key:"email",title:"邮箱地址"},{key:"reason",title:"原因"},{key:"source",title:"来源"},{key:"status",title:"状态"},{key:"updated",title:"更新时间"},{key:"actions",title:"操作",width:72}]} rows={suppressions.data.items.map((item:ContactSuppressionApiRecord)=>({key:item.id,cells:[
              <div className="standard-cell-stack"><strong>{item.destination}</strong><small>邮件渠道</small></div>,<span>{item.reason}</span>,<span>{item.source==="channel_event"?"渠道事件":item.source}</span>,<Badge tone={item.active?"red":"neutral"}>{item.active?"已抑制":"已恢复"}</Badge>,<span>{new Date(item.updatedAt).toLocaleString("zh-CN")}</span>,
              <div className="standard-row-actions">{item.active&&<Button title="确认恢复发送" onClick={async()=>{try{await outboxApi.restoreSuppression(item.id);await suppressions.refetch();showToast("该地址已移出抑制名单")}catch(cause){showToast(cause instanceof Error?cause.message:"恢复发送失败")}}}><RotateCcw/></Button>}</div>,
            ]}))}/> : <EmptyState className="list-empty-state compact" title="暂无抑制记录" icon={Mail}/>
          ) : (
            channelEvents.data?.items.length ? <DataTable className="customer-table customer-table-pro outbox-table governance-table" columns={[{key:"type",title:"事件类型"},{key:"address",title:"地址"},{key:"message",title:"关联消息"},{key:"status",title:"处理状态"},{key:"time",title:"发生时间"},{key:"note",title:"说明"}]} rows={channelEvents.data.items.map((item:ChannelWebhookEventApiRecord)=>({key:item.id,cells:[
              <Badge tone={item.eventType==="bounced"||item.eventType==="complained"?"red":item.eventType==="unsubscribed"?"orange":"blue"}>{{delivered:"已送达",bounced:"退信",complained:"投诉",unsubscribed:"退订",inbound_reply:"客户回复"}[item.eventType]}</Badge>,
              <div className="standard-cell-stack"><strong>{item.sender??item.recipient??"—"}</strong><small>{item.recipient&&item.sender?`发送至 ${item.recipient}`:""}</small></div>,<span title={item.externalMessageId??""}>{item.externalMessageId??"未关联"}</span>,
              <Badge tone={item.processingStatus==="processed"?"green":item.processingStatus==="unlinked"?"orange":item.processingStatus==="failed"?"red":"blue"}>{{processed:"已处理",unlinked:"未关联",failed:"失败",pending:"处理中"}[item.processingStatus]}</Badge>,<span>{new Date(item.occurredAt).toLocaleString("zh-CN")}</span>,<span>{item.reason??item.processingError??"—"}</span>,
            ]}))}/> : <EmptyState className="list-empty-state compact" title="暂无渠道事件" icon={Mail}/>
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(webhookConnection)}
        title={`事件接入 · ${webhookConnection?.name ?? ""}`}
        description="渠道适配器使用 HMAC-SHA256 签名回传送达、退信、退订和客户回复。签名密钥只在生成或轮换时显示一次。"
        width={720}
        onClose={() => {
          setWebhookConnection(null);
          setWebhookSecret("");
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setWebhookConnection(null);
                setWebhookSecret("");
              }}
            >
              关闭
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!webhookConnection) return;
                try {
                  const result = await outboxApi.rotateWebhookSecret(
                    webhookConnection.id,
                  );
                  setWebhookSecret(result.webhookSecret);
                  await connections.refetch();
                  showToast(
                    webhookConnection.hasWebhookSecret
                      ? "签名密钥已轮换，旧密钥立即失效"
                      : "签名密钥已生成",
                  );
                } catch (cause) {
                  showToast(
                    cause instanceof Error ? cause.message : "签名密钥生成失败",
                  );
                }
              }}
            >
              {webhookConnection?.hasWebhookSecret
                ? "轮换签名密钥"
                : "生成签名密钥"}
            </Button>
          </>
        }
      >
        <div className="webhook-setup">
          <div>
            <span>
              <strong>事件接收地址</strong>
              <small>配置到邮件服务或渠道适配器的回调地址</small>
            </span>
            <code>
              {webhookConnection
                ? `${window.location.origin}/api/outbox-webhooks/${webhookConnection.id}`
                : ""}
            </code>
            <Button
              size="sm"
              onClick={() => {
                if (!webhookConnection) return;
                navigator.clipboard?.writeText(
                  `${window.location.origin}/api/outbox-webhooks/${webhookConnection.id}`,
                );
                showToast("事件接收地址已复制");
              }}
            >
              <Copy />
              复制地址
            </Button>
          </div>
          <div>
            <span>
              <strong>签名密钥</strong>
              <small>
                {webhookSecret
                  ? "请立即保存，关闭后无法再次查看"
                  : "当前密钥仅显示末四位"}
              </small>
            </span>
            <code>
              {webhookSecret ||
                `•••• •••• •••• ${webhookConnection?.webhookSecretEnding ?? "未生成"}`}
            </code>
            <Button
              size="sm"
              disabled={!webhookSecret}
              onClick={() => {
                navigator.clipboard?.writeText(webhookSecret);
                showToast("签名密钥已复制");
              }}
            >
              <Copy />
              复制密钥
            </Button>
          </div>
          <section>
            <strong>签名协议</strong>
            <p>
              请求头携带 <code>x-sondara-timestamp</code> 和{" "}
              <code>x-sondara-signature</code>。签名内容为{" "}
              <code>timestamp.JSON</code>，使用 HMAC-SHA256；超过 5
              分钟或重复事件不会重复处理。
            </p>
          </section>
        </div>
      </Modal>
    </section>
  );
}

export function SettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab = sections[params.section as keyof typeof sections] ?? "个人资料";
  const [confirmDelete, setConfirmDelete] = useState<"key" | "account" | null>(
    null,
  );
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [aiServices, setAiServices] = useState<AiService[]>([]);
  const [aiKeys, setAiKeys] = useState<AiKeyRecord[]>([]);
  const [serviceDialog, setServiceDialog] = useState(false);
  const [keyService, setKeyService] = useState<AiService | null>(null);
  const [addKeyService, setAddKeyService] = useState<AiService | null>(null);
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [rotationStrategy, setRotationStrategy] = useState("失败后切换密钥");
  const [retryCount, setRetryCount] = useState("2 次");
  const [retryDelay, setRetryDelay] = useState("指数退避");
  const [cooldown, setCooldown] = useState("5 分钟");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceStatus, setServiceStatus] = useState("全部状态");
  const [serviceSort, setServiceSort] = useState<AiServiceSort>("优先级最高");
  const [selectedAiServices, setSelectedAiServices] = useState<Set<string>>(
    new Set(),
  );
  const [integration, setIntegration] = useState<ConfigurableIntegration | null>(null);
  const [securityDialog, setSecurityDialog] = useState<
    "password" | "2fa" | null
  >(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorSetup, setTwoFactorSetup] = useState<{secret:string;otpauth:string;accountName:string}|null>(null);
  const [twoFactorQrCode, setTwoFactorQrCode] = useState("");
  const [twoFactorRecovery, setTwoFactorRecovery] = useState<string[]|null>(null);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [accountDeletePassword, setAccountDeletePassword] = useState("");
  const [accountDeleteConfirmation, setAccountDeleteConfirmation] = useState("");
  const [profileDraft, setProfileDraft] = useState(() => {
    const saved = useBusinessStore.getState().accountPreferences;
    return {
      displayName: saved?.displayName ?? "",
      email: saved?.email ?? "",
      language: saved?.language ?? "简体中文",
      timezone: saved?.timezone ?? "Asia/Shanghai (UTC+8)",
      currency: saved?.currency ?? "CNY · 人民币",
      businessName: saved?.businessName ?? "",
    };
  });
  const showToast = useUiStore((s) => s.showToast);
  const twoFactorStatusQuery = useQuery({
    queryKey: ["auth", "2fa"],
    queryFn: authApi.twoFactorStatus,
    enabled: tab === "登录与安全",
    retry: 1,
  });
  const authSessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: authApi.session,
    enabled: tab === "个人资料" || tab === "登录与安全",
    retry: 1,
  });
  const sessionsQuery = useQuery({
    queryKey: ["auth-sessions"],
    queryFn: authApi.listSessions,
    enabled: tab === "登录与安全",
    retry: 1,
  });
  const backupsQuery = useQuery({
    queryKey: ["system-backups"],
    queryFn: systemApi.listBackups,
    enabled: tab === "数据与备份",
    retry: 1,
  });
  const operationsQuery = useQuery({
    queryKey: ["system-operations"],
    queryFn: systemApi.operations,
    enabled: tab === "数据与备份",
    retry: 1,
  });

  useEffect(() => {
    const session = authSessionQuery.data;
    if (!session) return;
    setProfileDraft({
      displayName: session.user.displayName,
      email: session.user.email,
      language: session.user.locale === "en" ? "English" : "简体中文",
      timezone: session.user.timezone === "Europe/Berlin" ? "Europe/Berlin (UTC+2)" : "Asia/Shanghai (UTC+8)",
      currency: `${session.user.currency ?? "CNY"} · ${session.user.currency === "EUR" ? "欧元" : session.user.currency === "USD" ? "美元" : "人民币"}`,
      businessName: session.workspace.name,
    });
  }, [authSessionQuery.data]);

  useEffect(() => {
    let active = true;
    const otpauth = twoFactorSetup?.otpauth;
    if (!otpauth) {
      setTwoFactorQrCode("");
      return;
    }
    QRCode.toDataURL(otpauth, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => {
        if (active) setTwoFactorQrCode(url);
      })
      .catch(() => {
        if (active) setTwoFactorQrCode("");
      });
    return () => {
      active = false;
    };
  }, [twoFactorSetup?.otpauth]);

  const openTwoFactorDialog = async () => {
    setTwoFactorCode("");
    setTwoFactorPassword("");
    setTwoFactorRecovery(null);
    setTwoFactorSetup(null);
    setTwoFactorQrCode("");
    setSecurityDialog("2fa");
    if (!twoFactorStatusQuery.data?.enabled) {
      setTwoFactorBusy(true);
      try {
        const setup = await authApi.setup2fa();
        if (!("enabled" in setup)) setTwoFactorSetup(setup);
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : "无法生成验证器密钥");
      } finally {
        setTwoFactorBusy(false);
      }
    }
  };
  const closeTwoFactorDialog = () => {
    setSecurityDialog(null);
    setTwoFactorCode("");
    setTwoFactorPassword("");
    setTwoFactorSetup(null);
    setTwoFactorQrCode("");
    setTwoFactorRecovery(null);
    setTwoFactorBusy(false);
  };
  const submitTwoFactor = async () => {
    if (!twoFactorPassword) { showToast("请输入当前登录密码"); return; }
    if (!/^\d{6}$|^[0-9A-F]{4}-?[0-9A-F]{4}$/i.test(twoFactorCode.trim())) { showToast("请输入 6 位验证码或 8 位恢复码"); return; }
    setTwoFactorBusy(true);
    try {
      let shouldClose = true;
      if (twoFactorStatusQuery.data?.enabled) {
        await authApi.disable2fa({ currentPassword: twoFactorPassword, code: twoFactorCode.trim() });
        showToast("双重验证已关闭，请使用其他恢复方式重新登录其他设备");
      } else {
        if (!twoFactorSetup) throw new Error("验证器密钥已过期，请重新打开设置窗口");
        const result = await authApi.enable2fa({ currentPassword: twoFactorPassword, secret: twoFactorSetup.secret, code: twoFactorCode.trim() });
        setTwoFactorRecovery(result.recoveryCodes);
        shouldClose = false;
        showToast("双重验证已启用，请立即保存恢复码");
      }
      await twoFactorStatusQuery.refetch();
      if (shouldClose) closeTwoFactorDialog();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "双重验证设置失败");
    } finally {
      setTwoFactorBusy(false);
    }
  };
  const aiServiceQuery = useQuery({
    queryKey: ["ai-services"],
    queryFn: aiApi.listServices,
    retry: 1,
    enabled: tab === "AI 模型配置",
  });
  const aiPolicyQuery = useQuery({
    queryKey: ["ai-policy"],
    queryFn: aiApi.getPolicy,
    retry: 1,
    enabled: tab === "AI 模型配置",
  });
  const aiKeyQuery = useQuery({
    queryKey: ["ai-service-keys", keyService?.id],
    queryFn: () => aiApi.listKeys(keyService!.id),
    retry: 1,
    enabled: Boolean(keyService?.id),
  });
  const integrationQuery = useQuery({
    queryKey: ["integration-connections"],
    queryFn: integrationApi.list,
    retry: 1,
    enabled: tab === "数据源与集成",
  });
  const updateAccountPreferences = useBusinessStore(
    (s) => s.updateAccountPreferences,
  );
  const searchConnection = integrationQuery.data?.items.find(
    (item) => item.category === "search",
  );
  const mapConnection = integrationQuery.data?.items.find(
    (item) => item.category === "map",
  );
  const outboundConnectionsQuery = useQuery({
    queryKey: ["outbound-connections"],
    queryFn: outboxApi.listConnections,
    retry: 1,
    enabled: tab === "数据源与集成",
  });
  const smtpConnection = outboundConnectionsQuery.data?.items.find(
    (item) => item.enabled && item.provider === "smtp",
  ) ?? outboundConnectionsQuery.data?.items[0];
  const activeMeta = sectionMeta[tab];
  const filteredAiServices = useMemo(
    () =>
      aiServices
        .filter(
          (service) =>
            (!serviceQuery ||
              `${service.name}${service.provider}${service.model}`
                .toLowerCase()
                .includes(serviceQuery.toLowerCase())) &&
            (serviceStatus === "全部状态" || service.status === serviceStatus),
        )
        .sort((a, b) =>
          serviceSort === "服务名称 A–Z"
            ? a.name.localeCompare(b.name, "zh-CN")
            : serviceSort === "服务名称 Z–A"
              ? b.name.localeCompare(a.name, "zh-CN")
              : serviceSort === "延迟最低"
                ? (Number.parseInt(a.latency) || 99999) -
                  (Number.parseInt(b.latency) || 99999)
                : serviceSort === "密钥最多"
                  ? b.keyCount - a.keyCount
                  : a.priority - b.priority,
        ),
    [aiServices, serviceQuery, serviceSort, serviceStatus],
  );
  const aiServicePaging = usePagination(
    filteredAiServices,
    3,
    `${serviceQuery}|${serviceStatus}|${serviceSort}|${aiServices.length}`,
  );
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  useEffect(() => {
    if (aiServiceQuery.data)
      setAiServices(aiServiceQuery.data.items.map(mapAiService));
  }, [aiServiceQuery.data]);
  useEffect(() => {
    if (aiKeyQuery.data) setAiKeys(aiKeyQuery.data.items.map(mapAiKey));
  }, [aiKeyQuery.data]);
  useEffect(() => {
    const policy = aiPolicyQuery.data;
    if (!policy) return;
    setRotationStrategy(policy.rotationStrategy === "round-robin" ? "按请求轮询" : policy.rotationStrategy === "least-used" ? "最少使用优先" : "失败后切换密钥");
    setRetryCount(policy.retryCount ? `${policy.retryCount} 次` : "不重试");
    setRetryDelay(policy.retryBackoff === "exponential" ? "指数退避" : policy.retryDelayMs === 3000 ? "固定 3 秒" : "固定 1 秒");
    setCooldown(policy.cooldownMs === 60_000 ? "1 分钟" : policy.cooldownMs === 900_000 ? "15 分钟" : policy.cooldownMs === 1_800_000 ? "30 分钟" : "5 分钟");
    setFailoverEnabled(policy.failoverEnabled);
  }, [aiPolicyQuery.data]);
  const moveServiceUp = async (id: string) => {
    const ordered = [...aiServices].sort((a, b) => a.priority - b.priority);
    const index = ordered.findIndex((item) => item.id === id);
    if (index <= 0) return;
    await Promise.all([
      aiApi.updateService(ordered[index].id, {
        priority: ordered[index - 1].priority,
      }),
      aiApi.updateService(ordered[index - 1].id, {
        priority: ordered[index].priority,
      }),
    ]);
    await aiServiceQuery.refetch();
    showToast("已上移一个调用优先级");
  };
  const testAiService = async (id: string) => {
    try {
      const result = await aiApi.testService(id);
      await aiServiceQuery.refetch();
      showToast(`连接测试通过，延迟 ${result.latencyMs} ms`);
    } catch (cause) {
      await aiServiceQuery.refetch();
      showToast(cause instanceof Error ? cause.message : "连接测试失败");
    }
  };
  const toggleAiService = async (id: string) => {
    const service = aiServices.find((item) => item.id === id);
    if (!service) return;
    await aiApi.updateService(id, { enabled: service.status === "停用" });
    await aiServiceQuery.refetch();
  };
  const bulkToggleAiServices = async (enabledValue: boolean) => {
    await Promise.all(
      [...selectedAiServices].map((id) =>
        aiApi.updateService(id, { enabled: enabledValue }),
      ),
    );
    setSelectedAiServices(new Set());
    await aiServiceQuery.refetch();
    showToast(enabledValue ? "所选服务已启用" : "所选服务已停用");
  };
  const addAiService = async (values: Record<string, string>) => {
    const provider =
      values.provider === "DeepSeek"
        ? "deepseek"
        : values.provider === "阿里云百炼"
          ? "dashscope"
          : "openai-compatible";
    await aiApi.createService({
      name: values.name,
      provider,
      model: values.model || undefined,
      endpoint: values.endpoint || undefined,
    });
    await aiServiceQuery.refetch();
  };
  const addAiKey = async (values: Record<string, string>) => {
    if (!addKeyService) return;
    await aiApi.addKey(addKeyService.id, {
      name: values.name,
      secret: values.key,
    });
    await Promise.all([aiServiceQuery.refetch(), aiKeyQuery.refetch()]);
  };
  const toggleAiKey = async (key: AiKeyRecord) => {
    await aiApi.updateKey(key.id, key.status !== "启用");
    await Promise.all([aiServiceQuery.refetch(), aiKeyQuery.refetch()]);
  };
  const saveAiPolicy = async () => {
    await aiApi.updatePolicy({
      rotationStrategy: rotationStrategy === "按请求轮询" ? "round-robin" : rotationStrategy === "最少使用优先" ? "least-used" : "failover",
      retryCount: retryCount === "不重试" ? 0 : Number.parseInt(retryCount),
      retryBackoff: retryDelay === "指数退避" ? "exponential" : "fixed",
      retryDelayMs: retryDelay === "固定 3 秒" ? 3000 : 1000,
      cooldownMs: cooldown === "1 分钟" ? 60_000 : cooldown === "15 分钟" ? 900_000 : cooldown === "30 分钟" ? 1_800_000 : 300_000,
      failoverEnabled,
    });
    await aiPolicyQuery.refetch();
    setPolicyOpen(false);
    showToast("轮转与重试策略已保存并立即生效");
  };
  const saveIntegration = async (values: Record<string, string>) => {
    if (!integration) return;
    const isSearch = integration === "搜索与网页 API";
    const connection = isSearch ? searchConnection : mapConnection;
    const provider = isSearch
      ? values.provider === "Brave Search API"
        ? "brave"
        : values.provider === "Tavily Search API"
          ? "tavily"
          : values.provider === "Google Custom Search"
            ? "google"
            : values.provider === "Bing Web Search"
              ? "bing"
              : values.provider === "SerpAPI"
                ? "serpapi"
                : "searxng"
      : "google-places";
    const input = {
      name: values.name || undefined,
      endpoint: values.endpoint || undefined,
      secret: values.key || undefined,
      resultLimit: Number(values.limit) || 10,
    };
    if (connection) await integrationApi.update(connection.id, input);
    else
      await integrationApi.create({
        ...input,
        category: isSearch ? "search" : "map",
        provider,
      });
    await integrationQuery.refetch();
  };
  const testIntegrationConnection = async (
    connection: typeof searchConnection,
    label: string,
  ) => {
    if (!connection) return;
    try {
      const result = await integrationApi.test(connection.id);
      await integrationQuery.refetch();
      showToast(
        `${label}连接正常，返回 ${result.resultCount} 条结果 · ${result.latencyMs} ms`,
      );
    } catch (cause) {
      await integrationQuery.refetch();
      showToast(
        cause instanceof Error ? cause.message : `${label}连接测试失败`,
      );
    }
  };
  const pageActions =
    tab === "个人资料" ? (
      <Button
        variant="primary"
        onClick={async () => {
          try {
            const session = await authApi.updateProfile({
              displayName: profileDraft.displayName,
              email: profileDraft.email,
              locale: profileDraft.language === "English" ? "en" : "zh-CN",
              timezone: profileDraft.timezone.startsWith("Europe/Berlin") ? "Europe/Berlin" : "Asia/Shanghai",
              currency: profileDraft.currency.slice(0, 3) as "CNY" | "EUR" | "USD",
              businessName: profileDraft.businessName,
            });
            updateAccountPreferences(profileDraft);
            await authSessionQuery.refetch();
            showToast(`个人资料已保存到${session.workspace.name}`);
          } catch (cause) {
            showToast(cause instanceof Error ? cause.message : "个人资料保存失败");
          }
        }}
      >
        <Save size={16} />
        保存资料
      </Button>
    ) : tab === "AI 模型配置" ? (
      <>
        <Button onClick={() => setPolicyOpen(true)}>
          <Route size={16} />
          轮转与重试
        </Button>
        <Button variant="primary" onClick={() => setServiceDialog(true)}>
          <Plus size={16} />
          添加服务
        </Button>
      </>
    ) : undefined;
  return (
    <div className="page-content settings-page">
      <PageHeader
        title={activeMeta.title}
        description={`应用设置 · ${activeMeta.description}`}
        actions={pageActions}
      />
      <div className="settings-content">
        {tab === "个人资料" ? (
          <div className="profile-settings-layout">
            <section className="profile-card profile-identity-card">
              <header>
                <i>
                  <UserRound size={18} />
                </i>
                <span>
                  <strong>身份资料</strong>
                  <small>用于账户显示和消息通知</small>
                </span>
              </header>
              <div className="profile-preview">
                <b>{profileDraft.displayName?.trim().slice(0, 1) || "用"}</b>
                <span>
                  <strong>{profileDraft.displayName || "未设置名称"}</strong>
                  <small>{profileDraft.email || "未设置邮箱"}</small>
                </span>
              </div>
              <div className="profile-form">
                <label>
                  显示名称
                  <Input
                    value={profileDraft.displayName}
                    onChange={(e) =>
                      setProfileDraft((value) => ({
                        ...value,
                        displayName: e.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  邮箱
                  <Input
                    type="email"
                    value={profileDraft.email}
                    onChange={(e) =>
                      setProfileDraft((value) => ({
                        ...value,
                        email: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </section>
            <section className="profile-card profile-preferences-card">
              <header>
                <i>
                  <Database size={18} />
                </i>
                <span>
                  <strong>区域与经营偏好</strong>
                  <small>用于界面语言、时间和经营数据的默认口径</small>
                </span>
              </header>
              <div className="profile-form profile-preference-grid">
                <label>
                  默认语言
                  <CustomSelect
                    ariaLabel="默认语言"
                    value={profileDraft.language}
                    onChange={(language) =>
                      setProfileDraft((value) => ({ ...value, language }))
                    }
                    options={["简体中文", "English"]}
                  />
                </label>
                <label>
                  时区
                  <CustomSelect
                    ariaLabel="时区"
                    value={profileDraft.timezone}
                    onChange={(timezone) =>
                      setProfileDraft((value) => ({ ...value, timezone }))
                    }
                    options={["Asia/Shanghai (UTC+8)", "Europe/Berlin (UTC+2)"]}
                  />
                </label>
                <label>
                  基准币种
                  <CustomSelect
                    ariaLabel="基准币种"
                    value={profileDraft.currency}
                    onChange={(currency) =>
                      setProfileDraft((value) => ({ ...value, currency }))
                    }
                    options={["CNY · 人民币", "EUR · 欧元", "USD · 美元"]}
                  />
                </label>
                <label>
                  经营名称
                  <Input
                    value={profileDraft.businessName}
                    onChange={(e) =>
                      setProfileDraft((value) => ({
                        ...value,
                        businessName: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </section>
          </div>
        ) : tab === "AI 模型配置" ? (
          <div className="ai-settings-page">
            <Panel className="standard-list-panel ai-service-panel">
              <div className="ai-service-toolbar customer-toolbar module-toolbar standard-list-toolbar">
                <div className="customer-filter-controls">
                  <label className="customer-search module-search">
                    <Search />
                    <Input
                      aria-label="搜索 AI 服务"
                      value={serviceQuery}
                      onChange={(event) => setServiceQuery(event.target.value)}
                      placeholder="搜索服务、模型或提供商"
                    />
                  </label>
                  <CustomSelect
                    className="ai-status-select"
                    ariaLabel="筛选 AI 服务状态"
                    value={serviceStatus}
                    onChange={setServiceStatus}
                    options={["全部状态", "可用", "未验证", "异常", "停用"]}
                  />
                  <CustomSelect
                    className="sort-select"
                    ariaLabel="AI 服务排序"
                    value={serviceSort}
                    onChange={(value) => setServiceSort(value as AiServiceSort)}
                    options={[
                      "优先级最高",
                      "服务名称 A–Z",
                      "服务名称 Z–A",
                      "延迟最低",
                      "密钥最多",
                    ]}
                  />
                  <Button
                    className="customer-refresh"
                    onClick={async () => {
                      await aiServiceQuery.refetch();
                      showToast("AI 服务列表已刷新");
                    }}
                  >
                    <RefreshCw />
                    刷新
                  </Button>
                  <Button
                    className="customer-clear module-clear"
                    disabled={
                      !serviceQuery &&
                      serviceStatus === "全部状态" &&
                      serviceSort === "优先级最高"
                    }
                    onClick={() => {
                      setServiceQuery("");
                      setServiceStatus("全部状态");
                      setServiceSort("优先级最高");
                    }}
                  >
                    清除筛选
                  </Button>
                </div>
                <div
                  className={`customer-selection-tools${selectedAiServices.size > 0 ? " has-selection" : " is-empty"}`}
                  aria-hidden={selectedAiServices.size === 0}
                >
                  <span>
                    <CheckCircle2 />
                    <small>已选择</small>
                    <strong>{selectedAiServices.size}</strong>
                    <small>个</small>
                  </span>
                  <div>
                    <Button onClick={() => bulkToggleAiServices(true)}>
                      启用所选
                    </Button>
                    <Button onClick={() => bulkToggleAiServices(false)}>
                      停用所选
                    </Button>
                    <Button
                      aria-label="取消选择"
                      title="取消选择"
                      onClick={() => setSelectedAiServices(new Set())}
                    >
                      <X />
                    </Button>
                  </div>
                </div>
              </div>
              <DataTable className="customer-table customer-table-pro ai-service-table" minWidth={880} columns={[
                {key:"select",title:<span className="customer-check"><Checkbox aria-label="选择本页全部 AI 服务" checked={aiServicePaging.pageItems.length>0&&aiServicePaging.pageItems.every(service=>selectedAiServices.has(service.id))} onChange={event=>setSelectedAiServices(current=>{const next=new Set(current);aiServicePaging.pageItems.forEach(service=>event.target.checked?next.add(service.id):next.delete(service.id));return next;})}/></span>,width:52},
                {key:"service",title:<Button className="customer-sort-head" onClick={()=>setServiceSort(serviceSort==="服务名称 A–Z"?"服务名称 Z–A":"服务名称 A–Z")}>服务、模型与优先级{aiSortIcon(serviceSort==="服务名称 A–Z"||serviceSort==="服务名称 Z–A",serviceSort==="服务名称 Z–A")}</Button>,width:260},
                {key:"keys",title:<Button className="customer-sort-head" onClick={()=>setServiceSort("密钥最多")}>密钥与状态{aiSortIcon(serviceSort==="密钥最多",true)}</Button>,width:150},
                {key:"quality",title:<Button className="customer-sort-head" onClick={()=>setServiceSort("延迟最低")}>连接质量与接口{aiSortIcon(serviceSort==="延迟最低")}</Button>,width:260},
                {key:"enabled",title:"启用状态",width:90},{key:"actions",title:"操作",width:120},
              ]} rows={aiServicePaging.pageItems.map(service=>({key:service.id,className:`${service.status==="停用"?"disabled ":""}${selectedAiServices.has(service.id)?"selected":""}`,cells:[
                <span className="customer-check"><Checkbox aria-label={`选择 ${service.name}`} checked={selectedAiServices.has(service.id)} onChange={event=>setSelectedAiServices(current=>{const next=new Set(current);event.target.checked?next.add(service.id):next.delete(service.id);return next;})}/></span>,
                <div className="customer-company ai-service-company"><i><Bot/></i><span><strong>{service.name}</strong><small>{service.provider} · {service.model}</small><em><Route/>{service.priority===1?"当前主服务":`备用服务 ${service.priority-1}`}</em></span></div>,
                <div className="standard-cell-stack"><Badge tone={service.status==="可用"?"green":service.status==="异常"?"red":service.status==="未验证"?"orange":"neutral"}>{service.status}</Badge><small>{service.keyCount} 个密钥参与轮转</small></div>,<div className="standard-cell-stack"><strong>{service.latency}</strong><span className="ai-endpoint" title={service.endpoint}>{service.endpoint}</span></div>,
                <Switch aria-label={`${service.name}启用状态`} checked={service.status!=="停用"} onChange={()=>toggleAiService(service.id)}/>,
                <div className="standard-row-actions ai-table-actions"><Button aria-label={`测试 ${service.name}`} title="测试连接" onClick={()=>testAiService(service.id)}><RefreshCw/></Button><Button aria-label={`管理 ${service.name} 密钥`} title="管理密钥" onClick={()=>setKeyService(service)}><KeyRound/></Button><Button className="ai-promote-service" disabled={service.priority===1} aria-label={service.priority===1?`${service.name} 已是最高优先级`:`将 ${service.name} 上移一个优先级`} title={service.priority===1?"已是最高优先级":"上移一个优先级"} onClick={()=>moveServiceUp(service.id)}><ArrowUp/></Button></div>,
              ]}))}/>
              {filteredAiServices.length > 0 && (
                <Pagination
                  page={aiServicePaging.page}
                  pageSize={aiServicePaging.pageSize}
                  total={filteredAiServices.length}
                  onPageChange={aiServicePaging.setPage}
                  onPageSizeChange={aiServicePaging.setPageSize}
                  pageSizeOptions={[3, 6, 10]}
                  itemName="个服务"
                />
              )}
            </Panel>
          </div>
        ) : tab === "数据源与集成" ? (
          <div className="integration-settings-page">
            <OutboundSettings />
            {integrationGroups.map((group, groupIndex) => (
              <section className="integration-group" key={group.title}>
                <header>
                  <span>
                    <strong>{group.title}</strong>
                    <small>{group.description}</small>
                  </span>
                </header>
                <div className="integration-grid">
                  {group.services.map((service) => {
                    const index = integrationServices.findIndex(
                      (item) => item.name === service.name,
                    );
                    const icons = [Search, MapPinned, CheckCircle2, Target, Mail];
                    const Icon = icons[index] ?? KeyRound;
                    const isEmail = service.name === "邮件发送服务";
                    const connection =
                      service.name === "搜索与网页 API"
                        ? searchConnection
                        : service.name === "地图 API"
                          ? mapConnection
                          : isEmail
                            ? smtpConnection
                            : undefined;
                    const isManaged =
                      service.name === "搜索与网页 API" ||
                      service.name === "地图 API" ||
                      isEmail;
                    const isBuiltIn = builtInIntegrations.has(service.name);
                    const isConnected = isManaged
                      ? Boolean(connection)
                      : isBuiltIn;
                    const connectionStatus =
                      connection && "status" in connection
                        ? connection.status
                        : undefined;
                    const statusLabel = connectionStatus
                      ? connectionStatus === "available"
                        ? "可用"
                        : connectionStatus === "error"
                          ? "异常"
                          : "待测试"
                      : isBuiltIn
                        ? "内置可用"
                        : "未配置";
                    const connectionDetail = isEmail
                      ? connection
                        ? `${connection.name} · ${(connection as OutboundConnectionApiRecord).host}:${(connection as OutboundConnectionApiRecord).port} · ${(connection as OutboundConnectionApiRecord).fromEmail}`
                        : service.description
                      : connection
                        ? `${connection.name} · ${(connection as { endpoint?: string }).endpoint ?? ""}`
                        : service.description;
                    return (
                      <article
                        className={isConnected ? "connected" : ""}
                        key={service.name}
                      >
                        <div className="integration-icon">
                          <Icon size={19} />
                        </div>
                        <span>
                          <strong>{service.name}</strong>
                          <small>{connectionDetail}</small>
                        </span>
                        <div className="integration-card-actions">
                          <Badge
                            tone={
                              statusLabel === "可用" ||
                              statusLabel === "内置可用"
                                ? "green"
                                : statusLabel === "异常"
                                  ? "red"
                                  : "neutral"
                            }
                          >
                            {statusLabel}
                          </Badge>
                          <span>
                            {isBuiltIn ? (
                              <small className="integration-built-in">
                                无需密钥
                              </small>
                            ) : (
                              <>
                                {connection && (
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      if (isEmail) {
                                        try {
                                          const result = await outboxApi.testConnection(connection.id);
                                          await outboundConnectionsQuery.refetch();
                                          showToast(
                                            `SMTP 连接正常 · ${result.latencyMs} ms${result.activatedJobs ? `，已激活 ${result.activatedJobs} 个待发送任务` : ""}`,
                                          );
                                        } catch (cause) {
                                          await outboundConnectionsQuery.refetch();
                                          showToast(
                                            cause instanceof Error ? cause.message : "SMTP 连接测试失败",
                                          );
                                        }
                                        return;
                                      }
                                      testIntegrationConnection(
                                        connection as typeof searchConnection,
                                        service.name === "地图 API" ? "地图" : "搜索",
                                      );
                                    }}
                                  >
                                    测试
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (isEmail) {
                                      document.querySelector(".outbound-settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                      return;
                                    }
                                    if (
                                      service.name === "搜索与网页 API" ||
                                      service.name === "地图 API"
                                    ) {
                                      setIntegration(service.name);
                                    }
                                  }}
                                >
                                  {isConnected ? "管理" : "配置"}
                                </Button>
                              </>
                            )}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {groupIndex === 0 && (
                  <footer>
                    <ShieldCheck size={14} />
                    <span>
                      连接凭据由服务端加密保存并按工作区隔离；公开联系人与行业来源具备无需密钥的内置基础能力。
                    </span>
                  </footer>
                )}
              </section>
            ))}
          </div>
        ) : tab === "数据与备份" ? (
          <div className="data-backup-layout">
            <section className="data-location-card">
              <header>
                <i>
                  <MonitorSmartphone size={20} />
                </i>
                <span>
                  <small>数据存储</small>
                  <strong>部署服务器持久化保存</strong>
                  <p>业务数据保存在服务端 PostgreSQL 数据库中，并按工作区隔离。</p>
                </span>
                <Badge tone="green">已持久化</Badge>
              </header>
              <div>
                <span>
                  <small>保存范围</small>
                  <strong>完整业务数据</strong>
                  <p>客户、任务、内容、活动与商机</p>
                </span>
                <span>
                  <small>保存方式</small>
                  <strong>业务动作后实时写入</strong>
                  <p>无需手动保存，修改即时生效</p>
                </span>
              </div>
            </section>
            <section className="backup-control-card">
              <header>
                <span>
                  <strong>数据导出与备份</strong>
                  <small>从服务器导出当前工作区的真实数据，或下载完整数据库备份</small>
                </span>
              </header>
              <div className="backup-action-grid">
                <Button
                  onClick={async () => {
                    try {
                      await systemApi.exportData();
                      showToast("数据导出已开始下载");
                    } catch {
                      showToast("数据导出失败，请稍后重试");
                    }
                  }}
                >
                  <i>
                    <Download size={17} />
                  </i>
                  <span>
                    <strong>导出业务数据 (JSON)</strong>
                    <small>客户、商机、内容、活动、消息等全部工作区数据</small>
                  </span>
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      await systemApi.backupDatabase();
                      showToast("数据库备份已开始下载");
                    } catch {
                      showToast("数据库备份失败，请稍后重试");
                    }
                  }}
                >
                  <i>
                    <Database size={17} />
                  </i>
                  <span>
                    <strong>完整数据库备份</strong>
                    <small>PostgreSQL custom-format 备份，可用于灾难恢复</small>
                  </span>
                </Button>
              </div>
              <div className="backup-reminder">
                <span>
                  <strong>{backupsQuery.data?.automatic ? `自动备份已启用 · 保留最近 ${backupsQuery.data.retentionCount} 份` : "自动备份未启用"}</strong>
                  <small>每份自动备份生成后均执行 pg_restore 目录校验；升级前仍建议额外下载一份。</small>
                </span>
                <Button size="sm" disabled={backupsQuery.isFetching} onClick={()=>backupsQuery.refetch()}><RefreshCw size={15}/>刷新</Button>
              </div>
              {(backupsQuery.data?.items ?? []).length > 0 && <div className="backup-reminder">
                <span>
                  <strong>最近持久化备份</strong>
                  <small>{backupsQuery.data!.items.slice(0, 3).map(item=>`${new Date(item.createdAt).toLocaleString("zh-CN")} · ${(item.size / 1024 / 1024).toFixed(1)} MB · ${item.verifiedAt ? "已校验" : "待校验"}`).join("\n")}</small>
                </span>
                <Button size="sm" onClick={async()=>{const item=backupsQuery.data?.items[0];if(!item)return;try{await systemApi.validateBackup(item.fileName);await backupsQuery.refetch();showToast("最新备份校验通过，可用于恢复")}catch{showToast("备份校验失败，请勿用于恢复")}}}>验证最新备份</Button>
              </div>}
              {operationsQuery.data && <div className="backup-reminder">
                <span>
                  <strong>运行概览</strong>
                  <small>{`客户 ${operationsQuery.data.counts.customers} · 任务 ${operationsQuery.data.counts.tasks} · 商机 ${operationsQuery.data.counts.deals} · 雷达任务 ${operationsQuery.data.counts.radarTasks} · 外发队列 ${operationsQuery.data.counts.queuedOutbound}`}</small>
                </span>
                <Badge tone={operationsQuery.data.workers.backup === "enabled" ? "green" : "orange"}>{operationsQuery.data.workers.backup === "enabled" ? "自动备份运行中" : "自动备份关闭"}</Badge>
              </div>}
            </section>
          </div>
        ) : (
          <div className="security-settings-layout">
            <section className="security-card">
              <header>
                <i>
                  <LockKeyhole size={18} />
                </i>
                <span>
                  <strong>账户保护</strong>
                  <small>管理登录凭据与第二重身份验证</small>
                </span>
              </header>
              <div className="security-options">
                <article>
                  <i>
                    <LockKeyhole size={17} />
                  </i>
                  <span>
                    <strong>登录密码</strong>
                    <small>最近更新于 30 天前</small>
                  </span>
                  <Button
                    size="sm"
                    onClick={() => setSecurityDialog("password")}
                  >
                    修改密码
                  </Button>
                </article>
                <article>
                  <i>
                    <ShieldCheck size={17} />
                  </i>
                  <span>
                    <strong>双重验证</strong>
                    <small>{twoFactorStatusQuery.data?.enabled ? "已启用验证器应用和恢复码" : "使用验证器应用保护账户"}</small>
                  </span>
                  <Badge tone={twoFactorStatusQuery.data?.enabled ? "green" : "orange"}>{twoFactorStatusQuery.data?.enabled ? "已启用" : "未启用"}</Badge>
                  <Button size="sm" onClick={openTwoFactorDialog}>
                    {twoFactorStatusQuery.data?.enabled ? "管理" : "设置"}
                  </Button>
                </article>
              </div>
            </section>
            <section className="security-card">
              <header>
                <i>
                  <MonitorSmartphone size={18} />
                </i>
                <span>
                  <strong>登录会话</strong>
                  <small>查看当前设备和其他活动会话</small>
                </span>
              </header>
              <div className="session-list">
                {(sessionsQuery.data?.items ?? []).map(session => <article className={session.current ? "current" : ""} key={session.id}>
                  <i><MonitorSmartphone size={17}/></i>
                  <span><strong>{/Windows/i.test(session.userAgent ?? "") ? "Windows" : /Mac/i.test(session.userAgent ?? "") ? "macOS" : /Mobile|Android|iPhone/i.test(session.userAgent ?? "") ? "移动设备" : "浏览器会话"} · {session.ipAddress ?? "未知地址"}</strong><small>{session.current ? "当前设备" : "其他设备"} · 最近活动：{session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString("zh-CN") : "未知"}</small></span>
                  {session.current ? <Badge tone="green">当前</Badge> : <Button size="sm" onClick={async()=>{await authApi.revokeSession(session.id);await sessionsQuery.refetch();showToast("该登录会话已退出")}}>退出</Button>}
                </article>)}
                {(sessionsQuery.data?.items ?? []).filter(session => !session.current).length > 0 && <article>
                  <i><UserRound size={17}/></i><span><strong>其他登录设备</strong><small>一次撤销当前设备之外的全部会话</small></span>
                  <Button size="sm" onClick={async()=>{const result=await authApi.revokeOtherSessions();await sessionsQuery.refetch();showToast(`已退出 ${result.removed} 个其他会话`)}}>全部退出</Button>
                </article>}
              </div>
            </section>
            <section className="security-danger-card">
              <i>
                <Trash2 size={18} />
              </i>
              <span>
                <strong>删除账户和数据</strong>
                <small>
                  永久删除账号、密钥及全部经营数据；建议操作前先导出完整备份。
                </small>
              </span>
              <Button
                variant="danger"
                onClick={() => setConfirmDelete("account")}
              >
                <Trash2 size={14} />
                删除账户
              </Button>
            </section>
          </div>
        )}
      </div>
      <Modal
        open={policyOpen}
        title="轮转与重试策略"
        description="配置密钥轮转、请求重试和跨服务故障切换。"
        width={660}
        onClose={() => setPolicyOpen(false)}
        footer={
          <>
            <Button onClick={() => setPolicyOpen(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try { await saveAiPolicy(); }
                catch (cause) { showToast(cause instanceof Error ? cause.message : "策略保存失败"); }
              }}
            >
              保存策略
            </Button>
          </>
        }
      >
        <div className="ai-policy-modal">
          <div className="ai-policy-flow">
            <span>
              <i>1</i>
              <strong>请求主服务</strong>
              <small>使用当前可用密钥</small>
            </span>
            <em>→</em>
            <span>
              <i>2</i>
              <strong>重试与轮转</strong>
              <small>换密钥并按策略重试</small>
            </span>
            <em>→</em>
            <span>
              <i>3</i>
              <strong>服务降级</strong>
              <small>切换下一个可用服务</small>
            </span>
          </div>
          <div className="ai-policy-grid">
            <label>
              密钥轮转方式
              <CustomSelect
                ariaLabel="密钥轮转方式"
                value={rotationStrategy}
                onChange={setRotationStrategy}
                options={["失败后切换密钥", "按请求轮询", "最少使用优先"]}
              />
            </label>
            <label>
              单密钥重试次数
              <CustomSelect
                ariaLabel="单密钥重试次数"
                value={retryCount}
                onChange={setRetryCount}
                options={["不重试", "1 次", "2 次", "3 次"]}
              />
            </label>
            <label>
              重试间隔
              <CustomSelect
                ariaLabel="重试间隔"
                value={retryDelay}
                onChange={setRetryDelay}
                options={["指数退避", "固定 1 秒", "固定 3 秒"]}
              />
            </label>
            <label>
              失败冷却时间
              <CustomSelect
                ariaLabel="失败冷却时间"
                value={cooldown}
                onChange={setCooldown}
                options={["1 分钟", "5 分钟", "15 分钟", "30 分钟"]}
              />
            </label>
          </div>
          <div className="setting-row">
            <span>
              <strong>跨服务自动切换</strong>
              <small>当前服务全部密钥失败后，自动使用下一优先级服务。</small>
            </span>
            <Switch
              aria-label="跨服务自动切换"
              checked={failoverEnabled}
              onChange={setFailoverEnabled}
            />
          </div>
        </div>
      </Modal>
      <CreateDialog
        open={serviceDialog}
        title="添加 AI 服务"
        description="DeepSeek 与阿里云百炼使用官方兼容接口；服务与密钥均按当前工作区隔离。"
        submitLabel="添加服务"
        successMessage="AI 服务已添加"
        onClose={() => setServiceDialog(false)}
        onSubmit={addAiService}
        fields={[
          {
            name: "name",
            label: "服务名称",
            required: true,
            placeholder: "例如：DeepSeek 主服务",
          },
          {
            name: "provider",
            label: "服务商",
            type: "select",
            required: true,
            options: ["DeepSeek", "阿里云百炼", "OpenAI 兼容服务"],
          },
          {
            name: "model",
            label: "默认模型",
            placeholder: "留空使用服务商推荐模型",
          },
          {
            name: "endpoint",
            label: "API Base URL",
            placeholder: "留空使用官方默认地址",
          },
        ]}
      />
      <Modal
        open={Boolean(keyService)}
        title={`密钥池 · ${keyService?.name ?? ""}`}
        description="密钥在服务端使用 AES-256-GCM 加密保存，前端只返回名称和末四位。"
        onClose={() => setKeyService(null)}
        footer={
          <>
            <Button onClick={() => setKeyService(null)}>关闭</Button>
            <Button
              variant="primary"
              onClick={() => {
                setAddKeyService(keyService);
                setKeyService(null);
              }}
            >
              <Plus size={14} />
              添加密钥
            </Button>
          </>
        }
      >
        <div className="ai-key-pool">
          <header>
            <span>
              <strong>
                {
                  aiKeys.filter(
                    (item) =>
                      item.serviceId === keyService?.id &&
                      item.status === "启用",
                  ).length
                }{" "}
                个启用
              </strong>
              <small>失败的密钥会进入冷却，恢复后重新加入轮转。</small>
            </span>
            <Badge tone="blue">{rotationStrategy}</Badge>
          </header>
          <div>
            {aiKeys.filter((item) => item.serviceId === keyService?.id)
              .length ? (
              aiKeys
                .filter((item) => item.serviceId === keyService?.id)
                .map((key) => (
                  <article key={key.id}>
                    <i>
                      <KeyRound />
                    </i>
                    <span>
                      <strong>{key.name}</strong>
                      <small>
                        •••• •••• •••• {key.ending} · 最近使用 {key.lastUsed}
                      </small>
                    </span>
                    <Badge tone={key.status === "启用" ? "green" : "neutral"}>
                      {key.status}
                    </Badge>
                    <Switch
                      aria-label={`${key.name}启用状态`}
                      checked={key.status === "启用"}
                      onChange={() => toggleAiKey(key)}
                    />
                    <Button
                      aria-label={`删除 ${key.name}`}
                      title="删除密钥"
                      onClick={() => { setDeleteKeyId(key.id); setConfirmDelete("key"); }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </article>
                ))
            ) : (
              <EmptyState
                className="list-empty-state compact"
                title="暂无密钥"
                icon={KeyRound}
              />
            )}
          </div>
        </div>
      </Modal>
      <CreateDialog
        open={Boolean(addKeyService)}
        title={`添加密钥 · ${addKeyService?.name ?? ""}`}
        description="密钥只会传给当前部署的服务端并加密保存；保存后接口不会再次返回明文。"
        submitLabel="保存密钥"
        successMessage="密钥已加密加入轮转池"
        onClose={() => setAddKeyService(null)}
        onSubmit={addAiKey}
        fields={[
          {
            name: "name",
            label: "密钥名称",
            required: true,
            placeholder: "例如：生产密钥 02",
          },
          {
            name: "key",
            label: "API Key",
            required: true,
            placeholder: "输入新生成的完整密钥",
          },
          {
            name: "note",
            label: "备注",
            type: "textarea",
            placeholder: "记录用途、归属或到期时间",
          },
        ]}
      />
      <Modal
        open={Boolean(confirmDelete)}
        title={
          confirmDelete === "account" ? "确认删除账户" : "确认删除 API Key"
        }
        description="此操作不可撤销"
        onClose={() => { setConfirmDelete(null); setDeleteKeyId(null); setAccountDeletePassword(""); setAccountDeleteConfirmation(""); }}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirmDelete === "key") {
                  if (!deleteKeyId) return;
                  try {
                    await aiApi.deleteKey(deleteKeyId);
                    await Promise.all([aiServiceQuery.refetch(), aiKeyQuery.refetch()]);
                    setConfirmDelete(null);
                    setDeleteKeyId(null);
                    showToast("API Key 已删除");
                  } catch (cause) {
                    showToast(cause instanceof Error ? cause.message : "密钥删除失败");
                  }
                  return;
                }
                try {
                  await authApi.deleteAccount({ currentPassword: accountDeletePassword, confirmation: accountDeleteConfirmation as "DELETE" });
                  setConfirmDelete(null);
                  navigate("/login", { replace: true });
                } catch (cause) {
                  showToast(cause instanceof Error ? cause.message : "账户删除失败");
                }
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="danger-copy">
          {confirmDelete === "account"
            ? "账号、客户、活动、消息、商机和密钥都将永久删除。建议先导出完整备份。"
            : "删除后，依赖该密钥的 AI 研究与内容生成功能将停止。"}
        </p>
        {confirmDelete === "account" && <div className="two-factor-fields"><label>当前密码<span>用于确认账户所有权</span><Input.Password value={accountDeletePassword} onChange={event=>setAccountDeletePassword(event.target.value)} autoComplete="current-password"/></label><label>确认文字<span>请输入 DELETE</span><Input value={accountDeleteConfirmation} onChange={event=>setAccountDeleteConfirmation(event.target.value.toUpperCase())} placeholder="DELETE"/></label></div>}
      </Modal>
      <CreateDialog
        open={Boolean(integration)}
        title={`配置${integration ?? ""}`}
        description={
          integration === "搜索与网页 API"
            ? "支持 Tavily、SerpAPI、Brave 官方 API 和 SearXNG。凭据只在服务端加密保存。"
            : "Google Places 适合全球地点发现；密钥仅在服务端加密保存。"
        }
        submitLabel={
          (integration === "搜索与网页 API" ? searchConnection : mapConnection)
            ? "更新连接"
            : "保存连接"
        }
        successMessage={`${integration ?? "数据服务"}连接已保存`}
        onClose={() => setIntegration(null)}
        onSubmit={saveIntegration}
        initialValues={
          integration === "搜索与网页 API" && searchConnection
            ? {
                name: searchConnection.name,
                provider:
                  searchConnection.provider === "brave"
                    ? "Brave Search API"
                    : searchConnection.provider === "tavily"
                      ? "Tavily Search API"
                      : searchConnection.provider === "google"
                        ? "Google Custom Search"
                        : searchConnection.provider === "bing"
                          ? "Bing Web Search"
                          : searchConnection.provider === "serpapi"
                            ? "SerpAPI"
                        : "SearXNG 自建服务",
                endpoint: searchConnection.endpoint,
                key: "",
                limit: String(searchConnection.config.resultLimit ?? 10),
              }
            : mapConnection
              ? {
                  name: mapConnection.name,
                  provider: "Google Places API",
                  endpoint: mapConnection.endpoint,
                  key: "",
                  limit: String(mapConnection.config.resultLimit ?? 10),
                }
              : {
                  provider: integration === "搜索与网页 API" ? "Brave Search API" : "Google Places API",
                  limit: "10",
                }
        }
        fields={
          integration === "搜索与网页 API"
            ? [
                {
                  name: "name",
                  label: "连接名称",
                  placeholder: "例如：主搜索服务",
                },
                {
                  name: "provider",
                  label: "搜索服务",
                  type: "select",
                  required: true,
                  options: ["Google Custom Search", "Bing Web Search", "SerpAPI", "Tavily Search API", "Brave Search API", "SearXNG 自建服务"],
                },
                {
                  name: "endpoint",
                  label: "接口地址",
                  placeholder: "留空使用服务商官方地址"
                },
                {
                  name: "key",
                  label: searchConnection?.hasSecret
                    ? `访问密钥（当前 •••• ${searchConnection.secretEnding}）`
                    : "访问密钥",
                  placeholder: searchConnection?.hasSecret
                    ? "留空保留现有密钥"
                    : "商业 API 必填；Google 需在接口地址附加 ?cx=ID；SearXNG 可选",
                },
                {
                  name: "limit",
                  label: "每次搜索结果上限",
                  type: "number",
                  required: true,
                },
              ]
            : [
                  {
                    name: "name",
                    label: "连接名称",
                    placeholder: "例如：本地企业发现服务",
                  },
                  {
                    name: "provider",
                    label: "地图服务",
                    type: "select",
                    required: true,
                    options: ["Google Places API"],
                  },
                  {
                    name: "endpoint",
                    label: "接口地址",
                    placeholder: "留空使用服务商官方地址",
                  },
                  {
                    name: "key",
                    label: mapConnection?.hasSecret
                      ? `访问密钥（当前 •••• ${mapConnection.secretEnding}）`
                      : "访问密钥",
                    required: !mapConnection?.hasSecret,
                    placeholder: mapConnection?.hasSecret
                      ? "留空保留现有密钥"
                      : "输入地图 Web Service API Key",
                  },
                  {
                    name: "limit",
                    label: "每次地点结果上限",
                    type: "number",
                    required: true,
                  },
                ]
        }
      />
      <CreateDialog
        open={securityDialog === "password"}
        title="修改登录密码"
        description="更新后其他设备需要重新登录。"
        submitLabel="更新密码"
        successMessage="登录密码已更新"
        onClose={() => setSecurityDialog(null)}
        onSubmit={async (values) => {
          if (values.next.length < 8) {
            showToast("新密码至少需要 8 位");
            return false;
          }
          if (values.next !== values.confirm) {
            showToast("两次输入的新密码不一致");
            return false;
          }
          await authApi.changePassword({
            currentPassword: values.current,
            newPassword: values.next,
          });
        }}
        fields={[
          { name: "current", label: "当前密码", type: "password", required: true },
          {
            name: "next",
            label: "新密码",
            type: "password",
            required: true,
            placeholder: "至少 8 位",
          },
          { name: "confirm", label: "确认新密码", type: "password", required: true },
        ]}
      />
      <Modal
        open={securityDialog === "2fa"}
        title={twoFactorRecovery ? "保存恢复码" : twoFactorStatusQuery.data?.enabled ? "关闭双重验证" : "设置双重验证"}
        description={twoFactorRecovery ? "恢复码只显示一次，请保存到密码管理器。" : twoFactorStatusQuery.data?.enabled ? "输入当前密码和验证码/恢复码后关闭第二重验证。" : "在验证器应用中添加账户，再输入当前密码和 6 位验证码。"}
        onClose={closeTwoFactorDialog}
        footer={twoFactorRecovery ? <Button variant="primary" onClick={closeTwoFactorDialog}>我已保存</Button> : <><Button onClick={closeTwoFactorDialog} disabled={twoFactorBusy}>取消</Button><Button variant="primary" onClick={submitTwoFactor} disabled={twoFactorBusy}>{twoFactorBusy ? "正在处理…" : twoFactorStatusQuery.data?.enabled ? "关闭验证" : "验证并启用"}</Button></>}
      >
        {twoFactorRecovery ? <div className="two-factor-setup"><div className="two-factor-guide"><i><ShieldCheck /></i><strong>恢复码</strong><span>每个恢复码只能使用一次；丢失验证器时可用其中一个登录。</span></div><div className="two-factor-key"><strong>一次性恢复码</strong><small>请离线保存</small><div style={{display:'grid',gap:8}}>{twoFactorRecovery.map(code=><code key={code}>{code}</code>)}</div></div></div> : <div className="two-factor-setup">
          {!twoFactorStatusQuery.data?.enabled && <div className="two-factor-guide">
            {twoFactorQrCode ? (
              <img className="two-factor-qr" src={twoFactorQrCode} alt="Sondara 双重验证二维码" width={140} height={140} />
            ) : (
              <div className="qr-placeholder" aria-label="正在生成二维码">QR<br />生成中</div>
            )}
            <strong>扫描二维码添加验证器</strong>
            <span>账户名称：{twoFactorSetup?.accountName ?? (profileDraft.email || "Sondara")}</span>
            <small>{twoFactorBusy && !twoFactorSetup ? "正在生成服务端加密密钥…" : "二维码由本机根据 otpauth 地址离线生成；无法扫码时可继续使用下方密钥手动输入。"}</small>
          </div>}
          <div className="two-factor-fields">
            {!twoFactorStatusQuery.data?.enabled && <div className="two-factor-key">
              <strong>设置密钥</strong>
              <small>复制后粘贴到 Google Authenticator、1Password、Authy 等应用</small>
              <div>
                <code>{twoFactorSetup?.secret ?? "正在生成…"}</code>
                <Button size="sm" disabled={!twoFactorSetup?.secret} onClick={() => { if (twoFactorSetup) { navigator.clipboard?.writeText(twoFactorSetup.secret); showToast("设置密钥已复制"); } }}>
                  <Copy />复制密钥
                </Button>
              </div>
              {twoFactorSetup?.otpauth ? <small>高级用户也可复制 otpauth 地址导入验证器：<br />{twoFactorSetup.otpauth}</small> : null}
            </div>}
            <label>当前登录密码<span>用于确认是本人操作</span><Input type="password" autoComplete="current-password" value={twoFactorPassword} onChange={event=>setTwoFactorPassword(event.target.value)} placeholder="输入当前密码"/></label>
            <label>{twoFactorStatusQuery.data?.enabled ? "6 位验证码或恢复码" : "6 位验证码"}<span>{twoFactorStatusQuery.data?.enabled ? "关闭验证需要二次确认" : "输入验证器应用当前显示的数字"}</span><Input aria-label="验证码" value={twoFactorCode} onChange={event=>setTwoFactorCode(event.target.value.replace(/\s|-/g,"").slice(0,8))} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="000000"/></label>
          </div>
        </div>}
      </Modal>
    </div>
  );
}
