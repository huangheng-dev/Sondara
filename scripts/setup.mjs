import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { Client } from 'pg'

const defaultUrl = 'postgresql://sondara:sondara@127.0.0.1:5432/sondara'
const nonInteractive = process.argv.includes('--non-interactive')
const checkOnly = process.argv.includes('--check-only')
const fromArgument = process.argv.find(value => value.startsWith('--database-url='))?.slice('--database-url='.length)
const prompt = nonInteractive ? null : createInterface({ input: stdin, output: stdout })

try {
  const databaseUrl = fromArgument || process.env.SONDARA_DATABASE_URL || (prompt
    ? (await prompt.question(`PostgreSQL 连接地址 [${defaultUrl}]：`)).trim() || defaultUrl
    : defaultUrl)
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error('连接地址必须以 postgres:// 或 postgresql:// 开头。')

  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 })
  await client.connect()
  const version = await client.query('select current_database() as database, current_setting(\'server_version\') as version')
  await client.end()

  console.log(`PostgreSQL 连接成功：${version.rows[0].database}（${version.rows[0].version}）`)
  if (checkOnly) {
    console.log('仅检查连接，未修改 .env。')
  } else {
    const envPath = '.env'
    const current = existsSync(envPath) ? await readFile(envPath, 'utf8') : ''
    const lines = current.split(/\r?\n/).filter(Boolean)
    const nextLine = `SONDARA_DATABASE_URL=${databaseUrl}`
    const index = lines.findIndex(line => line.startsWith('SONDARA_DATABASE_URL='))
    if (index >= 0) lines[index] = nextLine
    else lines.push(nextLine)
    await writeFile(envPath, `${lines.join('\n')}\n`, { mode: 0o600 })
    console.log('配置已写入 .env。下一步运行：npm run db:migrate')
  }
} finally {
  prompt?.close()
}
