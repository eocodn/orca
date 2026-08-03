import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'out'
])

export function isSourcePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/')
  const basename = path.posix.basename(normalized)
  const extension = path.posix.extname(normalized)
  if (
    !SOURCE_EXTENSIONS.has(extension) ||
    /\.d\.(?:cts|mts|ts)$/.test(basename)
  ) {
    return false
  }
  if (/(?:^|\.)(?:test|spec)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(basename)) {
    return false
  }
  return !normalized.split('/').some((part) => EXCLUDED_DIRECTORY_NAMES.has(part))
}

export function countSourceLines(sourceText) {
  if (sourceText.length === 0) {
    return 0
  }
  return sourceText.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length
}

function collectSourcePaths(root, current = root) {
  const entries = fs.readdirSync(current, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
      continue
    }
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      paths.push(...collectSourcePaths(root, absolutePath))
      continue
    }
    const relativePath = path.relative(root, absolutePath)
    if (isSourcePath(relativePath)) {
      paths.push(relativePath.split(path.sep).join('/'))
    }
  }
  return paths
}

export function collectOversizedSources(root = process.cwd(), { limit = 600 } = {}) {
  return collectSourcePaths(root)
    .sort()
    .map((relativePath) => ({
      lines: countSourceLines(fs.readFileSync(path.join(root, relativePath), 'utf8')),
      path: relativePath
    }))
    .filter((entry) => entry.lines > limit)
}

export function main(root = process.cwd(), options = {}) {
  const entries = collectOversizedSources(root, options)
  if (options.json) {
    console.log(JSON.stringify(entries))
  } else if (entries.length > 0) {
    for (const entry of entries) {
      console.error(`${entry.lines}\t${entry.path}`)
    }
  } else {
    console.log(`source line count OK — no production source exceeds ${options.limit ?? 600} lines`)
  }
  return entries.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const limitIndex = args.indexOf('--limit')
  const limit = limitIndex === -1 ? 600 : Number(args[limitIndex + 1])
  if (!Number.isInteger(limit) || limit < 1) {
    console.error('Usage: node config/scripts/check-source-line-counts.mjs [--json] [--limit N]')
    process.exit(2)
  }
  process.exit(main(process.cwd(), { json, limit }))
}
