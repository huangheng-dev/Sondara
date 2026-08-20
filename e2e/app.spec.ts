import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const appRoutes = [
  '/dashboard',
  '/icp',
  '/radar',
  '/customers',
  '/content',
  '/campaigns',
  '/inbox',
  '/pipeline',
  '/attribution',
  '/settings/profile',
  '/settings/ai',
  '/settings/integrations',
  '/settings/data',
  '/settings/security',
  '/admin/users',
  '/admin/roles',
  '/admin/audit-logs',
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
