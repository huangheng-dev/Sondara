# Sondara React 项目 -- CSS 类名完整编目报告

> 本报告编目了 `F:/Sondara/src/` 中所有 TSX 文件使用的 CSS 类名，用于完整 CSS 重写。

---

## 一、App / Layout 级别类名

### 1.1 入口文件

**`src/main.tsx`**
- CSS 导入：`antd/dist/reset.css`、`@/styles/global.css`
- 无 className

### 1.2 主布局组件 `src/app/layouts/AppLayout.tsx`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `app-shell` | + `sidebar-collapsed` | 最外层外壳 |
| `sidebar` | + `desktop-sidebar` | 桌面端侧边栏 |
| `mobile-navigation-drawer` | -- | 移动端抽屉导航 |
| `sidebar-inner` | -- | 侧边栏内部容器 |
| `brand` | -- | 品牌区域 |
| `brand-mark` | -- | 品牌 logo 标记 |
| `brand-copy` | -- | 品牌文字 |
| `app-navigation-menu` | -- | 导航菜单容器 |
| `menu-label-with-count` | -- | 带计数徽章的菜单项标签 |
| `sidebar-footer` | -- | 侧边栏底部 |
| `collapse-button` | -- | 侧边栏折叠按钮 |
| `main-area` | -- | 主内容区域 |
| `topbar` | -- | 顶部栏 |
| `mobile-menu` | -- | 移动端菜单按钮 |
| `topbar-search-autocomplete` | -- | 顶部搜索自动完成 |
| `global-search-option` | -- | 全局搜索选项 |
| `topbar-spacer` | -- | 顶部栏间距占位 |
| `topbar-icon` | + `active` | 顶部栏图标按钮 |
| `topbar-notifications-overlay` | -- | 通知浮层 |
| `topbar-popover` | + `notifications` | 通知弹出框 |
| `mark-read` | -- | 全部标记已读按钮 |
| `unread` | -- | 未读状态 |
| `user-block` | + `active` | 用户信息块 |
| `user-copy` | -- | 用户文字信息 |
| `user-chevron` | -- | 用户下拉箭头 |
| `account-dropdown-menu` | -- | 账户下拉菜单 |
| `account-dropdown-navigation-item` | -- | 账户下拉导航项 |
| `account-dropdown-icon` | -- | 账户下拉图标 |
| `account-dropdown-entry` | -- | 账户下拉入口 |
| `account-dropdown-label` | -- | 账户下拉标签 |
| `account-dropdown-arrow` | -- | 账户下拉箭头 |
| `account-dropdown-logout-item` | -- | 退出登录项 |
| `account-dropdown-logout-label` | -- | 退出登录标签 |
| `app-content` | -- | 内容区域（Outlet 容器） |

### 1.3 其他 App 级别文件

- **`src/app/AntDesignProvider.tsx`**：`<App className="sondara-ant-app">`，主题通过 ConfigProvider token 配置
- **`src/app/AuthGuard.tsx`**：无自定义 className，错误态使用内联样式 `{ minHeight:'100vh', display:'grid', placeItems:'center', padding:24, background:'#f5f7fb' }`
- **`src/app/AdminGuard.tsx`**、**`src/app/SettingsGuard.tsx`**：无 className
- **`src/app/navigation.ts`**、**`src/app/router.tsx`**：无 className

---

## 二、共享 UI 组件类名

所有组件位于 `src/components/ui/`。

### 2.1 Button.tsx
动态生成：`['app-button', `app-button-${variant}`, `app-button-${size}`, className]`
- 基础：`app-button`
- variant：`app-button-primary` / `app-button-secondary` / `app-button-ghost` / `app-button-link` / `app-button-danger`
- size：`app-button-sm` / `app-button-md`

### 2.2 Badge.tsx
- 无自定义 className，使用 antd Tag + 内联样式调色板（green/blue/orange/red/neutral）

### 2.3 CreateDialog.tsx
`dialog-file-upload`、`app-create-dialog`、`dialog-form`、`dialog-field-full`、`field-label`、`app-required-mark`、`app-optional-mark`、`form-error`

### 2.4 CustomSelect.tsx
`custom-select`、`app-select`、`select-option-label`

### 2.5 DataTable.tsx
`app-data-table`、`app-data-table-actions-cell`、`table-empty-state`
- 行类名通过 `row.className` 动态传入，常见值：`selected`、`disabled`、`done`、`urgent`、`money`

### 2.6 DatePicker.tsx
`app-date-picker`

### 2.7 DetailDrawer.tsx
`app-detail-drawer`、`detail-drawer-title`、`app-detail-drawer-header`、`app-detail-drawer-body`、`app-detail-drawer-footer`、`app-detail-drawer-close`

### 2.8 EmptyState.tsx
`app-empty-ant`、`app-empty-icon`、`app-empty-copy`、`app-empty-description`
- 支持通过 className prop 传入 `compact` 修饰类

### 2.9 Modal.tsx
`app-modal`、`app-modal-title`、`app-modal-title-actions`

### 2.10 PageHeader.tsx
`page-header`、`page-heading`、`page-actions`

### 2.11 PageLoader.tsx
`app-page-loader`、`app-page-loader__content`（BEM 风格）

### 2.12 Pagination.tsx
`app-pagination-ant`、`pagination-summary`

### 2.13 Panel.tsx
`app-panel panel`（两个类同时使用）、`panel-header`、`panel-body`

### 2.14 SearchInput.tsx
`app-search-input`

### 2.15 Toast.tsx
- 无自定义 className，使用 antd App message API


---

## 三、每页 Wrapper 类名及关键子组件类名

### 3.1 DashboardPage

