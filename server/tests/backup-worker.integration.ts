import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'

const writeProgram = (file: string, body: string) => writeFile(file, body, 'utf8')

const run = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sondara-backup-'))
  const bin = join(root, 'bin')
  const backupDir = join(root, 'backups')
  await Promise.all([
    import('node:fs/promises').then(fs => fs.mkdir(bin, { recursive: true })),
    import('node:fs/promises').then(fs => fs.mkdir(backupDir, { recursive: true })),
  ])

  const pgDumpSource = join(root, 'pg_dump.cs')
  const pgRestoreSource = join(root, 'pg_restore.cs')
  await writeProgram(pgDumpSource, `using System; using System.IO; class PgDump { static int Main(string[] args) { string file = null; foreach (string arg in args) { if (arg.StartsWith("--file=")) file = arg.Substring(7); } if (file == null) return 2; Directory.CreateDirectory(Path.GetDirectoryName(file)); File.WriteAllText(file, "PGDMP fake custom backup"); return 0; } }`)
  await writeProgram(pgRestoreSource, `class PgRestore { static int Main(string[] args) { return 0; } }`)
  const compileDump = spawnSync(csc, ['/nologo', '/target:exe', `/out:${join(bin, 'pg_dump.exe')}`, pgDumpSource], { encoding: 'utf8' })
  assert.equal(compileDump.status, 0, compileDump.stderr || compileDump.stdout)
  const compileRestore = spawnSync(csc, ['/nologo', '/target:exe', `/out:${join(bin, 'pg_restore.exe')}`, pgRestoreSource], { encoding: 'utf8' })
  assert.equal(compileRestore.status, 0, compileRestore.stderr || compileRestore.stdout)

  process.env.PATH = `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`
  process.env.SONDARA_BACKUP_DIRECTORY = backupDir
  process.env.SONDARA_BACKUP_RETENTION_COUNT = '2'

  const backupWorker = await import('../operations/backup-worker.js')
  const { createDatabaseBackup, listDatabaseBackups, validateDatabaseBackup, createBackupWorker } = backupWorker as typeof import('../operations/backup-worker.js')

  const oldOne = join(backupDir, 'sondara-auto-oldest.dump')
  const oldTwo = join(backupDir, 'sondara-auto-newer.dump')
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
  assert.match(created.fileName, /^sondara-auto-.*\.dump$/)
  assert.ok(created.verifiedAt)
  const createdPath = resolve(backupDir, created.fileName)
  assert.equal(await readFile(createdPath, 'utf8'), 'PGDMP fake custom backup')
  const metadata = JSON.parse(await readFile(`${createdPath}.json`, 'utf8'))
  assert.equal(metadata.verifiedAt, created.verifiedAt)

  const after = await listDatabaseBackups()
  assert.equal(after.length, 2)
  assert.ok(after.some(item => item.fileName === created.fileName))
  assert.ok(after.some(item => item.fileName === 'sondara-auto-newer.dump'))
  assert.ok(!after.some(item => item.fileName === 'sondara-auto-oldest.dump'))
  assert.deepEqual(after.map(item => item.verifiedAt).sort((a, b) => (a ?? 0) - (b ?? 0)), [20, created.verifiedAt])

  const invalid = await assert.rejects(() => validateDatabaseBackup('../escape.dump'), /备份文件名无效/)
  void invalid

  const worker = createBackupWorker()
  worker.start()
  await new Promise(resolveTimeout => setTimeout(resolveTimeout, 500))
  worker.stop()
  const afterWorker = (await readdir(backupDir)).filter(name => name.endsWith('.dump')).length
  assert.ok(afterWorker <= 2, `expected at most 2 backups after worker run, got ${afterWorker}`)

  console.log('Backup worker integration passed: fake pg_dump/pg_restore, backup validation, metadata, retention pruning and worker lifecycle verified.')
  await rm(root, { recursive: true, force: true })
}

run().then(
  () => process.exit(0),
  async error => {
    console.error(error)
    process.exit(1)
  },
)




