# Sondara 部署指南

## 系统要求

- Docker Compose（推荐），或 Node.js 20+ 与 PostgreSQL 15+
- 内存建议 1 GB 以上
- HTTPS 域名用于公开部署

## Docker 一键部署

开发机可直接启动：

```bash
docker compose up -d --build
```

Compose 项目固定命名为 `sondara`。Docker Desktop 中会看到：

- `sondara-app-1`：前端静态文件、API 和后台 worker；
- `sondara-postgres-1`：独立 PostgreSQL 17；
- `sondara_postgres-data`：数据库持久卷；
- `sondara_app-data`：主密钥与 worker 状态等本地运行数据。

应用地址为 `http://localhost:4176`，启动时会自动应用数据库迁移。
PostgreSQL 只绑定本机 `127.0.0.1:5433`，用于本地维护与备份，不对局域网或公网开放。

公开部署前：

```bash
cp .env.example .env
```

至少修改 `POSTGRES_PASSWORD`、`SONDARA_DATABASE_URL` 中对应密码、`SONDARA_ENCRYPTION_KEY`、`SONDARA_WEB_ORIGIN`，并设置 `SONDARA_SECURE_COOKIES=true`。生成主密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

常用操作：

```bash
docker compose ps
docker compose logs -f app
docker compose restart app
docker compose down
```

`docker compose down` 不删除数据卷；只有明确执行 `docker compose down -v` 才会删除数据库数据。

## 手动部署

```bash
npm ci
npm run setup
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

`npm run setup` 会测试 PostgreSQL 连接并更新 `.env`；自动化环境可使用：

```bash
npm run setup -- --non-interactive --database-url=postgresql://user:password@host:5432/sondara
```

只检查连接、不修改 `.env` 时增加 `--check-only`。

关键变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `SONDARA_DATABASE_URL` | PostgreSQL 连接地址 | `postgresql://user:pass@db:5432/sondara` |
| `SONDARA_DATABASE_POOL_MAX` | 进程连接池上限 | `10` |
| `SONDARA_WEB_ORIGIN` | 允许携带 Cookie 的站点来源 | `https://app.example.com` |
| `SONDARA_ENCRYPTION_KEY` | 密钥保险箱主密钥 | 64 位 hex |
| `SONDARA_SECURE_COOKIES` | HTTPS 部署设为 true | `true` |
| `SONDARA_TRUST_PROXY` | 位于可信反代后设为 true | `true` |

systemd 的 `ExecStart` 可使用 `/usr/bin/node /opt/sondara/server-dist/index.js`，并通过 `EnvironmentFile=/opt/sondara/.env` 注入配置。

## Nginx 反向代理

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4176;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 备份与恢复

设置页“数据与备份”提供当前工作区脱敏 JSON 导出，以及工作区所有者可下载的 PostgreSQL custom-format 全库备份。镜像已包含 `pg_dump`。

也可从数据库容器备份：

```bash
docker compose exec -T postgres pg_dump -U sondara -d sondara --format=custom --no-owner --no-acl > sondara.dump
```

恢复到空数据库：

```bash
docker compose exec -T postgres pg_restore -U sondara -d sondara --clean --if-exists --no-owner --no-acl < sondara.dump
```

升级前必须生成并实际验证备份。Drizzle migration 不自动回滚，失败时应恢复备份后再回滚代码。

## 健康与可观测性

| 端点 | 用途 |
|------|------|
| `GET /api/healthz` | 进程存活 |
| `GET /api/ready` | PostgreSQL 与服务就绪 |
| `GET /api/health` | 兼容 readiness |

Sentry 与 OpenTelemetry SDK 已作为可选依赖随锁文件提供。未设置变量时不会连接第三方；配置以下变量并重启即可：

```bash
SONDARA_SENTRY_DSN=https://public@sentry.example/1
SONDARA_SENTRY_TRACES_SAMPLE_RATE=0.1
SONDARA_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces
SONDARA_OTEL_SERVICE_NAME=sondara
```

## 安全清单

- 使用独立强数据库密码和稳定随机的 `SONDARA_ENCRYPTION_KEY`；
- 使用 HTTPS、Secure Cookie 和精确的 `SONDARA_WEB_ORIGIN`；
- 不提交 `.env`、数据库 dump、客户导出、日志和截图；
- 仅在可信内网确有需要时启用 `SONDARA_ALLOW_PRIVATE_CONNECTORS`；
- 定期执行 `npm audit`、`npm run qa:public-repo` 和恢复演练；
- PostgreSQL 端口不要直接暴露到公网。

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 应用未就绪 | `docker compose logs app`、`docker compose logs postgres`、连接 URL |
| 无法登录 | Cookie secure、CORS origin、代理头和系统时间 |
| 邮件收发失败 | SMTP/API、每邮箱 IMAP、连接测试和外发任务事件 |
| 连接数过多 | `SONDARA_DATABASE_POOL_MAX` 与 PostgreSQL `max_connections` |
| 备份失败 | `pg_dump` 版本、数据库权限和临时目录空间 |
