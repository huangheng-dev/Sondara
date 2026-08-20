import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const dataDir = resolve(root, 'data')
const playwrightCli = resolve(root, 'node_modules/playwright/cli.js')
const args = process.argv.slice(2).length ? process.argv.slice(2) : ['test', '--reporter=line']

const cleanup = async () => {
  await rm(resolve(root, '.tmp/e2e-auth.json'), { force: true })
  await rm(resolve(root, '.tmp/e2e-server.pid'), { force: true })
  const files = await readdir(dataDir)
  await Promise.allSettled(
    files
      .filter((file) => /^e2e-check(?:-\d+)?\.db(?:-wal|-shm)?$/.test(file))
      .map((file) => rm(resolve(dataDir, file), { force: true })),
  )
}

const child = spawn(process.execPath, [playwrightCli, ...args], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

child.on('exit', async (code) => {
  await cleanup()
  process.exit(code ?? 0)
})
