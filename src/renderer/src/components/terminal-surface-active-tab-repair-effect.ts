import { useEffect } from 'react'
import { resolveRepairedActiveTerminalTabId } from './terminal/active-terminal-repair'
import type { TerminalTab, WorkspaceVisibleTabType } from '../../../shared/types'

type TerminalSurfaceActiveTabRepairContext = {
  renderedActiveWorktreeId: string | null
  activeTabIdByWorktree: Record<string, string | undefined>
  activeTabType: WorkspaceVisibleTabType
  activeTabId: string | null
  tabs: TerminalTab[]
  setActiveTab: (tabId: string) => void
}

export function useTerminalSurfaceActiveTabRepairEffect(
  context: TerminalSurfaceActiveTabRepairContext
): void {
  const {
    renderedActiveWorktreeId,
    activeTabIdByWorktree,
    activeTabType,
    activeTabId,
    tabs,
    setActiveTab
  } = context
  useEffect(() => {
    const rememberedTabId = renderedActiveWorktreeId
      ? (activeTabIdByWorktree[renderedActiveWorktreeId] ?? null)
      : null
    const repairedTabId = resolveRepairedActiveTerminalTabId({
      activeTabType,
      activeTabId,
      rememberedTabId,
      tabs
    })
    if (repairedTabId) {
      setActiveTab(repairedTabId)
    }
  }, [
    activeTabId,
    activeTabType,
    activeTabIdByWorktree,
    renderedActiveWorktreeId,
    setActiveTab,
    tabs
  ])
}
