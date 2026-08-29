# Sondara 部署指南

## 本机启动（推荐）

只需要 Node.js 24 LTS，不需要单独启动数据库服务：

```bash
npm install
npm run setup -- --non-interactive
npm run start:local
```

以后启动只运行 `npm run start:local`。前端地址为 `http://localhost:4175`，API 为 `http://127.0.0.1:4176`，默认 SQLite 文件位于 `data/sondara.sqlite`。

Windows 需要无人值守运行时执行：

```powershell
npm run autostart:install
```

该命令优先注册当前用户的 Windows 登录任务；权限不足时自动回退为当前用户启动目录快捷方式。登录后通过 `npm run start:managed` 自动执行迁移和生产构建，在 `http://localhost:4175` 同时提供网页与 API，默认启用获客、发件队列、外部连接器、销售守护和本地备份 worker；进程异常退出后会自动恢复。日志保存在忽略提交的 `private/logs/managed-startup.log`。卸载命令为 `npm run autostart:uninstall`。

如需虚构演示数据，可在非生产环境额外运行 `npm run db:seed:dev`。正式环境不要执行该命令。

## 生产部署

Linux/macOS：

```bash
npm ci
npm run setup -- --non-interactive
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

Windows PowerShell：

```powershell
npm ci
npm run setup -- --non-interactive
npm run db:migrate
npm run build
$env:NODE_ENV = "production"
npm start
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
| `SONDARA_BACKUP_ENABLED` | 是否启用自动备份，默认关闭 | `true` |
| `SONDARA_BACKUP_DIRECTORY` | SQLite 备份目录 | `/opt/sondara/data/backups` |

SQLite 版本面向单机、单实例部署。不要让多个应用实例或多台服务器同时挂载同一个 SQLite 文件，也不要把数据库放在网络文件系统中。

## DONJOY 正式数据维护

当前 DONJOY 工作区从开发演示数据切换为正式数据前，必须先停止应用并独立备份 `data/sondara.sqlite`，然后运行：

```bash
npm run db:promote:formal
```

该命令只会清空 DONJOY 主工作区中的客户、候选、活动、内容、获客任务和相关业务记录；账号、成员、当前会话、AI 服务、连接器及权限配置会保留。完成后只写入来源于 DONJOY 英文外贸官网的公开业务资料，不会生成演示客户。它不是日常启动命令，也不得对未经确认的数据库执行。

需要指定正式账户时，可在运行正式化和正式流程命令前通过 `SONDARA_FORMAL_EMAIL` 设置；正式流程登录密码通过 `SONDARA_FORMAL_PASSWORD` 设置，单次获客区域通过 `SONDARA_FORMAL_TARGET_REGION` 设置。获客区域应按国家或区域分别运行，不要默认搜索全球。

完整正式获客闭环需要 API 已启动，并明确设置单次目标区域后再运行 `npm run flow:formal`；流程不会自动外发，生成的客户、内容和活动仍需人工审核。需要再次清空业务数据时，应重新备份数据库后运行 `npm run db:promote:formal`。

## PostgreSQL 旧数据迁移（仅旧版本需要）

旧 PostgreSQL 仍可访问时，可一次性复制到 SQLite：

```bash
npm run db:migrate:postgres-to-sqlite
```

默认读取 `postgresql://sondara:sondara@127.0.0.1:5433/sondara`。自定义地址使用 `--postgres-url=...`。脚本只读 PostgreSQL，导入后执行完整性校验，并在替换现有 SQLite 前保留备份。

## 备份与恢复

设置页“数据与备份”可下载完整 SQLite 快照。自动备份默认关闭；设置 `SONDARA_BACKUP_ENABLED=true` 后，默认每日运行一次、保留最近 7 份，每份备份都会执行 `PRAGMA quick_check`。

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
