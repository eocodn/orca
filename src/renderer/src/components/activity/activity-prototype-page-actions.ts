import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import type { AgentPaneThread } from './activity-prototype-page-model'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

export function activateActivityThreadTerminal(thread: AgentPaneThread): void {
  const state = useAppStore.getState()
  const worktree = getWorktreeMapFromState(state).get(thread.worktree.id)
  if (!worktree) {
    return
  }
  // Retained-agent threads can outlive their tab; do not focus a dead tab.
  const liveTabs = state.tabsByWorktree[worktree.id] ?? []
  if (!liveTabs.some((tab) => tab.id === thread.tab.id)) {
    return
  }
  if (state.activeRepoId !== worktree.repoId) {
    state.setActiveRepo(worktree.repoId)
  }
  if (state.activeWorktreeId !== worktree.id) {
    state.setActiveWorktree(worktree.id)
  }
  state.setActiveTabType('terminal')
  const parsed = parsePaneKey(thread.paneKey)
  activateTabAndFocusPane(
    thread.tab.id,
    parsed && parsed.tabId === thread.tab.id ? parsed.leafId : null,
    { scrollToBottomIfOutputSinceLastView: true }
  )
}

export function revealActivityThreadWorkspace(thread: AgentPaneThread): boolean {
  const state = useAppStore.getState()
  if (!getWorktreeMapFromState(state).has(thread.worktree.id)) {
    return false
  }
  activateAndRevealWorktree(thread.worktree.id)
  return true
}
