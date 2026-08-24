import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const root = process.cwd()
const port = Number(process.env.SONDARA_E2E_PORT ?? 4177)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list']],
  globalSetup: resolve(root, 'e2e/global-setup.ts'),
  globalTeardown: resolve(root, 'e2e/global-teardown.ts'),
  outputDir: resolve(root, 'test-results'),
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState: resolve(root, '.tmp/e2e-auth.json'),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `${baseURL}/api/healthz`,
    cwd: root,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      SONDARA_API_HOST: '127.0.0.1',
      SONDARA_API_PORT: String(port),
      SONDARA_E2E_DATABASE_URL: process.env.SONDARA_E2E_DATABASE_URL ?? '',
      SONDARA_RADAR_WORKER_ENABLED: 'false',
      SONDARA_OUTBOX_WORKER_ENABLED: 'false',
      SONDARA_RATE_LIMIT_MAX: '3000',
      SONDARA_SECURE_COOKIES: 'false',
      SONDARA_LOG_LEVEL: 'warn',
    },
  },
})
