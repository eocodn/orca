import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear issue board boundary', () => {
  it('keeps Linear board card rendering in a bounded component', () => {
    const BOARD_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-linear-issue-board.tsx'),
      'utf8'
    )

    expect(BOARD_SOURCE.split('\n').length).toBeLessThan(300)
    expect(SURFACE_SOURCE).toContain("from './task-page-linear-issue-board'")
    expect(SURFACE_SOURCE).not.toContain('linearBoardSections.map((section) =>')
    expect(BOARD_SOURCE).toContain('export function TaskPageLinearIssueBoard')
    expect(BOARD_SOURCE).toContain('onDrop')
  })
})
