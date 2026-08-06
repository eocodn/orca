import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE_PATH = resolve(__dirname, 'resource-usage-status-surface.tsx')
const INVENTORY_SOURCE_PATH = resolve(__dirname, 'resource-usage-status-inventory.ts')
const INVENTORY_HOOK_PATH = resolve(__dirname, 'use-resource-session-inventory.ts')

describe('ResourceUsageStatusSegment session inventory', () => {
  it('does not poll global terminal sessions while the popover is closed', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')
    const inventoryHookSource = readFileSync(INVENTORY_HOOK_PATH, 'utf8')

    expect(source).not.toContain('installWindowVisibilityInterval')
    expect(source).not.toContain('SESSIONS_POLL_MS')
    expect(inventoryHookSource).not.toContain('setInterval')
    // Why: every seed/action/lifecycle refresh shares one guarded inventory
    // read, and the closed path never installs a polling interval.
    expect(inventoryHookSource.match(/getClientRuntime\(\)\.terminal\.listSessions\(\)/g) ?? []).toHaveLength(1)

    const openEffectIndex = source.indexOf('if (!open)')
    const refreshIndex = source.indexOf('void refreshSessions()', openEffectIndex)

    // Why: pty.listSessions() is a global daemon inventory and can pause input
    // with large preserved-session sets. Keep continuous use off the closed path.
    expect(openEffectIndex).toBeGreaterThanOrEqual(0)
    expect(refreshIndex).toBeGreaterThan(openEffectIndex)
  })

  it('seeds the closed badge from daemon inventory instead of wake-hint bound PTYs', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')
    const inventoryHookSource = readFileSync(INVENTORY_HOOK_PATH, 'utf8')

    expect(readFileSync(INVENTORY_SOURCE_PATH, 'utf8')).toContain('useResourceSessionInventory')
    expect(source).toContain('sessionInventory.count')
    expect(inventoryHookSource).toContain('getClientRuntime().terminal.onSpawned')
    expect(inventoryHookSource).toContain('getClientRuntime().terminal.onExit')
    expect(source).not.toContain('createClosedResourceSessionCountSelector')
    expect(source).not.toContain('boundPtyIds.size')
    expect(source).not.toContain('closedSessionCount')
    expect(source).not.toContain('livePtyIdsByTabId')
  })

  it('seeds memory snapshot for the closed badge without requiring a click', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8')

    // Why: the ready-seed effect must call fetchSnapshot so RAM is not "—" until the user opens Resource Manager.
    expect(source).toContain('void fetchSnapshot()')
    expect(source).toContain('workspaceSessionReady')
  })
})
