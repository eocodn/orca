import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear project list data boundary', () => {
  it('keeps project cache reads, refresh state, and cancellation in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-project-list-data-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(140)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-project-list-data-state'")
    expect(SURFACE_SOURCE).not.toContain('listLinearProjectsFromStore(')
    expect(moduleSource).toContain('getCachedLinearProjects(')
    expect(moduleSource).toContain('listLinearProjectsFromStore(')
    expect(moduleSource).toContain('setLinearProjectsResult(result)')
    expect(moduleSource).toContain('cancelled = true')
  })
})
