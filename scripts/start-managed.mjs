import { createServer } from 'node:net'
import { get } from 'node:http'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const npmCli = process.env.npm_execpath ?? require.resolve('npm/bin/npm-cli.js')
const port = Number(process.env.SONDARA_MANAGED_PORT || 4175)
const origin = `http://127.0.0.1:${port}`
const restartDelayMs = 3_000

const portAvailable = () => new Promise(resolve => {
  const server = createServer()
  server.once('error', () => resolve(false))
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
})

const healthyInstanceExists = async () => {
  return new Promise(resolve => {
    const request = get(`${origin}/api/healthz`, response => {
      response.resume()
      resolve((response.statusCode ?? 500) < 400)
    })
    request.setTimeout(2_000, () => request.destroy())
    request.once('error', () => resolve(false))
  })
}

const managedEnv = {
  ...process.env,
  NODE_ENV: 'production',
  SONDARA_API_HOST: '127.0.0.1',
  SONDARA_API_PORT: String(port),
  SONDARA_WEB_ORIGIN: origin,
  SONDARA_SECURE_COOKIES: 'false',
  SONDARA_AUTO_MIGRATE: 'true',
  SONDARA_RADAR_WORKER_ENABLED: process.env.SONDARA_RADAR_WORKER_ENABLED ?? 'true',
  SONDARA_OUTBOX_WORKER_ENABLED: process.env.SONDARA_OUTBOX_WORKER_ENABLED ?? 'true',
  SONDARA_EXTERNAL_CONNECTOR_WORKER_ENABLED: process.env.SONDARA_EXTERNAL_CONNECTOR_WORKER_ENABLED ?? 'true',
  SONDARA_SALES_GUARDIAN_ENABLED: process.env.SONDARA_SALES_GUARDIAN_ENABLED ?? 'true',
  SONDARA_BACKUP_ENABLED: process.env.SONDARA_BACKUP_ENABLED ?? 'true',
}

if (!(await portAvailable())) {
  if (await healthyInstanceExists()) {
    console.log(`Sondara 已在 ${origin} 运行，无需重复启动。`)
    process.exit(0)
  }
  throw new Error(`${port} 端口已被其他程序占用，请释放后重试。`)
}

for (const script of ['db:migrate', 'build']) {
  console.log(`正在执行 npm run ${script}…`)
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: process.cwd(),
    env: managedEnv,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

let stopping = false
let child
const stop = signal => {
  stopping = true
  child?.kill(signal)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal))

while (!stopping) {
  console.log(`Sondara 托管服务启动：http://localhost:${port}`)
  child = spawn(process.execPath, [npmCli, 'start'], {
    cwd: process.cwd(),
    env: managedEnv,
    stdio: 'inherit',
  })
  const code = await new Promise(resolve => child.once('exit', resolve))
  child = undefined
  if (stopping) break
  console.error(`Sondara 服务异常退出（代码 ${code ?? 'unknown'}），${restartDelayMs / 1000} 秒后自动恢复。`)
  await delay(restartDelayMs)
}
