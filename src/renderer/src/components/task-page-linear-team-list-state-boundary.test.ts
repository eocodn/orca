import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear team list boundary', () => {
  it('keeps the workspace-scoped team cache and authoritative read in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-team-list-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(120)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-team-list-state'")
    expect(moduleSource).toContain('getCachedLinearTeams(')
    expect(moduleSource).toContain('listLinearTeams(')
    expect(moduleSource).toContain('setAvailableTeams([])')
    expect(moduleSource).toContain('cancelled = true')
  })
})
