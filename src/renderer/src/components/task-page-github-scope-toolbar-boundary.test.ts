import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage GitHub scope toolbar boundary', () => {
  it('keeps GitHub mode, project scope, and external-link controls bounded', () => {
    const TOOLBAR_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-github-scope-toolbar.tsx'),
      'utf8'
    )

    expect(TOOLBAR_SOURCE.split('\n').length).toBeLessThan(260)
    expect(SURFACE_SOURCE).toContain("from './task-page-github-scope-toolbar'")
    expect(SURFACE_SOURCE).not.toContain('githubModeButtons.map((mode) =>')
    expect(TOOLBAR_SOURCE).toContain('export function TaskPageGitHubScopeToolbar')
    expect(TOOLBAR_SOURCE).toContain('onModeChange')
  })
})
