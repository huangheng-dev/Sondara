import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const storageState = resolve(root, '.tmp/e2e-auth.json')
const serverPidFile = resolve(root, '.tmp/e2e-server.pid')
const databaseFile = resolve(root, '.tmp/e2e-database.json')

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

const removeWithRetry = async (path, attempts = 20) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(path, { force: true })
      return
    } catch (error) {
      if (attempt === attempts - 1 || (error instanceof Error && !error.message.includes('EBUSY'))) throw error
      await sleep(250)
    }
  }
}

const processExists = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const stopE2eServer = async () => {
  let pid = 0
  try {
    pid = Number.parseInt(await readFile(serverPidFile, 'utf8'), 10)
  } catch {
    return
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return
  if (processExists(pid)) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already stopped */ }
    for (let attempt = 0; attempt < 40 && processExists(pid); attempt += 1) await sleep(250)
    if (processExists(pid)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* already stopped */ }
    }
  }
  await rm(serverPidFile, { force: true })
}

const removeE2eDatabase = async () => {
  let metadata: { databasePath?: string }
  try {
    metadata = JSON.parse(await readFile(databaseFile, 'utf8')) as typeof metadata
  } catch {
    return
  }
  const { databasePath } = metadata
  if (!databasePath || !databasePath.startsWith(resolve(root, '.tmp'))) return
  await Promise.all([
    removeWithRetry(databasePath),
    removeWithRetry(`${databasePath}-wal`),
    removeWithRetry(`${databasePath}-shm`),
    rm(databaseFile, { force: true }),
  ])
}

export default async function globalTeardown() {
  await stopE2eServer()
  await removeE2eDatabase()
  await removeWithRetry(storageState, 5)

}
