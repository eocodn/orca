import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage GitHub PR checks boundary', () => {
  it('keeps eager prefetch gating and stale-row fencing in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-github-pr-checks-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(130)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-github-pr-checks-state'")
    expect(SURFACE_SOURCE).not.toContain('deriveTaskPagePRCheckSummary(')
    expect(moduleSource).toContain('deriveTaskPagePRCheckSummary(')
    expect(moduleSource).toContain('PR_CHECKS_EAGER_PREFETCH_LIMIT')
    expect(moduleSource).toContain('sameGitHubOwnerRepo')
  })
})
