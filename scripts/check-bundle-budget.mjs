import { access, readFile } from 'node:fs/promises'
import { constants, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const root = process.cwd()
const distDir = resolve(root, 'dist')
const indexPath = resolve(distDir, 'index.html')

try {
  await access(indexPath, constants.R_OK)
} catch {
  throw new Error('dist/index.html not found. Run `npm run build` before the bundle budget check.')
}

const html = await readFile(indexPath, 'utf8')
const assetUrls = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((match) => match[1])
const assets = [...new Set(assetUrls)].map((url) => resolve(distDir, url.replace(/^\//, '')))

const result = assets.map((file) => {
  const raw = statSync(file).size
  const gzip = gzipSync(readFileSync(file)).length
  return { file: file.replaceAll(root, '.'), raw, gzip }
})

const initialJs = result.filter((asset) => asset.file.endsWith('.js'))
const initialCss = result.filter((asset) => asset.file.endsWith('.css'))
const sum = (items) => items.reduce((total, asset) => total + asset.gzip, 0)

const limits = {
  maxInitialJsGzipKb: 260,
  maxInitialCssGzipKb: 90,
  maxAnyAssetRawKb: 500,
  maxInitialTotalGzipKb: 420,
}

const failures = []
const initialJsKb = sum(initialJs) / 1024
const initialCssKb = sum(initialCss) / 1024
const totalKb = sum(result) / 1024
if (initialJsKb > limits.maxInitialJsGzipKb) failures.push(`initial JS ${initialJsKb.toFixed(1)} KB exceeds ${limits.maxInitialJsGzipKb} KB gzip`)
if (initialCssKb > limits.maxInitialCssGzipKb) failures.push(`initial CSS ${initialCssKb.toFixed(1)} KB exceeds ${limits.maxInitialCssGzipKb} KB gzip`)
if (totalKb > limits.maxInitialTotalGzipKb) failures.push(`initial total ${totalKb.toFixed(1)} KB exceeds ${limits.maxInitialTotalGzipKb} KB gzip`)
for (const asset of result) {
  const rawKb = asset.raw / 1024
  if (rawKb > limits.maxAnyAssetRawKb) failures.push(`${asset.file} ${rawKb.toFixed(1)} KB exceeds ${limits.maxAnyAssetRawKb} KB raw`)
}

console.table(result.map((asset) => ({
  asset: asset.file,
  rawKb: (asset.raw / 1024).toFixed(1),
  gzipKb: (asset.gzip / 1024).toFixed(1),
})))
console.log(`Initial JS: ${initialJsKb.toFixed(1)} KB gzip`)
console.log(`Initial CSS: ${initialCssKb.toFixed(1)} KB gzip`)
console.log(`Initial total: ${totalKb.toFixed(1)} KB gzip`)

if (failures.length) {
  console.error('\nBundle budget failures:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('Bundle budget passed.')
