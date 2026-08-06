import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear composer state boundary', () => {
  it('keeps Linear project and issue composer state in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-composer-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(300)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-composer-state'")
    expect(SURFACE_SOURCE).not.toContain('const [newLinearProjectOpen, setNewLinearProjectOpen]')
    expect(SURFACE_SOURCE).not.toContain('const [newLinearIssueOpen, setNewLinearIssueOpen]')
  })
})
