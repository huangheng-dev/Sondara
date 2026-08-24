# 升级与数据库迁移

Sondara 当前使用 SQLite 单文件数据库。升级前应先在设置页生成并验证一份备份，或在应用停止后复制 `data/sondara.sqlite`。

## 手动部署升级

```bash
git pull
npm ci
npm run build
npm run db:migrate
NODE_ENV=production npm start
```

使用 systemd、PM2 或其他进程管理器时，先停止旧进程，执行 migration，再启动新进程。不要让不同版本的应用同时写同一个 SQLite 文件。

## Docker 升级

```bash
docker compose down
docker compose build --pull
docker compose up -d
```

`docker compose down` 不删除 `sondara_app-data` 数据卷。不要使用 `down -v`，除非明确要删除全部应用数据。

## Migration 说明

- migration 文件位于 `server/db/migrations-sqlite/`；
- `npm run db:migrate` 按 Drizzle journal 顺序执行未应用 migration；
- 不要修改已经发布的 migration，需要修正时新增 migration；
- 破坏性结构变更必须先验证备份恢复流程。

## 回滚

1. 停止应用；
2. 将代码切回上一版本；
3. 将升级前备份恢复为 `data/sondara.sqlite`；
4. 确认 `SONDARA_ENCRYPTION_KEY` 与备份时期一致；
5. 启动旧版本并检查 `/api/ready`。

## PostgreSQL 版本迁移到 SQLite

旧数据库仍在运行时执行：

```bash
npm run db:migrate:postgres-to-sqlite
```

该操作不会修改或删除 PostgreSQL。确认 SQLite 运行稳定并完成独立备份后，再自行决定何时停用旧 PostgreSQL 服务。
