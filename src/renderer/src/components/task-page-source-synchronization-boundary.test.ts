import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-base-controller.ts'),
  'utf8'
)

describe('TaskPage source synchronization boundary', () => {
  it('keeps page source, preferred provider, and availability synchronization in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-source-synchronization.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(130)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-source-synchronization'")
    expect(SURFACE_SOURCE).not.toContain(
      'const lastPageTaskSourceRef = useRef(pageData.taskSource)'
    )
    expect(moduleSource).toContain('lastPageTaskSourceRef.current')
    expect(moduleSource).toContain('resolveVisibleTaskProvider')
    expect(moduleSource).toContain('taskSourceManuallyChangedRef.current')
  })
})
