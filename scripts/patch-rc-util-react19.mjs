import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const patches = [
  ...['../node_modules/@rc-component/util/es/ref.js', '../node_modules/@rc-component/util/lib/ref.js'].map(relativePath => ({
    relativePath,
    original: "return ele.props.propertyIsEnumerable('ref') ? ele.props.ref : ele.ref;",
    replacement: "return ReactMajorVersion >= 19 ? ele.props.ref ?? null : ele.props.propertyIsEnumerable('ref') ? ele.props.ref : ele.ref;",
  })),
  ...['../node_modules/@rc-component/select/es/SelectInput/Input.js', '../node_modules/@rc-component/select/lib/SelectInput/Input.js'].map(relativePath => ({
    relativePath,
    original: 'InputComponent.ref, sharedInputProps.ref',
    replacement: 'InputComponent.props.ref, sharedInputProps.ref',
  })),
  ...['../node_modules/@rc-component/select/es/SelectInput/index.js', '../node_modules/@rc-component/select/lib/SelectInput/index.js'].map(relativePath => ({
    relativePath,
    original: 'RootComponent.ref, rootRef',
    replacement: 'RootComponent.props.ref, rootRef',
  })),
]

let patched = 0
for (const { relativePath, original, replacement } of patches) {
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url))
  const source = readFileSync(filePath, 'utf8')
  if (source.includes(replacement)) continue
  if (!source.includes(original)) {
    console.warn(`[react19-ref-patch] 未识别 ${relativePath}，可能已由上游修复。`)
    continue
  }
  writeFileSync(filePath, source.replace(original, replacement))
  patched += 1
}

console.log(`[react19-ref-patch] 已更新 ${patched} 个文件。`)
