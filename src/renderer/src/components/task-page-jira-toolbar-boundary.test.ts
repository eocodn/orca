import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-toolbar-view.tsx'), 'utf8')

describe('TaskPage Jira toolbar boundary', () => {
  it('keeps Jira presets, search, and actions in a bounded component', () => {
    const TOOLBAR_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-jira-toolbar.tsx'), 'utf8')

    expect(TOOLBAR_SOURCE.split('\n').length).toBeLessThan(280)
    expect(SURFACE_SOURCE).toContain("from './task-page-jira-toolbar'")
    expect(SURFACE_SOURCE).not.toContain('jiraPresets.map((preset) =>')
    expect(TOOLBAR_SOURCE).toContain('export function TaskPageJiraToolbar')
    expect(TOOLBAR_SOURCE).toContain('onSearchSubmit')
  })
})
