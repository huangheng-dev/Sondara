import { fileURLToPath } from 'node:url'
import { request as playwrightRequest } from '@playwright/test'

const baseURL = process.env.SONDARA_E2E_BASE_URL ?? 'http://127.0.0.1:4177'
const email = process.env.SONDARA_E2E_EMAIL ?? 'e2e@sondara.local'
const password = process.env.SONDARA_E2E_PASSWORD ?? 'SondaraE2E@2026'
const storageState = fileURLToPath(new URL('../.tmp/e2e-auth.json', import.meta.url))

export default async function globalSetup() {
  const context = await playwrightRequest.newContext({ baseURL })
  const register = await context.post('/api/auth/register', {
    data: { displayName: 'Sondara E2E', email, password },
  })
  if (register.status() !== 201) {
    const login = await context.post('/api/auth/login', { data: { email, password, remember: true } })
    if (!login.ok()) throw new Error(`E2E account is unavailable: ${login.status()} ${await login.text()}`)
  }
  await context.storageState({ path: storageState })
  await context.dispose()
}