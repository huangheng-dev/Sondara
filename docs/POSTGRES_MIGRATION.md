# SQLite → PostgreSQL 升级

Sondara 现在只使用 PostgreSQL 作为运行数据库。SQLite 仅保留为旧版本数据的离线迁移来源，不再作为可选运行模式。

## 迁移前

1. 停止旧版 Sondara，确保 SQLite 不再有写入。
2. 创建一个空 PostgreSQL 数据库，并确认连接账号具有建表和写入权限。
3. 在安全环境中设置 `SONDARA_ENCRYPTION_KEY`；迁移后的加密密钥数据仍依赖原主密钥解密。

## 执行

```bash
npm ci
npm run db:migrate:sqlite -- \
  --sqlite=./data/sondara.db \
  --postgres=postgresql://user:password@host:5432/sondara
```

迁移器会：

- 先应用 PostgreSQL migrations；
- 按外键依赖顺序复制两端共有的表和列；
- 将 SQLite 的 `0/1` 转换为 PostgreSQL boolean；
- 在同一事务中执行复制与逐表行数校验；
- 成功提交后删除源 `.db`、`-wal`、`-shm`，失败时不删除任何源文件。

如需暂时保留旧文件用于人工归档，增加 `--keep-source`。目标库已有数据时工具默认拒绝执行；只有明确需要按主键合并时才使用 `--merge`。

## 切换与验证

```bash
npm run setup -- --database-url=postgresql://user:password@host:5432/sondara
npm run db:migrate
npm start
```

随后检查 `/api/ready`、登录、客户数量、活动/消息记录和工作区隔离。生产切换前仍建议另做 PostgreSQL `pg_dump --format=custom` 备份。
