import React, { Suspense } from 'react'
import { createPortal } from 'react-dom'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import TabBar from './tab-bar/TabBar'
import TerminalPane from './terminal-pane/TerminalPane'
import BrowserPane from './browser-pane/BrowserPane'
import BrowserPaneOverlayLayer from './browser-pane/BrowserPaneOverlayLayer'
import TerminalPaneOverlayLayer from './terminal-pane/TerminalPaneOverlayLayer'
import TabGroupSplitLayout from './tab-group/TabGroupSplitLayout'
import AiVaultSessionDropLayer from './tab-group/AiVaultSessionDropLayer'
import CodexRestartChip from './CodexRestartChip'
import EditorAutosaveController from './editor/EditorAutosaveController'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { basename } from '../lib/path'
import { translate } from '@/i18n/i18n'
import {
  findActivityTerminalPortal,
  type ActivityTerminalPortalTarget
} from './activity/activity-terminal-portal'
import type { TabGroupLayoutNode } from '../../../shared/types'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store'
import { useBrowserAutomationVisibilityForAny } from './browser-pane/browser-automation-visibility'
import { useBrowserMobileDriverForAny } from '@/lib/pane-manager/browser-mobile-driver-state'
const EditorPanel = lazy(() => import('./editor/EditorPanel'))
export type TerminalSurfaceRenderProps = Record<string, any>
export function TerminalSurfaceMarkup(props: TerminalSurfaceRenderProps): React.JSX.Element {
  const {
    renderedActiveWorktreeId,
    effectiveActiveLayout,
    titlebarTabsTarget,
    tabs,
    activeTabId,
    handleActivateTab,
    handleCloseTab,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleNewTab,
    handleNewBrowserTab,
    handleOpenEntry,
    handleNewFile,
    setTabCustomTitle,
    setTabColor,
    expandedPaneByTabId,
    handleTogglePaneExpand,
    worktreeFiles,
    worktreeBrowserTabs,
    activeFileId,
    activeBrowserTabId,
    activeTabType,
    setActiveFile,
    setActiveTabType,
    handleCloseFile,
    handleActivateBrowserTab,
    handleCloseBrowserTab,
    handleDuplicateBrowserTab,
    handleCloseAllFiles,
    makePreviewFilePermanent,
    pinFile,
    tabBarOrder,
    anyMountedWorktreeHasLayout,
    workspaceSurfaces,
    mountedWorktreeIdsRef,
    getEffectiveLayoutForWorktree,
    activeGroupIdByWorktree,
    measurableBackgroundWorktreeIdsRef,
    effectiveParkedTerminalWorktreeIds,
    forceParkedTerminalWorktreeIds,
    activityTerminalPortals,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    activeView,
    shouldMountBackgroundWorktreeTab,
    browserTabsByWorktree,
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    confirmNativeWindowClose,
    saveDialogFileId,
    handleSaveDialogCancel,
    saveDialogFile,
    handleSaveDialogDiscard,
    handleSaveDialogSave
  } = props
  return (
    <div
      className={`flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden${renderedActiveWorktreeId ? '' : ' hidden'}`}
      data-rendered-active-worktree-id={renderedActiveWorktreeId ?? undefined}
    >
      <EditorAutosaveController />

      {/* Why: with split groups each group owns its inline tab strip; this titlebar portal is only a fallback before the root-group layout exists. */}
      {renderedActiveWorktreeId &&
        !effectiveActiveLayout &&
        titlebarTabsTarget &&
        createPortal(
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            worktreeId={renderedActiveWorktreeId}
            onActivate={handleActivateTab}
            onClose={handleCloseTab}
            onCloseOthers={handleCloseOthers}
            onCloseToRight={handleCloseTabsToRight}
            onCloseToLeft={handleCloseTabsToLeft}
            onNewTerminalTab={() => handleNewTab()}
            onNewTerminalWithShell={handleNewTab}
            onNewBrowserTab={handleNewBrowserTab}
            onOpenEntry={handleOpenEntry}
            onNewFileTab={handleNewFile}
            onSetCustomTitle={setTabCustomTitle}
            onSetTabColor={setTabColor}
            expandedPaneByTabId={expandedPaneByTabId}
            onTogglePaneExpand={handleTogglePaneExpand}
            editorFiles={worktreeFiles}
            browserTabs={worktreeBrowserTabs}
            activeFileId={activeFileId}
            activeBrowserTabId={activeBrowserTabId}
            activeTabType={activeTabType}
            onActivateFile={(fileId) => {
              const unifiedTabs =
                useAppStore.getState().unifiedTabsByWorktree[renderedActiveWorktreeId ?? ''] ?? []
              setActiveFile(fileId)
              setActiveTabType('editor')
            }}
            onCloseFile={handleCloseFile}
            onActivateBrowserTab={handleActivateBrowserTab}
            onCloseBrowserTab={handleCloseBrowserTab}
            onDuplicateBrowserTab={handleDuplicateBrowserTab}
            onCloseAllFiles={handleCloseAllFiles}
            onMakePreviewFilePermanent={makePreviewFilePermanent}
            onPinFile={pinFile}
            tabBarOrder={tabBarOrder}
          />,
          titlebarTabsTarget
        )}

      {/* Why: no full-width titlebar in workspace view — tab groups + terminal extend to the window top. */}

      {anyMountedWorktreeHasLayout ? (
        <div
          className={`relative flex flex-1 min-w-0 min-h-0 overflow-hidden${effectiveActiveLayout ? '' : ' hidden'}`}
        >
          {/* Why: absolutely position each mounted surface so hidden trees don't reflow the active one; the relative anchor sizes panes to the workspace body. */}
          {workspaceSurfaces
            .filter((workspace) => mountedWorktreeIdsRef.current.has(workspace.id))
            .map((workspace) => {
              const layout = getEffectiveLayoutForWorktree(workspace.id)
              if (!layout) {
                return null
              }
              // Why: strict '=== terminal' (not !== settings) so the terminal/browser surface hides on the tasks page too.
              const isVisible =
                activeView === 'terminal' && workspace.id === renderedActiveWorktreeId
              const shouldMeasureHiddenWorktree =
                !isVisible && measurableBackgroundWorktreeIdsRef.current.has(workspace.id)
              const shouldColdParkTerminalPanes =
                !isVisible &&
                !shouldMeasureHiddenWorktree &&
                effectiveParkedTerminalWorktreeIds.has(workspace.id)
              return (
                <WorktreeSplitSurface
                  key={`tab-groups-${workspace.id}`}
                  worktreeId={workspace.id}
                  worktreePath={workspace.path}
                  layout={layout}
                  focusedGroupId={activeGroupIdByWorktree[workspace.id]}
                  isVisible={isVisible}
                  shouldMeasureHiddenWorktree={shouldMeasureHiddenWorktree}
                  shouldColdParkTerminalPanes={shouldColdParkTerminalPanes}
                  isForceParked={forceParkedTerminalWorktreeIds.has(workspace.id)}
                  activityTerminalPortals={activityTerminalPortals}
                  backgroundMountTabIds={
                    backgroundMountTabIdsByWorktreeRef.current.get(workspace.id) ?? null
                  }
                  activationDeferredMountTabIds={
                    activationDeferredMountTabIdsByWorktreeRef.current.get(workspace.id) ?? null
                  }
                />
              )
            })}
        </div>
      ) : null}

      {!effectiveActiveLayout && !anyMountedWorktreeHasLayout && (
        <>
          {/* Why: render only one surface model — legacy panes mounted alongside split-group panes race two React trees over one PTY/webview; gate on !anyMountedWorktreeHasLayout too so shutdown-from-focused doesn't respawn PTYs and re-light the sidebar dot. */}
          {/* Terminal panes container - hidden when editor tab active */}
          <div
            className={`relative flex-1 min-h-0 overflow-hidden ${
              // Why: only hide the terminal when another tab type has content; else a stale activeTabType (e.g. 'editor' with no files after restore) blanks the screen.
              (activeTabType === 'editor' && worktreeFiles.length > 0) ||
              (activeTabType === 'browser' && worktreeBrowserTabs.length > 0)
                ? 'hidden'
                : ''
            }`}
          >
            {workspaceSurfaces
              .filter((workspace) => mountedWorktreeIdsRef.current.has(workspace.id))
              .map((workspace) => {
                // Why: strict '=== terminal' (not !== settings) so the terminal/browser surface hides on the tasks page too.
                const isVisible =
                  activeView === 'terminal' && workspace.id === renderedActiveWorktreeId
                const shouldMeasureHiddenWorktree =
                  !isVisible && measurableBackgroundWorktreeIdsRef.current.has(workspace.id)
                const shouldColdParkTerminalPanes =
                  !isVisible &&
                  !shouldMeasureHiddenWorktree &&
                  effectiveParkedTerminalWorktreeIds.has(workspace.id)
                return (
                  <div
                    key={workspace.id}
                    className={
                      isVisible
                        ? 'absolute inset-0'
                        : shouldMeasureHiddenWorktree
                          ? 'absolute inset-0 opacity-0 pointer-events-none'
                          : 'absolute inset-0 hidden'
                    }
                    aria-hidden={!isVisible}
                  >
                    <CodexRestartChip isVisible={isVisible} worktreeId={workspace.id} />
                    {(tabsByWorktree[workspace.id] ?? [])
                      .filter((tab) =>
                        shouldMountBackgroundWorktreeTab(
                          backgroundMountTabIdsByWorktreeRef.current.get(workspace.id) ?? null,
                          tab.id
                        )
                      )
                      .map((tab) => {
                        const activityTerminalPortal = findActivityTerminalPortal(
                          activityTerminalPortals,
                          { worktreeId: workspace.id, tabId: tab.id }
                        )
                        const isActivityPortalTab = activityTerminalPortal !== null
                        const isActiveTerminalTab =
                          isVisible && tab.id === activeTabId && activeTabType === 'terminal'
                        // Why: parking unmounts the view but keeps the PTY; an Activity portal stays
                        // mounted as a visible consumer, and a force-parked worktree's eviction-exempt
                        // tabs stay mounted because a remount would orphan their live pty.
                        if (
                          shouldColdParkTerminalPanes &&
                          !isActivityPortalTab &&
                          !evictionExemptTerminalTabIds.has(tab.id)
                        ) {
                          return null
                        }
                        const terminalPane = (
                          <TerminalPane
                            key={`${tab.id}-${tab.generation ?? 0}`}
                            tabId={tab.id}
                            worktreeId={workspace.id}
                            cwd={tab.startupCwd ?? workspace.path}
                            isActive={
                              isActiveTerminalTab || activityTerminalPortal?.active === true
                            }
                            // Why: keep isVisible true for the portaled tab so xterm fits/streams while the workspace surface stays hidden.
                            isVisible={isActiveTerminalTab || isActivityPortalTab}
                            // Why: inactive tabs here are tab-hidden (not worktree-hidden), so they need the same light resume path as split-group overlays.
                            isWorktreeActive={isVisible || isActivityPortalTab}
                            // Why: isolate the portaled Activity leaf so split siblings stay hidden; workspace renders pass null.
                            isolatedPaneKey={activityTerminalPortal?.paneKey ?? null}
                            onPtyExit={(ptyId) => handlePtyExit(tab.id, ptyId)}
                            onCloseTab={() => handleCloseTab(tab.id)}
                          />
                        )
                        if (activityTerminalPortal) {
                          return createPortal(
                            terminalPane,
                            activityTerminalPortal.target,
                            `activity-terminal-${tab.id}`
                          )
                        }
                        return terminalPane
                      })}
                  </div>
                )
              })}
          </div>

          {/* Browser panes: only the active pane mounts so inactive webviews park rather than keep hidden guest renderers alive. */}
          <div
            className={`relative flex-1 min-h-0 overflow-hidden ${
              activeTabType !== 'browser' ? 'hidden' : ''
            }`}
          >
            {workspaceSurfaces.map((workspace) => {
              const browserTabs = browserTabsByWorktree[workspace.id] ?? []
              // Why: strict '=== terminal' (not !== settings) so browser panes hide on the tasks page too.
              const isVisibleWorktree =
                activeView === 'terminal' && workspace.id === renderedActiveWorktreeId
              if (browserTabs.length === 0) {
                return null
              }
              return (
                <div
                  key={`browser-${workspace.id}`}
                  className={isVisibleWorktree ? 'absolute inset-0' : 'absolute inset-0 hidden'}
                  aria-hidden={!isVisibleWorktree}
                >
                  {browserTabs.map((browserTab) => {
                    const isBrowserActive =
                      isVisibleWorktree &&
                      activeTabType === 'browser' &&
                      browserTab.id === activeBrowserTabId
                    return (
                      <div
                        key={browserTab.id}
                        className={`absolute inset-0${isBrowserActive ? '' : ' pointer-events-none hidden'}`}
                      >
                        {isBrowserActive ? (
                          <BrowserPane browserTab={browserTab} isActive={isBrowserActive} />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {renderedActiveWorktreeId && activeTabType === 'editor' && worktreeFiles.length > 0 && (
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                  {translate('auto.components.Terminal.5c1d2a32bb', 'Loading editor...')}
                </div>
              }
            >
              <EditorPanel />
            </Suspense>
          )}
        </>
      )}

      {/* Save confirmation dialog */}
      <Dialog
        open={saveDialogFileId !== null}
        onOpenChange={(open) => {
          if (!open) {
            handleSaveDialogCancel()
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate('auto.components.Terminal.21295c6b8c', 'Unsaved Changes')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {saveDialogFile
                ? translate(
                    'auto.components.Terminal.61ed600d29',
                    '"{{value0}}" has unsaved changes. Do you want to save before closing?',
                    { value0: basename(saveDialogFile.relativePath) }
                  )
                : translate(
                    'auto.components.Terminal.46e08bc5c8',
                    'This file has unsaved changes.'
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSaveDialogCancel}>
              {translate('auto.components.Terminal.f82e9f02df', 'Cancel')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleSaveDialogDiscard}>
              {translate('auto.components.Terminal.0037b21794', "Don't Save")}
            </Button>
            <Button type="button" size="sm" onClick={handleSaveDialogSave}>
              {translate('auto.components.Terminal.cd51e28d8b', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Window close confirmation dialog */}
      <Dialog
        open={windowCloseDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setWindowCloseDialogOpen(false)
          }
        }}
      >
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate('auto.components.Terminal.2fa9c69ff3', 'Close Window?')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate(
                'auto.components.Terminal.7958465754',
                'There are local terminals with running processes. Close the window anyway?'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWindowCloseDialogOpen(false)}
            >
              {translate('auto.components.Terminal.f82e9f02df', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              autoFocus
              onClick={() => {
                setWindowCloseDialogOpen(false)
                confirmNativeWindowClose()
              }}
            >
              {translate('auto.components.Terminal.73768427cf', 'Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

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

export default TerminalSurfaceMarkup
