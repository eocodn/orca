import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store'
import { useBrowserAutomationVisibilityForAny } from './browser-pane/browser-automation-visibility'
import { useBrowserMobileDriverForAny } from '@/lib/pane-manager/browser-mobile-driver-state'
import CodexRestartChip from './CodexRestartChip'
import TabGroupSplitLayout from './tab-group/TabGroupSplitLayout'
import TerminalPaneOverlayLayer from './terminal-pane/TerminalPaneOverlayLayer'
import BrowserPaneOverlayLayer from './browser-pane/BrowserPaneOverlayLayer'
import AiVaultSessionDropLayer from './tab-group/AiVaultSessionDropLayer'
import type { TabGroupLayoutNode } from '../../../shared/types'
import type { ActivityTerminalPortalTarget } from './activity/activity-terminal-portal'

// Why: overlay pins each once-rendered pane (keyed by pane id) to its group's CSS anchor, so cross-group moves avoid terminal remount / webview reload.
// React.memo: Terminal.tsx re-renders on unrelated store updates; memoize so this surface only re-renders on its own prop changes.

const WorktreeSplitSurface = React.memo(function WorktreeSplitSurface({
  worktreeId,
  worktreePath,
  layout,
  focusedGroupId,
  isVisible,
  shouldMeasureHiddenWorktree,
  shouldColdParkTerminalPanes,
  isForceParked,
  activityTerminalPortals,
  backgroundMountTabIds,
  activationDeferredMountTabIds
}: {
  worktreeId: string
  worktreePath: string
  layout: TabGroupLayoutNode
  focusedGroupId?: string
  isVisible: boolean
  shouldMeasureHiddenWorktree: boolean
  shouldColdParkTerminalPanes: boolean
  isForceParked: boolean
  activityTerminalPortals: ActivityTerminalPortalTarget[]
  backgroundMountTabIds: ReadonlySet<string> | null
  activationDeferredMountTabIds: ReadonlySet<string> | null
}): React.JSX.Element {
  const browserPageIds = useAppStore(
    useShallow((state) =>
      (state.browserTabsByWorktree[worktreeId] ?? []).flatMap((tab) =>
        tab.pageIds && tab.pageIds.length > 0 ? tab.pageIds : [tab.activePageId ?? tab.id]
      )
    )
  )
  const hasAutomationVisibleBrowser = useBrowserAutomationVisibilityForAny(browserPageIds)
  const hasMobileDrivenBrowser = useBrowserMobileDriverForAny(browserPageIds)
  const shouldKeepPaintable =
    shouldMeasureHiddenWorktree || hasAutomationVisibleBrowser || hasMobileDrivenBrowser

  return (
    <div
      className={
        isVisible
          ? 'absolute inset-0 flex'
          : shouldKeepPaintable
            ? 'absolute inset-0 flex opacity-0 pointer-events-none'
            : 'absolute inset-0 hidden'
      }
      // Why: paintable-but-hidden webviews must be inert so they stay unreachable by Tab / assistive tech.
      inert={!isVisible}
      aria-hidden={!isVisible}
    >
      <CodexRestartChip isVisible={isVisible} worktreeId={worktreeId} />
      <TabGroupSplitLayout
        layout={layout}
        worktreeId={worktreeId}
        focusedGroupId={focusedGroupId}
        isWorktreeActive={isVisible}
      />
      <TerminalPaneOverlayLayer
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isWorktreeActive={isVisible}
        coldParkTerminalPanes={shouldColdParkTerminalPanes}
        isForceParked={isForceParked}
        shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
        activityTerminalPortals={activityTerminalPortals}
        backgroundMountTabIds={backgroundMountTabIds}
        activationDeferredMountTabIds={activationDeferredMountTabIds}
      />
      {isVisible || backgroundMountTabIds === null ? (
        <>
          <BrowserPaneOverlayLayer worktreeId={worktreeId} isWorktreeActive={isVisible} />
        </>
      ) : null}
      <AiVaultSessionDropLayer worktreeId={worktreeId} enabled={isVisible} />
    </div>
  )
})

export { WorktreeSplitSurface }
