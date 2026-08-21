import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { config } from '../config.js'

export type BackupRecord = { fileName: string; createdAt: number; size: number; verifiedAt: number | null }

const backupDir = resolve(config.backupDirectory)
const run = (command: string, args: string[]) => new Promise<void>((resolveRun, rejectRun) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  child.once('error', error => rejectRun(error))
  child.once('close', code => code === 0 ? resolveRun() : rejectRun(new Error(stderr.trim() || `${command} 退出码 ${code}`)))
})
const metadataPath = (fileName: string) => join(backupDir, `${fileName}.json`)

export const listDatabaseBackups = async (): Promise<BackupRecord[]> => {
  await mkdir(backupDir, { recursive: true })
  const entries = await readdir(backupDir, { withFileTypes: true })
  const records = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.dump')).map(async entry => {
    const file = await stat(join(backupDir, entry.name))
    let verifiedAt: number | null = null
    try { verifiedAt = JSON.parse(await readFile(metadataPath(entry.name), 'utf8')).verifiedAt ?? null } catch { /* a legacy backup may not have metadata */ }
    return { fileName: entry.name, createdAt: file.mtimeMs, size: file.size, verifiedAt }
  }))
  return records.sort((a, b) => b.createdAt - a.createdAt)
}

export const validateDatabaseBackup = async (fileName: string) => {
  if (!/^[a-zA-Z0-9._-]+\.dump$/.test(fileName)) throw new Error('备份文件名无效。')
  const filePath = join(backupDir, fileName)
  await stat(filePath)
  await run('pg_restore', ['--list', filePath])
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
  const fileName = `sondara-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', `--file=${join(backupDir, fileName)}`, config.databaseUrl])
  const result = await validateDatabaseBackup(fileName)
  await pruneBackups()
  return result
}

export const createBackupWorker = () => {
  let timer: NodeJS.Timeout | undefined
  let running = false
  const runOnce = async () => {
    if (running) return
    running = true
    try { await createDatabaseBackup() } catch (error) { console.error('Automatic PostgreSQL backup failed', error) } finally { running = false }
  }
  return { start: () => { void runOnce(); timer = setInterval(() => void runOnce(), config.backupIntervalMs); timer.unref() }, stop: () => { if (timer) clearInterval(timer) } }
}
