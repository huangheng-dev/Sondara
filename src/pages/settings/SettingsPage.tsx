import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  CheckCircle2,
  Database,
  Download,
  KeyRound,
  LockKeyhole,
  Mail,
  MapPinned,
  MonitorSmartphone,
  Pencil,
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
import { ListRefreshButton } from "@/components/ui/ListRefreshButton";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useUiStore } from "@/stores/ui-store";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { SearchInput } from "@/components/ui/SearchInput";
import { CreateDialog } from "@/components/ui/CreateDialog";
import { integrationServices } from "@/data/channels";
import { useBusinessStore } from "@/stores/business-store";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/ui/DataTable";
import { List } from "@/components/ui/List";
import { usePagination } from "@/hooks/usePagination";
import {
  Alert,
  Avatar,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Steps,
  Switch,
  Tabs,
  Typography,
} from "antd";
import {
  PageContainer,
  PageState,
  SelectionBar,
  TableToolbar,
} from "@/components/ui/PageModules";
import { RecordTime } from "@/components/ui/TableCells";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { LeadSourcesPage } from "@/pages/settings/LeadSourcesPage";
import { ConnectorCatalogPage } from "@/pages/settings/ConnectorCatalogPage";
import { ProcurementPage } from "@/pages/procurement/ProcurementPage";
import {
  aiApi,
  authApi,
  integrationApi,
  outboxApi,
  systemApi,
  type AiServiceApiRecord,
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
    description: "管理模型连接、调用顺序、请求重试与自动故障切换。",
    icon: Bot,
  },
  数据源与集成: {
    title: "集成中心",
    description: "统一管理内置能力、线索入口、外部服务和运行状态。",
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

type AiServiceStatus = "可用" | "性能退化" | "未验证" | "停用" | "异常";
type AiProtocol = AiServiceApiRecord["protocol"];
type AiServiceSort =
  | "优先级最高"
  | "服务名称 A–Z"
  | "服务名称 Z–A"
  | "延迟最低";
type AiService = {
  id: string;
  name: string;
  provider: string;
  protocol: AiProtocol;
  model: string;
  endpoint: string;
  keyCount: number;
  status: AiServiceStatus;
  priority: number;
  latency: string;
  lastTestedAt: number | null;
};
const providerLabel = (provider: AiServiceApiRecord["provider"]) =>
  provider === "deepseek"
    ? "DeepSeek"
    : provider === "dashscope"
      ? "阿里云百炼"
      : "自定义模型服务";
const aiProtocolOptions: Array<{ value: AiProtocol; label: string }> = [
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];
const aiProtocolLabel = Object.fromEntries(aiProtocolOptions.map(option => [option.value, option.label])) as Record<AiProtocol, string>;
const aiConnectionTemplates: Record<string, { name: string; endpoint: string; model: string; protocol: AiProtocol }> = {
  OpenAI: { name: "OpenAI 主模型", endpoint: "https://api.openai.com/v1", model: "gpt-4.1-mini", protocol: "openai-responses" },
  "Google Gemini": { name: "Gemini 主模型", endpoint: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.7-flash", protocol: "openai-chat-completions" },
  "xAI Grok": { name: "Grok 主模型", endpoint: "https://api.x.ai/v1", model: "grok-4.5", protocol: "openai-chat-completions" },
  "Mistral AI": { name: "Mistral 主模型", endpoint: "https://api.mistral.ai/v1", model: "mistral-small-latest", protocol: "openai-chat-completions" },
  Groq: { name: "Groq 高速模型", endpoint: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant", protocol: "openai-chat-completions" },
  OpenRouter: { name: "OpenRouter 聚合模型", endpoint: "https://openrouter.ai/api/v1", model: "~openai/gpt-latest", protocol: "openai-chat-completions" },
  DeepSeek: { name: "DeepSeek 主模型", endpoint: "https://api.deepseek.com", model: "deepseek-v4-flash", protocol: "openai-chat-completions" },
  "阿里云百炼": { name: "千问主模型", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", protocol: "openai-chat-completions" },
};
const mapAiService = (service: AiServiceApiRecord): AiService => ({
  id: service.id,
  name: service.name,
  provider: providerLabel(service.provider),
  protocol: service.protocol,
  model: service.model,
  endpoint: service.endpoint,
  keyCount: service.keyCount,
  status: !service.enabled
    ? "停用"
    : service.keyCount === 0
      ? "未验证"
    : service.status === "degraded" || (service.lastLatencyMs ?? 0) > 10_000
      ? "性能退化"
    : service.status === "available"
      ? "可用"
      : service.status === "error"
        ? "异常"
        : "未验证",
  priority: service.priority,
  latency: service.lastLatencyMs ? `${service.lastLatencyMs} ms` : "—",
  lastTestedAt: service.lastTestedAt,
});
const integrationGroups = [
  {
    title: "客户发现与验证",
    description: "用于寻找企业、补全联系人并核验公开商业信号",
    services: integrationServices.filter((service) => service.name !== "邮件发送服务"),
  },
];
const builtInIntegrations = new Set(["联系人补全 API", "行业与招投标数据"]);
type ConfigurableIntegration = "搜索与网页 API" | "地图 API";
const aiSortIcon = (active: boolean, descending = false) => (
  <span aria-hidden="true">
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
  const [templateConnection, setTemplateConnection] = useState<OutboundConnectionApiRecord | null>(null);
  const [jobStatus, setJobStatus] = useState("all");
  const connections = useQuery({
    queryKey: ["outbound-connections"],
    queryFn: outboxApi.listConnections,
    retry: 1,
  });
  const whatsappTemplates = useQuery({
    queryKey: ["whatsapp-templates", templateConnection?.id],
    queryFn: () => outboxApi.listWhatsappTemplates(templateConnection!.id),
    enabled: Boolean(templateConnection),
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
      whatsappBusinessAccountId: values.whatsappBusinessAccountId || null,
      whatsappDefaultTemplateName: values.whatsappDefaultTemplateName || null,
      whatsappDefaultTemplateLanguage: values.whatsappDefaultTemplateLanguage || null,
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
    <Flex id="outbound-settings" vertical>
      <Panel
        title="消息发送、收件与队列"
        subtitle="支持 SMTP、SendGrid、Mailgun、WhatsApp Cloud API 与合规 Webhook；每个邮件服务可独立配置 IMAP 收件"
        action={
          <Space wrap>
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
          </Space>
        }
      >
        {connections.data?.items.length ? (
          <List
            dataSource={connections.data.items}
            renderItem={(connection) => (
              <List.Item
                className="settings-service-row"
                key={connection.id}
                extra={
                  <Space className="settings-service-row__actions" wrap>
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
                {connection.provider === "whatsapp-cloud" && (
                  <Button size="sm" onClick={() => setTemplateConnection(connection)}>
                    模板
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => {
                    setWebhookConnection(connection);
                    setWebhookSecret("");
                  }}
                >
                  回调
                </Button>
                  </Space>
                }
              >
                <List.Item.Meta
                  style={{ minWidth: 0 }}
                  avatar={<Avatar icon={<Mail size={18} />} />}
                  title={connection.name}
                  description={
                    <Space orientation="vertical" size={0}>
                      <Typography.Text type="secondary">
                        {connection.provider.toUpperCase()} · {connection.host}{connection.provider === "smtp" ? `:${connection.port}` : ""} · {connection.fromEmail}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        优先级 {connection.priority}{connection.lastLatencyMs ? ` · ${connection.lastLatencyMs} ms` : ""}
                      </Typography.Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <EmptyState
            title="暂无邮件发送配置"
            icon={Mail}
          />
        )}
      </Panel>
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
                whatsappBusinessAccountId: current.whatsappBusinessAccountId ?? "",
                whatsappDefaultTemplateName: current.whatsappDefaultTemplateName ?? "",
                whatsappDefaultTemplateLanguage: current.whatsappDefaultTemplateLanguage ?? "",
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
            label: "登录账号 / WhatsApp Phone Number ID",
            required: true,
            placeholder: "邮箱账号或 WhatsApp Phone Number ID",
          },
          { name: "whatsappBusinessAccountId", label: "WhatsApp Business Account ID", placeholder: "仅 WhatsApp Cloud API 需要" },
          { name: "whatsappDefaultTemplateName", label: "WhatsApp 默认模板", placeholder: "可选；使用正文作为 {{1}} 参数" },
          { name: "whatsappDefaultTemplateLanguage", label: "WhatsApp 模板语言", placeholder: "例如 en_US、zh_CN" },
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
        open={Boolean(templateConnection)}
        title={`WhatsApp 模板 · ${templateConnection?.name ?? ""}`}
        description="从 Meta Business Account 同步模板审核状态；只有 APPROVED 模板可作为默认模板发送。"
        width={820}
        onClose={() => setTemplateConnection(null)}
        footer={<><Button onClick={() => setTemplateConnection(null)}>关闭</Button><Button variant="primary" loading={whatsappTemplates.isFetching} onClick={async () => { if (!templateConnection) return; try { await outboxApi.syncWhatsappTemplates(templateConnection.id); await whatsappTemplates.refetch(); showToast("WhatsApp 模板状态已同步"); } catch (cause) { showToast(cause instanceof Error ? cause.message : "模板同步失败"); } }}>同步模板</Button></>}
      >
        {whatsappTemplates.isLoading
          ? <EmptyState spinning title="正在读取模板" icon={RefreshCw}/>
          : whatsappTemplates.data?.items.length
            ? <List dataSource={whatsappTemplates.data.items} renderItem={item => <List.Item extra={<Badge tone={item.status === "APPROVED" ? "green" : item.status === "REJECTED" ? "red" : "orange"}>{item.status}</Badge>}><List.Item.Meta title={`${item.name} · ${item.language}`} description={`${item.category}${item.rejectedReason ? ` · ${item.rejectedReason}` : ""} · 更新 ${new Date(item.lastSyncedAt).toLocaleString("zh-CN")}`}/></List.Item>}/>
            : <EmptyState title="尚未同步模板" description="先在连接中填写 WhatsApp Business Account ID，再点击同步模板。" icon={RefreshCw}/>}
      </Modal>
      <Modal
        open={queueOpen}
        title="邮件发送队列"
        description="统一查看待配置、发送中、已发送与失败任务；失败重试仍需人工确认。"
        width={1120}
        onClose={() => setQueueOpen(false)}
        footer={<Button onClick={() => setQueueOpen(false)}>关闭</Button>}
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <TableToolbar filters={<>
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
            <ListRefreshButton label="更新发送状态" loading={jobs.isFetching} onClick={() => jobs.refetch()}/>
            <Typography.Text type="secondary">共 {jobs.data?.total ?? 0} 个任务</Typography.Text>
          </>} />
          {jobs.data?.items.length ? <DataTable
            columns={[{key:"recipient",title:"收件人"},{key:"message",title:"主题与内容"},{key:"status",title:"状态"},{key:"attempts",title:"尝试"},{key:"updated",title:"更新时间"},{key:"actions",title:"操作",width:72}]}
            rows={jobs.data.items.map(job=>({key:job.id,cells:[
              <Space orientation="vertical" size={0}><Typography.Text strong>{job.contact.name}</Typography.Text><Typography.Text type="secondary">{job.contact.company} · {job.contact.email??"缺少邮箱"}</Typography.Text></Space>,
              <Space orientation="vertical" size={0}><Typography.Text strong>{job.thread.subject}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:job.message.body}}>{job.message.body}</Typography.Text></Space>,
              <Space orientation="vertical" size={0}><Badge tone={job.status==="sent"?"green":job.status==="failed"?"red":job.status==="awaiting_configuration"?"orange":"blue"}>{{awaiting_configuration:"等待配置",queued:"待发送",processing:"发送中",sent:"已发送",failed:"失败",cancelled:"已取消"}[job.status]}</Badge>{job.lastError&&<Typography.Text type="danger" ellipsis={{tooltip:job.lastError}}>{job.lastError}</Typography.Text>}</Space>,
              <Typography.Text>{job.attempts} / {job.maxAttempts}</Typography.Text>,<Typography.Text>{new Date(job.updatedAt).toLocaleString("zh-CN")}</Typography.Text>,
              <Space>{["failed","awaiting_configuration"].includes(job.status)&&<Button title="确认重试" onClick={async()=>{try{await outboxApi.retryJob(job.id);await jobs.refetch();showToast("发送任务已重新进入队列")}catch(cause){showToast(cause instanceof Error?cause.message:"任务重试失败")}}}><RefreshCw/></Button>}</Space>,
            ]}))}
          />:<EmptyState title="暂无发送任务" icon={Mail}/>}
        </Space>
      </Modal>
      <Modal
        open={governanceOpen}
        title="发送治理"
        description="退信、投诉和退订地址会自动进入抑制名单；恢复发送前必须确认已重新获得联系人许可。"
        width={1120}
        onClose={() => setGovernanceOpen(false)}
        footer={<Button onClick={() => setGovernanceOpen(false)}>关闭</Button>}
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <TableToolbar filters={<>
            <CustomSelect
              ariaLabel="治理内容"
              value={governanceView}
              onChange={setGovernanceView}
              options={["抑制名单", "渠道事件"]}
            />
            {governanceView === "抑制名单" && (
              <>
                <SearchInput ariaLabel="搜索抑制名单" value={suppressionQuery} onChange={(event) => setSuppressionQuery(event.target.value)} placeholder="搜索邮箱或原因" />
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
                <Typography.Text type="secondary">共 {suppressions.data?.total ?? 0} 条记录</Typography.Text>
              </>
            )}
            {governanceView === "渠道事件" && (
              <>
                <ListRefreshButton label="检查新事件" loading={channelEvents.isFetching} onClick={() => channelEvents.refetch()}/>
                <Typography.Text type="secondary">最近 {channelEvents.data?.items.length ?? 0} 条事件</Typography.Text>
              </>
            )}
          </>} />
          {governanceView === "抑制名单" ? (
            suppressions.data?.items.length ? <DataTable columns={[{key:"email",title:"邮箱地址"},{key:"reason",title:"原因"},{key:"source",title:"来源"},{key:"status",title:"状态"},{key:"updated",title:"更新时间"},{key:"actions",title:"操作",width:72}]} rows={suppressions.data.items.map((item:ContactSuppressionApiRecord)=>({key:item.id,cells:[
              <Space orientation="vertical" size={0}><Typography.Text strong>{item.destination}</Typography.Text><Typography.Text type="secondary">邮件渠道</Typography.Text></Space>,<Typography.Text>{item.reason}</Typography.Text>,<Typography.Text>{item.source==="channel_event"?"渠道事件":item.source}</Typography.Text>,<Badge tone={item.active?"red":"neutral"}>{item.active?"已抑制":"已恢复"}</Badge>,<Typography.Text>{new Date(item.updatedAt).toLocaleString("zh-CN")}</Typography.Text>,
              <Space>{item.active&&<Button title="确认恢复发送" onClick={async()=>{try{await outboxApi.restoreSuppression(item.id);await suppressions.refetch();showToast("该地址已移出抑制名单")}catch(cause){showToast(cause instanceof Error?cause.message:"恢复发送失败")}}}><RotateCcw/></Button>}</Space>,
            ]}))}/> : <EmptyState title="暂无抑制记录" icon={Mail}/>
          ) : (
            channelEvents.data?.items.length ? <DataTable columns={[{key:"type",title:"事件类型"},{key:"address",title:"地址"},{key:"message",title:"关联消息"},{key:"status",title:"处理状态"},{key:"time",title:"发生时间"},{key:"note",title:"说明"}]} rows={channelEvents.data.items.map((item:ChannelWebhookEventApiRecord)=>({key:item.id,cells:[
              <Badge tone={item.eventType==="bounced"||item.eventType==="complained"?"red":item.eventType==="unsubscribed"?"orange":"blue"}>{{delivered:"已送达",bounced:"退信",complained:"投诉",unsubscribed:"退订",inbound_reply:"客户回复"}[item.eventType]}</Badge>,
              <Space orientation="vertical" size={0}><Typography.Text strong>{item.sender??item.recipient??"—"}</Typography.Text><Typography.Text type="secondary">{item.recipient&&item.sender?`发送至 ${item.recipient}`:""}</Typography.Text></Space>,<Typography.Text ellipsis={{tooltip:item.externalMessageId??""}}>{item.externalMessageId??"未关联"}</Typography.Text>,
              <Badge tone={item.processingStatus==="processed"?"green":item.processingStatus==="unlinked"?"orange":item.processingStatus==="failed"?"red":"blue"}>{{processed:"已处理",unlinked:"未关联",failed:"失败",pending:"处理中"}[item.processingStatus]}</Badge>,<Typography.Text>{new Date(item.occurredAt).toLocaleString("zh-CN")}</Typography.Text>,<Typography.Text>{item.reason??item.processingError??"—"}</Typography.Text>,
            ]}))}/> : <EmptyState title="暂无渠道事件" icon={Mail}/>
          )}
        </Space>
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
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="事件接收地址">
              <Space wrap>
                <Typography.Text code copyable>
                  {webhookConnection
                    ? `${window.location.origin}/api/outbox-webhooks/${webhookConnection.id}`
                    : ""}
                </Typography.Text>
                <Typography.Text type="secondary">配置到邮件服务或渠道适配器的回调地址</Typography.Text>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="签名密钥">
              <Space wrap>
                <Typography.Text code copyable={Boolean(webhookSecret)}>
                  {webhookSecret || `•••• •••• •••• ${webhookConnection?.webhookSecretEnding ?? "未生成"}`}
                </Typography.Text>
                <Typography.Text type={webhookSecret ? "warning" : "secondary"}>
                  {webhookSecret ? "请立即保存，关闭后无法再次查看" : "当前密钥仅显示末四位"}
                </Typography.Text>
              </Space>
            </Descriptions.Item>
          </Descriptions>
          <StatusNotice
            tone="info"
            icon={<ShieldCheck size={17}/>}
            title="签名协议"
            description={<>请求头携带 <Typography.Text code>x-sondara-timestamp</Typography.Text> 和 <Typography.Text code>x-sondara-signature</Typography.Text>。签名内容为 <Typography.Text code>timestamp.JSON</Typography.Text>，使用 HMAC-SHA256；超过 5 分钟或重复事件不会重复处理。</>}
          />
        </Space>
      </Modal>
    </Flex>
  );
}

export function SettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = sections[params.section as keyof typeof sections] ?? "个人资料";
  const [integrationSection, setIntegrationSection] = useState("core");
  useEffect(() => {
    if (tab !== "数据源与集成") return;
    setIntegrationSection(location.hash === "#lead-source-settings" ? "leads" : location.hash === "#external-service-settings" ? "extensions" : "core");
  }, [location.hash, tab]);
  const [confirmDelete, setConfirmDelete] = useState<"account" | null>(null);
  const [aiServices, setAiServices] = useState<AiService[]>([]);
  const [serviceDialog, setServiceDialog] = useState(false);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [aiConnectionForm] = Form.useForm();
  const [editingAiService, setEditingAiService] = useState<AiService | null>(null);
  const [editServiceSaving, setEditServiceSaving] = useState(false);
  const [editServiceForm] = Form.useForm();
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [rotationStrategy, setRotationStrategy] = useState("按优先级故障切换");
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
  const connectorHealthQuery = useQuery({
    queryKey: ["system-connector-health"],
    queryFn: systemApi.connectorHealth,
    enabled: tab === "数据与备份",
    retry: 1,
    staleTime: 30_000,
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
  const integrationIssues = [
    !searchConnection ? "搜索与网页 API 未配置" : searchConnection.status !== "available" ? "搜索与网页 API 需要测试或修复" : null,
    !mapConnection ? "地图 API 未配置" : mapConnection.status !== "available" ? "地图 API 需要测试或修复" : null,
    !smtpConnection ? "消息发送服务未配置" : smtpConnection.status !== "available" ? "消息发送服务需要测试或修复" : null,
  ].filter((item): item is string => Boolean(item));
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
                : a.priority - b.priority,
        ),
    [aiServices, serviceQuery, serviceSort, serviceStatus],
  );
  const aiServicePaging = usePagination(
    filteredAiServices,
    10,
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
    const policy = aiPolicyQuery.data;
    if (!policy) return;
    setRotationStrategy(policy.rotationStrategy === "round-robin" ? "按连接轮询" : policy.rotationStrategy === "least-used" ? "最久未用优先" : "按优先级故障切换");
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
  const openAiConnectionDialog = () => {
    aiConnectionForm.setFieldsValue({ template: "自定义接口", protocol: "openai-responses", keyName: "主密钥", priority: aiServices.length + 1 });
    setServiceDialog(true);
  };
  const applyAiTemplate = (template: string) => {
    const preset = aiConnectionTemplates[template];
    aiConnectionForm.setFieldsValue(preset ?? { name: "", endpoint: "", model: "", protocol: "openai-responses" });
  };
  const saveAiConnection = async () => {
    let created: AiServiceApiRecord | null = null;
    try {
      const values = await aiConnectionForm.validateFields();
      setServiceSaving(true);
      created = await aiApi.createConnection({
        name: values.name,
        protocol: values.protocol,
        endpoint: values.endpoint,
        model: values.model,
        keyName: values.keyName,
        secret: values.secret,
        priority: Number(values.priority),
      });
      try {
        const result = await aiApi.testService(created.id);
        showToast(`模型连接已保存，测试通过，延迟 ${result.latencyMs} ms`);
      } catch (cause) {
        showToast(`模型连接已保存，但测试失败：${cause instanceof Error ? cause.message : "请检查地址、模型和密钥"}`);
      }
      await aiServiceQuery.refetch();
      aiConnectionForm.resetFields();
      setServiceDialog(false);
    } catch (cause) {
      if (created) await aiServiceQuery.refetch();
      if (cause instanceof Error) showToast(cause.message);
    } finally {
      setServiceSaving(false);
    }
  };
  const openEditAiService = (service: AiService) => {
    setEditingAiService(service);
    editServiceForm.setFieldsValue({ name: service.name, endpoint: service.endpoint, model: service.model, priority: service.priority, protocol: service.protocol });
  };
  const saveEditedAiService = async () => {
    if (!editingAiService) return;
    try {
      const values = await editServiceForm.validateFields();
      setEditServiceSaving(true);
      await aiApi.updateService(editingAiService.id, { name: values.name, protocol: values.protocol, endpoint: values.endpoint, model: values.model, priority: Number(values.priority) });
      if (values.secret) await aiApi.replaceKey(editingAiService.id, { name: "连接密钥", secret: values.secret });
      try {
        const result = await aiApi.testService(editingAiService.id);
        showToast(`模型连接已更新，测试通过，延迟 ${result.latencyMs} ms`);
      } catch (cause) {
        showToast(`模型连接已更新，但测试失败：${cause instanceof Error ? cause.message : "请检查地址、模型和密钥"}`);
      }
      await aiServiceQuery.refetch();
      setEditingAiService(null);
      editServiceForm.resetFields();
    } catch (cause) {
      if (cause instanceof Error) showToast(cause.message);
    } finally {
      setEditServiceSaving(false);
    }
  };
  const deleteAiService = async (service: AiService) => {
    try {
      await aiApi.deleteService(service.id);
      setSelectedAiServices(current => { const next = new Set(current); next.delete(service.id); return next; });
      await aiServiceQuery.refetch();
      showToast(`模型连接“${service.name}”已删除`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "模型连接删除失败");
    }
  };
  const saveAiPolicy = async () => {
    await aiApi.updatePolicy({
      rotationStrategy: rotationStrategy === "按连接轮询" ? "round-robin" : rotationStrategy === "最久未用优先" ? "least-used" : "failover",
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
        <Button variant="primary" onClick={openAiConnectionDialog}>
          <Plus size={16} />
          添加模型
        </Button>
      </>
    ) : undefined;
  const SettingsContentFrame = ["登录与安全", "AI 模型配置", "数据源与集成", "数据与备份"].includes(tab) ? Fragment : Card;
  return (
    <PageContainer>
      <PageHeader
        title={activeMeta.title}
        description={`应用设置 · ${activeMeta.description}`}
        actions={pageActions}
      />
      {tab === "个人资料" ? (
          <Row className="settings-profile-grid" gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card className="settings-profile-card" title={<Space><UserRound size={18} />身份资料</Space>} extra={<Typography.Text type="secondary">用于账户显示和消息通知</Typography.Text>}>
                <Space orientation="vertical" size="large" style={{ width: "100%" }}>
                  <Space align="center"><Avatar size="large">{profileDraft.displayName?.trim().slice(0, 1) || "用"}</Avatar><Space orientation="vertical" size={0}><Typography.Text strong>{profileDraft.displayName || "未设置名称"}</Typography.Text><Typography.Text type="secondary">{profileDraft.email || "未设置邮箱"}</Typography.Text></Space></Space>
                  <Form layout="vertical">
                    <Form.Item label="显示名称">
                  <Input aria-label="显示名称"
                    value={profileDraft.displayName}
                    onChange={(e) =>
                      setProfileDraft((value) => ({
                        ...value,
                        displayName: e.target.value,
                      }))
                    }
                  />
                    </Form.Item>
                    <Form.Item label="邮箱">
                  <Input aria-label="邮箱"
                    type="email"
                    value={profileDraft.email}
                    onChange={(e) =>
                      setProfileDraft((value) => ({
                        ...value,
                        email: e.target.value,
                      }))
                    }
                  />
                    </Form.Item>
                  </Form>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card className="settings-profile-card" title={<Space><Database size={18} />区域与经营偏好</Space>} extra={<Typography.Text type="secondary">经营数据的默认口径</Typography.Text>}>
                <Form layout="vertical">
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item label="默认语言">
                        <CustomSelect
                          width="100%"
                          ariaLabel="默认语言"
                          value={profileDraft.language}
                          onChange={(language) =>
                            setProfileDraft((value) => ({ ...value, language }))
                          }
                          options={["简体中文", "English"]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="时区">
                        <CustomSelect
                          width="100%"
                          ariaLabel="时区"
                          value={profileDraft.timezone}
                          onChange={(timezone) =>
                            setProfileDraft((value) => ({ ...value, timezone }))
                          }
                          options={["Asia/Shanghai (UTC+8)", "Europe/Berlin (UTC+2)"]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item label="基准币种">
                        <CustomSelect
                          width="100%"
                          ariaLabel="基准币种"
                          value={profileDraft.currency}
                          onChange={(currency) =>
                            setProfileDraft((value) => ({ ...value, currency }))
                          }
                          options={["CNY · 人民币", "EUR · 欧元", "USD · 美元"]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="经营名称" style={{ marginBottom: 0 }}>
                        <Input aria-label="经营名称"
                          value={profileDraft.businessName}
                          onChange={(e) =>
                            setProfileDraft((value) => ({
                              ...value,
                              businessName: e.target.value,
                            }))
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
              </Card>
            </Col>
          </Row>
        ) : (
          <SettingsContentFrame>
          {tab === "AI 模型配置" ? (
            <Panel>
            <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
              {aiServices.some(service => ["异常", "性能退化", "未验证"].includes(service.status)) && (
                <StatusNotice
                  tone="warning"
                  icon={<Bot size={17}/>}
                  title={`${aiServices.filter(service => ["异常", "性能退化", "未验证"].includes(service.status)).length} 个模型连接需要处理`}
                  description={aiServices.filter(service => ["异常", "性能退化", "未验证"].includes(service.status)).map(service => `${service.name}：${service.status}`).join("；")}
                  action={<Button onClick={async()=>{for(const service of aiServices.filter(item=>item.status!=="停用"))await testAiService(service.id)}}>重新检测</Button>}
                />
              )}
                <TableToolbar filters={<>
                  <SearchInput ariaLabel="搜索 AI 服务" value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} placeholder="搜索服务、模型或提供商" />
                  {aiServices.length > 4 && <><CustomSelect
                    ariaLabel="筛选 AI 服务状态"
                    value={serviceStatus}
                    onChange={setServiceStatus}
                    options={["全部状态", "可用", "性能退化", "未验证", "异常", "停用"]}
                  />
                  <CustomSelect
                    ariaLabel="AI 服务排序"
                    value={serviceSort}
                    onChange={(value) => setServiceSort(value as AiServiceSort)}
                    options={[
                      "优先级最高",
                      "服务名称 A–Z",
                      "服务名称 Z–A",
                      "延迟最低",
                    ]}
                  /></>}
                  {(serviceQuery || serviceStatus !== "全部状态" || serviceSort !== "优先级最高") && <Button
                    onClick={() => {
                      setServiceQuery("");
                      setServiceStatus("全部状态");
                      setServiceSort("优先级最高");
                    }}
                  >
                    清除筛选
                  </Button>}
                </>} selection={selectedAiServices.size > 0 ? (
                  <SelectionBar
                    count={selectedAiServices.size}
                    unit="个服务"
                    actions={<>
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
                    </>}
                  />
                ) : undefined} />
              {failoverEnabled && aiServices.filter(service=>service.status!=="停用").length<2 && <StatusNotice tone="warning" icon={<Bot size={17}/>} title="AI 服务缺少备用连接" description="当前只有一个已启用的模型连接；建议添加第二个服务用于自动故障切换。"/>}
              {aiServiceQuery.isLoading ? (
                <PageState status="loading" title="正在加载 AI 服务" />
              ) : aiServiceQuery.isError ? (
                <PageState status="error" title="AI 服务加载失败" description="请检查服务端连接后重试。" onRetry={() => aiServiceQuery.refetch()} />
              ) : (
              <DataTable ariaLabel="AI 模型连接表格" className="ai-model-table" minWidth={1120} columns={[
                {key:"select",title:<span><Checkbox aria-label="选择本页全部 AI 服务" checked={aiServicePaging.pageItems.length>0&&aiServicePaging.pageItems.every(service=>selectedAiServices.has(service.id))} onChange={event=>setSelectedAiServices(current=>{const next=new Set(current);aiServicePaging.pageItems.forEach(service=>event.target.checked?next.add(service.id):next.delete(service.id));return next;})}/></span>,width:52},
                {key:"service",title:<Button onClick={()=>setServiceSort(serviceSort==="服务名称 A–Z"?"服务名称 Z–A":"服务名称 A–Z")}>模型连接{aiSortIcon(serviceSort==="服务名称 A–Z"||serviceSort==="服务名称 Z–A",serviceSort==="服务名称 Z–A")}</Button>,width:300},
                {key:"interface",title:"接口配置",width:280},
                {key:"routing",title:<Button onClick={()=>setServiceSort("优先级最高")}>调用顺序{aiSortIcon(serviceSort==="优先级最高")}</Button>,width:160},
                {key:"status",title:<Button onClick={()=>setServiceSort("延迟最低")}>运行状态{aiSortIcon(serviceSort==="延迟最低")}</Button>,width:190},
                {key:"enabled",title:"启用",width:82},
                {key:"actions",title:"操作",width:168},
              ]} rows={aiServicePaging.pageItems.map(service=>({key:service.id,cells:[
                <Checkbox aria-label={`选择 ${service.name}`} checked={selectedAiServices.has(service.id)} onChange={event=>setSelectedAiServices(current=>{const next=new Set(current);event.target.checked?next.add(service.id):next.delete(service.id);return next;})}/>,
                <Space className="ai-model-table__profile" align="center"><Avatar icon={<Bot size={17}/>}/><Space className="ai-model-table__copy" orientation="vertical" size={0}><Typography.Text strong ellipsis={{tooltip:service.name}}>{service.name}</Typography.Text><Typography.Text type="secondary" ellipsis={{tooltip:`${service.provider} · ${service.model}`}}>{service.provider} · {service.model}</Typography.Text></Space></Space>,
                <Space className="ai-model-table__copy" orientation="vertical" size={3}><Badge tone="blue">{aiProtocolLabel[service.protocol]}</Badge><Typography.Text type="secondary" ellipsis={{tooltip:service.endpoint}}>{service.endpoint}</Typography.Text></Space>,
                <Space orientation="vertical" size={2}><Typography.Text strong>优先级 {String(service.priority).padStart(2,"0")}</Typography.Text><Typography.Text type="secondary">{service.priority===1?"主连接":`备用连接 ${service.priority-1}`}</Typography.Text><Typography.Text type={service.keyCount>0?"secondary":"danger"}>{service.keyCount>0?"API Key 已配置":"缺少 API Key"}</Typography.Text></Space>,
                <Space orientation="vertical" size={2}><Space size={8}><Badge tone={service.status==="可用"?"green":service.status==="异常"?"red":service.status==="性能退化"||service.status==="未验证"?"orange":"neutral"}>{service.status}</Badge><Typography.Text strong type={service.status==="性能退化"?"warning":undefined}>{service.latency}</Typography.Text></Space><RecordTime value={service.lastTestedAt} label={service.lastTestedAt?"最近检测":"尚未检测"}/></Space>,
                <Switch aria-label={`${service.name}启用状态`} checked={service.status!=="停用"} onChange={()=>toggleAiService(service.id)}/>,
                <Space><Button aria-label={`编辑 ${service.name}`} title="编辑模型连接" onClick={()=>openEditAiService(service)}><Pencil/></Button><Button aria-label={`测试 ${service.name}`} title="测试连接" onClick={()=>testAiService(service.id)}><RefreshCw/></Button><Button disabled={service.priority===1} aria-label={service.priority===1?`${service.name} 已是最高优先级`:`将 ${service.name} 上移一个优先级`} title={service.priority===1?"已是最高优先级":"上移一个优先级"} onClick={()=>moveServiceUp(service.id)}><ArrowUp/></Button><Popconfirm title={`删除模型连接“${service.name}”？`} description="对应 API Key 和连接状态会一并删除，此操作不可撤销。" okText="删除" cancelText="取消" okButtonProps={{danger:true}} onConfirm={()=>deleteAiService(service)}><Button variant="danger" aria-label={`删除 ${service.name}`} title="删除模型连接"><Trash2/></Button></Popconfirm></Space>,
              ]}))}/>
              )}
              {filteredAiServices.length > 0 && (
                <Pagination
                  page={aiServicePaging.page}
                  pageSize={aiServicePaging.pageSize}
                  total={filteredAiServices.length}
                  onPageChange={aiServicePaging.setPage}
                  onPageSizeChange={aiServicePaging.setPageSize}
                  itemName="个服务"
                />
              )}
            </Space>
            </Panel>
        ) : tab === "数据源与集成" ? (
          <Tabs
            className="settings-integration-tabs"
            activeKey={integrationSection}
            aria-label="集成分类导航"
            onChange={(key) => {
              setIntegrationSection(key);
              navigate({ pathname: location.pathname, hash: key === "leads" ? "lead-source-settings" : key === "extensions" ? "external-service-settings" : "" }, { replace: true });
            }}
            items={[{
              key: "core",
              label: "核心服务",
              children: <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            {!integrationQuery.isLoading && !outboundConnectionsQuery.isLoading && (
              <StatusNotice
                tone={integrationIssues.length ? "warning" : "success"}
                icon={<Route size={17}/>}
                title={integrationIssues.length ? `${integrationIssues.length} 项集成需要处理` : "核心集成运行正常"}
                description={integrationIssues.length ? integrationIssues.join("；") : "搜索、地图和消息发送服务均已配置并通过连接测试。"}
                action={integrationIssues.length ? <Button onClick={async()=>{await Promise.all([integrationQuery.refetch(),outboundConnectionsQuery.refetch()]);showToast("已重新检查集成状态")}}>重新检查</Button> : undefined}
              />
            )}
            <OutboundSettings />
            {integrationGroups.map((group, groupIndex) => (
              <Panel
                className="settings-section-card"
                key={group.title}
                title={group.title}
                subtitle={group.description}
              >
                <List dataSource={[...group.services] as Array<{ name: string; description: string }>} renderItem={(service) => {
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
                      <List.Item
                        className="settings-service-row"
                        key={service.name}
                        extra={
                          <Space className="settings-service-row__actions" wrap>
                            <Badge
                              tone={statusLabel === "可用" || statusLabel === "内置可用" ? "green" : statusLabel === "异常" ? "red" : "neutral"}
                            >
                              {statusLabel}
                            </Badge>
                            {isBuiltIn ? (
                              <Typography.Text type="secondary">无需密钥</Typography.Text>
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
                                          showToast(`SMTP 连接正常 · ${result.latencyMs} ms${result.activatedJobs ? `，已激活 ${result.activatedJobs} 个待发送任务` : ""}`);
                                        } catch (cause) {
                                          await outboundConnectionsQuery.refetch();
                                          showToast(cause instanceof Error ? cause.message : "SMTP 连接测试失败");
                                        }
                                        return;
                                      }
                                      testIntegrationConnection(connection as typeof searchConnection, service.name === "地图 API" ? "地图" : "搜索");
                                    }}
                                  >
                                    测试
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (isEmail) {
                                      document.getElementById("outbound-settings")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                      return;
                                    }
                                    if (service.name === "搜索与网页 API" || service.name === "地图 API") setIntegration(service.name);
                                  }}
                                >
                                  {isConnected ? "管理" : "配置"}
                                </Button>
                              </>
                            )}
                          </Space>
                        }
                      >
                        <List.Item.Meta
                          avatar={<Avatar icon={<Icon size={19} />} />}
                          title={<Typography.Text strong>{service.name}</Typography.Text>}
                          description={<Typography.Text type="secondary">{connectionDetail}</Typography.Text>}
                        />
                      </List.Item>
                    );
                  }} />
                {groupIndex === 0 && (
                  <StatusNotice tone="info" icon={<ShieldCheck size={17}/>} title="连接凭据已加密并按工作区隔离" description="公开联系人与行业来源属于无需密钥的内置基础能力。"/>
                )}
              </Panel>
            ))}
            <Panel
              className="settings-section-card"
              title="采购公告数据源"
              subtitle="仅管理官方数据源凭据；采购条件和目标地区直接在 AI 获客任务中设置。"
            >
              <ProcurementPage embedded view="settings" />
            </Panel>
              </Space>,
            }, {
              key: "leads",
              label: "线索入口",
              children: <div id="lead-source-settings"><LeadSourcesPage embedded /></div>,
            }, {
              key: "extensions",
              label: "扩展服务",
              children: <div id="external-service-settings"><ConnectorCatalogPage embedded /></div>,
            }]}
          />
        ) : tab === "数据与备份" ? (
          <Row className="settings-data-grid" gutter={[16, 16]}>
            <Col xs={24} lg={12}>
            <Card className="settings-data-card" title={<Space><MonitorSmartphone size={18} />数据存储</Space>} extra={<Badge tone="green">已持久化</Badge>}>
              <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small">
                <Descriptions.Item label="部署方式">本地 SQLite 文件持久化，按工作区隔离</Descriptions.Item>
                <Descriptions.Item label="保存范围">客户、任务、内容、活动与商机</Descriptions.Item>
                <Descriptions.Item label="保存方式">业务动作后实时写入，无需手动保存</Descriptions.Item>
                <Descriptions.Item label="状态">修改即时生效</Descriptions.Item>
              </Descriptions>
            </Card>
            </Col>
            <Col xs={24} lg={12}>
            <Card className="settings-data-card" title={<Space><Database size={18} />数据导出与备份</Space>} extra={<Typography.Text type="secondary">下载当前工作区的真实数据</Typography.Text>}>
              <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                <Space className="settings-data-actions" wrap>
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
                  <Download size={17} />
                  导出业务数据 (JSON)
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
                  <Database size={17} />
                  完整数据库备份
                </Button>
                </Space>
                <StatusNotice
                  tone={backupsQuery.data?.automatic ? "success" : "warning"}
                  icon={<Database size={17}/>}
                  title={backupsQuery.data?.automatic ? `自动备份已启用 · 保留最近 ${backupsQuery.data.retentionCount} 份` : "自动备份未启用"}
                  description="每份自动备份生成后均执行 SQLite 完整性校验；升级前仍建议额外下载一份。"
                />
                {(backupsQuery.data?.items ?? []).length > 0 && (
                  <List
                    header={<Flex align="center" justify="space-between" gap={12} wrap><Typography.Text strong>最近持久化备份</Typography.Text><Button size="sm" onClick={async()=>{const item=backupsQuery.data?.items[0];if(!item)return;try{await systemApi.validateBackup(item.fileName);await backupsQuery.refetch();showToast("最新备份校验通过，可用于恢复")}catch{showToast("备份校验失败，请勿用于恢复")}}}>验证最新备份</Button></Flex>}
                    dataSource={backupsQuery.data!.items.slice(0, 3)}
                    renderItem={(item) => <List.Item><Flex align="center" gap={12}><Avatar icon={<Database size={16}/>} /><Space orientation="vertical" size={0}><Typography.Text strong>{new Date(item.createdAt).toLocaleString("zh-CN")}</Typography.Text><Typography.Text type="secondary">{`${(item.size / 1024 / 1024).toFixed(1)} MB · ${item.verifiedAt ? "已校验" : "待校验"}`}</Typography.Text></Space></Flex></List.Item>}
                  />
                )}
              </Space>
            </Card>
            </Col>
            <Col span={24}>
            <Card
              className="settings-data-card"
              title={<Space><Route size={18} />运行与连接健康</Space>}
              extra={<Typography.Text type="secondary">业务数据量、后台任务和连接器状态</Typography.Text>}
            >
              <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
                {operationsQuery.data && (
                  <div className="settings-data-overview">
                    <Flex className="settings-data-overview__heading" align="center" justify="space-between" gap={12} wrap>
                      <Typography.Text strong>运行概览</Typography.Text>
                      <Badge tone={operationsQuery.data.workers.backup === "enabled" ? "green" : "orange"}>{operationsQuery.data.workers.backup === "enabled" ? "自动备份运行中" : "自动备份关闭"}</Badge>
                    </Flex>
                    <Row gutter={[16, 16]}>
                      <Col xs={12} md={4}><Statistic title="客户" value={operationsQuery.data.counts.customers}/></Col>
                      <Col xs={12} md={4}><Statistic title="任务" value={operationsQuery.data.counts.tasks}/></Col>
                      <Col xs={12} md={4}><Statistic title="商机" value={operationsQuery.data.counts.deals}/></Col>
                      <Col xs={12} md={4}><Statistic title="雷达任务" value={operationsQuery.data.counts.radarTasks}/></Col>
                      <Col xs={12} md={4}><Statistic title="外发队列" value={operationsQuery.data.counts.queuedOutbound}/></Col>
                    </Row>
                  </div>
                )}
              {connectorHealthQuery.data && (() => {
                const s = connectorHealthQuery.data.summary;
                const totalIssues = s.totalIssues;
                if (totalIssues === 0) return (
                  <StatusNotice tone="success" icon={<CheckCircle2 size={17}/>} title="连接器运行正常" description="过去 7 天未发现失败记录。"/>
                );
                return (
                  <StatusNotice tone="warning" icon={<AlertTriangle size={17}/>} title={`过去 7 天有 ${totalIssues} 项连接异常`} description={
                    <Space wrap>
                      {s.outboundUnhealthy > 0 && <Badge tone="red">外发渠道 {s.outboundUnhealthy}</Badge>}
                      {s.integrationUnhealthy > 0 && <Badge tone="red">数据源 {s.integrationUnhealthy}</Badge>}
                      {s.leadSourceUnhealthy > 0 && <Badge tone="orange">官方线索 {s.leadSourceUnhealthy}</Badge>}
                      {s.failedRadarTasks > 0 && <Badge tone="red">雷达任务 {s.failedRadarTasks}</Badge>}
                      {s.radarErrors > 0 && <Badge tone="red">雷达错误 {s.radarErrors}</Badge>}
                      {s.failedRadarQueue > 0 && <Badge tone="orange">研究队列 {s.failedRadarQueue}</Badge>}
                      {s.outboxFailures > 0 && <Badge tone="red">外发失败 {s.outboxFailures}</Badge>}
                      {s.aiServiceDegraded > 0 && <Badge tone="orange">AI 服务 {s.aiServiceDegraded}</Badge>}
                    </Space>
                  } />
                );
              })()}
              {connectorHealthQuery.data && (() => {
                const data = connectorHealthQuery.data;
                const allConnections = [
                  ...data.connections.outbound.map(c => ({ type: "外发渠道" as const, name: c.name, provider: c.provider, enabled: c.enabled, status: c.status, detail: c.imapEnabled ? "SMTP+IMAP" : "SMTP", lastError: c.lastError, lastTestedAt: c.lastTestedAt, lastLatencyMs: c.lastLatencyMs })),
                  ...data.connections.integrations.map(c => ({ type: c.category === "search" ? "搜索数据源" as const : "地图数据源" as const, name: c.name, provider: c.provider, enabled: c.enabled, status: c.status, detail: c.enabled ? "已启用" : "已禁用", lastError: c.lastError, lastTestedAt: c.lastTestedAt, lastLatencyMs: c.lastLatencyMs })),
                  ...data.connections.leadSources.map(c => ({ type: "官方线索" as const, name: c.name, provider: c.provider, enabled: c.enabled, status: c.hasAccessToken ? c.status : "no_token", detail: c.hasAccessToken ? "已授权" : "未授权", lastError: c.lastError, lastTestedAt: c.lastSyncedAt, lastLatencyMs: null as number | null })),
                ];
                if (!allConnections.length && !data.failedRadarTasks.length && !data.outboxFailures.length && !data.radarEvents.length) return null;
                const connStatusTone = (c: { enabled: boolean; status: string; lastError: string | null }) => {
                  if (!c.enabled) return "neutral" as const;
                  if (c.status === "error" || c.status === "failed") return "red" as const;
                  if (c.status === "degraded" || c.status === "no_token" || c.lastError) return "orange" as const;
                  if (c.status === "ok" || c.status === "connected" || c.status === "active" || c.status === "tested") return "green" as const;
                  return "blue" as const;
                };
                return (
                  <List header={<Typography.Text strong>连接器与失败明细</Typography.Text>} dataSource={[
                    ...allConnections.map(c => {
                      const tone = connStatusTone(c);
                      return (
                        <List.Item key={`${c.type}-${c.name}`} extra={<Badge tone={tone}>{c.enabled ? (c.status === "no_token" ? "未授权" : c.status === "untested" ? "未测试" : c.status === "ok" || c.status === "connected" || c.status === "active" ? "正常" : c.status) : "已禁用"}</Badge>}>
                          <List.Item.Meta title={`${c.type} · ${c.name}`} description={<Space orientation="vertical" size={0}><Typography.Text type="secondary">{c.provider} · {c.detail}{c.lastLatencyMs ? ` · ${c.lastLatencyMs}ms` : ""}{c.lastTestedAt ? ` · ${new Date(c.lastTestedAt).toLocaleString("zh-CN")}` : ""}</Typography.Text>{c.lastError && <Typography.Text type="danger">{c.lastError}</Typography.Text>}</Space>} />
                        </List.Item>
                      );
                    }),
                    ...data.failedRadarTasks.map(task => (
                      <List.Item key={task.id}><List.Item.Meta avatar={<Avatar icon={<AlertTriangle size={14}/>} />} title={`雷达任务失败 · ${task.name}`} description={`${task.lastError ?? "未知错误"} · ${new Date(task.updatedAt).toLocaleString("zh-CN")}`} /></List.Item>
                    )),
                    ...data.outboxFailures.slice(0, 5).map(job => (
                      <List.Item key={job.id}><List.Item.Meta avatar={<Avatar icon={<AlertTriangle size={14}/>} />} title={`外发失败 · ${job.channel}`} description={`${job.lastError ?? "未知错误"} · 重试 ${job.attempts}/${job.maxAttempts} · ${new Date(job.updatedAt).toLocaleString("zh-CN")}`} /></List.Item>
                    )),
                    ...data.radarEvents.slice(0, 5).map(event => (
                      <List.Item key={event.id}><List.Item.Meta avatar={<Avatar icon={<AlertTriangle size={14}/>} />} title={`雷达连接器 · ${event.eventType}`} description={`${event.message} · ${new Date(event.createdAt).toLocaleString("zh-CN")}`} /></List.Item>
                    )),
                  ]} renderItem={(item) => item}/>
                );
              })()}
              </Space>
            </Card>
            </Col>
          </Row>
        ) : (
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <Card title={<Space><LockKeyhole size={18} />账户保护</Space>} extra={<Typography.Text type="secondary">管理登录凭据与第二重身份验证</Typography.Text>}>
              <List dataSource={["password", "two-factor"]} renderItem={(item) => item === "password" ? (
                <List.Item actions={[<Button key="password" size="sm" onClick={() => setSecurityDialog("password")}>修改密码</Button>]}>
                  <Space align="center"><Avatar icon={<LockKeyhole size={17}/>} /><Space orientation="vertical" size={0}><Typography.Text strong>登录密码</Typography.Text><Typography.Text type="secondary">使用当前密码验证后可设置新密码</Typography.Text></Space></Space>
                </List.Item>
              ) : (
                <List.Item actions={[<Badge key="status" tone={twoFactorStatusQuery.data?.enabled ? "green" : "orange"}>{twoFactorStatusQuery.data?.enabled ? "已启用" : "未启用"}</Badge>, <Button key="two-factor" size="sm" onClick={openTwoFactorDialog}>{twoFactorStatusQuery.data?.enabled ? "管理" : "设置"}</Button>]}>
                  <Space align="center"><Avatar icon={<ShieldCheck size={17}/>} /><Space orientation="vertical" size={0}><Typography.Text strong>双重验证</Typography.Text><Typography.Text type="secondary">{twoFactorStatusQuery.data?.enabled ? "已启用验证器应用和恢复码" : "使用验证器应用保护账户"}</Typography.Text></Space></Space>
                </List.Item>
              )}/>
            </Card>
            <Card title={<Space><MonitorSmartphone size={18} />登录会话</Space>} extra={<Typography.Text type="secondary">查看当前设备和其他活动会话</Typography.Text>}>
              <List preserveLastDivider={(sessionsQuery.data?.items ?? []).some(session => !session.current)} dataSource={sessionsQuery.data?.items ?? []} renderItem={(session) => <List.Item key={session.id} actions={[session.current ? <Badge key="current" tone="green">当前</Badge> : <Button key="revoke" size="sm" onClick={async()=>{await authApi.revokeSession(session.id);await sessionsQuery.refetch();showToast("该登录会话已退出")}}>退出</Button>]}>
                  <Space align="center"><Avatar icon={<MonitorSmartphone size={17}/>} /><Space orientation="vertical" size={0}><Typography.Text strong>{`${/Windows/i.test(session.userAgent ?? "") ? "Windows" : /Mac/i.test(session.userAgent ?? "") ? "macOS" : /Mobile|Android|iPhone/i.test(session.userAgent ?? "") ? "移动设备" : "浏览器会话"} · ${session.ipAddress ?? "未知地址"}`}</Typography.Text><Typography.Text type="secondary">{`${session.current ? "当前设备" : "其他设备"} · 最近活动：${session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString("zh-CN") : "未知"}`}</Typography.Text></Space></Space>
                </List.Item>}/>
              {(sessionsQuery.data?.items ?? []).some(session => !session.current) && <List dataSource={["other-sessions"]} renderItem={() => <List.Item actions={[<Button key="revoke-all" size="sm" onClick={async()=>{const result=await authApi.revokeOtherSessions();await sessionsQuery.refetch();showToast(`已退出 ${result.removed} 个其他会话`)}}>全部退出</Button>]}>
                  <Space align="center"><Avatar icon={<UserRound size={17}/>} /><Space orientation="vertical" size={0}><Typography.Text strong>其他登录设备</Typography.Text><Typography.Text type="secondary">一次撤销当前设备之外的全部会话</Typography.Text></Space></Space>
                </List.Item>}/>}
            </Card>
            <Card title={<Space><AlertTriangle size={18}/>危险操作</Space>} extra={<Badge tone="red">不可恢复</Badge>}>
              <List dataSource={["delete-account"]} renderItem={() => (
                <List.Item actions={[
                  <Button key="delete" variant="danger" onClick={() => setConfirmDelete("account")}>删除账户</Button>,
                ]}>
                  <List.Item.Meta
                    avatar={
                      <Avatar icon={<Trash2 size={17}/>} />
                    }
                    title={<Typography.Text strong>删除账户和全部数据</Typography.Text>}
                    description="永久删除账号、AI 密钥、连接配置及全部经营数据。删除前请先导出完整备份。"
                  />
                </List.Item>
              )}/>
            </Card>
          </Space>
        )}
          </SettingsContentFrame>
        )}
      <Modal
        open={policyOpen}
        title="轮转与重试策略"
        description="配置模型连接轮转、请求重试和连接故障切换。"
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
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <Steps
            size="small"
            current={1}
            items={[
              { title: "请求主服务", description: "使用当前可用密钥" },
              { title: "重试与轮转", description: "换密钥并按策略重试" },
              { title: "服务降级", description: "切换下一个可用服务" },
            ]}
          />
          <Form layout="vertical">
            <Row gutter={16}>
              <Col xs={24} sm={12}><Form.Item label="密钥轮转方式">
              <CustomSelect
                ariaLabel="密钥轮转方式"
                value={rotationStrategy}
                onChange={setRotationStrategy}
                options={["按优先级故障切换", "按连接轮询", "最久未用优先"]}
              />
              </Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item label="单密钥重试次数">
              <CustomSelect
                ariaLabel="单密钥重试次数"
                value={retryCount}
                onChange={setRetryCount}
                options={["不重试", "1 次", "2 次", "3 次"]}
              />
              </Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item label="重试间隔">
              <CustomSelect
                ariaLabel="重试间隔"
                value={retryDelay}
                onChange={setRetryDelay}
                options={["指数退避", "固定 1 秒", "固定 3 秒"]}
              />
              </Form.Item></Col>
              <Col xs={24} sm={12}><Form.Item label="失败冷却时间">
              <CustomSelect
                ariaLabel="失败冷却时间"
                value={cooldown}
                onChange={setCooldown}
                options={["1 分钟", "5 分钟", "15 分钟", "30 分钟"]}
              />
              </Form.Item></Col>
            </Row>
          </Form>
          <Card size="small">
            <Flex justify="space-between" align="center" gap={16}>
              <Space orientation="vertical" size={0}><Typography.Text strong>连接失败后自动切换</Typography.Text><Typography.Text type="secondary">当前模型连接调用失败后，自动尝试列表中的下一个可用连接。</Typography.Text></Space>
              <Switch aria-label="连接失败后自动切换" checked={failoverEnabled} onChange={setFailoverEnabled} />
            </Flex>
          </Card>
        </Space>
      </Modal>
      <Modal
        open={serviceDialog}
        title="添加模型连接"
        description="选择服务实际支持的 API 协议；快捷模板只负责预填，不限制服务商。"
        width={640}
        onClose={() => { if (!serviceSaving) { setServiceDialog(false); aiConnectionForm.resetFields(); } }}
        footer={<><Button disabled={serviceSaving} onClick={() => { setServiceDialog(false); aiConnectionForm.resetFields(); }}>取消</Button><Button variant="primary" loading={serviceSaving} onClick={saveAiConnection}>保存并测试</Button></>}
      >
        <Form form={aiConnectionForm} layout="vertical" requiredMark="optional">
          <Row gutter={16}>
            <Col xs={24} sm={12}><Form.Item name="template" label="快捷模板"><CustomSelect width="100%" ariaLabel="AI 模型快捷模板" options={["自定义接口", ...Object.keys(aiConnectionTemplates)]} onChange={value => { aiConnectionForm.setFieldValue("template", value); applyAiTemplate(value); }}/></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="protocol" label="API 协议" rules={[{ required: true, message: "请选择 API 协议" }]}><CustomSelect width="100%" ariaLabel="API 协议" options={aiProtocolOptions}/></Form.Item></Col>
          </Row>
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: "请输入便于识别的配置名称" }, { max: 120 }]}><Input placeholder="例如：生产主模型、备用模型"/></Form.Item>
          <Form.Item name="endpoint" label="API Base URL" extra="填写基础地址即可；系统会根据所选协议补充请求路径。" rules={[{ required: true, message: "请输入 API Base URL" }, { type: "url", message: "请输入完整的 http:// 或 https:// 地址" }]}><Input placeholder="https://api.example.com/v1" autoComplete="url"/></Form.Item>
          <Form.Item name="model" label="模型 ID" rules={[{ required: true, message: "请输入接口实际使用的模型 ID" }, { max: 120 }]}><Input placeholder="例如：model-name"/></Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={16}><Form.Item name="keyName" label="密钥名称" rules={[{ required: true, message: "请输入密钥名称" }]}><Input placeholder="主密钥"/></Form.Item></Col>
            <Col xs={24} sm={8}><Form.Item name="priority" label="调用优先级" extra="数字越小越优先" rules={[{ required: true, message: "请输入优先级" }]}><Input type="number" min={1} max={100}/></Form.Item></Col>
          </Row>
          <Form.Item name="secret" label="API Key" rules={[{ required: true, message: "请输入 API Key" }, { min: 8, message: "API Key 至少需要 8 个字符" }]}><Input.Password placeholder="输入完整密钥" autoComplete="new-password"/></Form.Item>
          <StatusNotice tone="info" icon={<KeyRound size={17}/>} title="一条连接使用一个密钥" description="API Key 与当前模型连接一起加密保存；需要备用时，请添加另一条完整连接。"/>
        </Form>
      </Modal>
      <Modal
        open={Boolean(editingAiService)}
        title={`编辑模型连接 · ${editingAiService?.name ?? ""}`}
        description="可修改连接信息或替换 API Key；保存后会立即重新测试。"
        width={620}
        onClose={() => { if (!editServiceSaving) { setEditingAiService(null); editServiceForm.resetFields(); } }}
        footer={<><Button disabled={editServiceSaving} onClick={() => { setEditingAiService(null); editServiceForm.resetFields(); }}>取消</Button><Button variant="primary" loading={editServiceSaving} onClick={saveEditedAiService}>保存并测试</Button></>}
      >
        <Form form={editServiceForm} layout="vertical" requiredMark="optional">
          <Form.Item name="protocol" label="API 协议" rules={[{ required: true, message: "请选择 API 协议" }]}><CustomSelect width="100%" ariaLabel="编辑 API 协议" options={aiProtocolOptions}/></Form.Item>
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: "请输入配置名称" }, { max: 120 }]}><Input/></Form.Item>
          <Form.Item name="endpoint" label="API Base URL" extra="填写基础地址即可；系统会根据所选协议补充请求路径。" rules={[{ required: true, message: "请输入 API Base URL" }, { type: "url", message: "请输入完整的 http:// 或 https:// 地址" }]}><Input autoComplete="url"/></Form.Item>
          <Form.Item name="model" label="模型 ID" rules={[{ required: true, message: "请输入模型 ID" }, { max: 120 }]}><Input/></Form.Item>
          <Form.Item name="priority" label="调用优先级" extra="数字越小越优先；相同优先级按创建顺序调用。" rules={[{ required: true, message: "请输入调用优先级" }]}><Input type="number" min={1} max={100}/></Form.Item>
          <Form.Item name="secret" label="替换 API Key" extra="留空则继续使用当前加密密钥；填写新密钥会直接替换旧密钥。" rules={[{ min: 8, message: "API Key 至少需要 8 个字符" }]}><Input.Password placeholder="留空表示不更换" autoComplete="new-password"/></Form.Item>
          <StatusNotice tone="info" icon={<KeyRound size={17}/>} title="连接级故障切换" description="轮转发生在模型连接之间；每条连接只使用一个 API Key。"/>
        </Form>
      </Modal>
      <Modal
        open={Boolean(confirmDelete)}
        title="确认删除账户"
        description="此操作不可撤销"
        descriptionTone="warning"
        onClose={() => { setConfirmDelete(null); setAccountDeletePassword(""); setAccountDeleteConfirmation(""); }}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={async () => {
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
        <Typography.Paragraph className="ui-form-intro">账号、客户、活动、消息、商机和密钥都将永久删除。建议先导出完整备份。</Typography.Paragraph>
        <Form layout="vertical"><Form.Item label="当前密码" extra="用于确认账户所有权"><Input.Password value={accountDeletePassword} onChange={event=>setAccountDeletePassword(event.target.value)} autoComplete="current-password"/></Form.Item><Form.Item label="确认文字" extra="请输入 DELETE"><Input value={accountDeleteConfirmation} onChange={event=>setAccountDeleteConfirmation(event.target.value.toUpperCase())} placeholder="DELETE"/></Form.Item></Form>
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
        {twoFactorRecovery ? (
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <Alert type="warning" showIcon icon={<ShieldCheck />} title="请立即保存恢复码" description="每个恢复码只能使用一次；丢失验证器时可用其中一个登录。" />
            <Card size="small" title="一次性恢复码" extra={<Typography.Text type="secondary">请离线保存</Typography.Text>}>
              <Row gutter={[12, 12]}>
                {twoFactorRecovery.map(code=><Col xs={12} key={code}><Typography.Text code copyable>{code}</Typography.Text></Col>)}
              </Row>
            </Card>
          </Space>
        ) : (
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            {!twoFactorStatusQuery.data?.enabled && (
              <Card size="small">
                <Flex vertical align="center" gap={12}>
                  {twoFactorQrCode ? <img src={twoFactorQrCode} alt="Sondara 双重验证二维码" width={140} height={140} /> : <Typography.Text aria-label="正在生成二维码">二维码生成中…</Typography.Text>}
                  <Typography.Text strong>扫描二维码添加验证器</Typography.Text>
                  <Typography.Text>账户名称：{twoFactorSetup?.accountName ?? (profileDraft.email || "Sondara")}</Typography.Text>
                  <Typography.Text type="secondary">{twoFactorBusy && !twoFactorSetup ? "正在生成服务端加密密钥…" : "二维码由本机根据 otpauth 地址离线生成；无法扫码时可继续使用下方密钥手动输入。"}</Typography.Text>
                </Flex>
              </Card>
            )}
            {!twoFactorStatusQuery.data?.enabled && (
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="设置密钥">
                  <Space wrap><Typography.Text code copyable={Boolean(twoFactorSetup?.secret)}>{twoFactorSetup?.secret ?? "正在生成…"}</Typography.Text><Typography.Text type="secondary">复制后粘贴到验证器应用</Typography.Text></Space>
                </Descriptions.Item>
                {twoFactorSetup?.otpauth && <Descriptions.Item label="otpauth 地址"><Typography.Text copyable ellipsis={{tooltip:twoFactorSetup.otpauth}}>{twoFactorSetup.otpauth}</Typography.Text></Descriptions.Item>}
              </Descriptions>
            )}
            <Form layout="vertical">
              <Form.Item label="当前登录密码" extra="用于确认是本人操作"><Input.Password autoComplete="current-password" value={twoFactorPassword} onChange={event=>setTwoFactorPassword(event.target.value)} placeholder="输入当前密码"/></Form.Item>
              <Form.Item label={twoFactorStatusQuery.data?.enabled ? "6 位验证码或恢复码" : "6 位验证码"} extra={twoFactorStatusQuery.data?.enabled ? "关闭验证需要二次确认" : "输入验证器应用当前显示的数字"}><Input aria-label="验证码" value={twoFactorCode} onChange={event=>setTwoFactorCode(event.target.value.replace(/\s|-/g,"").slice(0,8))} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="000000"/></Form.Item>
            </Form>
          </Space>
        )}
      </Modal>
    </PageContainer>
  );
}
