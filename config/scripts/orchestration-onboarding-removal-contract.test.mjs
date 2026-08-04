import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('orchestration onboarding removal contract', () => {
  it('removes orchestration from onboarding feature setup state and side effects', () => {
    const source = readProjectFile('src/renderer/src/components/onboarding/onboarding-feature-setup.ts')
    expect(source).not.toContain('orchestration')
    expect(source).not.toContain('ORCHESTRATION_')
    expect(source).not.toContain('ORCHESTRATION_SKILL_NAME')
  })

  it('removes orchestration from the onboarding checklist', () => {
    const source = readProjectFile('src/renderer/src/components/onboarding/FeatureSetupChecklist.tsx')
    expect(source).not.toContain('orchestration')
    expect(source).not.toContain('Workflow')
  })

  it('removes orchestration from capability readiness and setup action', () => {
    const statusSource = readProjectFile(
      'src/renderer/src/components/feature-wall/agent-capability-setup-status.ts'
    )
    const actionSource = readProjectFile(
      'src/renderer/src/components/feature-wall/AgentCapabilitiesSetupAction.tsx'
    )
    expect(statusSource).not.toContain('orchestration')
    expect(statusSource).not.toContain('ORCHESTRATION_SKILL_NAME')
    expect(actionSource).not.toContain('orchestration')
    expect(actionSource).not.toContain('Workflow')
  })
})
