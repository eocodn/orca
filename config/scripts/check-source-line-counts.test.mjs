import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectOversizedSources,
  countSourceLines,
  isSourcePath
} from './check-source-line-counts.mjs'

const temporaryRoots = []
const repositoryRoot = join(import.meta.dirname, '../..')

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('source line count gate', () => {
  it('recognizes production source and excludes tests/declarations', () => {
    expect(isSourcePath('src/main/service.ts')).toBe(true)
    expect(isSourcePath('src/main/component.jsx')).toBe(true)
    expect(isSourcePath('src/main/module.mts')).toBe(true)
    expect(isSourcePath('src/main/module.cts')).toBe(true)
    expect(isSourcePath('config/build.cjs')).toBe(true)
    expect(isSourcePath('config/build.js')).toBe(true)
    expect(isSourcePath('config/build.test.cjs')).toBe(false)
    expect(isSourcePath('src/test.ts')).toBe(false)
    expect(isSourcePath('src/spec.ts')).toBe(false)
    expect(isSourcePath('src/main/service.test.jsx')).toBe(false)
    expect(isSourcePath('src/main/service.spec.mts')).toBe(false)
    expect(isSourcePath('src/main/service.spec.cts')).toBe(false)
    expect(isSourcePath('src/main/service.test.ts')).toBe(false)
    expect(isSourcePath('src/main/service.d.ts')).toBe(false)
    expect(isSourcePath('src/main/service.d.mts')).toBe(false)
    expect(isSourcePath('src/main/service.d.cts')).toBe(false)
    expect(isSourcePath('src/main/generated/service.ts')).toBe(false)
  })

  it('excludes source files below test directories without excluding production neighbors', () => {
    expect(isSourcePath('test/fixtures/large.ts')).toBe(false)
    expect(isSourcePath('tests/fixtures/large.ts')).toBe(false)
    expect(isSourcePath('src/main/__tests__/large.ts')).toBe(false)
    expect(isSourcePath('src/main/testing/large.ts')).toBe(true)
  })

  it('excludes generated source files by filename', () => {
    expect(isSourcePath('src/main/service.generated.ts')).toBe(false)
    expect(isSourcePath('src/main/service.generated.tsx')).toBe(false)
    expect(isSourcePath('src/main/generated-service.ts')).toBe(true)
  })

  it('counts physical lines without treating a trailing newline as an extra line', () => {
    expect(countSourceLines('one\ntwo\n')).toBe(2)
    expect(countSourceLines('one\ntwo')).toBe(2)
  })

  it('reports every oversized source in stable path order', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-source-lines-'))
    temporaryRoots.push(root)
    writeFileSync(join(root, 'large.ts'), '1\n2\n3\n4\n')
    writeFileSync(join(root, 'large.cjs'), '1\n2\n3\n4\n')
    writeFileSync(join(root, 'small.ts'), '1\n2\n')
    writeFileSync(join(root, 'ignored.test.ts'), '1\n2\n3\n4\n')

    expect(collectOversizedSources(root, { limit: 3 })).toEqual([
      { lines: 4, path: 'large.cjs' },
      { lines: 4, path: 'large.ts' }
    ])
  })

  it('scans runtime files and enforces a strict greater-than limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-source-lines-'))
    temporaryRoots.push(root)
    writeFileSync(join(root, 'exact.jsx'), `${'line\n'.repeat(600)}`)
    writeFileSync(join(root, 'oversized.mts'), `${'line\n'.repeat(601)}`)
    writeFileSync(join(root, 'oversized.cts'), `${'line\n'.repeat(601)}`)

    expect(collectOversizedSources(root)).toEqual([
      { lines: 601, path: 'oversized.cts' },
      { lines: 601, path: 'oversized.mts' }
    ])
  })

  it('keeps the renderer delivery initializer within the production budget', () => {
    expect(collectOversizedSources(repositoryRoot)).not.toContainEqual(
      expect.objectContaining({
        path: 'src/main/ipc/pty-ipc-runtime-renderer-delivery-core.ts'
      })
    )
  })

  it('is part of both local lint and PR static analysis', () => {
    const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
    const workflow = readFileSync(join(repositoryRoot, '.github/workflows/pr.yml'), 'utf8')

    expect(packageJson.scripts.lint).toContain('pnpm run check:source-lines')
    expect(workflow).toContain('run: pnpm run check:source-lines')
  })
})
