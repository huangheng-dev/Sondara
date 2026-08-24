import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const npmCli = process.env.npm_execpath ?? require.resolve('npm/bin/npm-cli.js')
const portAvailable = port => new Promise(resolve => {
  const server = createServer()
  server.once('error', () => resolve(false))
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
})

let apiPort = Number(process.env.SONDARA_API_PORT || 4176)
while (!(await portAvailable(apiPort)) && apiPort < 4190) apiPort += 1
if (apiPort >= 4190) throw new Error('4176–4189 端口均被占用，无法启动本地 API。')

const env = { ...process.env, SONDARA_API_PORT: String(apiPort) }
const migration = spawnSync(process.execPath, [npmCli, 'run', 'db:migrate'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
})
if (migration.status !== 0) process.exit(migration.status ?? 1)

console.log(`本地前端：http://localhost:4175`)
console.log(`本地 API：http://127.0.0.1:${apiPort}`)
if (apiPort !== 4176) console.log(`提示：4176 已被占用，本次已自动改用 ${apiPort}。`)

const child = spawn(process.execPath, [npmCli, 'run', 'dev:all'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code ?? 0))
