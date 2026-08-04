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

describe('legacy orchestration CLI removal contract', () => {
  it('removes orchestration command specs, handlers, and tests', () => {
    for (const relativePath of [
      'src/cli/specs/orchestration.ts',
      'src/cli/specs/orchestration-worker-specs.ts',
      'src/cli/handlers/orchestration.ts',
      'src/cli/handlers/orchestration-handler-1.ts',
      'src/cli/handlers/orchestration-handler-2.ts',
      'src/cli/handlers/orchestration-handler-3.ts',
      'src/cli/handlers/orchestration-handler-4.ts',
      'src/cli/handlers/orchestration-handler-5.ts',
      'src/cli/handlers/orchestration-handler-6.ts',
      'src/cli/handlers/orchestration-handler-support.ts',
      'src/cli/handlers/orchestration.test.ts'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
    expect(readProjectFile('src/cli/handler-group-manifest.ts')).not.toContain(
      "name: 'orchestration'"
    )
    expect(readProjectFile('src/cli/specs/index.ts')).not.toContain('ORCHESTRATION_COMMAND_SPECS')
  })

  it('removes orchestration from CLI discovery and help surfaces', () => {
    expect(readProjectFile('src/cli/help-root-text.ts')).not.toContain('\nOrchestration:')
    expect(readProjectFile('src/cli/help-formatters.ts')).not.toContain('orchestration')
    expect(readProjectFile('src/cli/args.ts')).not.toMatch(/['"]orchestration['"]|orchestration /)
  })
})