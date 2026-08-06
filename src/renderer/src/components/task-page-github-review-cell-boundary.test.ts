import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')
const REVIEW_CELL_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'task-page-github-review-cell.tsx'),
  'utf8'
)

describe('TaskPage GitHub review cell boundary', () => {
  it('keeps reviewer state and mutations in a bounded provider module', () => {
    expect(REVIEW_CELL_SOURCE.split('\n').length).toBeLessThan(600)
    expect(SURFACE_SOURCE).toContain("from './task-page-github-review-cell'")
    expect(SURFACE_SOURCE).not.toContain('function PRReviewCell')
    expect(REVIEW_CELL_SOURCE).toContain('export function PRReviewCell')
    expect(REVIEW_CELL_SOURCE).toContain('sourceContext')
    expect(REVIEW_CELL_SOURCE).toContain("recordFeatureInteraction('github-tasks')")
  })
})
