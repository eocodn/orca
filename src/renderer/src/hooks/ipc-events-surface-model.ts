import { useAppStore } from '../store'
import type { AppState } from '../store/types'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode
} from '../../../shared/types'
import type { RuntimeTerminalPresentation } from '../../../shared/runtime-types'
import { requestBackgroundTerminalWorktreeMount } from '@/components/terminal/background-terminal-worktree-mount'
import {
  acquireBrowserAutomationVisibility,
  releaseBrowserAutomationVisibility
} from '@/components/browser-pane/browser-automation-visibility'
import { collectLeafIdsInOrder } from '@/components/terminal-pane/layout-serialization'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { buildLinearIssueLinkedWorkItem } from '@/lib/linear-linked-work-item'
import { getLinearIssueWorkspaceName } from '../../../shared/workspace-name'
import { isDirectSshRemoteWorkspaceApplyInProgress } from './remote-workspace-target-sync'
import { getTabIdsAwaitingHostHydrationRemount } from '@/lib/parked-terminal-host-hydration'
const BROWSER_AUTOMATION_BOOTSTRAP_LEASE_MS = 10_000
const browserAutomationBootstrapLeaseByPageId = new Map<string, { token: string; timer: number }>()
export const WORKTREE_RENAME_PURGE_GRACE_MS = 20_000
export const recentlyRenamedWorktreeIdExpiry = new Map<string, number>()

export function getAuthoritativeDetectedWorktreeIds(
  state: AppState,
  repoId: string
): Set<string> | null {
  const detected = state.detectedWorktreesByRepo[repoId]
  if (detected?.authoritative !== true) {
    return null
  }
  return new Set(detected.worktrees.map((worktree) => worktree.id))
}

export function getVisibleWorktreeIdsForRepo(state: AppState, repoId: string): Set<string> {
  return new Set((state.worktreesByRepo[repoId] ?? []).map((worktree) => worktree.id))
}

export function isRuntimeEnvironmentActive(): boolean {
  return Boolean(useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim())
}

export function remountTerminalTabsAwaitingHostHydration(): void {
  const store = useAppStore.getState()
  for (const tabId of getTabIdsAwaitingHostHydrationRemount(store)) {
    store.remountTerminalTabForRecovery(tabId)
  }
}

export function tryMakePaneKey(tabId: string, leafId: string): string | null {
  try {
    return makePaneKey(tabId, leafId)
  } catch {
    return null
  }
}

export function resolveTerminalPresentation(data: {
presentation?: RuntimeTerminalPresentation
activate?: boolean
focus?: boolean
}): RuntimeTerminalPresentation | undefined {
if (data.presentation) {
  return data.presentation
}
if (data.focus !== undefined) {
  return data.focus ? 'focused' : 'background'
}
if (data.activate === true) {
  return 'focused'
}
return undefined
}

export function isPinnedSessionTab(store: AppState, worktreeId: string, visibleId: string): boolean {
return (store.unifiedTabsByWorktree?.[worktreeId] ?? []).some(
  (tab) => (tab.id === visibleId || tab.entityId === visibleId) && tab.isPinned
)
}

function releaseBrowserAutomationBootstrapLease(browserPageId: string): void {
const existing = browserAutomationBootstrapLeaseByPageId.get(browserPageId)
if (!existing) {
  return
}
window.clearTimeout(existing.timer)
releaseBrowserAutomationVisibility(existing.token)
browserAutomationBootstrapLeaseByPageId.delete(browserPageId)
}

function findBrowserPageWorktreeId(store: AppState, browserPageId: string): string | null {
for (const [worktreeId, browserTabs] of Object.entries(store.browserTabsByWorktree)) {
  for (const workspace of browserTabs) {
    if (
      workspace.id === browserPageId ||
      workspace.activePageId === browserPageId ||
      workspace.pageIds?.includes(browserPageId)
    ) {
      return worktreeId
    }
  }
}

for (const pages of Object.values(store.browserPagesByWorkspace)) {
  const page = pages.find((candidate) => candidate.id === browserPageId)
  if (page) {
    return page.worktreeId
  }
}

return null
}

export function acquireBrowserAutomationBootstrapLease(
worktreeId: string | null | undefined,
browserPageId?: string | null
): void {
const store = useAppStore.getState()
const targetWorktreeId =
  worktreeId ??
  (browserPageId ? findBrowserPageWorktreeId(store, browserPageId) : null) ??
  store.activeWorktreeId
if (!targetWorktreeId) {
  return
}
requestBackgroundTerminalWorktreeMount({ worktreeId: targetWorktreeId })
let targetBrowserPageId = browserPageId ?? null
if (!targetBrowserPageId) {
  const browserTabs = store.browserTabsByWorktree[targetWorktreeId] ?? []
  const activeWorkspaceId = store.activeBrowserTabIdByWorktree[targetWorktreeId] ?? null
  const workspace =
    browserTabs.find((tab) => tab.id === activeWorkspaceId) ?? browserTabs[0] ?? null
  targetBrowserPageId =
    workspace?.activePageId ?? workspace?.pageIds?.[0] ?? workspace?.id ?? null
}
if (!targetBrowserPageId) {
  return
}

releaseBrowserAutomationBootstrapLease(targetBrowserPageId)
const token = acquireBrowserAutomationVisibility(targetBrowserPageId)
const timer = window.setTimeout(() => {
  releaseBrowserAutomationBootstrapLease(targetBrowserPageId)
}, BROWSER_AUTOMATION_BOOTSTRAP_LEASE_MS)
browserAutomationBootstrapLeaseByPageId.set(targetBrowserPageId, { token, timer })
}
type TerminalSplitDirection = 'horizontal' | 'vertical'

