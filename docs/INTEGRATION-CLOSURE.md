# Sondara 外部渠道闭环执行清单

> 本文件是外部渠道剩余工作的唯一执行清单。后续按顺序持续推进，不再把“配置已保存”“模拟响应通过”和“真实账号验收”混为一谈。

## 状态定义

- `CODE`：生产代码、数据库迁移、权限、审计和错误处理完成。
- `MOCK`：使用隔离 SQLite 和模拟官方响应通过自动化验收。
- `LIVE`：使用用户自有官方账号、套餐权限和凭据完成真实联网验收。
- `BLOCKED`：仅表示需要外部平台审批、付费账号或凭据；不阻止其他代码任务继续。

## P0：平台级运行闭环

| 编号 | 项目 | CODE | MOCK | LIVE | 验收标准 |
|---|---|---:|---:|---:|---|
| R1 | 定时同步 | ✅ | ✅ | — | 每个连接器可配置周期、下次运行时间；多实例只由租约持有者执行 |
| R2 | 失败重试 | ✅ | ✅ | — | 失败指数退避，达到 5 次后自动暂停并保留错误原因 |
| R3 | 额度控制 | ✅ | ✅ | — | 支持单次、每日上限；达到每日上限后次日自动恢复 |
| R4 | 暂停与恢复 | ✅ | ✅ | — | 手动暂停、自动熔断、恢复后继续游标，状态和原因可追溯 |
| R5 | 运行历史与诊断 | ✅ | ✅ | — | 保存游标、读取、新增、更新、跳过和错误；页面展示最近状态 |

## P1：官方获客与触达平台

| 编号 | 项目 | CODE | MOCK | LIVE | 验收标准 |
|---|---|---:|---:|---:|---|
| L1 | LinkedIn Lead Gen | ✅ | ✅ | BLOCKED | OAuth 回调、Token 生命周期、通知签名、Lead Response 拉取、去重入库 |
| L2 | Meta Lead Ads | ✅ | ✅ | BLOCKED | OAuth、Webhook 签名、`leadgen_id` 拉取完整字段、去重入库 |
| L3 | WhatsApp 模板 | ✅ | ✅ | BLOCKED | 模板同步、语言和审核状态、24 小时窗口、失败回调与合规门禁 |
| L4 | Google Ads Lead Form | ✅ | ✅ | BLOCKED | 官方字段、Google Key、Lead ID 幂等和客户跟进闭环 |

## P1：CRM 双向同步

| 编号 | 项目 | CODE | MOCK | LIVE | 验收标准 |
|---|---|---:|---:|---:|---|
| C1 | HubSpot 联系人 | ✅ | ✅ | BLOCKED | Private App/OAuth、分页导入、批量 Upsert、邮箱去重 |
| C2 | HubSpot 企业 | ✅ | ✅ | BLOCKED | 企业同步、本地映射、冲突保护和双向写入 |
| C3 | HubSpot 商机 | ✅ | ✅ | BLOCKED | Deal 阶段和金额映射、双向更新、公司关联和冲突策略 |
| C4 | HubSpot 任务 | ✅ | ✅ | BLOCKED | 跟进任务双向同步、状态/优先级/截止时间映射和公司关联 |
| C5 | Salesforce / Pipedrive | ⬜ | ⬜ | BLOCKED | 在用户实际选购后实现专用适配器；不提前伪装支持 |

## P1：采购与意向数据

| 编号 | 项目 | CODE | MOCK | LIVE | 验收标准 |
|---|---|---:|---:|---:|---|
| P1 | TED | ✅ | ✅ | ✅ | 官方公开 API、订阅、去重、截止日期和任务闭环 |
| P2 | SAM.gov | 🟡 | ✅ | BLOCKED | API Key、分页、截止日期、去重和任务闭环 |
| P3 | UNGM | 🟡 | ✅ | BLOCKED | OAuth Token、权限范围、分页和任务闭环 |
| P4 | World Bank | ✅ | ✅ | ✅ | 官方 Procurement Notices JSON API、订阅、筛选、去重和任务闭环 |
| P5 | 新闻/招聘/扩张信号 | ✅ | ✅ | 🟡 | 必须有证据 URL 才加分；真实搜索源随用户配置验收 |

## P2：数据补全与访客识别

| 编号 | 项目 | CODE | MOCK | LIVE | 验收标准 |
|---|---|---:|---:|---:|---|
| D1 | Apollo 企业联系人 | ✅ | ✅ | BLOCKED | 官方 People Search、游标、去重、来源记录 |
| D2 | 邮箱验证（Hunter / ZeroBounce / NeverBounce） | ✅ | ✅ | BLOCKED | 多服务商适配、验证结果回写、额度保护、缓存与重验周期 |
| D3 | Twilio Lookup | ✅ | ✅ | BLOCKED | Basic Auth、E.164、国家和有效性回写 |
| D4 | Generic REST 数据库 | ✅ | ✅ | BLOCKED | 列表路径、JSON 字段路径映射、游标和安全 URL |
| D5 | 访客识别 Webhook | ✅ | ✅ | BLOCKED | HMAC、幂等，只为已有企业增加意向信号 |
| D6 | Dealfront / Leadfeeder | ⬜ | ⬜ | BLOCKED | 用户选定后实现厂商事件格式和鉴权 |
| D7 | 海关/供应链专用服务 | 🟡 | ✅ | BLOCKED | Generic REST 已有；选定付费服务商后补专项分页与字段规则 |

## 统一完成条件

1. `CODE` 必须包含工作区隔离、管理员权限、密钥加密、审计、SSRF 防护和失败信息。
2. `MOCK` 必须使用隔离数据库，不写入正式数据；覆盖成功、重复、失败、重试和权限。
3. `LIVE` 必须保存官方账号、时间、接口版本和验收结果，但不得把凭据写入仓库或文档。
4. 因外部凭据阻塞的项目统一留在 `BLOCKED`，其余代码工作继续执行。
