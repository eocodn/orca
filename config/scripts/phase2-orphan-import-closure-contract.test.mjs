import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')

// Scan only test/config surfaces where retired Phase 2 imports were observed.
// Production/runtime paths are intentionally out of scope.
const closureEntries = [join(repositoryRoot, 'tests/e2e'), join(repositoryRoot, 'config/scripts')]

function isScopedSource(filePath) {
  return closureEntries.some((rootPath) => {
    const pathFromRoot = relative(rootPath, filePath)
    return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !pathFromRoot.includes(':'))
  })
}

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])

function isClosureEntry(filePath) {
  const normalized = relative(repositoryRoot, filePath).replaceAll('\\', '/')
  if (normalized.startsWith('tests/e2e/')) {
    return normalized.endsWith('.unit.test.ts') || /orchestration-run-/.test(normalized)
  }
  return (
    normalized.startsWith('config/scripts/') &&
    (/orchestration/.test(normalized) || /phase2/.test(normalized)) &&
    normalized.endsWith('.mjs')
  )
}

function collectEntries(rootPath) {
  if (!existsSync(rootPath)) return []
  const entries = readdirSync(rootPath, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = join(rootPath, entry.name)
    if (entry.isDirectory()) return collectEntries(path)
    return isClosureEntry(path) ? [path] : []
  })
}

function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(importer), specifier)
  const candidates = [base]
  if (!extname(base)) {
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`)
    for (const extension of sourceExtensions) candidates.push(join(base, `index${extension}`))
    candidates.push(`${base}.json`)
  }
  return candidates.find(isRegularFile) ?? base
}

function isRegularFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function importsFrom(source) {
  const imports = []
  const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImportPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const pattern of [importPattern, dynamicImportPattern, requirePattern]) {
    for (const match of source.matchAll(pattern)) imports.push(match[1])
  }
  return imports
}

function findMissingImports(entries) {
  const visited = new Set()
  const missing = new Set()
  const queue = [...entries]

  while (queue.length > 0) {
    const importer = queue.pop()
    if (visited.has(importer) || !sourceExtensions.has(extname(importer))) continue
    visited.add(importer)
    const source = readFileSync(importer, 'utf8')
    for (const specifier of importsFrom(source)) {
      const target = resolveRelativeImport(importer, specifier)
      if (!target) continue
      if (!isRegularFile(target)) {
        missing.add(`${relative(repositoryRoot, importer)} -> ${specifier}`)
      } else if (isScopedSource(target) && !visited.has(target)) {
        queue.push(target)
      }
    }
  }

  return [...missing].sort()
}

describe('Phase 2 orphan import closure', () => {
  it('resolves every relative import in retired-surface test/config closures', () => {
    const entries = closureEntries.flatMap(collectEntries)
    const missing = findMissingImports(entries)
    expect(missing, `Missing relative imports:\n${missing.join('\n')}`).toEqual([])
  })

  it('does not treat a directory without an index module as resolved', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'phase2-orphan-import-'))
    try {
      const importer = join(fixtureRoot, 'entry.ts')
      mkdirSync(join(fixtureRoot, 'missing-module'))
      const missingSpecifier = './missing-module'
      writeFileSync(importer, `${['import', JSON.stringify(missingSpecifier)].join(' ')}\n`, 'utf8')

      const missing = findMissingImports([importer])
      expect(missing).toHaveLength(1)
      expect(missing[0]).toContain(` -> ${missingSpecifier}`)
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
