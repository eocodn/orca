import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage GitHub task toolbar boundary', () => {
  it('keeps GitHub presets, filters, search, and actions bounded', () => {
    const TOOLBAR_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-github-task-toolbar.tsx'),
      'utf8'
    )

    expect(TOOLBAR_SOURCE.split('\n').length).toBeLessThan(330)
    expect(SURFACE_SOURCE).toContain("from './task-page-github-task-toolbar'")
    expect(SURFACE_SOURCE).not.toContain('getGitHubTaskKindPresets(activeGithubTaskKind).map')
    expect(TOOLBAR_SOURCE).toContain('export function TaskPageGitHubTaskToolbar')
    expect(TOOLBAR_SOURCE).toContain('onSearchKeyDown')
  })
})
