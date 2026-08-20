# Sondara 部署指南

## 系统要求

- Node.js 20+ （推荐 22 LTS）
- 磁盘空间 ≥ 500 MB（含 node_modules 和数据库）
- 内存 ≥ 512 MB
- Linux / macOS / Windows Server

## 快速开始（Docker）

### 1. 准备环境

```bash
cp .env.example .env
# 编辑 .env，至少设置：
#   SONDARA_WEB_ORIGIN=https://your-domain
#   SONDARA_SECURE_COOKIES=true（HTTPS 时）
#   SONDARA_ENCRYPTION_KEY=<32+字节随机字符串>
```

生成加密密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. 构建并启动

```bash
docker compose up -d --build
```

应用在 `http://localhost:4176` 运行（API 和前端静态文件同端口）。

### 3. 初始化数据（首次）

```bash
docker compose exec sondara node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/sondara.db');
console.log('Database ready at /app/data/sondara.db');
"
```

迁移在启动时自动执行。如需开发示例数据：

```bash
docker compose exec sondara npx tsx server/db/seed-dev.ts
```

## 手动部署（无 Docker）

### 1. 安装依赖并构建

```bash
npm ci
npm run build
```

这会生成：
- `dist/` — 前端静态文件
- `server-dist/` — 编译后的服务端代码

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env
```

关键变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `SONDARA_API_HOST` | 监听地址 | `0.0.0.0` |
| `SONDARA_API_PORT` | 监听端口 | `4176` |
| `SONDARA_DATABASE_URL` | SQLite 文件路径 | `./data/sondara.db` |
| `SONDARA_WEB_ORIGIN` | 前端访问 URL（CORS） | `https://app.example.com` |
| `SONDARA_SECURE_COOKIES` | HTTPS 下设为 true | `true` |
| `SONDARA_ENCRYPTION_KEY` | 密钥保险箱主密钥 | 64 位 hex 字符串 |
| `SONDARA_LOG_LEVEL` | 日志级别 | `info` |
| `SONDARA_TRUST_PROXY` | 反向代理后设为 true | `true` |

### 3. 运行数据库迁移

```bash
npm run db:migrate
```

### 4. 启动

```bash
NODE_ENV=production npm start
```

生产模式下，API 在同一端口同时服务 `/api/*` 和前端静态文件，无需独立 Web 服务器。

### 进程管理（systemd）

创建 `/etc/systemd/system/sondara.service`：

```ini
[Unit]
Description=Sondara AI Customer Growth Workspace
After=network.target

[Service]
Type=simple
User=sondara
WorkingDirectory=/opt/sondara
EnvironmentFile=/opt/sondara/.env
ExecStart=/usr/bin/node server-dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now sondara
sudo systemctl status sondara
```

## 反向代理（Nginx）

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:4176;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

设置 `SONDARA_TRUST_PROXY=true` 以信任代理头。

## 备份与恢复

### 在线备份（推荐）

在「设置 → 数据与备份」页面可：
- **导出业务数据 (JSON)** — 下载当前工作区全部业务表数据
- **完整数据库备份** — 下载 SQLite 数据库文件快照（使用 `VACUUM INTO`，不锁库）

也可通过 API：

```bash
# 导出 JSON（需要会话 Cookie）
curl -o sondara-export.json -b cookies.txt https://app.example.com/api/system/export

# 完整数据库备份
curl -o sondara-backup.db -b cookies.txt https://app.example.com/api/system/backup
```

### 文件级备份

SQLite 数据库文件位于 `data/sondara.db`（WAL 模式下还有 `-wal` 和 `-shm` 文件）。

安全做法：

```bash
# 使用 sqlite3 .backup 命令（在线一致性备份）
sqlite3 data/sondara.db ".backup" backups/sondara-$(date +%Y%m%d).db"
```

建议通过 cron 每日备份并保留最近 7–30 天。

### 恢复

1. 停止 Sondara 服务
2. 用备份文件替换 `data/sondara.db`，删除 `-wal` 和 `-shm` 文件
3. 重启服务
4. 启动时自动执行迁移（如版本更新）

## 健康检查

| 端点 | 用途 |
|------|------|
| `GET /api/healthz` | Liveness — 进程存活 |
| `GET /api/ready` | Readiness — 数据库可连接、worker 状态 |
| `GET /api/health` | 传统健康检查（等同 readiness） |

## 升级流程

1. 备份数据库（通过设置页或 `sqlite3 .backup`）
2. 拉取新版本代码：`git pull`
3. 安装依赖：`npm ci`
4. 重新构建：`npm run build`
5. 重启服务：`sudo systemctl restart sondara`
6. 数据库迁移在启动时自动执行

**注意**：Drizzle 迁移不支持自动回滚。如升级失败，用备份文件恢复数据库后再回滚代码。

## 日志

生产环境日志以 JSON 格式输出到 stdout（pino），可直接被 journalctl、Docker logs 或日志收集器采集：

```bash
# systemd
journalctl -u sondara -f

# Docker
docker compose logs -f sondara
```

日志级别通过 `SONDARA_LOG_LEVEL` 控制（fatal/error/warn/info/debug/trace）。

## 安全清单

- [ ] 设置强随机的 `SONDARA_ENCRYPTION_KEY`
- [ ] HTTPS 反向代理 + `SONDARA_SECURE_COOKIES=true`
- [ ] `SONDARA_WEB_ORIGIN` 设置为实际域名（不使用 `*`）
- [ ] `SONDARA_TRUST_PROXY=true`（反向代理后）
- [ ] 定期备份 `data/` 目录
- [ ] 不暴露 `SONDARA_ALLOW_PRIVATE_CONNECTORS=true`（仅本地可信网络）
- [ ] 定期更新依赖：`npm audit` 和 `npm update`

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 无法登录 | Cookie 安全设置、CORS origin、系统时间是否准确 |
| AI 功能不工作 | 设置页检查 AI 服务连通性；查看日志 `journalctl -u sondara` |
| 邮件发送失败 | SMTP 配置、`outbox_jobs` 表状态、投递事件日志 |
| 数据库锁定 | WAL 模式正常；检查是否有长事务或备份操作 |
| 容器健康检查失败 | `docker compose logs sondara`；`curl localhost:4176/api/healthz` |

## 可选：Sentry 与 OpenTelemetry

默认镜像和本地安装不强制包含错误追踪/链路追踪依赖，避免把不用的 SDK 装进生产环境。需要时在部署环境安装可选包：

```bash
npm install @sentry/node
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
```

配置环境变量：

```bash
SONDARA_SENTRY_DSN="https://public@sentry.example/1"
SONDARA_SENTRY_TRACES_SAMPLE_RATE="0.1"
SONDARA_OTEL_EXPORTER_OTLP_ENDPOINT="http://otel-collector:4318/v1/traces"
SONDARA_OTEL_SERVICE_NAME="sondara"
```

- Sentry DSN 存在时，500 错误、未捕获异常和未处理 Promise 会上报；请求追踪按采样率上报。
- OTLP HTTP endpoint 存在时，OpenTelemetry Node SDK 会自动注入 HTTP/Fastify/出站请求等 instrumentation，并导出 trace。
- 未设置变量时保持零开销、零第三方连接；可选依赖缺失会打印 warning，不会阻止启动。
- 生产部署建议将环境变量和密钥放入 systemd `EnvironmentFile`、Docker secret 或编排平台的 secret 管理，不写入镜像。
