import { useEffect } from 'react'
import { resolveRepairedActiveTerminalTabId } from './terminal/active-terminal-repair'

export function useTerminalSurfaceActiveTabRepairEffect(
  context: Record<string, any>
): void {
  const { renderedActiveWorktreeId, activeTabIdByWorktree, activeTabType, activeTabId, tabs, setActiveTab } =
    context
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
    if (repairedTabId) setActiveTab(repairedTabId)
  }, [activeTabId, activeTabType, activeTabIdByWorktree, renderedActiveWorktreeId, setActiveTab, tabs])
}
