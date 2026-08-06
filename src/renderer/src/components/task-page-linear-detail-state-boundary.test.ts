import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const LINEAR_CONTROLLER_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-linear-controller.ts'),
  'utf8'
)
const ROOT_CONTROLLER_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-controller.ts'),
  'utf8'
)

describe('TaskPage Linear detail state boundary', () => {
  it('keeps cache-backed selection and navigation in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-detail-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(180)
    expect(LINEAR_CONTROLLER_SOURCE).toContain("from './use-task-page-linear-detail-state'")
    expect(LINEAR_CONTROLLER_SOURCE).not.toContain(
      'const [selectedLinearIssueId, setSelectedLinearIssueId]'
    )
    expect(MODULE_SOURCE).toContain('findTaskPageLinearIssue(')
    expect(MODULE_SOURCE).toContain('allowOutsideList: true')
    expect(ROOT_CONTROLLER_SOURCE).toContain('clearSelectedLinearIssue()')
  })
})
