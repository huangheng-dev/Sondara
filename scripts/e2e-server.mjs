import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const dataDir = resolve(root, 'data')
const tempDir = resolve(root, '.tmp')
const pidFile = resolve(tempDir, 'e2e-server.pid')
const databaseUrl = process.env.SONDARA_DATABASE_URL ?? `./data/e2e-check-${process.ppid}.db`
const databasePath = resolve(root, databaseUrl)
const isManagedDatabase = databasePath.startsWith(`${dataDir}\\`) && /e2e-check(?:-\d+)?\.db$/.test(databasePath)

const cleanup = async (path) => {
  await rm(path, { force: true })
}

const cleanupDatabaseGroup = async (path) => {
  await Promise.allSettled([
    cleanup(path),
    cleanup(`${path}-wal`),
    cleanup(`${path}-shm`),
  ])
}

const cleanupStaleDatabases = async () => {
  if (!isManagedDatabase) return
  const files = await readdir(dataDir)
  await Promise.allSettled(
    files
      .filter((file) => /^e2e-check(?:-\d+)?\.db(?:-wal|-shm)?$/.test(file))
      .filter((file) => resolve(dataDir, file) !== databasePath)
      .map((file) => cleanup(resolve(dataDir, file))),
  )
}

await cleanupStaleDatabases()
await mkdir(tempDir, { recursive: true })

const child = spawn(process.execPath, ['server-dist/index.js'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})
if (!child.pid) throw new Error('E2E server process did not start')
await writeFile(pidFile, String(child.pid), 'utf8')

child.on('exit', async (code, signal) => {
  await Promise.allSettled([cleanupDatabaseGroup(databasePath), rm(pidFile, { force: true })])
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})

child.on('error', async error => {
  await rm(pidFile, { force: true })
  console.error(error)
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
