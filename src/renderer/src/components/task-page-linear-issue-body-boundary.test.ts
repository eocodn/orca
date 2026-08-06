import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'task-page-linear-content-view.tsx'),
  'utf8'
)

describe('TaskPage Linear issue body boundary', () => {
  it('keeps Linear issue states and collection controls bounded', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-linear-issue-body.tsx'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(320)
    expect(SURFACE_SOURCE).toContain("from './task-page-linear-issue-body'")
    expect(SURFACE_SOURCE).not.toContain('Unable to load Linear issues')
  })
})
