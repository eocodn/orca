import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-linear-controller.ts'),
  'utf8'
)

describe('TaskPage Linear toolbar action boundary', () => {
  it('keeps Linear creation, search, and access refresh callbacks in its action hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-toolbar-actions.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(180)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-toolbar-actions'")
    expect(SURFACE_SOURCE).not.toContain('const handleCreateLinearItem = useCallback(')
    expect(SURFACE_SOURCE).not.toContain('const submitLinearSearch = useCallback(')
    expect(moduleSource).toContain('setNewLinearProjectOpen(true)')
    expect(moduleSource).toContain(
      "setTaskResumeState({ linearQuery: trimmed, linearMode: 'issues' })"
    )
    expect(moduleSource).toContain('setLinearTeamRefreshNonce((n) => n + 1)')
  })
})
