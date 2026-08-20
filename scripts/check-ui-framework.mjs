import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const forbidden = [
  ['button', /<button\b/g],
  ['input', /<input\b/g],
  ['textarea', /<textarea\b/g],
  ['select', /<select\b/g],
  ['table', /<table\b/g],
  ['form', /<form\b/g],
]

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collect(path) : [path]
  }))).flat()
}

const violations = []
for (const file of (await collect('src')).filter((path) => path.endsWith('.tsx'))) {
  const source = await readFile(file, 'utf8')
  for (const [element, pattern] of forbidden) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length
      violations.push(`${file}:${line} uses native <${element}>`)
    }
  }
}

if (violations.length) {
  process.stderr.write(`Ant Design source gate failed:\n${violations.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write('Ant Design source gate passed: no native business controls or tables.\n')
