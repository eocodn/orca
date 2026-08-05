import type { Terminal } from '@xterm/xterm'
import type { TerminalPaneSplitSource } from '../../../../shared/feature-education-telemetry'
import type { CloseTerminalPaneDetail } from '@/constants/terminal'
import type { PtyTransport } from './pty-transport'
import { writeTerminalOutput } from '@/lib/pane-manager/pane-terminal-output-scheduler'
import { RESET_KITTY_KEYBOARD_PROTOCOL } from './layout-serialization'
import { recordCreatedTerminalPaneSplit } from './terminal-pane-split-completion'

export function resetTerminalKeyboardProtocolAfterInterrupt(terminal: Terminal): void {
  writeTerminalOutput(terminal, RESET_KITTY_KEYBOARD_PROTOCOL, {
    foreground: true,
    latencySensitive: false
  })
}

export function recordRuntimeCreatedTerminalPaneSplit(
  createdPane: unknown,
  args: {
    source: TerminalPaneSplitSource
    direction: 'vertical' | 'horizontal'
  }
): boolean {
  return recordCreatedTerminalPaneSplit(createdPane, args)
}

export function applyTerminalScrollbackRowsToMountedPanes(
  manager: { getPanes(): { terminal: Pick<Terminal, 'options'> }[] },
  rows: number
): void {
  for (const pane of manager.getPanes()) {
    if (pane.terminal.options.scrollback !== rows) {
      pane.terminal.options.scrollback = rows
    }
  }
}

export function suppressIntentionalPaneCloseExit(
  transport: Pick<PtyTransport, 'getPtyId'> | null | undefined,
  suppressPtyExit: (ptyId: string) => void
): string | null {
  const ptyId = transport?.getPtyId() ?? null
  if (ptyId) suppressPtyExit(ptyId)
  return ptyId
}

export function mapRestoredPaneTitlesByPaneId(
  savedTitles: Record<string, string> | undefined,
  restoredPaneByLeafId: ReadonlyMap<string, number>
): Record<number, string> {
  if (!savedTitles) return {}
  const restored: Record<number, string> = {}
  for (const [oldLeafId, title] of Object.entries(savedTitles)) {
    const newPaneId = restoredPaneByLeafId.get(oldLeafId)
    if (newPaneId != null && title) restored[newPaneId] = title
  }
  return restored
}

type SplitStartupPayload = { command: string; env?: Record<string, string> }

export function splitPaneWithOneShotStartup<TPane>(
  deps: { startup?: SplitStartupPayload | null },
  startup: SplitStartupPayload,
  splitPane: () => TPane
): TPane {
  deps.startup = startup
  try {
    return splitPane()
  } finally {
    deps.startup = null
  }
}

export type TerminalPaneCloseManager = {
  closePane: (paneId: number) => void
  detachPaneForExternalMove: (paneId: number) => boolean
  retirePanePreservingPty: (paneId: number) => boolean
  getNumericIdForLeaf: (leafId: string) => number | null
  getPanes: () => unknown[]
}

export function applyTerminalPaneCloseRequest(args: {
  detail: CloseTerminalPaneDetail
  manager: TerminalPaneCloseManager
  closeTab: () => void
  closeTabPreservingPty: () => void
  getPtyIdForLeaf?: (leafId: string) => string | undefined
}): 'ignored' | 'pane' | 'tab' {
  if (
    args.detail.expectedPtyId &&
    (!args.detail.leafId ||
      args.getPtyIdForLeaf?.(args.detail.leafId) !== args.detail.expectedPtyId)
  ) {
    return 'ignored'
  }
  const paneRuntimeId =
    args.detail.paneRuntimeId ??
    (args.detail.leafId ? args.manager.getNumericIdForLeaf(args.detail.leafId) : null)
  if (paneRuntimeId === null || paneRuntimeId === undefined) return 'ignored'
  if (args.manager.getPanes().length <= 1) {
    args.detail.preservePty ? args.closeTabPreservingPty() : args.closeTab()
    return 'tab'
  }
  if (args.detail.preservePty) {
    if (args.detail.retireSurface) {
      args.manager.retirePanePreservingPty(paneRuntimeId)
    } else {
      args.manager.detachPaneForExternalMove(paneRuntimeId)
    }
  } else {
    args.manager.closePane(paneRuntimeId)
  }
  return 'pane'
}

export function retireMountedTerminalPaneSurface(args: {
  paneKey: string
  paneId: number
  tabId: string
  ptyId: string | null
  retireAgentPaneAuthority: (
    paneKey: string,
    options?: { preserveSleepingAgentSession?: boolean }
  ) => void
  syncPanePtyLayoutBinding: (paneId: number, ptyId: string | null) => void
  clearTabPtyId: (tabId: string, ptyId: string) => void
  transport?: { detach?: () => void; destroy?: () => void }
}): void {
  args.retireAgentPaneAuthority(args.paneKey, { preserveSleepingAgentSession: true })
  if (args.ptyId) {
    args.syncPanePtyLayoutBinding(args.paneId, null)
    args.clearTabPtyId(args.tabId, args.ptyId)
  }
  args.transport?.detach?.()
}
