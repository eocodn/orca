import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('runtime orchestration storage removal contract', () => {
  it('does not initialize orchestration storage or recovery during startup', () => {
    for (const relativePath of [
      'src/main/main-process-ready-foundation.ts',
      'src/main/main-process-process-configuration.ts',
      'src/main/main-process-ready-window-serve-lifecycle.ts'
    ]) {
      const source = readProjectFile(relativePath)
      expect(source).not.toContain('prepareLegacyWorkerTerminalRecovery')
      expect(source).not.toContain('reconcileLegacyWorkerTerminals')
      expect(source).not.toContain('refreshRestoredOrchestrationAuthority')
      expect(source).not.toContain('orchestrationEnvironmentTransport')
    }
  })

  it('keeps the runtime state and local-provider boundary free of orchestration storage', () => {
    for (const relativePath of [
      'src/main/runtime/orca-runtime-state-part-1.ts',
      'src/main/runtime/orca-runtime-get-local-provider-part-1.ts',
      'src/main/runtime/orca-runtime-imports-agent.ts'
    ]) {
      const source = readProjectFile(relativePath)
      expect(source).not.toContain('OrchestrationDb')
      expect(source).not.toContain('LegacyWorkerTerminalRecovery')
      expect(source).not.toContain('orchestrationEnvironmentTransport')
    }
  })

  it('does not derive worktree lineage or agent rows from orchestration tasks', () => {
    for (const relativePath of [
      'src/main/runtime/orca-runtime-resolve-workspace-parent-selector-part-70.ts',
      'src/main/runtime/orca-runtime-get-agent-status-orchestration-context-for-handle-part-78.ts',
      'src/main/runtime/orca-runtime-build-pty-mobile-agent-status-part-77.ts'
    ]) {
      const source = readProjectFile(relativePath)
      expect(source).not.toContain('OrchestrationDb')
      expect(source).not.toContain('orchestrationContext')
      expect(source).not.toContain('getOrchestrationDb')
      expect(source).not.toContain('taskId')
      expect(source).not.toContain('orchestrationRunId')
    }
  })

  it('accepts only explicit, environment, cwd, and terminal lineage context', () => {
    for (const relativePath of [
      'src/main/runtime/orca-runtime-context-3.ts',
      'src/main/runtime/rpc/methods/worktree-schemas.ts',
      'src/main/runtime/rpc/methods/worktree.ts',
      'src/shared/types-worktree.ts'
    ]) {
      expect(readProjectFile(relativePath)).not.toContain('orchestrationContext')
    }
  })
})
