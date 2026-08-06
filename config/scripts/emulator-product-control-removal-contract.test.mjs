import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function projectPath(relativePath) {
  return resolve(projectRoot, relativePath)
}

function readProjectFile(relativePath) {
  return readFileSync(projectPath(relativePath), 'utf8')
}

const rendererSimulatorRemovalFiles = [
  'src/renderer/src/components/WorktreeJumpPalette.tsx',
  'src/renderer/src/components/worktree-jump-palette-model.tsx',
  'src/renderer/src/components/tab-bar/tab-bar-surface.tsx',
  'src/renderer/src/components/tab-group/TabGroupPanel.tsx',
  'src/renderer/src/components/tab-group/tab-group-workspace-model-implementation.ts',
  'src/renderer/src/components/terminal-surface.tsx',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-state.ts',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-tab-actions.ts',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-render-content.tsx',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-render-titlebar.tsx'
]

const retiredSimulatorTests = [
  'src/shared/keybindings.test.ts',
  'src/renderer/src/hooks/modal-return-focus-action.test.ts',
  'src/renderer/src/hooks/ipc-tab-switch.test.ts',
  'src/renderer/src/hooks/useIpcEvents.test.ts',
  'src/renderer/src/store/selectors.test.ts',
  'src/renderer/src/lib/workspace-session.test.ts',
  'src/renderer/src/components/tab-bar/TabBar.context-menu.test.ts',
  'src/renderer/src/components/tab-bar/TabBar.windows-shell-launch.test.ts',
  'src/renderer/src/components/tab-bar/group-tab-order.test.ts',
  'src/renderer/src/components/tab-bar/tab-create-menu-options.test.ts',
  'src/renderer/src/store/slices/tabs-hydration.test.ts',
  'src/renderer/src/store/slices/tabs.test.ts',
  'src/renderer/src/components/floating-terminal/FloatingTerminalPanel.test.tsx'
]

describe('emulator product-control removal contract', () => {
  it('removes the emulator backend and runtime command entry points', () => {
    expect(existsSync(projectPath('src/main/emulator'))).toBe(false)
    expect(existsSync(projectPath('src/main/runtime/orca-runtime-emulator.ts'))).toBe(false)
    expect(existsSync(projectPath('src/main/runtime/rpc/methods/emulator.ts'))).toBe(false)
    expect(existsSync(projectPath('src/cli/handlers/emulator.ts'))).toBe(false)
    expect(existsSync(projectPath('src/cli/specs/emulator.ts'))).toBe(false)
  })

  it('removes the renderer and preload product-control entry points', () => {
    expect(existsSync(projectPath('src/renderer/src/components/emulator-pane'))).toBe(false)
    expect(existsSync(projectPath('src/renderer/src/lib/open-mobile-emulator-tab.ts'))).toBe(false)
    expect(existsSync(projectPath('src/preload/api-browser-emulator.ts'))).toBe(false)
    expect(readProjectFile('src/shared/types-tabs.ts')).not.toMatch(/simulator/)
  })

  it('closes renderer imports and branches for the removed simulator surface', () => {
    const staleSimulatorImport = /(?:simulator-palette-search|open-mobile-emulator-tab|ensure-simulator-tab|emulator-pane|MobileEmulatorTabIntroCallout|mobile-emulator-tab-intro-visibility)/
    const staleSimulatorBranch = /mobileEmulatorEnabled|newSimulator|contentType\s*!==?\s*['"]simulator['"]|contentType\s*===\s*['"]simulator['"]|['"]simulator['"]\s*\)|['"]simulator['"]\s*\]/
    for (const relativePath of rendererSimulatorRemovalFiles) {
      const source = readProjectFile(relativePath)
      expect(source, relativePath).not.toMatch(staleSimulatorImport)
      expect(source, relativePath).not.toMatch(staleSimulatorBranch)
    }
  })

  it('does not keep removed simulator fixtures in renderer and keybinding tests', () => {
    for (const relativePath of retiredSimulatorTests) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(
        /contentType:\s*['\"]simulator['\"]|tab\.newSimulator|new-simulator|activeTabType[^\n]*simulator|SimulatorTab|simulatorTab|hasSimulator|\bsimulator\b/i
      )
    }
  })
})
