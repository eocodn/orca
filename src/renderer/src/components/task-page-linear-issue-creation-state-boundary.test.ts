import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear issue creation boundary', () => {
  it('keeps workspace validation, context fencing, and detail selection in its hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-issue-creation-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(230)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-issue-creation-state'")
    expect(SURFACE_SOURCE).not.toContain('const handleCreateNewLinearIssue = useCallback')
    expect(MODULE_SOURCE).toContain('linearCreateIssue(')
    expect(MODULE_SOURCE).toContain('providerRuntimeContextKeyRef.current')
    expect(MODULE_SOURCE).toContain('setSelectedLinearIssue(full, { allowOutsideList: true })')
  })
})
