# PostgreSQL 路线

Sondara 0.1 默认使用 SQLite：一个 `data/sondara.db` 文件即可完成本地或单节点私有部署。PostgreSQL 规划为面向云端多实例、高并发和集中运维场景的可选生产后端。

## 适用场景

- 本地开发、个人使用、单机私有部署：继续使用 SQLite。
- 多实例部署、高并发写入、集中备份监控或云数据库托管：使用 PostgreSQL。

## 实施路线

1. 建立数据库驱动边界，通过 `SONDARA_DATABASE_DRIVER=sqlite|postgres` 选择活动驱动。
2. 为 PostgreSQL 维护独立 migrations，并将 JSON 字段映射为 `jsonb`、时间字段映射为 `timestamptz`。
3. 为健康检查、备份导出、迁移和连接管理提供数据库适配器。
4. 建立 PostgreSQL 集成测试矩阵，覆盖认证、客户雷达、外发队列、归因聚合和备份导出。
5. 提供 SQLite → PostgreSQL 离线迁移工具，校验表行数、关键聚合和工作区隔离。
6. 更新 Docker Compose、云数据库连接、备份恢复和升级文档。

## 切换约定

每个部署使用一个活动数据库驱动。正式切换前先完成全量备份和迁移校验，再通过配置切换到 PostgreSQL。