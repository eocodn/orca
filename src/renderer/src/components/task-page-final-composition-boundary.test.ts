import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname

describe('TaskPage final composition boundary', () => {
  it('keeps the public surface as a small controller/view composition', () => {
    const surface = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')
    const controller = readFileSync(join(COMPONENT_ROOT, 'use-task-page-controller.ts'), 'utf8')
    const view = readFileSync(join(COMPONENT_ROOT, 'task-page-view.tsx'), 'utf8')
    const boundedModules = [
      'use-task-page-base-controller.ts',
      'use-task-page-github-controller.ts',
      'use-task-page-linear-controller.ts',
      'use-task-page-jira-controller.ts',
      'task-page-toolbar-view.tsx',
      'task-page-content-view.tsx',
      'task-page-code-host-content-view.tsx',
      'task-page-jira-content-view.tsx',
      'task-page-linear-content-view.tsx',
      'task-page-dialogs-view.tsx'
    ]

    expect(surface.split('\n').length).toBeLessThan(40)
    expect(controller.split('\n').length).toBeLessThan(300)
    expect(view.split('\n').length).toBeLessThan(80)
    for (const moduleName of boundedModules) {
      const moduleSource = readFileSync(join(COMPONENT_ROOT, moduleName), 'utf8')
      expect(moduleSource.split('\n').length, moduleName).toBeLessThan(300)
    }
    expect(surface).toContain("from './use-task-page-controller'")
    expect(surface).toContain("from './task-page-view'")
    expect(controller).toContain('useTaskPageGitHubController')
    expect(controller).toContain('useTaskPageLinearController')
    expect(controller).toContain('useTaskPageJiraController')
  })
})