**文件**：`src/pages/dashboard/DashboardPage.tsx`
**Wrapper**：`<div className="page-content dashboard-page">`
**CSS 导入**：`import '@/styles/routes/dashboard.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `dashboard-executive` | -- | 执行摘要区 |
| `dashboard-pulse-card` | -- | 脉动卡片 |
| `dashboard-metrics` | -- | 指标网格 |
| `dashboard-metric` | + `tone-blue` / `tone-violet` / `tone-orange` / `tone-green` | 单个指标卡 |
| `dashboard-workstreams` | -- | 工作流区域 |
| `dashboard-workstream-grid` | -- | 工作流网格 |
| `dashboard-workstream` | + `workstream-${tone}` | 单个工作流 |
| `dashboard-workstream-value` | -- | 工作流数值 |
| `dashboard-columns` | + `dashboard-command-layout` | 列布局 |
| `dashboard-task-panel` | -- | 任务面板 |
| `dashboard-task-switch` | -- | 任务切换 |
| `task-list` | -- | 任务列表 |
| `task-order` | -- | 任务排序 |
| `task-check` | -- | 任务复选框 |
| `task-main` | -- | 任务主体 |
| `task-schedule` | -- | 任务排期 |
| `task-impact` | -- | 任务影响 |
| `task-more` | -- | 任务更多操作 |
| `task-priority-high` / `task-priority-normal` | -- | 优先级 |
| `is-completed` | -- | 已完成状态 |
| `dashboard-task-pagination` | -- | 任务分页 |
| `dashboard-side` | + `dashboard-action-rail` | 侧边操作栏 |
| `dashboard-attention-panel` | -- | 注意力面板 |
| `dashboard-attention-list` | -- | 注意力列表 |
| `attention-${tone}` | blue/violet/orange/green | 注意力项色调 |
| `dashboard-recommendation` | -- | 推荐卡片 |
| `task-detail-dialog` | -- | 任务详情对话框 |
| `suggestion-dialog` | -- | 建议对话框 |

---

### 3.2 RadarPage

**文件**：`src/pages/radar/RadarPage.tsx`
**Wrapper**：`<div className="page-content radar-page">`
**CSS 导入**：`import '@/styles/routes/radar.css'`

#### RadarPage.tsx 自身类名

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `radar-workspace` | -- | 工作区 |
| `customer-workspace` | + `radar-customer-workspace` | 客户工作区（共享类） |
| `customer-toolbar` | + `radar-toolbar module-toolbar standard-list-toolbar` | 工具栏 |
| `customer-filter-controls` | + `radar-filter-controls` | 筛选控件 |
| `radar-mode-select` | -- | 模式选择 |
| `sort-select` | -- | 排序选择 |
| `customer-refresh` | -- | 刷新按钮 |
| `customer-clear` | + `module-clear` | 清除按钮 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作工具栏 |
| `radar-task-dialog` | -- | 任务对话框 |
| `radar-task-stats` | -- | 任务统计 |
| `radar-task-stage` | -- | 任务阶段 |
| `radar-task-runtime` | -- | 任务运行时间 |
| `radar-pipeline` | -- | 管道 |
| `radar-research-list` | -- | 研究列表 |
| `radar-refresh` | -- | 雷达刷新 |
| `radar-task-events` | -- | 任务事件 |
| `is-error` | -- | 错误状态 |

#### 子组件 CandidateList.tsx（`src/pages/radar/CandidateList.tsx`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `customer-table` | + `customer-table-pro radar-candidate-table` | 表格 |
| `customer-check` | -- | 复选框列 |
| `customer-sort-head` | -- | 可排序表头 |
| `customer-sort-icon` | + `is-active` | 排序图标 |
| `customer-company` | -- | 公司名单元格 |
| `customer-match` | -- | 匹配度 |
| `customer-signal` | -- | 信号 |
| `customer-relation` | -- | 关系 |
| `radar-core-actions` | -- | 核心操作组 |
| `radar-core-action` | -- | 单个核心操作 |
| `radar-core-action-save` | -- | 保存操作 |
| `selected` | （行状态） | 选中行 |
| `list-empty-state` | -- | 空列表状态 |

#### 子组件 CompanyDecisionDrawer.tsx（`src/pages/radar/CompanyDecisionDrawer.tsx`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `decision-drawer` | -- | 决策抽屉 |
| `decision-drawer-actions` | -- | 操作按钮区 |
| `drawer-body` | -- | 抽屉内容体 |
| `decision-summary` | -- | 决策摘要 |
| `score-hero` | -- | 评分数 |
| `decision-reason` | -- | 决策理由 |
| `score-row` | -- | 评分行 |
| `progress` | -- | 进度条（全局共享类） |
| `evidence-row` | + `is-expanded` | 证据行 |
| `evidence-marker` | -- | 证据标记 |
| `evidence-main` | -- | 证据主体 |
| `evidence-actions` | -- | 证据操作 |
| `evidence-toggle` | -- | 证据展开/收起 |
| `evidence-snapshot` | -- | 证据快照 |
| `committee-grid` | + `contact-grid` | 联系人网格 |
| `relationship-row` | -- | 关系行 |
| `next-action` | + `done` | 下一步行动 |
| `outreach-brief` | -- | 外联简报 |
| `decision-section` | -- | 决策区块 |

---

### 3.3 CustomersPage

**文件**：`src/pages/customers/CustomersPage.tsx`
**Wrapper**：`<div className="page-content customers-page">`
**CSS 导入**：`import '@/styles/routes/customers.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `customer-workspace` | -- | 工作区 |
| `customer-toolbar` | + `module-toolbar standard-list-toolbar` | 工具栏 |
| `customer-filter-controls` | -- | 筛选控件 |
| `customer-search` | + `module-search` | 搜索框 |
| `customer-view-select` | -- | 视图选择 |
| `score-select` | -- | 评分筛选 |
| `source-select` | -- | 来源筛选 |
| `sort-select` | -- | 排序选择 |
| `customer-refresh` | + `is-spinning` | 刷新按钮 |
| `customer-clear` | + `module-clear` | 清除按钮 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作栏 |
| `customer-data-state` | -- | 数据状态 |
| `customer-table` | + `customer-table-pro customer-library-table` | 表格 |
| `customer-check` | -- | 复选框列 |
| `customer-sort-head` | -- | 排序表头 |
| `customer-sort-icon` | + `is-active` | 排序图标 |
| `customer-company` | -- | 公司名 |
| `customer-match` | -- | 匹配度 |
| `customer-signal` | -- | 信号 |
| `customer-relation` | -- | 关系 |
| `customer-next` | -- | 下一步 |
| `customer-more` | -- | 更多操作 |
| `urgent` | （行状态） | 紧急 |
| `money` | （行状态） | 金额相关 |
| `selected` | （行状态） | 选中 |
| `list-empty-state` | -- | 空列表 |
| `customer-drawer` | -- | 客户抽屉 |
| `customer-drawer-body` | + `app-detail-drawer-body` | 抽屉体 |
| `customer-detail-overview` | -- | 详情概览 |
| `override-badge-wrap` | -- | 覆盖徽章 |
| `stage-transition-section` | -- | 阶段转换区 |
| `stage-transition-buttons` | -- | 阶段转换按钮 |
| `stage-hint` | -- | 阶段提示 |
| `score-explanation-section` | -- | 评分解读区 |
| `score-tier-grid` | -- | 评分等级网格 |
| `score-tier-desc` | -- | 评分等级描述 |
| `score-confidence-bar` | -- | 评分置信度条 |
| `score-bar-track` | -- | 评分条轨道 |
| `score-override-history` | -- | 评分覆盖历史 |
| `score-override-actions` | -- | 评分覆盖操作 |
| `score-override-form` | -- | 评分覆盖表单 |
| `score-override-form-actions` | -- | 表单操作按钮 |
| `contact-verification-filter` | -- | 联系人验证筛选 |
| `customer-contact-list` | -- | 联系人列表 |
| `contact-actions` | -- | 联系人操作 |
| `customer-timeline` | -- | 客户时间线 |
| `customer-detail-action` | -- | 详情操作 |
| `standard-cell-stack` | -- | 标准单元格堆叠（共享） |
| `campaign-content-dialog` | -- | 活动内容对话框 |
| `status-detail-list` | -- | 状态详情列表 |
| `merge-suggestions-list` | -- | 合并建议列表 |
| `merge-suggestion-pair` | -- | 合并建议对 |
| `merge-suggestion-reasons` | -- | 合并建议原因 |
| `merge-suggestion-actions` | -- | 合并建议操作 |
| `action-sheet-list` | -- | 操作表单列表 |


