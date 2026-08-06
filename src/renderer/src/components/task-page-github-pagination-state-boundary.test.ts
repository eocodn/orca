import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage GitHub pagination state boundary', () => {
  it('keeps cached page initialization and reset fencing in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-github-pagination-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(150)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-github-pagination-state'")
    expect(SURFACE_SOURCE).not.toContain('const [pages, setPages] = useState')
    expect(MODULE_SOURCE).toContain('getCachedWorkItems(')
    expect(MODULE_SOURCE).toContain('paginationGenerationRef.current += 1')
    expect(MODULE_SOURCE).toContain('workItemsInvalidationNonce')
  })
})
