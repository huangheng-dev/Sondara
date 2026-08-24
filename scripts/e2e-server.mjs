import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const tempDir = resolve(root, '.tmp')
const pidFile = resolve(tempDir, 'e2e-server.pid')
const databaseFile = resolve(tempDir, 'e2e-database.json')
const configuredUrl = process.env.SONDARA_E2E_DATABASE_URL?.trim()
const databasePath = resolve(tempDir, `sondara-e2e-${process.pid}-${Date.now()}.sqlite`)
const databaseUrl = configuredUrl || `file:${databasePath.replaceAll('\\', '/')}`
await mkdir(tempDir, { recursive: true })
if (!configuredUrl) {
  await writeFile(databaseFile, JSON.stringify({ databasePath }), 'utf8')
}

const child = spawn(process.execPath, ['server-dist/index.js'], {
  cwd: root,
  env: { ...process.env, SONDARA_DATABASE_URL: databaseUrl },
  stdio: 'inherit',
})
if (!child.pid) throw new Error('E2E server process did not start')
await writeFile(pidFile, String(child.pid), 'utf8')

let cleaningUp = false
const finish = async (code = 0) => {
  if (cleaningUp) return
  cleaningUp = true
  await rm(pidFile, { force: true })
  process.exit(code)
}

child.on('exit', code => void finish(code ?? 0))
child.on('error', error => {
  console.error(error)
  void finish(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