---

### 3.4 CampaignsPage

**文件**：`src/pages/campaigns/CampaignsPage.tsx`
**Wrapper**：`<div className="page-content campaigns-page">`
**CSS 导入**：`import '@/styles/routes/campaigns.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `campaign-workspace` | + `standard-list-panel` | 工作区 |
| `campaign-toolbar` | + `customer-toolbar module-toolbar standard-list-toolbar` | 工具栏 |
| `campaign-search` | + `customer-search module-search` | 搜索框 |
| `campaign-status-select` | -- | 状态筛选 |
| `sort-select` | -- | 排序选择 |
| `customer-refresh` | + `is-spinning` | 刷新按钮 |
| `customer-clear` | + `module-clear` | 清除按钮 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作栏 |
| `standard-list-state` | -- | 列表状态 |
| `customer-table` | + `customer-table-pro campaign-table` | 表格 |
| `customer-check` | -- | 复选框列 |
| `customer-sort-head` | -- | 排序表头 |
| `standard-entity` | -- | 标准实体 |
| `standard-cell-stack` | -- | 单元格堆叠 |
| `standard-progress` | -- | 标准进度 |
| `standard-value` | -- | 标准值 |
| `standard-next` | -- | 标准下一步 |
| `standard-row-actions` | -- | 行操作 |
| `campaign-drawer` | -- | 活动抽屉 |
| `app-detail-drawer-body` | -- | 抽屉体（共享组件类） |
| `done` | （行状态） | 已完成 |
| `danger-copy` | -- | 危险文案 |
| `campaign-content-dialog` | -- | 内容对话框 |
| `recommendation-list` | -- | 推荐列表 |
| `action-sheet-list` | -- | 操作表单列表 |

---

### 3.5 ContentPage

**文件**：`src/pages/content/ContentPage.tsx`
**Wrapper**：`<div className="page-content content-page">`
**CSS 导入**：`import '@/styles/routes/content.css'`

#### 内容创作区

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `content-layout` | + `content-layout-v2 content-creator-workspace` | 内容布局 |
| `content-left-panel` | + `content-creation-dock` | 左侧面板 |
| `content-creation-head` | -- | 创作头部 |
| `content-creation-grid` | -- | 创作网格 |
| `content-mini-head` | -- | 小标题 |
| `content-source-methods` | -- | 来源方法 |
| `content-format-zone` | -- | 格式区域 |
| `content-type-head` | -- | 类型头部 |
| `content-group-select` | -- | 分组选择 |
| `active` | -- | 激活状态 |
| `content-workbench` | -- | 工作台 |
| `content-editor-card` | -- | 编辑器卡片 |
| `content-editor-head` | -- | 编辑器头部 |
| `content-editor-status` | -- | 编辑器状态 |
| `content-title-input` | -- | 标题输入 |
| `content-editor-toolbar` | -- | 编辑器工具栏 |
| `is-spinning` | -- | 旋转中 |
| `content-preview-pro` | -- | 预览区 |
| `content-editor-textarea` | -- | 文本域 |
| `content-settings` | -- | 设置面板 |
| `content-quality` | -- | 质量面板 |
| `content-quality-score` | -- | 质量评分 |
| `content-quality-metrics` | -- | 质量指标 |
| `full-width` | -- | 全宽 |

#### 内容资产列表区

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `content-assets` | + `content-assets-page standard-list-panel customer-workspace` | 资产区 |
| `content-asset-toolbar` | -- | 资产工具栏 |
| `content-asset-filter-controls` | -- | 筛选控件 |
| `customer-search` | + `module-search` | 搜索（共享） |
| `sort-select` | -- | 排序选择 |
| `customer-refresh` | -- | 刷新按钮 |
| `customer-clear` | + `module-clear` | 清除按钮 |
| `customer-selection-tools` | -- | 批量操作栏 |
| `standard-list-state` | -- | 列表状态 |
| `customer-table` | + `customer-table-pro standard-data-table content-asset-table content-asset-table-pro` | 表格 |
| `customer-check` | -- | 复选框列 |
| `customer-sort-head` | -- | 排序表头 |
| `standard-entity` | -- | 标准实体 |
| `standard-row-actions` | -- | 行操作 |
| `list-empty-state` | -- | 空列表 |
| `language-check` | -- | 语言检查 |
| `asset-dialog-list` | -- | 资产对话框列表 |
| `asset-preview-dialog` | -- | 资产预览对话框 |

---

### 3.6 IcpPage

**文件**：`src/pages/icp/IcpPage.tsx`
**Wrapper**：`<div className="page-content icp-page positioning-page">`（注意双类名）
**CSS 导入**：`import '@/styles/routes/icp.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `icp-business-hero` | -- | 业务头部 |
| `icp-business-hero__head` | -- | 头部（BEM） |
| `icp-business-hero__identity` | -- | 标识（BEM） |
| `icp-business-hero__grid` | -- | 网格（BEM） |
| `positioning-result-grid` | -- | 定位结果网格 |
| `positioning-market-ranking` | -- | 市场排名 |
| `positioning-market-list` | -- | 市场列表 |
| `active` | -- | 激活状态 |
| `positioning-profile-card` | -- | 画像卡片 |
| `positioning-profile-workspace` | -- | 画像工作区 |
| `positioning-profile-summary` | -- | 画像摘要 |
| `positioning-profile-lead` | -- | 画像引导 |
| `positioning-profile-overview` | -- | 画像概览 |
| `positioning-profile-tags` | -- | 画像标签 |
| `positioning-profile-criteria` | -- | 画像标准 |
| `positioning-profile-compact` | -- | 紧凑画像 |
| `icp-profile-dialog` | -- | 画像对话框 |

