import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('SSH orchestration removal contract', () => {
  it('does not route orchestration commands through the remote CLI shim', () => {
    const source = readProjectFile('src/main/ssh/ssh-remote-orca-cli.ts')
    expect(source).not.toContain('orchestration')
    expect(source).not.toContain('RuntimeOrchestrationEnvelope')
    expect(source).not.toContain('OrchestrationCompatibility')
  })

  it('does not expose orchestration post-output acknowledgement', () => {
    const source = readProjectFile(
      'src/main/ssh/ssh-relay-session-lifecycle-wire-up-remote-orca-cli-wire-up-remote-workspace-events.ts'
    )
    expect(source).not.toContain('orca.cli.postOutput')
    expect(source).not.toContain('registerOrchestrationCompatibilitySshAttachment')
    expect(source).not.toContain('releaseOrchestrationCompatibilitySshAttachment')
  })

  it('removes orchestration-only SSH bridge modules', () => {
    for (const relativePath of [
      'src/main/ssh/ssh-remote-orchestration-ask-output.ts',
      'src/main/ssh/ssh-remote-orchestration-check-output.ts',
      'src/main/ssh/ssh-remote-orchestration-compatibility.test.ts',
      'src/main/ssh/ssh-remote-orchestration-post-output.ts',
      'src/main/ssh/ssh-remote-orchestration-send.test.ts',
      'src/main/ssh/ssh-remote-orchestration-send.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('keeps in-process SSH results as ordinary RPC responses', () => {
    const source = readProjectFile('src/main/ssh/ssh-remote-cli-in-process-result.ts')
    expect(source).not.toContain('orchestration')
    expect(source).not.toContain('postOutput')
  })
})
