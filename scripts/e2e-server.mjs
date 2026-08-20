import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Client } from 'pg'

const root = process.cwd()
const tempDir = resolve(root, '.tmp')
const pidFile = resolve(tempDir, 'e2e-server.pid')
const databaseFile = resolve(tempDir, 'e2e-database.json')
const configuredUrl = process.env.SONDARA_E2E_DATABASE_URL?.trim()
const adminUrl = process.env.SONDARA_E2E_DATABASE_ADMIN_URL?.trim()
const databaseName = `sondara_e2e_${process.pid}_${Date.now()}`
let databaseUrl = configuredUrl
let ownsDatabase = false

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`

const createDatabase = async () => {
  if (databaseUrl) return
  if (!adminUrl || !/^postgres(?:ql)?:\/\//i.test(adminUrl)) {
    throw new Error('E2E 需要 SONDARA_E2E_DATABASE_URL，或可创建测试库的 SONDARA_E2E_DATABASE_ADMIN_URL。')
  }
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    await client.query(`create database ${quoteIdentifier(databaseName)}`)
  } finally {
    await client.end()
  }
  const nextUrl = new URL(adminUrl)
  nextUrl.pathname = `/${databaseName}`
  databaseUrl = nextUrl.toString()
  ownsDatabase = true
}

const dropDatabase = async () => {
  if (!ownsDatabase || !adminUrl || !/^sondara_e2e_\d+_\d+$/.test(databaseName)) return
  const client = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    await client.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [databaseName])
    await client.query(`drop database if exists ${quoteIdentifier(databaseName)}`)
  } finally {
    await client.end()
  }
}

await createDatabase()
await mkdir(tempDir, { recursive: true })
if (ownsDatabase) {
  await writeFile(databaseFile, JSON.stringify({ databaseName, adminUrl }), 'utf8')
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
  await Promise.allSettled([rm(pidFile, { force: true }), dropDatabase()])
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
