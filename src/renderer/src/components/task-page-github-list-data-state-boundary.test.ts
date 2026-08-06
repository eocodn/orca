import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-github-list-model.ts'),
  'utf8'
)

describe('TaskPage GitHub list data boundary', () => {
  it('keeps cache-first fan-out, count reads, and retry fencing in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-github-list-data-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(280)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-github-list-data-state'")
    expect(SURFACE_SOURCE).not.toContain('fetchWorkItemsAcrossRepos(')
    expect(SURFACE_SOURCE).not.toContain('countWorkItemsAcrossRepos(')
    expect(moduleSource).toContain('fetchWorkItemsAcrossRepos(')
    expect(moduleSource).toContain('countWorkItemsAcrossRepos(')
    expect(moduleSource).toContain('deriveTaskPageGitHubWorkItemsFetchOptions(')
    expect(moduleSource).toContain('cancelled = true')
  })
})
