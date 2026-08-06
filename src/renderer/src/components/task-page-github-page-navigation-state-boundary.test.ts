import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage GitHub page navigation boundary', () => {
  it('keeps count fallback, page fetch fencing, and loading cleanup in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-github-page-navigation-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(170)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-github-page-navigation-state'")
    expect(SURFACE_SOURCE).not.toContain('taskPageToGitHubApiPage(target)')
    expect(moduleSource).toContain('taskPageToGitHubApiPage(target)')
    expect(moduleSource).toContain('paginationGenerationRef.current')
    expect(moduleSource).toContain('setLoadingTargetPage(null)')
  })
})
