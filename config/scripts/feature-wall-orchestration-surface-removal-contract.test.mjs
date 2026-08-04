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

describe('feature-wall orchestration surface removal contract', () => {
  it('removes the orchestration workflow and step definitions', () => {
    expect(readProjectFile('src/shared/feature-wall-workflows.ts')).not.toContain(
      'agents-orchestration'
    )
    expect(existsSync(projectPath('src/shared/agents-orchestration-steps.ts'))).toBe(false)
  })

  it('removes the orchestration visual entry points', () => {
    expect(existsSync(projectPath('src/renderer/src/components/feature-wall/AgentsOrchestrationVisual.tsx'))).toBe(false)
    expect(existsSync(projectPath('src/renderer/src/components/feature-wall/agents-orchestration'))).toBe(false)
  })

  it('removes orchestration selection from the feature-wall shell', () => {
    for (const path of [
      'src/renderer/src/components/feature-wall/FeatureWallTourSurface.tsx',
      'src/renderer/src/components/feature-wall/FeatureWallTourPanel.tsx',
      'src/renderer/src/components/feature-wall/FeatureWallRail.tsx',
      'src/renderer/src/components/feature-wall/FeatureWallBody.tsx',
      'src/renderer/src/components/feature-wall/feature-wall-active-step-copy.ts'
    ]) {
      expect(readProjectFile(path)).not.toContain('agents-orchestration')
    }
  })

  it('removes agent substep completion and depth state from the retained tour', () => {
    for (const path of [
      'src/renderer/src/components/feature-wall/feature-wall-completion-progress.ts',
      'src/renderer/src/components/feature-wall/use-feature-wall-completion.ts',
      'src/renderer/src/components/feature-wall/use-feature-wall-session-depth.ts',
      'src/shared/feature-wall-tour-depth.ts'
    ]) {
      expect(readProjectFile(path)).not.toContain('AgentsStepId')
      expect(readProjectFile(path)).not.toContain('agentStepDone')
    }
  })
})