#### 子组件 GrowthKnowledge.tsx（`src/pages/icp/GrowthKnowledge.tsx`）

**Wrapper**：`<div className="knowledge-page knowledge-page-inline ${modal ? "knowledge-page-modal" : ""}">`
**无独立 CSS 导入**（通过 IcpPage 加载 `icp.css`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `knowledge-inline-header` | -- | 内联头部 |
| `knowledge-inline-actions` | -- | 内联操作 |
| `knowledge-workspace` | + `knowledge-workspace-inline` | 知识库工作区 |
| `knowledge-library` | + `customer-workspace standard-list-panel` | 知识库 |
| `knowledge-toolbar` | + `customer-toolbar module-toolbar standard-list-toolbar` | 工具栏 |
| `customer-search` | + `module-search` | 搜索（共享） |
| `sort-select` | -- | 排序 |
| `customer-refresh` | + `is-spinning` | 刷新 |
| `customer-clear` | + `module-clear` | 清除 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作 |
| `customer-table` | + `customer-table-pro knowledge-table knowledge-customer-table` | 表格 |
| `customer-check` | -- | 复选框 |
| `customer-sort-head` | -- | 排序表头 |
| `standard-entity` | -- | 标准实体 |
| `standard-cell-stack` | -- | 单元格堆叠 |
| `standard-value` | -- | 标准值 |
| `standard-row-actions` | -- | 行操作 |
| `list-empty-state` | -- | 空列表 |
| `knowledge-detail` | -- | 知识详情 |
| `danger` | （Button variant） | 危险按钮 |
| `compact` | -- | 紧凑模式 |

---

### 3.7 InboxPage

**文件**：`src/pages/inbox/InboxPage.tsx`
**Wrapper**：`<div className="page-content inbox-page">`
**CSS 导入**：`import '@/styles/routes/inbox.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `inbox-pro-shell` | + `show-conversation` / `show-details` | 收件箱外壳 |
| `inbox-list` | -- | 消息列表 |
| `message-filter-row` | -- | 筛选行 |
| `message-channel-filter` | -- | 渠道筛选 |
| `message-state-tabs` | -- | 状态标签页 |
| `inbox-result-meta` | -- | 结果元信息 |
| `inbox-list-state` | -- | 列表状态 |
| `active` | -- | 激活 |
| `unread` / `read` | -- | 未读/已读 |
| `inbox-load-state` | -- | 加载状态 |
| `inbox-conversation` | + `inbox-no-thread` | 会话区 |
| `conversation-back` | -- | 返回按钮 |
| `inbox-detail-toggle` | -- | 详情切换 |
| `inbox-thread` | -- | 线程 |
| `inbox-load-older` | -- | 加载更多 |
| `inbox-thread-state` | + `error` | 线程状态 |
| `is-spinning` | -- | 旋转中 |
| `outgoing` / `incoming` | -- | 发出/接收 |
| `inbox-intent` | -- | 意图标签 |
| `inbox-composer` | -- | 编辑器 |
| `inbox-contact` | -- | 联系人 |
| `full-width` | -- | 全宽 |
| `quick-replies` | -- | 快速回复 |
| `inbox-timeline-dialog` | -- | 时间线对话框 |
| `inbox-confirm-reply` | -- | 确认回复 |
| `list-empty-state` | -- | 空列表 |


---

### 3.8 PipelinePage

**文件**：`src/pages/pipeline/PipelinePage.tsx`
**Wrapper**：`<div className="page-content pipeline-page">`
**CSS 导入**：`import '@/styles/routes/pipeline.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `pipeline-workspace` | + `pipeline-list-panel standard-list-panel` | 工作区 |
| `pipeline-toolbar` | + `customer-toolbar module-toolbar standard-list-toolbar` | 工具栏 |
| `customer-search` | + `module-search` | 搜索框（共享） |
| `pipeline-stage-select` | -- | 阶段筛选 |
| `pipeline-owner-select` | -- | 负责人筛选 |
| `pipeline-risk-select` | -- | 风险筛选 |
| `sort-select` | -- | 排序选择 |
| `customer-refresh` | + `is-spinning` | 刷新按钮 |
| `customer-clear` | + `module-clear` | 清除按钮 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作栏 |
| `customer-data-state` | -- | 数据状态 |
| `customer-table` | + `customer-table-pro pipeline-table` | 表格 |
| `customer-check` | -- | 复选框列 |
| `customer-sort-head` | -- | 排序表头 |
| `customer-company` | -- | 公司名 |
| `pipeline-stage-cell` | -- | 阶段单元格 |
| `standard-value` | -- | 标准值 |
| `pipeline-risk-cell` | -- | 风险单元格 |
| `pipeline-risk-owner` | -- | 风险负责人 |
| `done` | （行状态） | 已完成 |
| `customer-next` | -- | 下一步 |
| `standard-row-actions` | -- | 行操作 |
| `pipeline-drawer` | -- | 商机抽屉 |
| `app-detail-drawer-body` | -- | 抽屉体（共享） |
| `pipeline-next-action` | -- | 下一步行动 |
| `forecast-dialog` | -- | 预测对话框 |
| `list-empty-state` | -- | 空列表 |
| `money` | （行状态） | 金额相关 |

---

### 3.9 AttributionPage

