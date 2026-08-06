import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { applyExpandedLayoutTo } from './expand-collapse'
import type { TerminalPaneLifecycleContext } from './terminal-pane-lifecycle-contracts'
import { mapRestoredPaneTitlesByPaneId } from './terminal-pane-lifecycle-support'

export function seedRestoredPaneState(
  context: TerminalPaneLifecycleContext,
  manager: PaneManager,
  restoredPaneByLeafId: ReadonlyMap<string, number>
): void {
  const { deps: d } = context
  const restoredTitles = mapRestoredPaneTitlesByPaneId(
    d.initialLayoutRef.current.titlesByLeafId,
    restoredPaneByLeafId
  )
  if (Object.keys(restoredTitles).length > 0) {
    d.setPaneTitles((previous) => ({ ...previous, ...restoredTitles }))
    d.paneTitlesRef.current = { ...d.paneTitlesRef.current, ...restoredTitles }
  }
  const restoredActivePaneId =
    (d.initialLayoutRef.current.activeLeafId
      ? restoredPaneByLeafId.get(d.initialLayoutRef.current.activeLeafId)
      : null) ??
    manager.getActivePane()?.id ??
    manager.getPanes()[0]?.id ??
    null
  if (restoredActivePaneId !== null) {
    manager.setActivePane(restoredActivePaneId, { focus: d.isActive })
  }
  const restoredExpandedPaneId = d.initialLayoutRef.current.expandedLeafId
    ? (restoredPaneByLeafId.get(d.initialLayoutRef.current.expandedLeafId) ?? null)
    : null
  if (restoredExpandedPaneId !== null && manager.getPanes().length > 1) {
    d.setExpandedPane(restoredExpandedPaneId)
    applyExpandedLayoutTo(restoredExpandedPaneId, {
      managerRef: d.managerRef,
      containerRef: d.containerRef,
      expandedStyleSnapshotRef: d.expandedStyleSnapshotRef
    })
  } else {
    d.setExpandedPane(null)
  }
}
