import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-linear-controller.ts'),
  'utf8'
)

describe('TaskPage Linear resume boundary', () => {
  it('keeps authoritative project/view restore and cancellation in its hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-resume-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(190)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-resume-state'")
    expect(SURFACE_SOURCE).not.toContain('linearContextResumeAttemptedRef.current ||')
    expect(MODULE_SOURCE).toContain('fetchLinearProject(')
    expect(MODULE_SOURCE).toContain('fetchLinearCustomView(')
    expect(MODULE_SOURCE).toContain('setTaskResumeState({ linearContext: undefined })')
    expect(MODULE_SOURCE).toContain('cancelled = true')
  })
})