**文件**：`src/pages/attribution/AttributionPage.tsx`
**Wrapper**：`<div className="page-content conversion-page conversion-page-rebuilt">`
**CSS 导入**：`import '@/styles/routes/attribution.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `conversion-header-actions` | -- | 头部操作区 |
| `conversion-period-tabs` | -- | 周期标签页 |
| `is-spinning` | -- | 旋转中 |
| `conversion-flow-panel` | + `conversion-overview-panel` | 流程面板 |
| `conversion-quality-compact` | -- | 质量紧凑区 |
| `conversion-flow` | + `complete` | 转化流程 |
| `conversion-stage-arrow` | -- | 阶段箭头 |
| `attribution-channel-table-panel` | + `standard-list-panel` | 渠道表面板 |
| `standard-list-heading` | -- | 列表标题 |
| `attribution-channel-toolbar` | -- | 渠道工具栏 |
| `attribution-filter-controls` | -- | 筛选控件 |
| `customer-search` | + `module-search` | 搜索（共享） |
| `sort-select` | -- | 排序 |
| `customer-refresh` | -- | 刷新 |
| `customer-clear` | + `module-clear` | 清除 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作 |
| `customer-table` | + `customer-table-pro standard-data-table attribution-channel-table` | 表格 |
| `customer-check` | -- | 复选框 |
| `customer-sort-head` | -- | 排序表头 |
| `standard-entity` | + `attribution-channel-entity` | 实体 |
| `standard-progress` | -- | 进度 |
| `standard-cell-stack` | -- | 单元格堆叠 |
| `attribution-rate` | -- | 归因比率 |
| `standard-next` | + `attribution-bottleneck` | 瓶颈/下一步 |
| `standard-row-actions` | -- | 行操作 |
| `list-empty-state` | -- | 空列表 |
| `status-detail-list` | -- | 状态详情列表 |
| `conversion-recommendations` | -- | 推荐 |
| `conversion-channel-detail` | -- | 渠道详情 |

---

### 3.10 AuthPage

**文件**：`src/pages/auth/AuthPage.tsx`
**Wrapper**：`<main className="auth-shell">`（注意：不使用 `page-content`，使用 `<main>` 标签）
**CSS 导入**：`import '@/styles/routes/auth.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `auth-shell` | -- | 认证页外壳 |
| `auth-brand` | -- | 品牌区 |
| `auth-brand-inner` | -- | 品牌内部容器 |
| `auth-brand-mark` | -- | 品牌标记 |
| `auth-brand-copy` | -- | 品牌文案 |
| `auth-kicker` | -- | 引导语 |
| `auth-capabilities` | -- | 功能列表 |
| `auth-brand-footer` | -- | 品牌页脚 |
| `auth-panel` | -- | 登录面板 |
| `auth-mobile-logo` | -- | 移动端 logo |
| `auth-card` | -- | 卡片 |
| `auth-mode-switch` | -- | 模式切换（登录/注册） |
| `auth-back-link` | -- | 返回链接 |
| `auth-card-header` | -- | 卡片头部 |
| `auth-success` | -- | 成功状态 |
| `auth-form` | -- | 表单 |
| `auth-required-mark` | -- | 必填标记 |
| `auth-input-control` | -- | 输入控件 |
| `auth-field-help` | -- | 字段帮助 |
| `auth-form-meta` | -- | 表单元信息 |
| `auth-submit` | -- | 提交按钮 |
| `auth-submit-label` | -- | 提交标签 |
| `auth-panel-note` | -- | 面板注释 |

---

### 3.11 AdminPage

**文件**：`src/pages/admin/AdminPage.tsx`
**Wrapper**：`<div className="page-content admin-page">`
**CSS 导入**：`import '@/styles/routes/admin.css'`

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `admin-workspace` | -- | 工作区 |
| `admin-main` | -- | 主区域 |
| `admin-toolbar` | + `customer-toolbar module-toolbar standard-list-toolbar` | 工具栏 |
| `admin-filter-select` | -- | 筛选选择 |
| `customer-search` | + `module-search` | 搜索（共享） |
| `sort-select` | -- | 排序 |
| `customer-refresh` | + `is-spinning` | 刷新 |
| `customer-clear` | + `module-clear` | 清除 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作 |
| `customer-table` | + `customer-table-pro admin-customer-table` | 用户表格 |
| `customer-sort-head` | -- | 排序表头 |
| `customer-sort-icon` | + `is-active` | 排序图标 |
| `customer-company` | + `admin-user-company` | 公司/用户名 |
| `standard-cell-stack` | -- | 单元格堆叠 |
| `standard-value` | -- | 标准值 |
| `standard-row-actions` | -- | 行操作 |
| `admin-role-table` | -- | 角色表格 |
| `admin-role-note` | -- | 角色说明 |
| `admin-permission-chips` | -- | 权限标签 |
| `admin-audit-table` | -- | 审计日志表格 |
| `admin-actor` | -- | 操作者 |
| `list-empty-state` | + `compact` | 空列表 |
| `campaign-content-dialog` | -- | 内容对话框 |
| `admin-user-detail` | -- | 用户详情 |
| `admin-user-identity` | -- | 用户身份 |
| `admin-detail-grid` | -- | 详情网格 |
| `admin-permission-list` | -- | 权限列表 |
| `admin-log-detail` | -- | 日志详情 |

---

### 3.12 SettingsPage

**文件**：`src/pages/settings/SettingsPage.tsx`
**Wrapper**：`<div className="page-content settings-page">`
**CSS 导入**：`import '@/styles/routes/settings.css'`
**注意**：文件共 1726 行，是项目中最大的页面组件，包含 4 个标签页区域。

#### 通用布局

| 类名 | 用途 |
|---|---|
| `settings-content` | 设置内容容器 |

#### 标签页 1：个人资料（`tab === "个人资料"`）

| 类名 | 用途 |
|---|---|
| `profile-settings-layout` | 个人资料布局 |
| `profile-card` | 资料卡片（2 个） |
| `profile-preview` | 头像预览 |
| `profile-form` | 资料表单 |
| `profile-preference-grid` | 偏好网格（与 profile-form 组合使用） |

