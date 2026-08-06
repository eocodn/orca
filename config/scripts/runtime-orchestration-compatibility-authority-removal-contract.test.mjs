import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('runtime orchestration compatibility authority removal contract', () => {
  it('removes the legacy runtime authority bridge and its restored receipt state', () => {
    for (const relativePath of [
      'src/main/runtime/orca-runtime-read-headless-visible-terminal-state-part-27.ts',
      'src/main/runtime/orca-runtime-refresh-pty-worktree-records-with-controller-inventory-part-73.ts',
      'src/main/runtime/orca-runtime-on-pty-exit-part-32.ts',
      'src/main/runtime/orca-runtime-state-part-3.ts',
      'src/main/runtime/orca-runtime-context-3.ts',
      'src/main/runtime/orca-runtime-imports-agent.ts'
    ]) {
      const source = readProjectFile(relativePath)
      expect(source, relativePath).not.toContain('restoredOrchestrationAuthorityByPtyId')
      expect(source, relativePath).not.toContain('verifyOrchestrationCompatibilityCaller')
      expect(source, relativePath).not.toContain('registerOrchestrationCompatibilitySshAttachment')
      expect(source, relativePath).not.toContain('releaseOrchestrationCompatibilitySshAttachment')
      expect(source, relativePath).not.toContain('OrchestrationCompatibilityCallerAuthority')
      expect(source, relativePath).not.toContain('OrchestrationCompatibilitySshAttachmentAuthority')
    }
  })

  it('removes tests and the obsolete shared evidence module for the retired bridge', () => {
    expect(
      existsSync(
        resolve(projectRoot, 'src/main/runtime/orchestration-compatibility-authority.test.ts')
      )
    ).toBe(false)
    expect(
      existsSync(resolve(projectRoot, 'src/shared/orchestration-compatibility-evidence.ts'))
    ).toBe(false)
    expect(
      existsSync(resolve(projectRoot, 'src/shared/orchestration-compatibility-evidence.test.ts'))
    ).toBe(false)
    expect(
      existsSync(resolve(projectRoot, 'src/shared/orchestration-compatibility-environment.ts'))
    ).toBe(true)
  })

  it('keeps WSL/SSH interoperability while rejecting the retired hook bridge', () => {
    const source = readProjectFile('src/main/pty/wsl-orca-env.ts')
    for (const field of [
      'ORCA_TERMINAL_HANDLE/u',
      'ORCA_PANE_KEY/u',
      'ORCA_TAB_ID/u',
      'ORCA_WORKTREE_ID/u',
      'ORCA_ORCHESTRATION_COMPATIBILITY_HOST_KIND/u',
      'ORCA_ORCHESTRATION_COMPATIBILITY_HOST_ID/u',
      'ORCA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION/u'
    ]) {
      expect(source, field).toContain(field)
    }
    for (const field of [
      'ORCA_AGENT_HOOK_PORT/u',
      'ORCA_AGENT_HOOK_TOKEN/u',
      'ORCA_AGENT_HOOK_ENV/u',
      'ORCA_AGENT_HOOK_VERSION/u',
      'ORCA_AGENT_HOOK_ENDPOINT'
    ]) {
      expect(source, field).not.toContain(field)
    }
    expect(source).toContain('stampWslOrchestrationCompatibilityHost')
  })

  it('keeps agent-hook authority ownership independent of the retired bridge', () => {
    expect(readProjectFile('src/main/agent-hooks/agent-hook-server-base.ts')).toContain(
      'attestCompatibilityAuthority'
    )
    expect(readProjectFile('src/main/agent-hooks/agent-hook-server-authority.ts')).toContain(
      'retirePaneAuthority'
    )
  })
})
