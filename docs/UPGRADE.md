# 升级与数据库迁移

本文说明 Sondara 版本升级、PostgreSQL migration 和回滚准备。生产环境升级前先在 staging 或本地备份验证。

## 升级前检查

1. 阅读目标版本的 Release Notes。
2. 确认当前版本和目标版本之间没有需要手动执行的特殊步骤。
3. 备份 PostgreSQL：

   ```bash
   docker compose exec -T postgres pg_dump \
     -U sondara -d sondara \
     --format=custom --no-owner --no-acl \
     > sondara-before-upgrade.dump
   ```

4. 验证备份可读取：

   ```bash
   pg_restore --list sondara-before-upgrade.dump
   ```

5. 确认 `SONDARA_ENCRYPTION_KEY`、数据库密码和 `.env` 已备份到安全位置。没有主密钥时，数据库中的第三方密钥无法解密。

## Docker 升级

```bash
git pull
docker compose build --pull
docker compose run --rm --no-deps app npm run db:migrate
docker compose up -d
```

如果镜像入口已经自动执行 migration，仍建议在流量切换前单独运行一次 `db:migrate`，以便尽早发现数据库连接或 SQL 错误。

升级后检查：

```bash
docker compose ps
docker compose logs --tail=200 app
curl -f http://127.0.0.1:4176/api/healthz
curl -f http://127.0.0.1:4176/api/ready
```

## 手动部署升级

```bash
git pull
npm ci
npm run build
npm run db:migrate
NODE_ENV=production npm start
```

使用 systemd、PM2 或其他进程管理器时，先停止旧进程，执行 migration，再启动新进程。不要让多个不同版本的应用同时写同一个数据库。

## Migration 说明

- migration 文件位于 `server/db/migrations-pg/`；
- `npm run db:migrate` 会按 Drizzle journal 顺序执行未应用 migration；
- 不要修改已经发布的 migration；需要修正时新增 migration；
- 不要删除 `meta/_journal.json` 或 `meta/*_snapshot.json`；
- 新增字段应尽量向后兼容，避免在同一发布中立即删除旧字段。

## 回滚

应用代码可以回滚到上一版本，但数据库 migration 不会自动降级。回滚步骤：

1. 停止应用；
2. 将代码切回上一版本；
3. 恢复升级前 PostgreSQL 备份；
4. 确认 `.env` 中的 `SONDARA_ENCRYPTION_KEY` 与备份时期一致；
5. 启动旧版本并检查健康检查。

恢复到空数据库示例：

```bash
docker compose exec -T postgres pg_restore \
  -U sondara -d sondara \
  --clean --if-exists --no-owner --no-acl \
  < sondara-before-upgrade.dump
```

如果目标库不是空库，先确认 `--clean --if-exists` 不会误删仍需保留的数据。

## 0.1.x 注意事项

- 当前唯一受支持的运行数据库为 PostgreSQL；旧 SQLite 数据不提供自动迁移。
- 本地开发 Node.js 版本为 24 LTS。
- Docker Compose 默认对外映射 PostgreSQL 到 `127.0.0.1:5433`。
- 自动备份默认保留最近 7 份，可通过 `SONDARA_BACKUP_RETENTION_COUNT` 调整。