#### 标签页 2：AI 服务（`tab === "AI 服务"`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `ai-settings-page` | -- | AI 服务页容器 |
| `standard-list-panel` | + `ai-service-panel`（通过 Panel 组件） | 列表面板 |
| `ai-service-toolbar` | + `customer-toolbar module-toolbar standard-list-toolbar` | 工具栏 |
| `customer-filter-controls` | -- | 筛选控件（共享） |
| `customer-search` | + `module-search` | 搜索（共享） |
| `ai-status-select` | -- | 状态筛选 |
| `sort-select` | -- | 排序 |
| `customer-refresh` | + `is-spinning` | 刷新 |
| `customer-clear` | + `module-clear` | 清除 |
| `customer-selection-tools` | + `has-selection` / `is-empty` | 批量操作 |
| `customer-table` | + `customer-table-pro ai-service-table` | AI 服务表格 |
| `customer-check` | -- | 复选框 |
| `customer-sort-head` | -- | 排序表头 |
| `customer-sort-icon` | + `is-active` | 排序图标 |
| `customer-company` | + `ai-service-company` | 服务名单元格 |
| `standard-cell-stack` | -- | 单元格堆叠 |
| `ai-endpoint` | -- | API 端点 |
| `standard-row-actions` | + `ai-table-actions` | 行操作 |
| `ai-promote-service` | -- | 提升优先级按钮 |
| `disabled` | （行状态） | 停用行 |
| `selected` | （行状态） | 选中行 |

#### 标签页 3：数据源与集成（`tab === "数据源与集成"`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `integration-settings-page` | -- | 集成设置容器 |
| `integration-group` | -- | 集成分组 |
| `integration-grid` | -- | 集成卡片网格 |
| `connected` | （article 修饰类） | 已连接状态 |
| `integration-icon` | -- | 集成图标 |
| `integration-card-actions` | -- | 卡片操作区 |

> 该标签页内还嵌入了 `<OutboundSettings />` 子组件，类名见下方 3.14 节。

#### 标签页 4：数据与备份（`tab === "数据与备份"`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `data-backup-layout` | -- | 备份布局 |
| `data-location-card` | -- | 数据位置卡片 |
| `backup-control-card` | -- | 备份控制卡片 |
| `backup-action-grid` | -- | 备份操作网格 |
| `backup-reminder` | + `connector-health-panel` | 备份提醒/连接器健康面板 |
| `connector-health-summary` | -- | 连接器健康摘要 |
| `connector-health-details` | -- | 连接器健康详情列表 |
| `connector-health-item` | -- | 单个连接器项 |
| `connector-dot` | + `connector-dot-green` / `connector-dot-red` / `connector-dot-orange` / `connector-dot-blue` / `connector-dot-neutral` | 状态圆点 |
| `connector-error-text` | -- | 错误文字 |

#### 标签页 5：安全设置（else 分支，默认 tab）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `security-settings-layout` | -- | 安全设置布局 |
| `security-card` | -- | 安全卡片（2 个） |
| `security-options` | -- | 安全选项列表 |
| `session-list` | -- | 会话列表 |
| `current` | （article 修饰类） | 当前会话 |
| `security-danger-card` | -- | 危险操作卡片（删除账户） |

#### SettingsPage 中的模态框/对话框

| 类名 | 用途 |
|---|---|
| `ai-policy-modal` | AI 轮转策略对话框 |
| `ai-policy-flow` | 策略流程图 |
| `ai-policy-grid` | 策略设置网格 |
| `setting-row` | 设置行（标签 + Switch） |
| `ai-key-pool` | 密钥池对话框 |
| `danger-copy` | 危险操作文案 |
| `two-factor-fields` | 双重验证字段容器 |
| `two-factor-setup` | 双重验证设置容器 |
| `two-factor-guide` | 双重验证引导区 |
| `two-factor-qr` | 双重验证二维码图片 |
| `qr-placeholder` | 二维码占位符 |
| `two-factor-key` | 双重验证密钥区 |

---

### 3.13 LeadSourcesPage

**文件**：`src/pages/settings/LeadSourcesPage.tsx`
**Wrapper**：`<div className="page-content settings-page">`（与 SettingsPage 共享 wrapper 类名）
**CSS 导入**：`import '@/styles/routes/settings.css'`（与 SettingsPage 共享同一 CSS 文件）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `customer-workspace` | -- | 工作区（共享） |
| `outbound-settings-section` | -- | 外发设置区（共享） |
| `standard-cell-stack` | -- | 单元格堆叠（共享） |
| `customer-table` | + `customer-table-pro` | 表格（共享） |
| `list-empty-state` | + `compact` | 空列表 |
| `status-detail-list` | -- | 状态详情列表（共享） |

---

### 3.14 OutboundSettings（SettingsPage 子组件）

**文件**：`src/pages/settings/OutboundSettings.tsx`
**Wrapper**：无独立 wrapper（嵌入 SettingsPage 的集成标签页中）
**CSS 导入**：无独立导入（通过 SettingsPage 加载 `settings.css`）

| 类名 | 条件/修饰符 | 用途 |
|---|---|---|
| `outbound-settings-section` | -- | 外发设置区块 |
| `outbound-connection-grid` | -- | 连接卡片网格 |
| `is-spinning` | -- | 旋转中 |
| `list-empty-state` | + `compact` | 空列表 |
| `outbox-modal` | -- | 发件箱模态框 |
| `outbox-toolbar` | -- | 发件箱工具栏 |
| `governance-toolbar` | -- | 治理工具栏 |
| `customer-table` | + `customer-table-pro outbox-table` | 发件箱表格 |
| `governance-table` | -- | 治理表格 |
| `standard-cell-stack` | -- | 单元格堆叠 |
| `standard-row-actions` | -- | 行操作 |
| `webhook-setup` | -- | Webhook 配置 |

---

### 3.15 NotFoundPage

**文件**：`src/pages/NotFoundPage.tsx`
**Wrapper**：`<div className="page-content">`（无特定页面类名，仅使用通用 `page-content`）
**CSS 导入**：无

---

## 四、CSS 导入模式

### 4.1 全局 CSS 导入

**`src/main.tsx`** 中导入两个全局样式：
```tsx
import "antd/dist/reset.css";        // Ant Design 重置样式
import "@/styles/global.css";        // 全局自定义样式（2000+ 行）
```

### 4.2 路由级 CSS 导入

每个页面组件在文件顶部导入自己的路由 CSS，使用 `@/styles/routes/` 路径别名：

