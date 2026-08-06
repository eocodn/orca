import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage source provider toolbar boundary', () => {
  it('keeps provider buttons and availability labels bounded', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-source-provider-toolbar.tsx'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(150)
    expect(SURFACE_SOURCE).toContain("from './task-page-source-provider-toolbar'")
    expect(SURFACE_SOURCE).not.toContain('data-task-source={source.id}')
  })
})
