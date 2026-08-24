import { createClient } from '@libsql/client'
import { Client as PostgresClient } from 'pg'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const npmCli = process.env.npm_execpath ?? require.resolve('npm/bin/npm-cli.js')
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const postgresUrl = argument('postgres-url') || process.env.SONDARA_POSTGRES_IMPORT_URL || 'postgresql://sondara:sondara@127.0.0.1:5433/sondara'
const targetPath = resolve(argument('sqlite-path') || process.env.SONDARA_DATABASE_PATH || 'data/sondara.sqlite')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const temporaryPath = resolve('.tmp', `postgres-import-${timestamp}.sqlite`)
const backupPath = resolve(dirname(targetPath), `sondara-before-postgres-import-${timestamp}.sqlite`)
const fileUrl = path => `file:${path.replaceAll('\\', '/')}`
const quote = identifier => `"${identifier.replaceAll('"', '""')}"`

await mkdir(dirname(temporaryPath), { recursive: true })
await mkdir(dirname(targetPath), { recursive: true })

const migration = spawnSync(process.execPath, [npmCli, 'run', 'db:migrate'], {
  cwd: process.cwd(),
  env: { ...process.env, SONDARA_DATABASE_URL: fileUrl(temporaryPath), SONDARA_DATABASE_PATH: temporaryPath },
  stdio: 'inherit',
})
if (migration.status !== 0) process.exit(migration.status ?? 1)

const postgres = new PostgresClient({ connectionString: postgresUrl, connectionTimeoutMillis: 10_000 })
const sqlite = createClient({ url: fileUrl(temporaryPath) })
const counts = []

try {
  await postgres.connect()
  await sqlite.execute('PRAGMA foreign_keys = OFF')
  const tables = await sqlite.execute("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations' order by name")
  for (const tableRow of tables.rows) {
    const table = String(tableRow.name)
    const sourceExists = await postgres.query('select 1 from information_schema.tables where table_schema = $1 and table_name = $2', ['public', table])
    if (!sourceExists.rowCount) continue
    const tableInfo = await sqlite.execute(`PRAGMA table_info(${quote(table)})`)
    const columns = tableInfo.rows.map(row => String(row.name))
    const columnSql = columns.map(quote).join(', ')
    const source = await postgres.query(`select ${columnSql} from ${quote(table)}`)
    if (source.rows.length) {
      const placeholders = columns.map(() => '?').join(', ')
      for (let offset = 0; offset < source.rows.length; offset += 100) {
        const statements = source.rows.slice(offset, offset + 100).map(row => ({
          sql: `insert into ${quote(table)} (${columnSql}) values (${placeholders})`,
          args: columns.map(column => typeof row[column] === 'boolean' ? Number(row[column]) : row[column]),
        }))
        await sqlite.batch(statements, 'write')
      }
    }
    counts.push({ table, rows: source.rows.length })
  }
  await sqlite.execute('PRAGMA foreign_keys = ON')
  const check = await sqlite.execute('PRAGMA quick_check')
  if (check.rows[0]?.quick_check !== 'ok') throw new Error('导入后的 SQLite 完整性校验失败。')
  await sqlite.execute('PRAGMA wal_checkpoint(TRUNCATE)')
} finally {
  await postgres.end().catch(() => undefined)
  sqlite.close()
}

if (existsSync(targetPath)) await rename(targetPath, backupPath)
for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${targetPath}${suffix}`
  if (existsSync(sidecar)) {
    if (existsSync(backupPath)) await rename(sidecar, `${backupPath}${suffix}`)
    else await rm(sidecar, { force: true })
  }
}
await copyFile(temporaryPath, targetPath)
await rm(temporaryPath, { force: true }).catch(() => undefined)

console.log(`PostgreSQL 数据已复制到 SQLite：${targetPath}`)
if (existsSync(backupPath)) console.log(`切换前的本地 SQLite 已备份：${backupPath}`)
console.log(`已导入 ${counts.length} 张表，共 ${counts.reduce((sum, item) => sum + item.rows, 0)} 行；原 PostgreSQL 未修改。`)