| 页面组件 | CSS 文件 |
|---|---|
| DashboardPage | `@/styles/routes/dashboard.css` |
| RadarPage | `@/styles/routes/radar.css` |
| CustomersPage | `@/styles/routes/customers.css` |
| CampaignsPage | `@/styles/routes/campaigns.css` |
| ContentPage | `@/styles/routes/content.css` |
| IcpPage | `@/styles/routes/icp.css` |
| InboxPage | `@/styles/routes/inbox.css` |
| PipelinePage | `@/styles/routes/pipeline.css` |
| AttributionPage | `@/styles/routes/attribution.css` |
| AuthPage | `@/styles/routes/auth.css` |
| AdminPage | `@/styles/routes/admin.css` |
| SettingsPage | `@/styles/routes/settings.css` |
| LeadSourcesPage | `@/styles/routes/settings.css`（与 SettingsPage 共享） |
| NotFoundPage | 无 CSS 导入 |

**说明**：
- `src/styles/routes/` 目录共 12 个 CSS 文件
- `GrowthKnowledge.tsx` 不单独导入 CSS，依赖 `IcpPage` 加载的 `icp.css`
- `CandidateList.tsx`、`CompanyDecisionDrawer.tsx` 等子组件不单独导入 CSS，依赖父页面
- `OutboundSettings.tsx` 不单独导入 CSS，依赖 `SettingsPage` 加载的 `settings.css`
- `components/ui/` 目录中的所有组件均无 CSS 文件导入，样式完全由 `global.css` 和路由 CSS 提供

### 4.3 global.css 内容概要

**`src/styles/global.css`**（2000+ 行）包含：
- CSS 变量定义：`--ui-*`、`--nav`、`--blue`、`--green`、`--orange`、`--red`、`--color-*`
- CSS Reset / 基础样式
- 布局类：`.app-shell`、`.sidebar`、`.main-area`、`.topbar`、`.page-content`、`.app-content`
- 共享组件类：`.panel`、`.badge`、`.metric-card`、`.toolbar`、`.progress`
- 色调类：`.tone-blue`、`.tone-violet`、`.tone-orange`、`.tone-green`
- 共享列表/表格类：`.customer-table`、`.customer-toolbar`、`.standard-*`、`.module-*`
- 响应式断点：800px、1100px、480px、520px

---

## 五、路由配置（页面组件到路由的映射）

路由配置文件：`src/app/router.tsx`，使用 `createBrowserRouter`。
所有页面组件均通过 `React.lazy()` 懒加载。

### 5.1 无 AppLayout 的独立路由（认证页）

| 路由路径 | 页面组件 | Guard | 说明 |
|---|---|---|---|
| `/login` | `AuthPage` | 无 | 登录 |
| `/register` | `AuthPage` | 无 | 注册 |
| `/forgot-password` | `AuthPage` | 无 | 忘记密码 |
| `/reset-password` | `AuthPage` | 无 | 重置密码 |

> 以上路由均不使用 `AppLayout`，直接渲染 `AuthPage`，其 wrapper 为 `<main className="auth-shell">`。

### 5.2 受保护路由（AppLayout 包裹）

根路径 `/` 通过 `AuthGuard` 包裹 `AppLayout`，子路由如下：

| 路由路径 | 页面组件 | Guard | 说明 |
|---|---|---|---|
| `/` | -- | AuthGuard | 重定向到 `/dashboard` |
| `/dashboard` | `DashboardPage` | -- | 仪表盘 |
| `/icp` | `IcpPage` | -- | ICP 定位画像 |
| `/knowledge` | -- | -- | 重定向到 `/icp` |
| `/radar` | `RadarPage` | -- | 雷达（候选公司发现） |
| `/customers` | `CustomersPage` | -- | 客户库 |
| `/content` | `ContentPage` | -- | 内容创作与资产 |
| `/content/assets` | -- | -- | 重定向到 `/content` |
| `/campaigns` | `CampaignsPage` | -- | 营销活动 |
| `/inbox` | `InboxPage` | -- | 收件箱 |
| `/pipeline` | `PipelinePage` | -- | 商机管道 |
| `/attribution` | `AttributionPage` | -- | 归因分析 |
| `/settings` | -- | -- | 重定向到 `/settings/ai` |
| `/settings/lead-sources` | `LeadSourcesPage` | SettingsGuard | 线索源设置 |
| `/settings/:section` | `SettingsPage` | SettingsGuard | 设置页（动态 section） |
| `/admin` | -- | -- | 重定向到 `/admin/users` |
| `/admin/system` | -- | -- | 重定向到 `/admin/users` |
| `/admin/:section` | `AdminPage` | AdminGuard | 管理页（动态 section） |
| `*` | `NotFoundPage` | -- | 404 页面 |

### 5.3 路由结构树

```
/login, /register, /forgot-password, /reset-password
  └── AuthPage (无 AppLayout)

/
  └── AuthGuard > AppLayout
        ├── index → <Navigate to="/dashboard" />
        ├── dashboard → DashboardPage
        ├── icp → IcpPage
        ├── knowledge → <Navigate to="/icp" />
        ├── radar → RadarPage
        ├── customers → CustomersPage
        ├── content → ContentPage
        ├── content/assets → <Navigate to="/content" />
        ├── campaigns → CampaignsPage
        ├── inbox → InboxPage
        ├── pipeline → PipelinePage
        ├── attribution → AttributionPage
        ├── settings → <Navigate to="/settings/ai" />
        │     ├── lead-sources → SettingsGuard > LeadSourcesPage
        │     └── :section → SettingsGuard > SettingsPage
        ├── admin → <Navigate to="/admin/users" />
        │     ├── system → <Navigate to="/admin/users" />
        │     └── :section → AdminGuard > AdminPage
        └── * → NotFoundPage
```

---

## 六、跨页面共享类名汇总

以下类名在多个页面中重复使用，重写 CSS 时应作为共享组件/工具类处理。

### 6.1 列表/表格共享类

