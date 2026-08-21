# Contributing

感谢参与 Sondara。本项目目标是提供可本地运行、可自托管、合规边界清晰的 AI 获客与增长工作区。

## 开发准备

1. Fork 仓库并基于 `main` 创建分支，分支名建议使用：
   - `feat/...`：新功能
   - `fix/...`：缺陷修复
   - `docs/...`：文档
   - `test/...`：测试
2. 安装依赖：

   ```bash
   npm install
   ```
3. 准备 PostgreSQL 15+（推荐 17）。本地默认连接为：

   ```text
   postgresql://sondara:sondara@127.0.0.1:5433/sondara
   ```

   也可通过 `SONDARA_DATABASE_URL` 指定隔离数据库。
4. 初始化开发库：

   ```bash
   npm run setup
   npm run db:migrate
   npm run db:seed:dev
   npm run dev:all
   ```

## 提交前检查

不要只运行构建。涉及后端、数据模型、发送渠道或权限的改动，至少运行：

```bash
npm run typecheck
npm run test:all
```

公开提交或 Pull Request 前运行完整门禁：

```bash
npm run qa:all
```

门禁包含：

- 公开仓库安全扫描；
- UI 框架约束检查；
- TypeScript 类型检查；
- 前后端生产构建；
- Bundle 预算；
- Playwright E2E；
- 生产 smoke；
- 19 组集成测试。

E2E 会自动创建临时数据库；集成测试应使用隔离数据库，不能指向含真实客户数据的库。

## 代码约定

- 业务表带 `workspace_id`，服务端必须从登录会话读取工作区，不信任客户端传入的工作区。
- 密钥、Token、密码只加密存储或只返回末四位，不写日志，不进前端状态。
- 外发、导入、合并、删除、备份恢复等高风险操作要有审计日志。
- 自动外发必须保留人工确认、抑制名单、退订/退信/投诉停止逻辑。
- 不接受绕过人机验证、登录限制、平台反爬规则或非官方批量私信/加好友的实现。
- 新增数据表必须同时添加 Drizzle schema 和 PostgreSQL migration。
- 新增后端能力优先补集成测试；修复缺陷时优先加能复现问题的测试。

## 数据库变更

- 使用 `npm run db:generate` 生成 migration 后检查 SQL，不要盲提交。
- migration 必须可在空库和上一版本库上执行。
- Drizzle migration 不自动回滚；破坏性变更必须在 PR 中说明备份和恢复方案。
- 升级步骤见 [UPGRADE.md](./docs/UPGRADE.md)。

## 文档

用户可见行为变化时同步更新：

- `README.md`：功能、启动、测试总览；
- `docs/DEPLOY.md`：部署、环境变量、备份恢复；
- `docs/UPGRADE.md`：版本升级与迁移；
- `docs/CORE-ROADMAP.md`：当前完成状态和下一步。

## Pull Request

PR 描述建议包含：

1. 解决的问题；
2. 实现方案；
3. 风险与兼容性；
4. 运行过的验证命令；
5. 截图或 API 示例（如适用）。

不要提交 `.env`、`data/`、数据库、备份、日志、截图、Cookie、storage state 或真实客户资料。
