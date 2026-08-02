import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectOversizedSources,
  countSourceLines,
  isSourcePath
} from './check-source-line-counts.mjs'

const temporaryRoots = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('source line count gate', () => {
  it('recognizes production source and excludes tests/declarations', () => {
    expect(isSourcePath('src/main/service.ts')).toBe(true)
    expect(isSourcePath('config/build.cjs')).toBe(true)
    expect(isSourcePath('config/build.js')).toBe(true)
    expect(isSourcePath('config/build.test.cjs')).toBe(false)
    expect(isSourcePath('src/main/service.test.ts')).toBe(false)
    expect(isSourcePath('src/main/service.d.ts')).toBe(false)
    expect(isSourcePath('src/main/generated/service.ts')).toBe(false)
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
})
