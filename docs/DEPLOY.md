# Sondara 部署指南

## 本机启动（推荐）

只需要 Node.js 24 LTS，不需要单独启动数据库服务：

```bash
npm install
npm run setup -- --non-interactive
npm run db:seed:dev
npm run start:local
```

以后启动只运行 `npm run start:local`。前端地址为 `http://localhost:4175`，API 为 `http://127.0.0.1:4176`，默认 SQLite 文件位于 `data/sondara.sqlite`。

## 生产部署

```bash
npm ci
npm run setup -- --non-interactive
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

生产模式由 4176 端口同时提供前端静态文件、API 和后台 worker。运行用户必须对 `data/` 目录拥有读写权限。

关键变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `SONDARA_DATABASE_PATH` | SQLite 数据文件 | `/opt/sondara/data/sondara.sqlite` |
| `SONDARA_WEB_ORIGIN` | 允许携带 Cookie 的站点来源 | `https://app.example.com` |
| `SONDARA_ENCRYPTION_KEY` | 密钥保险箱主密钥 | 64 位 hex |
| `SONDARA_SECURE_COOKIES` | HTTPS 部署设为 true | `true` |
| `SONDARA_TRUST_PROXY` | 位于可信反代后设为 true | `true` |

SQLite 版本面向单机、单实例部署。不要让多个应用实例或多台服务器同时挂载同一个 SQLite 文件，也不要把数据库放在网络文件系统中。

## PostgreSQL 旧数据迁移

旧 PostgreSQL 仍可访问时，可一次性复制到 SQLite：

```bash
npm run db:migrate:postgres-to-sqlite
```

默认读取 `postgresql://sondara:sondara@127.0.0.1:5433/sondara`。自定义地址使用 `--postgres-url=...`。脚本只读 PostgreSQL，导入后执行完整性校验，并在替换现有 SQLite 前保留备份。

## 备份与恢复

设置页“数据与备份”可下载完整 SQLite 快照。自动备份默认每日运行一次、保留最近 7 份，每份备份都会执行 `PRAGMA quick_check`。

恢复时先停止应用，再将备份文件复制为 `data/sondara.sqlite`，最后重新启动。恢复前也应保存当前数据库文件和稳定的 `SONDARA_ENCRYPTION_KEY`。

## 健康检查

| 端点 | 用途 |
|------|------|
| `GET /api/healthz` | 进程存活 |
| `GET /api/ready` | SQLite 与服务就绪 |
| `GET /api/health` | 兼容 readiness |

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 应用未就绪 | 数据目录写权限、SQLite 文件路径和应用日志 |
| `database is locked` | 是否启动了多个应用实例、数据库是否位于网络盘 |
| 无法登录 | Cookie secure、CORS origin、代理头和系统时间 |
| 备份失败 | `data/` 与备份目录磁盘空间和写权限 |
