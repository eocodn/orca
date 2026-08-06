import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-jira-content-view.tsx'), 'utf8')

describe('TaskPage Jira list surface boundary', () => {
  it('keeps connected Jira list chrome bounded', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-jira-list-surface.tsx'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(200)
    expect(SURFACE_SOURCE).toContain("from './task-page-jira-list-surface'")
    expect(SURFACE_SOURCE).not.toContain('<TaskPageJiraSortControls')
  })
})
