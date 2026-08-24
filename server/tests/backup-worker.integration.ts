import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const run = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sondara-backup-'))
  const backupDir = join(root, 'backups')
  await mkdir(backupDir, { recursive: true })
  process.env.SONDARA_BACKUP_DIRECTORY = backupDir
  process.env.SONDARA_BACKUP_RETENTION_COUNT = '2'

  const backupWorker = await import('../operations/backup-worker.js')
  const { createDatabaseBackup, listDatabaseBackups, validateDatabaseBackup, createBackupWorker } = backupWorker

  const oldOne = join(backupDir, 'sondara-auto-oldest.sqlite')
  const oldTwo = join(backupDir, 'sondara-auto-newer.sqlite')
  await writeFile(oldOne, 'old-one')
  await writeFile(oldTwo, 'old-two')
  await writeFile(`${oldOne}.json`, JSON.stringify({ verifiedAt: 10 }))
  await writeFile(`${oldTwo}.json`, JSON.stringify({ verifiedAt: 20 }))
  const oldTime = new Date('2025-01-01T00:00:00.000Z')
  const newerTime = new Date('2025-02-01T00:00:00.000Z')
  await utimes(oldOne, oldTime, oldTime)
  await utimes(oldTwo, newerTime, newerTime)

  const before = await listDatabaseBackups()
  assert.equal(before.length, 2)

  const created = await createDatabaseBackup()
  assert.match(created.fileName, /^sondara-auto-.*\.sqlite$/)
  assert.ok(created.verifiedAt)
  const createdPath = resolve(backupDir, created.fileName)
  assert.ok((await stat(createdPath)).size > 0)
  const metadata = JSON.parse(await readFile(`${createdPath}.json`, 'utf8'))
  assert.equal(metadata.verifiedAt, created.verifiedAt)
  await validateDatabaseBackup(created.fileName)

  const after = await listDatabaseBackups()
  assert.equal(after.length, 2)
  assert.ok(after.some(item => item.fileName === created.fileName))
  assert.ok(after.some(item => item.fileName === 'sondara-auto-newer.sqlite'))
  assert.ok(!after.some(item => item.fileName === 'sondara-auto-oldest.sqlite'))

  await assert.rejects(() => validateDatabaseBackup('../escape.sqlite'), /备份文件名无效/)

  const worker = createBackupWorker()
  worker.start()
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, 500))
  await worker.stop()
  const afterWorker = (await readdir(backupDir)).filter(name => name.endsWith('.sqlite')).length
  assert.ok(afterWorker <= 2, `expected at most 2 backups after worker run, got ${afterWorker}`)

  console.log('Backup worker integration passed: SQLite snapshot, integrity validation, metadata, retention pruning and worker lifecycle verified.')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      break
    } catch (error) {
      if (attempt === 19 || !(error instanceof Error) || !error.message.includes('EBUSY')) throw error
      await new Promise(resolveTimeout => setTimeout(resolveTimeout, 100))
    }
  }
}

run().then(
  () => process.exit(0),
  error => {
    console.error(error)
    process.exit(1)
  },
)
