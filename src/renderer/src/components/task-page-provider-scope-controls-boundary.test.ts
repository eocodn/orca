import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-toolbar-view.tsx'), 'utf8')

describe('TaskPage provider scope controls boundary', () => {
  it('keeps provider scope and site controls bounded', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-provider-scope-controls.tsx'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(180)
    expect(SURFACE_SOURCE).toContain("from './task-page-provider-scope-controls'")
    expect(SURFACE_SOURCE).not.toContain('Select one Linear team to open in Linear')
  })
})