function insertLeafAfterSource(
node: TerminalPaneLayoutNode,
sourceLeafId: string,
newLeafId: string,
direction: TerminalSplitDirection
): { node: TerminalPaneLayoutNode; inserted: boolean } {
if (node.type === 'leaf') {
  if (node.leafId !== sourceLeafId) {
    return { node, inserted: false }
  }
  return {
    node: {
      type: 'split',
      direction,
      first: node,
      second: { type: 'leaf', leafId: newLeafId },
      ratio: 0.5
    },
    inserted: true
  }
}

const first = insertLeafAfterSource(node.first, sourceLeafId, newLeafId, direction)
if (first.inserted) {
  return { node: { ...node, first: first.node }, inserted: true }
}
const second = insertLeafAfterSource(node.second, sourceLeafId, newLeafId, direction)
if (second.inserted) {
  return { node: { ...node, second: second.node }, inserted: true }
}
return { node, inserted: false }
}

export function addSplitLeafToLayout(
layout: TerminalLayoutSnapshot | null | undefined,
sourceLeafId: string,
newLeafId: string,
ptyId: string,
direction: TerminalSplitDirection,
title?: string | null,
activateNewLeaf = true
): TerminalLayoutSnapshot {
const root = layout?.root ?? { type: 'leaf', leafId: sourceLeafId }
const existingLeafIds = collectLeafIdsInOrder(root)
const nextActiveLeafId =
  activateNewLeaf || !layout?.activeLeafId || !existingLeafIds.includes(layout.activeLeafId)
    ? newLeafId
    : layout.activeLeafId
const nextRoot = existingLeafIds.includes(newLeafId)
  ? root
  : (() => {
      const inserted = insertLeafAfterSource(root, sourceLeafId, newLeafId, direction)
      if (inserted.inserted) {
        return inserted.node
      }
      return {
        type: 'split' as const,
        direction,
        first: root,
        second: { type: 'leaf' as const, leafId: newLeafId },
        ratio: 0.5
      }
    })()
return {
  ...(layout ?? { root: null, activeLeafId: null, expandedLeafId: null }),
  root: nextRoot,
  activeLeafId: nextActiveLeafId,
  expandedLeafId: null,
  ptyIdsByLeafId: {
    ...layout?.ptyIdsByLeafId,
    [newLeafId]: ptyId
  },
  ...(title
    ? {
        titlesByLeafId: {
          ...layout?.titlesByLeafId,
          [newLeafId]: title
        }
      }
    : {})
}
}

export function activateExistingLeafInLayout(
layout: TerminalLayoutSnapshot | null | undefined,
leafId: string,
ptyId: string,
title?: string | null
): TerminalLayoutSnapshot | null {
if (!layout?.root || !collectLeafIdsInOrder(layout.root).includes(leafId)) {
  return null
}
return {
  ...layout,
  activeLeafId: leafId,
  expandedLeafId: null,
  ptyIdsByLeafId: {
    ...layout.ptyIdsByLeafId,
    [leafId]: ptyId
  },
  ...(title
    ? {
        titlesByLeafId: {
          ...layout.titlesByLeafId,
          [leafId]: title
        }
      }
    : {})
}
}

export function isRemoteWorkspaceSnapshotApplyInProgress(): boolean {
return isDirectSshRemoteWorkspaceApplyInProgress()
}

type BrowserSessionTabTarget =
| { kind: 'unified-browser'; unifiedTabId: string; workspaceId: string; groupId: string }
| { kind: 'fallback-browser'; workspaceId: string }

type NewWorkspaceShortcutModalData = {
telemetrySource: 'shortcut'
prefilledName?: string
linkedWorkItem?: ReturnType<typeof buildLinearIssueLinkedWorkItem>
}

export function buildNewWorkspaceShortcutModalData(
state: Pick<AppState, 'activeView' | 'taskPageData'>
): NewWorkspaceShortcutModalData {
const linearIssue =
  state.activeView === 'tasks' ? (state.taskPageData.openLinearIssue ?? null) : null
if (!linearIssue) {
  return { telemetrySource: 'shortcut' }
}

return {
  telemetrySource: 'shortcut',
  prefilledName: getLinearIssueWorkspaceName(linearIssue),
  // Why: Cmd+N from a Linear issue mirrors its Start-workspace action, else the agent launches without source context.
  linkedWorkItem: buildLinearIssueLinkedWorkItem(linearIssue)
}
}

export function openNewWorkspaceFromShortcut(
state: Pick<AppState, 'activeModal' | 'activeView' | 'taskPageData' | 'openModal'>
): void {
if (state.activeModal === 'new-workspace-composer') {
  return
}
state.openModal('new-workspace-composer', buildNewWorkspaceShortcutModalData(state))
}

export function resolveBrowserSessionTabTarget(
state: Pick<AppState, 'browserTabsByWorktree' | 'unifiedTabsByWorktree'>,
worktreeId: string,
tabId: string
): BrowserSessionTabTarget | null {
const tab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find((item) => item.id === tabId)
if (tab?.contentType === 'browser') {
  return {
    kind: 'unified-browser',
    unifiedTabId: tab.id,
    workspaceId: tab.entityId,
    groupId: tab.groupId
  }
}
const fallbackBrowser = (state.browserTabsByWorktree[worktreeId] ?? []).find(
  (workspace) => workspace.id === tabId
)
return fallbackBrowser ? { kind: 'fallback-browser', workspaceId: fallbackBrowser.id } : null
}
