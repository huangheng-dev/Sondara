import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const npmCli = process.env.npm_execpath ?? require.resolve('npm/bin/npm-cli.js')

const tests = [
  'ai-client',
  'approvals',
  'attribution',
  'auth-2fa',
  'backup-worker',
  'campaigns',
  'closed-loop',
  'contact-enrichment',
  'content-assets',
  'customer-governance',
  'icp',
  'inbox',
  'industry-source',
  'lead-sources',
  'map-connector',
  'outbox',
  'partial-updates',
  'search-connector',
  'team-invitations',
  'worker-locks',
]

let index = 0
const tempDir = resolve(process.cwd(), '.tmp', 'integration')
await mkdir(tempDir, { recursive: true })

const removeDatabase = async path => Promise.all([
  rm(path, { force: true }),
  rm(`${path}-wal`, { force: true }),
  rm(`${path}-shm`, { force: true }),
])

const runNpm = (args, env) => new Promise(resolveRun => {
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  })
  child.on('exit', code => resolveRun(code ?? 1))
})

const runNext = async () => {
  if (index >= tests.length) {
    console.log(`\n${tests.length}/${tests.length} integration test suites passed.`)
    process.exit(0)
  }

  const name = tests[index]
  const databasePath = resolve(tempDir, `${name}-${process.pid}.sqlite`)
  const env = { ...process.env, SONDARA_DATABASE_URL: `file:${databasePath.replaceAll('\\', '/')}` }
  console.log(`\n=== test:${name} ===`)
  const migrationCode = await runNpm(['run', 'db:migrate'], env)
  const testCode = migrationCode === 0 ? await runNpm(['run', `test:${name}`], env) : migrationCode
  await removeDatabase(databasePath)
  if (testCode !== 0) process.exit(testCode)
  index += 1
  await runNext()
}

await runNext()
