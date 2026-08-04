import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('orchestration skill install removal contract', () => {
  it('does not expose a combined CLI-plus-orchestration install command', () => {
    expect(readProjectFile('src/shared/agent-feature-install-commands.ts')).not.toContain(
      'ORCA_CLI_ORCHESTRATION_SKILL_INSTALL_COMMAND'
    )
  })

  it('does not mark orchestration setup from generic skill discovery', () => {
    const source = readProjectFile('src/renderer/src/hooks/useInstalledAgentSkills.ts')
    expect(source).not.toContain('isOrchestrationSkillName')
    expect(source).not.toContain('markOrchestrationSetupComplete')
  })
})
