import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererRoot = resolve(import.meta.dirname, '..')
const boundaryFiles = [
  'web/web-preload-repository-apis.ts',
  'store/slices/worktrees-state-create-worktree-actions.ts',
  'store/slices/worktree-helpers.ts',
  'store/slices/ui-state-hydrate-persisted-ui-actions.ts',
  'store/slices/ui-state-cancel-contextual-tour-actions.ts',
  'lib/startup-ui-hydration.ts'
]

function readBoundarySources(): string[] {
  return boundaryFiles.map((fileName) => readFileSync(resolve(rendererRoot, fileName), 'utf8'))
}

describe('renderer automation removal boundaries', () => {
  it('does not expose automation provenance requests or hide-automation UI state', () => {
    for (const source of readBoundarySources()) {
      expect(source).not.toContain('automationProvenanceRequest')
      expect(source).not.toContain('hideAutomationGeneratedWorkspaces')
      expect(source).not.toContain('setHideAutomationGeneratedWorkspaces')
    }
  })

  it('retains the generic create boundary and CLI provenance hydration', () => {
    const sources = readBoundarySources().join('\n')

    expect(sources).toContain('createdWithAgent')
    expect(sources).toContain('createWorktree')
    expect(sources).toContain('hideCliCreatedWorkspaces')
  })
})
