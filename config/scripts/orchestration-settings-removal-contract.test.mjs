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

describe('orchestration settings removal contract', () => {
  it('removes orchestration settings components and helpers', () => {
    for (const relativePath of [
      'src/renderer/src/components/settings/OrchestrationPane.tsx',
      'src/renderer/src/components/settings/OrchestrationSetupCard.tsx',
      'src/renderer/src/components/settings/OrchestrationSkillAgentCoverage.tsx',
      'src/renderer/src/components/settings/OrchestrationSkillPromptDialog.tsx',
      'src/renderer/src/components/settings/orchestration-search.ts',
      'src/renderer/src/components/floating-terminal/FloatingTerminalOrchestrationDialog.tsx',
      'src/renderer/src/lib/orchestration-install-command.ts',
      'src/renderer/src/lib/orchestration-skill-coverage.ts',
      'src/renderer/src/lib/orchestration-usage-examples.ts'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
  })

  it('removes orchestration from settings navigation and page assembly', () => {
    expect(readProjectFile('src/renderer/src/components/settings/settings-page-primary-sections.tsx')).not.toContain(
      'OrchestrationPane'
    )
    expect(readProjectFile('src/renderer/src/hooks/settings-navigation-metadata-builder.ts')).not.toContain(
      "id: 'orchestration'"
    )
    expect(readProjectFile('src/renderer/src/lib/settings-navigation-types.ts')).not.toContain(
      "'orchestration'"
    )
    expect(readProjectFile('src/renderer/src/components/settings/settings-page-navigation-state.ts')).not.toContain(
      'ORCHESTRATION_SKILL_NAME'
    )
    expect(readProjectFile('src/renderer/src/components/settings/settings-page-runtime-state.ts')).not.toContain(
      'ORCHESTRATION_SKILL_NAME'
    )
  })
})
