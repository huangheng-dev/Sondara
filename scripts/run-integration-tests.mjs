import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const npmCli = process.env.npm_execpath ?? require.resolve('npm/bin/npm-cli.js')

const tests = [
  'ai-client',
  'attribution',
  'auth-2fa',
  'campaigns',
  'closed-loop',
  'contact-enrichment',
  'content-assets',
  'icp',
  'inbox',
  'industry-source',
  'map-connector',
  'outbox',
  'partial-updates',
  'search-connector',
]

let index = 0

const runNext = () => {
  if (index >= tests.length) {
    console.log(`\n${tests.length}/${tests.length} integration test suites passed.`)
    process.exit(0)
  }

  const name = tests[index]
  console.log(`\n=== test:${name} ===`)
  const child = spawn(process.execPath, [npmCli, 'run', `test:${name}`], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })

  child.on('exit', (code) => {
    if (code !== 0) process.exit(code ?? 1)
    index += 1
    runNext()
  })
}

runNext()
