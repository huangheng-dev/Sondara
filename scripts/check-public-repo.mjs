import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const normalize = (value) => value.split(sep).join('/').replace(/^\.\//, '')

const privatePathPatterns = [
  /^(?:data|backups|uploads|exports|private)\//i,
  /^(?:audit|output|\.audit|\.audits|\.tmp|\.workbuddy|\.workbuddy-ai|test-results|playwright-report)\//i,
  /(?:^|\/)\.env(?:\.|$)(?!example$)/i,
  /(?:^|\/)(?:cookies[^/]*\.txt|[^/]*storage-state[^/]*\.json|[^/]*-auth\.json)$/i,
  /\.(?:db|sqlite|sqlite3|pem|key|p12|pfx|crt|bak)(?:$|-)/i,
]

const ignoredDirectories = new Set([
  '.git', 'node_modules', 'dist', 'server-dist', 'coverage', 'data', 'backups',
  'uploads', 'exports', 'private', 'audit', 'output', '.audit', '.audits', '.tmp',
  '.workbuddy', '.workbuddy-ai', '.playwright-cli', '.playwright-amplify',
  'test-results', 'playwright-report',
])

const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff',
  '.woff2', '.ttf', '.eot', '.mp3', '.mp4', '.mov', '.avi', '.db', '.sqlite', '.sqlite3',
])

const contentRules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{20,}\b/],
  ['OpenAI-style API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['Bearer credential', /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i],
  ['Chinese identity number', /(?<!\d)\d{17}[\dXx](?!\d)/],
  ['Chinese mobile number', /(?<!\d)1[3-9]\d{9}(?!\d)/],
]

const allowedEmailDomain = (domain) => {
  const normalized = domain.toLowerCase()
  return normalized === 'sondara.local' || normalized.endsWith('.local') ||
    normalized.endsWith('.test') || normalized === 'example.com' ||
    normalized.endsWith('.example.com') || normalized === 'example.org' ||
    normalized.endsWith('.example.org') || normalized === 'example.net' ||
    normalized.endsWith('.example.net') || normalized === 'sentry.example'
}

const gitFiles = () => {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    return execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
      .split('\0').filter(Boolean).map(normalize)
  } catch {
    return null
  }
}

const filesystemFiles = () => {
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(normalize(relative(root, absolute)))
    }
  }
  visit(root)
  return files
}

const requiredIgnoreEntries = [
  'data/', 'backups/', 'uploads/', 'exports/', 'private/', '.env.*', 'audit/', 'output/',
  '.audit/', '.audits/', '.tmp/', '.workbuddy/', '.workbuddy-ai/', 'test-results/',
  'PROJECT_ANALYSIS.md', 'design-qa.md', 'docs/PROJECT_EXECUTION.md',
]

const findings = []
const ignoreText = readFileSync(join(root, '.gitignore'), 'utf8')
for (const entry of requiredIgnoreEntries) {
  if (!ignoreText.split(/\r?\n/).includes(entry)) findings.push(`.gitignore is missing required rule: ${entry}`)
}

const files = gitFiles() ?? filesystemFiles()
for (const path of files) {
  if (path.endsWith('.tsbuildinfo') || path.endsWith('.log')) continue
  if (privatePathPatterns.some((pattern) => pattern.test(path))) {
    findings.push(`private path would be published: ${path}`)
    continue
  }

  const absolute = join(root, path)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
  if (binaryExtensions.has(extname(path).toLowerCase()) || statSync(absolute).size > 2_000_000) continue

  let content
  try { content = readFileSync(absolute, 'utf8') } catch { continue }
  if (content.includes('\u0000')) continue

  for (const [label, pattern] of contentRules) {
    if (pattern.test(content)) findings.push(`${label} pattern found: ${path}`)
  }

  const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi
  for (const match of content.matchAll(emailPattern)) {
    if (!allowedEmailDomain(match[1])) findings.push(`non-example email address found: ${path}`)
  }

  if (path === '.env.example') {
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const match = line.match(/^([A-Z0-9_]*(?:KEY|PASSWORD|SECRET|TOKEN|DSN)[A-Z0-9_]*)=(.+)$/)
      if (match && match[2].trim()) findings.push(`credential-like value in .env.example:${index + 1}`)
    }
  }
}

if (findings.length) {
  console.error('Public repository safety gate failed:')
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Public repository safety gate passed: ${files.length} publishable files checked; private runtime paths excluded.`)
