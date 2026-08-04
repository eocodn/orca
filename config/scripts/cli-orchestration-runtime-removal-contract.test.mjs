import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function projectPath(relativePath) {
  return resolve(projectRoot, relativePath)
}

function readProjectFile(relativePath) {
  return readFileSync(projectPath(relativePath), 'utf8')
}

describe('CLI orchestration runtime removal contract', () => {
  it('removes CLI-only orchestration transport modules', () => {
    for (const relativePath of [
      'src/cli/runtime/mutation-recovery.ts',
      'src/cli/runtime/orchestration-compatibility-envelope.ts',
      'src/cli/runtime/types.test.ts'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
  })

  it('keeps the CLI runtime client free of orchestration dispatch metadata', () => {
    for (const relativePath of [
      'src/cli/runtime/client.ts',
      'src/cli/runtime/transport.ts',
      'src/cli/runtime/websocket-transport.ts'
    ]) {
      const source = readProjectFile(relativePath)
      expect(source).not.toContain('orchestration')
      expect(source).not.toContain('compatibilityInvocationId')
    }
  })
})
