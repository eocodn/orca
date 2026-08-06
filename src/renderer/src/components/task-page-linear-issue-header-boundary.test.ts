import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'task-page-linear-content-view.tsx'),
  'utf8'
)

describe('TaskPage Linear issue header boundary', () => {
  it('keeps Linear view controls and column headers bounded', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-linear-issue-header.tsx'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(220)
    expect(SURFACE_SOURCE).toContain("from './task-page-linear-issue-header'")
    expect(SURFACE_SOURCE).not.toContain('onClick={() => setLinearViewMode(id)}')
  })
})
