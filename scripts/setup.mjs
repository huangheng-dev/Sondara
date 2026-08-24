import { createClient } from '@libsql/client'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const defaultPath = resolve('data', 'sondara.sqlite')
const nonInteractive = process.argv.includes('--non-interactive')
const checkOnly = process.argv.includes('--check-only')
const fromArgument = process.argv.find(value => value.startsWith('--database-path='))?.slice('--database-path='.length)
const prompt = nonInteractive ? null : createInterface({ input: stdin, output: stdout })

try {
  const databasePath = resolve(fromArgument || process.env.SONDARA_DATABASE_PATH || (prompt
    ? (await prompt.question(`SQLite 数据文件 [${defaultPath}]：`)).trim() || defaultPath
    : defaultPath))
  await mkdir(dirname(databasePath), { recursive: true })
  const client = createClient({ url: `file:${databasePath.replaceAll('\\', '/')}` })
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA foreign_keys = ON')
  const version = await client.execute('select sqlite_version() as version')
  client.close()

  console.log(`SQLite 已就绪：${databasePath}（${version.rows[0].version}）`)
  if (checkOnly) {
    console.log('仅检查连接，未修改 .env。')
  } else {
    const envPath = '.env'
    const current = existsSync(envPath) ? await readFile(envPath, 'utf8') : ''
    const lines = current.split(/\r?\n/).filter(Boolean)
    const nextLine = `SONDARA_DATABASE_PATH=${databasePath.replaceAll('\\', '/')}`
    const index = lines.findIndex(line => line.startsWith('SONDARA_DATABASE_PATH='))
    if (index >= 0) lines[index] = nextLine
    else lines.push(nextLine)
    await writeFile(envPath, `${lines.join('\n')}\n`, { mode: 0o600 })
    console.log('配置已写入 .env。下一步运行：npm run db:migrate')
  }
} finally {
  prompt?.close()
}
