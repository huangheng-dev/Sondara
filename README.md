# Sondara

Sondara 是一个免费开源的 AI 找客户与个人增长工作区，可在本地单人运行，也可部署到云端供多个独立账号使用。

它用于验证这条核心闭环：

```text
定义 ICP → 多来源发现企业 → AI 研究和评分 → 保存客户 → 内容与跟进 → 商机 → 收入归因
```

## 当前功能

- 个人增长工作台与经营总览
- 市场与 ICP（业务资料、定位知识、AI 画像分析）
- 统一客户雷达（官网种子、搜索、Google Places、行业名录/展会/招投标）
- 企业决策详情、评分拆解和证据链
- 客户库和批量操作
- 内容资产生成、编辑、质量检查和版本管理
- 增长活动编排和执行追踪
- 客户收件箱与人工确认外发
- SMTP 邮件队列、送达/退信/退订回调和抑制名单
- 个人销售管道与商机推进
- 转化分析、渠道归因、成本/ROI 和优化任务生成
- 数据导出与数据库备份
- 登录、注册和会话恢复
- 账户设置、BYOK 加密密钥库、TOTP 双重验证与登录安全

## 技术栈

- React 19 + TypeScript + Vite 7
- React Router 7、TanStack Query/Table、Zustand
- Ant Design 6、Lucide React
- Fastify 5 + better-sqlite3 + Drizzle ORM
- 多 AI 服务密钥池轮转、AES-256-GCM 密钥保险箱
- Docker 多阶段构建支持

## 本地启动

需要 Node.js 20 或更高版本（推荐 22 LTS）。

```bash
npm install
npm run db:migrate
npm run db:seed:dev
npm run dev:all
```

默认地址：

- 前端：`http://localhost:4175`
- API：`http://127.0.0.1:4176`
- 健康检查：`http://127.0.0.1:4176/api/healthz`

本地开发登录：`demo@sondara.local` / `Sondara@2026`。登录页仅在 Vite 开发模式自动预填，生产构建不会预填。

仅启动前端或后端：

```bash
npm run dev:web
npm run dev:api
```

## 生产部署

```bash
npm install
npm run build
NODE_ENV=production npm start
```

生产模式下，API 在同一端口（默认 4176）同时服务 `/api/*` 和前端静态文件，无需独立 Web 服务器。

### Docker

```bash
cp .env.example .env
# 编辑 .env，设置 SONDARA_ENCRYPTION_KEY、SONDARA_WEB_ORIGIN 等
docker compose up -d --build
```

完整部署指南见 [docs/DEPLOY.md](./docs/DEPLOY.md)，包含 Docker、手动部署、systemd、Nginx 反代、备份恢复和升级流程。

## 测试

全部 14 组本地集成验收（全 mock，不外连）：

```bash
npm run test:auth-2fa        # TOTP 双重验证、恢复码、登录验证
npm run test:ai-client        # AI 密钥池轮转与故障切换
npm run test:closed-loop      # 权限、审计、资料、会话与密钥生命周期
npm run test:search-connector # 搜索发现连接器
npm run test:map-connector    # Google Places 连接器
npm run test:contact-enrichment # 公开联系人补全
npm run test:industry-source  # 行业名录/展会/招投标
npm run test:content-assets   # 内容资产 CRUD
npm run test:campaigns        # 营销活动
npm run test:inbox            # 消息线程
npm run test:outbox           # SMTP 队列与回调
npm run test:partial-updates  # 局部更新保护
npm run test:icp              # 业务资料与定位知识
npm run test:attribution      # 转化归因
```

环境变量参考 [`.env.example`](./.env.example)。本地数据库默认保存在 `data/sondara.db`，整个 `data/` 目录均被 Git 忽略。

准备公开仓库前必须运行：

```bash
npm run qa:public-repo
```

该门禁会阻止数据库、备份、`.env`、密钥文件、登录状态、审计截图、非示例邮箱和常见令牌格式进入提交。完整步骤见 [开源发布安全清单](./docs/OPEN_SOURCE_CHECKLIST.md)。

公开版本的功能范围以本 README、测试和 Release Notes 为准；内部执行记录不进入仓库。

## 数据与隐私

- 仓库不包含真实 API Key。
- 所有第三方密钥通过 AES-256-GCM 加密存储，接口仅返回末四位。
- 所有业务表带 `workspace_id`，服务端从认证会话读取工作区，不信任客户端传入。
- 数据源采集和外发触达必须遵守目标网站条款、隐私法规和反垃圾规则。

## 项目结构

```text
src/
├─ app/          # 路由、导航、布局、认证守卫
├─ components/   # 通用 UI 组件
├─ pages/        # 独立业务页面
├─ stores/       # Zustand 本地 UI 状态
├─ styles/       # 全局响应式样式
├─ hooks/        # 自定义 hooks
└─ lib/          # API 客户端和工具函数
server/
├─ db/           # 数据表、迁移和 SQLite 连接
├─ ai/           # 统一 AI 调用、密钥轮转和降级
├─ radar/        # 雷达任务、连接器、AI 富化和后台 worker
├─ outbox/       # 外发队列、SMTP 适配器和后台执行器
├─ integrations/ # 搜索、地图客户端
├─ routes/       # API 路由
├─ plugins/      # Fastify 插件（认证守卫等）
└─ lib/          # 密码、会话、密钥保险箱、ID 和审计
```

## 路线图

- **0.1.x：稳定发布** — 修复真实部署问题，完善文档、备份恢复、CI 和可访问性回归。
- **0.2.x：生产加固** — 在保持 SQLite 零配置体验的前提下，提供可选 PostgreSQL 驱动、迁移工具和云部署文档。
- **0.3.x：连接器生态** — 增强入站邮件、投递事件和合规人工触达渠道适配器。

Sentry/OpenTelemetry、E2E、2FA 二维码等基础增强已进入当前代码库；后续围绕真实部署反馈继续打磨。

## 渠道事件回调

每个 SMTP 连接都可在"数据源集成 → 发送治理"中生成或轮换独立回调密钥。服务商适配器向以下地址发送 JSON：

```text
POST /api/outbox-webhooks/:connectionId
X-Sondara-Timestamp: <Unix 秒>
X-Sondara-Signature: <HMAC-SHA256(timestamp + "." + JSON body)>
```

事件类型包括 `delivered`、`bounced`、`complained`、`unsubscribed` 和 `inbound_reply`。同一连接下的 `providerEventId` 保证幂等；回调密钥只在创建或轮换时显示一次，数据库仅保存加密密文。

## 许可证

[MIT License](./LICENSE)

安全说明见 [SECURITY.md](./SECURITY.md)。

欢迎提交 Issue 和 Pull Request。
