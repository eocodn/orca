import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear scope controller boundary', () => {
  it('keeps workspace reset and scope refresh orchestration in its controller', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-scope-controller.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(180)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-scope-controller'")
    expect(SURFACE_SOURCE).not.toContain('const handleLinearWorkspaceChange = useCallback(')
    expect(SURFACE_SOURCE).not.toContain('const handleLinearScopeOpen = useCallback(')
    expect(moduleSource).toContain('setLinearProjectsResult({ items: [] })')
    expect(moduleSource).toContain('selectLinearWorkspace(workspaceId)')
    expect(moduleSource).toContain('listLinearTeams(selectedLinearWorkspaceId, { force: true })')
  })
})