| 类名 | 使用页面 | 用途 |
|---|---|---|
| `customer-workspace` | Radar, Customers, Campaigns, Content, Knowledge, LeadSources | 列表工作区容器 |
| `standard-list-panel` | Campaigns, Content, Pipeline, Attribution, Knowledge | 标准列表面板 |
| `customer-toolbar` | Radar, Customers, Campaigns, Pipeline, Admin, Settings, Knowledge | 工具栏 |
| `module-toolbar` | 同上 | 模块工具栏修饰 |
| `standard-list-toolbar` | 同上 | 标准列表工具栏修饰 |
| `customer-filter-controls` | Radar, Customers, Content, Settings, Attribution | 筛选控件容器 |
| `customer-search` / `module-search` | Customers, Campaigns, Content, Pipeline, Admin, Settings, Knowledge, Attribution | 搜索框 |
| `sort-select` | Radar, Customers, Campaigns, Content, Pipeline, Admin, Settings, Knowledge, Attribution | 排序下拉选择 |
| `customer-refresh` | Radar, Customers, Campaigns, Content, Pipeline, Admin, Settings, Knowledge | 刷新按钮 |
| `customer-clear` / `module-clear` | 同上 | 清除筛选按钮 |
| `customer-selection-tools` | 同上 | 批量操作工具栏 |
| `customer-table` / `customer-table-pro` | Radar, Customers, Campaigns, Content, Pipeline, Admin, Settings, Knowledge, Attribution | 表格 |
| `customer-check` | Radar, Customers, Campaigns, Content, Pipeline, Admin, Settings | 复选框列 |
| `customer-sort-head` | Radar, Customers, Campaigns, Content, Pipeline, Admin, Settings | 可排序表头 |
| `customer-sort-icon` | Radar, Customers, Admin, Settings | 排序图标 |
| `standard-entity` | Campaigns, Content, Knowledge, Attribution | 标准实体单元格 |
| `standard-cell-stack` | Customers, Campaigns, Content, Pipeline, Admin, Settings, Knowledge, Attribution, LeadSources | 单元格垂直堆叠 |
| `standard-value` | Campaigns, Pipeline, Admin, Knowledge | 标准值 |
| `standard-row-actions` | Campaigns, Content, Pipeline, Admin, Settings, Knowledge, Attribution | 行操作按钮组 |
| `standard-progress` | Campaigns, Attribution | 标准进度条 |
| `standard-next` | Campaigns, Attribution | 标准下一步 |
| `list-empty-state` | Radar, Customers, Campaigns, Content, Pipeline, Admin, Settings, Knowledge, Inbox | 空列表状态 |
| `standard-list-state` | Campaigns, Content | 列表状态容器 |
| `app-detail-drawer-body` | Customers, Campaigns, Pipeline | 抽屉体（来自 DetailDrawer 组件） |

### 6.2 状态修饰类（全局通用）

| 类名 | 使用位置 | 含义 |
|---|---|---|
| `active` | AppLayout, ICP, Inbox, Content | 激活/选中状态 |
| `selected` | DataTable 行（Radar, Customers, Settings） | 行选中 |
| `disabled` | DataTable 行（Settings AI 服务） | 行禁用 |
| `done` | Campaigns, Pipeline, CompanyDecisionDrawer | 已完成 |
| `is-spinning` | RefreshCw 图标（多页面） | 旋转动画 |
| `is-error` | Radar | 错误状态 |
| `is-active` | customer-sort-icon | 排序激活 |
| `has-selection` / `is-empty` | customer-selection-tools | 批量选择栏状态 |
| `is-completed` | Dashboard tasks | 任务完成 |
| `is-expanded` | CompanyDecisionDrawer evidence-row | 展开状态 |
| `unread` / `read` | AppLayout 通知, Inbox | 消息已读/未读 |
| `outgoing` / `incoming` | Inbox | 消息方向 |
| `compact` | EmptyState, Admin, Knowledge, OutboundSettings, LeadSources | 紧凑模式 |
| `full-width` | Content, Inbox | 全宽布局 |
| `connected` | Settings integration cards | 已连接 |
| `current` | Settings session list | 当前会话 |
| `urgent` / `money` | Customers, Pipeline（行状态） | 紧急/金额标记 |
| `danger` / `danger-copy` | Campaigns, Settings, Knowledge | 危险操作/文案 |

### 6.3 色调类

| 类名 | 使用位置 |
|---|---|
| `tone-blue` / `tone-violet` / `tone-orange` / `tone-green` | Dashboard metrics/workstreams/attention |
| `workstream-blue` / `workstream-violet` / `workstream-orange` / `workstream-green` | Dashboard workstream |
| `attention-blue` / `attention-violet` / `attention-orange` / `attention-green` | Dashboard attention |
| `connector-dot-green` / `-red` / `-orange` / `-blue` / `-neutral` | Settings 连接器健康 |

---

## 七、常见重复内联样式模式

以下内联样式在多个文件中重复出现，重写 CSS 时应考虑提取为工具类：

### 7.1 进度条模式（最常见）

在多个页面中重复出现：
```jsx
<u style={{ width: `${progress}%` }} />
```
用于 `standard-progress`、`score-confidence-bar`、`score-bar-track` 等进度条内部填充。

### 7.2 居中错误/加载状态

```jsx
// AuthGuard.tsx
style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f7fb' }}
```

### 7.3 Badge 组件内联调色板

Badge.tsx 通过内联 `style` 设置颜色（green/blue/orange/red/neutral），每种色调包含 `background`、`color`、`border`。

### 7.4 网格布局内联样式

- `style={{ display: 'grid', gap: 8 }}` -- SettingsPage 2FA 恢复码
- `style={{ display: 'grid', placeItems: 'center' }}` -- 多处居中

### 7.5 颜色值硬编码

以下颜色值在多处通过内联样式使用：
- `#f5f7fb` -- 浅灰背景（AuthGuard）
- Badge 调色板中的 green/blue/orange/red/neutral 色值（Badge.tsx）

---

## 八、页面 Wrapper 类名快速参考

| 页面 | Wrapper 类名 | 特殊说明 |
|---|---|---|
| Dashboard | `page-content dashboard-page` | |
| Radar | `page-content radar-page` | |
| Customers | `page-content customers-page` | |
| Campaigns | `page-content campaigns-page` | |
| Content | `page-content content-page` | |
| ICP | `page-content icp-page positioning-page` | 双类名 |
| GrowthKnowledge | `knowledge-page knowledge-page-inline` (+ `knowledge-page-modal`) | 不使用 `page-content`，嵌入 ICP |
| Inbox | `page-content inbox-page` | |
| Pipeline | `page-content pipeline-page` | |
| Attribution | `page-content conversion-page conversion-page-rebuilt` | 双类名 |
| Auth | `auth-shell` | 使用 `<main>` 标签，不使用 `page-content` |
| Admin | `page-content admin-page` | |
| Settings | `page-content settings-page` | |
| LeadSources | `page-content settings-page` | 与 Settings 共享 |
| NotFound | `page-content` | 无页面特定类名 |
| AppLayout | `app-shell` (+ `sidebar-collapsed`) | 外壳，非页面 |
