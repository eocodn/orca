import React, { Suspense } from 'react'
import { createPortal } from 'react-dom'
import TabBar from './tab-bar/TabBar'
import TerminalPane from './terminal-pane/TerminalPane'
import BrowserPane from './browser-pane/BrowserPane'
import EditorAutosaveController from './editor/EditorAutosaveController'
import CodexRestartChip from './CodexRestartChip'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import { findActivityTerminalPortal } from './activity/activity-terminal-portal'
import { WorktreeSplitSurface } from './terminal-surface-worktree-split-surface'
import { TerminalSurfaceDialogs } from './terminal-surface-dialogs'
const EditorPanel = lazy(() => import('./editor/EditorPanel'))
import type { buildTerminalSurfaceRenderProps } from './terminal-surface-render-props'

export type TerminalSurfaceRenderProps = ReturnType<typeof buildTerminalSurfaceRenderProps>
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
    tabsByWorktree,
    evictionExemptTerminalTabIds,
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

      <TerminalSurfaceDialogs
        saveDialogFileId={saveDialogFileId}
        handleSaveDialogCancel={handleSaveDialogCancel}
        saveDialogFile={saveDialogFile}
        handleSaveDialogDiscard={handleSaveDialogDiscard}
        handleSaveDialogSave={handleSaveDialogSave}
        windowCloseDialogOpen={windowCloseDialogOpen}
        setWindowCloseDialogOpen={setWindowCloseDialogOpen}
        confirmNativeWindowClose={confirmNativeWindowClose}
      />
    </div>
  )
}

export default TerminalSurfaceMarkup
