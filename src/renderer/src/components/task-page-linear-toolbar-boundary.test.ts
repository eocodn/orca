import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-toolbar-view.tsx'), 'utf8')

describe('TaskPage Linear toolbar boundary', () => {
  it('keeps Linear mode, search, and action controls in a bounded component', () => {
    const TOOLBAR_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-linear-toolbar.tsx'),
      'utf8'
    )

    expect(TOOLBAR_SOURCE.split('\n').length).toBeLessThan(360)
    expect(SURFACE_SOURCE).toContain("from './task-page-linear-toolbar'")
    expect(SURFACE_SOURCE).not.toContain('linearModeOptions.map((mode) =>')
    expect(TOOLBAR_SOURCE).toContain('export function TaskPageLinearToolbar')
    expect(TOOLBAR_SOURCE).toContain('onLinearSearchSubmit')
  })
})
