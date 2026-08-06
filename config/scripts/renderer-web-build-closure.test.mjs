import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('renderer web build closure', () => {
  it('keeps workspace-space facade exports unambiguous', () => {
    const facade = read('src/renderer/src/components/status-bar/workspace-space-manager-rows.tsx')
    expect(facade.match(/\bCheckButton\b/g)).toHaveLength(1)
    expect(facade.match(/\bUpdatedMetric\b/g)).toHaveLength(1)
  })

  it('does not retain the removed AI Vault drop surface', () => {
    const splitSurface = read(
      'src/renderer/src/components/terminal-surface-worktree-split-surface.tsx'
    )
    expect(splitSurface).not.toContain('AiVaultSessionDropLayer')
    expect(
      existsSync(
        resolve(projectDir, 'src/renderer/src/components/tab-group/AiVaultSessionDropLayer.d.ts')
      )
    ).toBe(false)
  })

  it('re-exports the virtual row key from its concrete owner', () => {
    const rowModel = read('src/renderer/src/components/sidebar/worktree-list-row-model.ts')
    expect(rowModel).toContain("export { getRenderRowKey } from './worktree-list-virtual-rows'")
    expect(rowModel).not.toContain('export { getRenderRowKey }\n')
  })

  it('owns context-menu split source and completion in a concrete module', () => {
    const telemetry = read(
      'src/renderer/src/components/terminal-pane/terminal-pane-context-menu-telemetry.ts'
    )
    expect(telemetry).toContain('getRequestedSplitTelemetrySource')
    expect(telemetry).toContain('recordCreatedTerminalPaneSplit')
    expect(telemetry).not.toContain('trackTerminalPaneSplit')
  })
})
