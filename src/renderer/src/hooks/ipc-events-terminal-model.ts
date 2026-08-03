import type { AppState } from '../store/types'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { focusRuntimeTerminalSurface } from '@/runtime/sync-runtime-graph'

export function focusTerminalInitiatedTab(tabId: string, leafId?: string | null): void {
  if (!focusRuntimeTerminalSurface(tabId, leafId)) {
    focusTerminalTabSurface(tabId, leafId)
  }
}

export function activateTerminalInitiatedWorktree(store: AppState, worktreeId: string): void {
  store.setActiveView('terminal')
  store.setActiveWorktree(worktreeId)
  // Why: CLI/runtime terminal focus is user-visible navigation, so feed both Cmd+J recency and the back/forward stack.
  store.markWorktreeVisited(worktreeId)
  if (!store.isNavigatingHistory) {
    store.recordWorktreeVisit(worktreeId)
  }
}
