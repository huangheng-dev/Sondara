import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'
import { sqliteClient } from '../db/client.js'
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from '../lib/leader-lock.js'
import { logger } from '../logger.js'

export type BackupRecord = { fileName: string; createdAt: number; size: number; verifiedAt: number | null }

const backupDir = resolve(config.backupDirectory)
const metadataPath = (fileName: string) => join(backupDir, `${fileName}.json`)

export const listDatabaseBackups = async (): Promise<BackupRecord[]> => {
  await mkdir(backupDir, { recursive: true })
  const entries = await readdir(backupDir, { withFileTypes: true })
  const records = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.sqlite')).map(async entry => {
    const file = await stat(join(backupDir, entry.name))
    let verifiedAt: number | null = null
    try { verifiedAt = JSON.parse(await readFile(metadataPath(entry.name), 'utf8')).verifiedAt ?? null } catch { /* a legacy backup may not have metadata */ }
    return { fileName: entry.name, createdAt: file.mtimeMs, size: file.size, verifiedAt }
  }))
  return records.sort((a, b) => b.createdAt - a.createdAt)
}

export const validateDatabaseBackup = async (fileName: string) => {
  if (!/^[a-zA-Z0-9._-]+\.sqlite$/.test(fileName)) throw new Error('备份文件名无效。')
  const filePath = join(backupDir, fileName)
  await stat(filePath)
  const backupDatabase = new DatabaseSync(filePath, { readOnly: true })
  try {
    const check = backupDatabase.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
    if (check?.quick_check !== 'ok') throw new Error('SQLite 完整性校验失败。')
  } finally {
    backupDatabase.close()
  }
  const verifiedAt = Date.now()
  await writeFile(metadataPath(fileName), JSON.stringify({ verifiedAt }), 'utf8')
  return { fileName, verifiedAt }
}

const pruneBackups = async () => {
  const records = await listDatabaseBackups()
  await Promise.all(records.slice(config.backupRetentionCount).flatMap(record => [rm(join(backupDir, record.fileName), { force: true }), rm(metadataPath(record.fileName), { force: true })]))
}

export const createDatabaseBackup = async () => {
  await mkdir(backupDir, { recursive: true })
  const fileName = `sondara-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
  const filePath = join(backupDir, fileName)
  await sqliteClient.execute('PRAGMA wal_checkpoint(TRUNCATE)')
  await copyFile(config.databasePath, filePath)
  const result = await validateDatabaseBackup(fileName)
  await pruneBackups()
  return result
}

export const createBackupWorker = () => {
  let timer: NodeJS.Timeout | undefined
  let runningPromise: Promise<void> | undefined
  const runOnce = () => {
    if (runningPromise) return runningPromise
    runningPromise = createDatabaseBackup()
      .then(() => undefined)
      .catch(error => { logger.error({ err: error }, 'Automatic SQLite backup failed') })
      .finally(() => { runningPromise = undefined })
    return runningPromise
  }
  let electionTimer: NodeJS.Timeout | undefined
  let lease: LeaderLease | null = null
  const scheduleElection = () => {
    if (electionTimer) return
    electionTimer = setTimeout(() => { electionTimer = undefined; void elect() }, config.workerLeaderElectionIntervalMs)
    electionTimer.unref?.()
  }
  const activate = () => {
    if (timer) return
    void runOnce()
    timer = setInterval(() => void runOnce(), config.backupIntervalMs)
    timer.unref()
    logger.info({ intervalMs: config.backupIntervalMs }, 'Backup worker elected as leader')
  }
  const elect = async () => {
    if (timer || electionTimer) return
    if (!config.workerLeaderLock) { activate(); return }
    try {
      lease = await acquireLeaderLease(LEADER_KEYS.backup, () => {
        logger.warn('Backup worker leader lock lost; standing down')
        if (timer) clearInterval(timer)
        timer = undefined
        void lease?.release()
        lease = null
        scheduleElection()
      })
      if (lease) activate()
      else { logger.info('Backup worker is standby; another instance owns the leader lock'); scheduleElection() }
    } catch (error) {
      logger.warn({ err: error }, 'Backup worker leader election failed; retrying')
      scheduleElection()
    }
  }
  return {
    start: elect,
    stop: async () => {
      if (electionTimer) clearTimeout(electionTimer)
      electionTimer = undefined
      if (timer) clearInterval(timer)
      timer = undefined
      const current = lease
      lease = null
      await current?.release()
      await runningPromise
    },
  }
}
