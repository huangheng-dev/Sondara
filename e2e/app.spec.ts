import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const appRoutes = [
  '/dashboard',
  '/icp',
  '/radar',
  '/procurement',
  '/customers',
  '/content',
  '/campaigns',
  '/inbox',
  '/pipeline',
  '/attribution',
  '/settings/profile',
  '/settings/ai',
  '/settings/integrations',
  '/settings/lead-sources',
  '/settings/connectors',
  '/settings/data',
  '/settings/security',
  '/admin/users',
  '/admin/roles',
  '/admin/audit-logs',
  '/admin/approvals',
] as const

test.describe('public auth page', () => {
  test.use({ storageState: undefined })

  test('is accessible and has no uncaught errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: '登录你的工作空间' })).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze()
    expect(results.violations).toEqual([])
    expect(errors).toEqual([])
  })
})

test.describe('authenticated smoke, accessibility and performance', () => {
  let pageErrors: string[] = []

  test.beforeEach(async ({ page }) => {
    pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
  })

  for (const route of appRoutes) {
    test(`renders ${route} without critical errors`, async ({ page }) => {
      await page.goto(route)
      await expect(page.locator('#root')).not.toBeEmpty()
      await page.waitForLoadState('networkidle')
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
        .analyze()
      expect(results.violations).toEqual([])
      expect(pageErrors).toEqual([])
    })
  }

  test('explains unavailable sources and creates after a public source is supplied', async ({ page }) => {
    await page.goto('/radar')
    await page.getByRole('button', { name: /创\s*建\s*获\s*客/ }).click()
    const dialog = page.getByRole('dialog', { name: /创建获客/ })
    await dialog.getByRole('textbox', { name: /计划名称/ }).fill('无来源网址回归任务')
    await dialog.getByRole('textbox', { name: /目标地区/ }).fill('德国')
    await dialog.getByRole('button', { name: /创\s*建/ }).click()
    await expect(dialog.getByRole('alert')).toContainText('所选数据源尚未就绪')
    await expect(dialog.getByRole('alert')).not.toContainText('Cannot read properties')
    await dialog.getByRole('button', { name: '高级设置' }).click()
    await dialog.getByRole('textbox', { name: /补充公开网址/ }).fill('https://www.example.com')
    await dialog.getByRole('button', { name: /创\s*建/ }).click()
    await expect(dialog).toBeHidden()
    const runHistory = page.getByRole('dialog', { name: /运行记录/ })
    await expect(runHistory).toBeVisible()
    await expect(page.getByText('无来源网址回归任务', { exact: true }).first()).toBeVisible()
    await expect(runHistory.getByText('没有已启用且可用的 AI 密钥。')).toBeVisible()
    expect(pageErrors.filter(message => !message.includes('status of 409'))).toEqual([])
  })

  test('global search opens the selected customer detail', async ({ page }) => {
    await page.goto('/dashboard')
    const customer = await page.evaluate(async () => {
      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company: '全局搜索回归客户', region: '德国', industry: '工业设备', score: 88, confidence: 90, signal: '官网询盘', source: 'E2E' }),
      })
      return response.json() as Promise<{ company: string }>
    })
    await page.reload()
    const search = page.getByRole('combobox', { name: '搜索客户、联系人和消息' })
    await search.fill(customer.company)
    await expect(search).toHaveAttribute('aria-expanded', 'true')
    await search.press('ArrowDown')
    await search.press('Enter')
    await expect(page).toHaveURL(/\/customers$/)
    await expect(page.getByRole('dialog').filter({ hasText: customer.company })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('customer and AI acquisition details share the unified drawer sections', async ({ page }) => {
    await page.goto('/customers')
    await page.evaluate(async () => {
      await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company: '详情抽屉回归客户', region: '德国', industry: '工业设备', score: 88, confidence: 90, signal: '官网询盘', source: 'E2E' }),
      })
    })
    await page.reload()
    await page.getByRole('button', { name: '查看 详情抽屉回归客户 客户档案' }).click()
    await expect(page.locator('.ui-drawer .ui-detail-section').first()).toBeVisible()
    expect(await page.locator('.ui-drawer .ui-detail-section').count()).toBeGreaterThanOrEqual(7)

    await page.goto('/radar')
    await page.evaluate(async () => {
      await fetch('/api/radar/candidates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company: '详情抽屉回归候选', region: '德国', industry: '工业设备', size: '中型企业', score: 91, confidence: 87, signal: '扩产信号', source: 'E2E', estimatedValue: 120000, currency: 'CNY', reason: '公开来源显示近期扩产和采购活动。' }),
      })
    })
    await page.reload()
    await page.getByRole('button', { name: '查看 AI 决策：详情抽屉回归候选' }).click()
    const radarDrawer = page.locator('.ui-drawer')
    await expect(radarDrawer.locator('.ui-detail-section').first()).toBeVisible()
    expect(await radarDrawer.locator('.ui-detail-section').count()).toBeGreaterThanOrEqual(6)
    await expect(radarDrawer.locator('.ant-drawer-footer')).toBeVisible()
    await expect(radarDrawer.getByRole('button', { name: /^不\s*符\s*合$/ })).toBeVisible()
    await expect(radarDrawer.getByRole('button', { name: /^符\s*合$/ })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('top navigation toggle changes and remembers the sidebar state', async ({ page }) => {
    await page.goto('/dashboard')
    const expand = page.getByRole('button', { name: '展开导航栏' })
    const collapse = page.getByRole('button', { name: '收起导航栏' })
    const startsCollapsed = await expand.isVisible()
    await (startsCollapsed ? expand : collapse).click()
    const expected = startsCollapsed ? collapse : expand
    await expect(expected).toBeVisible()
    await page.reload()
    await expect(expected).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('integration center switches between clear configuration categories', async ({ page }) => {
    await page.goto('/settings/integrations')
    await expect(page.getByRole('tab', { name: '核心服务' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: '线索入口' }).click()
    await expect(page).toHaveURL(/#lead-source-settings$/)
    await expect(page.getByText(/线索入口配置 \d+\/\d+/)).toBeVisible()
    await page.getByRole('tab', { name: '扩展服务' }).click()
    await expect(page).toHaveURL(/#external-service-settings$/)
    await expect(page.getByRole('searchbox', { name: '搜索可选集成' })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('AI acquisition stays unified and keeps the old procurement route compatible', async ({ page }) => {
    await page.goto('/radar')
    await expect(page.getByRole('heading', { name: 'AI 获客' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '企业发现' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '招标采购' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /创\s*建\s*获\s*客/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /运\s*行\s*记\s*录/ })).toBeVisible()
    await expect(page.getByText('全渠道获客能力', { exact: true })).toHaveCount(0)
    await expect(page.getByText('发现的客户', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '更多筛选' })).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: '筛选来源任务' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '筛选候选范围' })).toBeVisible()
    await expect(page.getByText('这里用于查看单个任务的运行进度和执行记录，不会限制下方候选客户列表。')).toHaveCount(0)

    await page.goto('/procurement')
    await expect(page).toHaveURL(/\/radar$/)
    await expect(page.getByRole('heading', { name: 'AI 获客' })).toBeVisible()

    await page.goto('/settings/integrations')
    await expect(page.getByText('采购公告数据源', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /采购订阅/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '创建采购订阅' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '刷新连接状态' })).toHaveCount(0)
    await expect(page.getByText('欧盟 TED', { exact: true })).toBeVisible()
    await expect(page.getByText('World Bank Procurement', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('creates a website lead source through the unified Ant Design form', async ({ page }) => {
    await page.goto('/settings/lead-sources')
    await page.getByRole('button', { name: '添加其他来源' }).click()
    const dialog = page.getByRole('dialog', { name: /添加线索来源/ })
    await dialog.getByRole('textbox', { name: /来源名称/ }).fill('官网询价表单 E2E')
    await dialog.getByRole('combobox', { name: '接入方式' }).click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '网站表单' }).click()
    await dialog.getByRole('button', { name: /保存并建立连接/ }).click()
    const webhookDialog = page.getByRole('dialog', { name: /Webhook 配置/ })
    await expect(webhookDialog).toBeVisible()
    await expect(webhookDialog).toContainText('/api/lead-sources/webhook/')
    await webhookDialog.getByRole('button', { name: /完\s*成/ }).click()
    await expect(page.getByText('官网询价表单 E2E', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('offers all supported AI API protocols in create and edit-ready form controls', async ({ page }) => {
    await page.goto('/settings/ai')
    await page.getByRole('button', { name: '添加模型' }).click()
    const dialog = page.getByRole('dialog', { name: /添加模型连接/ })
    const protocol = dialog.getByRole('combobox', { name: 'API 协议' })
    await expect(protocol).toBeEnabled()
    await protocol.click()
    const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    await expect(options).toHaveText([
      'OpenAI Responses',
      'OpenAI Chat Completions',
      'Anthropic Messages',
    ])
    await options.filter({ hasText: 'Anthropic Messages' }).click()
    await expect(protocol).toHaveAttribute('aria-expanded', 'false')
    await dialog.getByRole('button', { name: /取\s*消/ }).click()
    await expect(dialog).toBeHidden()
    expect(pageErrors).toEqual([])
  })

  test('selected table rows keep enterprise avatars visually distinct', async ({ page }) => {
    const company = `Selected Avatar ${Date.now()}`
    const create = await page.request.post('/api/customers', { data: { company, region: '全球市场', industry: '工业工程', score: 88, confidence: 82 } })
    expect(create.status()).toBe(201)
    const customer = await create.json() as { id: string }
    try {
      await page.goto('/customers')
      const row = page.getByRole('row').filter({ hasText: company })
      await expect(row).toBeVisible()
      await row.getByRole('checkbox').check()
      await expect(row).toHaveClass(/selected/)
      const avatar = row.locator('.ant-avatar')
      const cell = row.locator('td').nth(1)
      const colors = await Promise.all([
        avatar.evaluate(element => getComputedStyle(element).backgroundColor),
        cell.evaluate(element => getComputedStyle(element).backgroundColor),
      ])
      expect(colors[0]).not.toBe(colors[1])
      await expect(avatar).toHaveCSS('box-shadow', /rgb\(199, 210, 254\)/)
      await row.screenshot({ path: 'artifacts/selected-row-avatar-qa.png' })
    } finally {
      await page.request.delete(`/api/customers/${customer.id}`)
    }
    expect(pageErrors).toEqual([])
  })

  test('dashboard stays within local performance budget', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      const resources = performance.getEntriesByType('resource')
      return {
        domContentLoaded: navigation.domContentLoadedEventEnd,
        load: navigation.loadEventEnd,
        transferred: resources.reduce((total, resource) => total + (resource as PerformanceResourceTiming).encodedBodySize, 0),
      }
    })
    expect(metrics.domContentLoaded).toBeLessThan(5_000)
    expect(metrics.load).toBeLessThan(8_000)
    expect(metrics.transferred).toBeLessThan(2_000_000)
    expect(pageErrors).toEqual([])
  })
})
