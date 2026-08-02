// Concrete surface implementation for FloatingTerminalPanel.tsx.
// Keeps mixed tab orchestration local to the floating worktree.
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { toast } from 'sonner'
import EmulatorPane from '@/components/emulator-pane/EmulatorPane'
import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
import TabBar from '@/components/tab-bar/TabBar'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import TerminalPane, { type TerminalPaneHandle } from '@/components/terminal-pane/TerminalPane'
import { shouldDeferParkedPtyExitTabClose } from '@/components/terminal-pane/terminal-parked-tab-watchers'
import { useTerminalTabColdParking } from '@/components/terminal-pane/use-terminal-tab-cold-parking'
import { isTerminalPaneCloseChord } from '@/components/terminal-pane/terminal-shortcut-policy'
import { isTerminalImeInputContextRefreshing } from '@/components/terminal-pane/terminal-ime-input-context-refresh'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTerminalSaveDialog } from '@/components/terminal/useTerminalSaveDialog'
import { appendUniqueOpenFileIds } from '@/components/terminal/unsaved-close-queue'
import { getConnectionId } from '@/lib/connection-context'
import { createUntitledMarkdownFileWithTemplateSelection } from '@/lib/create-untitled-markdown'
import { detectLanguage } from '@/lib/language-detect'
import { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { isOrcaCliAvailableOnPath } from '@/lib/agent-skill-cli-prerequisite'
import {
  countVisibleFloatingWorkspaceItems,
  isEventTargetInsideFloatingWorkspacePanel,
  isFloatingWorkspacePanelFocused,
  isFloatingWorkspaceTerminalInputTarget,
  switchFloatingWorkspaceTab
} from '@/lib/floating-workspace-terminal-actions'
import {
  matchFloatingWorkspacePanelOwnedAction,
  matchFloatingWorkspacePanelShortcut,
  type FloatingWorkspacePanelOwnedAction
} from '@/lib/floating-workspace-shortcut-policy'
import {
  armFloatingPanelReclaimIntent,
  clearFloatingPanelReclaimIntent,
  consumeFloatingPanelReclaimIntent
} from '@/lib/floating-workspace-focus-reclaim'
import {
  FLOATING_WORKSPACE_GUEST_CLOSE_EVENT,
  FLOATING_WORKSPACE_GUEST_SELECT_INDEX_EVENT,
  type FloatingWorkspaceGuestCloseDetail,
  type FloatingWorkspaceGuestSelectIndexDetail
} from '@/lib/floating-workspace-guest-bridge'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { guardPinnedTabClose, resolvePinnedTabLabel } from '@/store/pinned-tab-close-guard'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import {
  ORCHESTRATION_SETUP_DISMISSED_STORAGE_KEY,
  ORCHESTRATION_SETUP_STATE_EVENT,
  hasOrchestrationSetupMarker,
  isOrchestrationSetupDismissed,
  notifyOrchestrationSetupStateChanged
} from '@/lib/orchestration-setup-state'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { destroyWorkspaceWebviews } from '@/store/slices/browser-webview-cleanup'
import { createTerminalPaneHandleRegistry } from './terminal-pane-handle-registry'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  keybindingMatchesAction,
  type KeybindingActionId,
  type KeybindingContext,
  type KeybindingMatchOptions,
  type PhysicalModifierToken
} from '../../../../shared/keybindings'
import {
  ModifierDoubleTapDetector,
  toModifierDoubleTapEvent
} from '../../../../shared/modifier-double-tap-detector'
import type { BrowserTab as BrowserTabState, Tab, TerminalTab } from '../../../../shared/types'
import { resolveUnifiedTabLabel } from '../../../../shared/tab-title-resolution'
import { FloatingBrowserSlot } from './FloatingBrowserSlot'
import { FloatingTerminalOrchestrationDialog } from './FloatingTerminalOrchestrationDialog'
import { FloatingTerminalResizeHandles } from './FloatingTerminalResizeHandles'
import { FloatingTerminalWindowControls } from './FloatingTerminalWindowControls'
export { FloatingTerminalToggleButton } from './FloatingTerminalToggleButton'
import {
  anchorFloatingTerminalPanelBounds,
  clampFloatingTerminalBounds,
  getDefaultFloatingTerminalCommittedBounds,
  getDefaultFloatingTerminalBounds,
  getMaximizedFloatingTerminalBounds,
  persistFloatingTerminalPanelBounds,
  readPersistedFloatingTerminalPanelBounds,
  resolveFloatingTerminalPanelCommittedBounds,
  resolveFloatingTerminalPanelBounds,
  shouldReconcileFloatingTerminalPanelBounds,
  type FloatingTerminalPanelBounds,
  type FloatingTerminalPanelCommittedBounds,
  type FloatingTerminalPanelBoundsSource
} from './floating-terminal-panel-bounds'
import { translate } from '@/i18n/i18n'
import { FloatingTerminalEmptyState } from './floating-terminal-empty-state'
import { consumeFloatingTerminalOpenMaximizedIntent } from '@/lib/floating-terminal'
import { selectFloatingTerminalPanelInputs } from './floating-terminal-panel-inputs'
const LOCAL_RUNTIME_SETTINGS = { activeRuntimeEnvironmentId: null } as const
const NO_ACTIVITY_TERMINAL_PORTALS = []

const EditorPanel = lazy(() => import('@/components/editor/EditorPanel'))

type FloatingTerminalPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tourInteractionSnapshot?: FloatingWorkspaceTourInteractionSnapshot | null | undefined
}

type FloatingWorkspaceTourInteractionSnapshot = {
  wasPreviouslyInteracted?: boolean
  persisted?: Promise<void>
  recordFeatureInteractionForTour: boolean
}

type FloatingPanelShortcutInput = Partial<
  Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
> &
  Pick<KeyboardEvent, 'target'> & { doubleTapModifier?: PhysicalModifierToken }

// Tri-state dispatch outcome: 'deferred' means "matched, but leave DOM propagation intact so the
// terminal pane's L3 handler closes the focused split pane" — callers must NOT consume it. Both
// 'handled' and 'deferred' stop L2's own directional dispatch; only 'unmatched' falls through.
type FloatingShortcutOutcome = 'handled' | 'deferred' | 'unmatched'

// What the panel claimed for one keydown, resolved once and then applied — see resolveFloatingPanelShortcut.
type FloatingPanelShortcutResolution =
  | { kind: 'create'; action: Exclude<FloatingWorkspacePanelOwnedAction, 'tab.close'> }
  | { kind: 'close'; focusedFloatingTerminal: boolean }
  | { kind: 'index'; index: number }
  | { kind: 'chrome'; action: KeybindingActionId }

const FLOATING_TERMINAL_NO_DRAG_SELECTOR =
  'button,input,textarea,select,[role="menuitem"],[data-testid="sortable-tab"],[data-floating-terminal-no-drag]'
const FLOATING_TERMINAL_SHORTCUT_SURFACE_SELECTOR = '[data-floating-terminal-shortcut-surface]'

type FloatingTerminalPanelBoundsState = {
  committedBounds: FloatingTerminalPanelCommittedBounds
  renderedBounds: FloatingTerminalPanelBounds
  source: FloatingTerminalPanelBoundsSource
}

function isFloatingTerminalDragTarget(target: EventTarget): boolean {
  return !(target instanceof HTMLElement && target.closest(FLOATING_TERMINAL_NO_DRAG_SELECTOR))
}

function readInitialPanelBounds(): FloatingTerminalPanelBoundsState {
  const defaultCommittedBounds = getDefaultFloatingTerminalCommittedBounds()
  const defaultRenderedBounds = getDefaultFloatingTerminalBounds()
  const persistedBounds = readPersistedFloatingTerminalPanelBounds()
  return persistedBounds
    ? {
        committedBounds: persistedBounds,
        renderedBounds: shouldReconcileFloatingTerminalPanelBounds('user')
          ? resolveFloatingTerminalPanelBounds(persistedBounds, 'user')
          : resolveFloatingTerminalPanelCommittedBounds(persistedBounds),
        source: 'user'
      }
    : {
        committedBounds: defaultCommittedBounds,
        renderedBounds: defaultRenderedBounds,
        source: 'default'
      }
}

function areFloatingTerminalPanelCommittedBoundsEqual(
  left: FloatingTerminalPanelCommittedBounds | null,
  right: FloatingTerminalPanelCommittedBounds
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right)
}

// Last atomic focus payload sent to main; module-scoped so send-on-change dedupe survives re-renders.
let lastReportedFloatingFocus: { panelFocused: boolean; terminalFocused: boolean } | null = null
// The IPC fn the dedupe above is keyed to; if the preload surface swaps (HMR/version skew), re-emit.
let lastReportedFloatingFocusFn: unknown = null

// Single guarded reporter for both focus bits. `release === true` means the panel is
// explicitly losing keyboard ownership (outside pointer-down, close, unmount, window blur); otherwise both
// bits derive from the next focus/blur target. Enforces panel ⊇ terminal and emits one atomic payload on change.
function reportFloatingFocus(next: EventTarget | null, release = false): void {
  const setFloatingFocus = window.api.ui.setFloatingFocus
  // Why: dev reloads can pair a new renderer with an older preload; losing this
  // shortcut mirror should not take down the whole React tree.
  if (typeof setFloatingFocus !== 'function') {
    return
  }
  if (setFloatingFocus !== lastReportedFloatingFocusFn) {
    lastReportedFloatingFocus = null
    lastReportedFloatingFocusFn = setFloatingFocus
  }
  const terminalFocused = !release && isFloatingWorkspaceTerminalInputTarget(next)
  const panelFocused =
    !release && (terminalFocused || isEventTargetInsideFloatingWorkspacePanel(next))
  if (
    lastReportedFloatingFocus !== null &&
    lastReportedFloatingFocus.panelFocused === panelFocused &&
    lastReportedFloatingFocus.terminalFocused === terminalFocused
  ) {
    return
  }
  lastReportedFloatingFocus = { panelFocused, terminalFocused }
  setFloatingFocus({ panelFocused, terminalFocused })
}

// Reset the send-on-change dedupe (test-only): the mock setFloatingFocus keeps one identity across
// tests, so without this a prior test's last-reported payload would suppress the next test's first emit.
export function clearReportedFloatingFocusCache(): void {
  lastReportedFloatingFocus = null
  lastReportedFloatingFocusFn = null
}


export function FloatingTerminalPanelView({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    activateFloatingItem,
    activateTab,
    active,
    activeBrowserId,
    activeBrowserTab,
    activeClosableTab,
    activeEditorFile,
    activeEditorFileId,
    activeEditorUnifiedId,
    activeGroup,
    activeTab,
    activeTabType,
    activeTerminalId,
    advanceEditorCloseQueue,
    anchoredBounds,
    applyFloatingPanelShortcut,
    armIfEmptying,
    assignments,
    bounds,
    boundsSourceRef,
    browserDefaultUrl,
    browserItems,
    browserTab,
    browserTabs,
    cancelShortcutFocusFrame,
    clampedBounds,
    closeActiveFloatingTerminalPane,
    closeAllFiles,
    closeBrowserTab,
    closeFile,
    closeFloatingItemConfirmed,
    closeFloatingItems,
    closeOthers,
    closeShortcut,
    closeTab,
    closeToLeft,
    closeToRight,
    closeToSide,
    closeUnifiedTab,
    commitUserBounds,
    committedBoundsRef,
    consume,
    context,
    createBrowserTab,
    createFloatingBrowserTab,
    createFloatingMarkdownTab,
    createFloatingTerminalTab,
    createTab,
    currentGroup,
    currentGroupTabs,
    cwd,
    detail,
    detected,
    dirtyEditorFileIds,
    dismissOrchestrationSetup,
    dispatchShortcut,
    document,
    doubleTapDetectorRef,
    drag,
    dragRef,
    dx,
    dy,
    editorItems,
    expandedPaneByTabId,
    file,
    fileId,
    fileInfo,
    floatingChromeMatchOptions,
    floatingFiles,
    floatingShortcutListenersRef,
    floatingTerminalCwd,
    focusPanel,
    focusPanelForShortcuts,
    focusPanelForShortcutsAfterClose,
    focusedFloatingTerminal,
    generatedTabTitlesEnabled,
    getNextQueuedEditorClose,
    groupTabs,
    groups,
    handle,
    handleDragEnd,
    handleDragMove,
    handleDragStart,
    handleFloatingPanelBlur,
    handleFloatingPanelKeyDown,
    handleFloatingPanelKeyUp,
    handleFloatingPanelShortcutAction,
    handleFloatingSaveDialogCancel,
    handleFloatingSaveDialogDiscard,
    handleFloatingSaveDialogSave,
    handleGuestClose,
    handleGuestSelectIndex,
    handleOutsidePointerDown,
    handleResize,
    handleSetupStateChange,
    handleShortcutSurfaceKeyDown,
    handleTitlebarDoubleClick,
    handleWindowBlur,
    handleWindowFocus,
    hasVisibleFloatingTabs,
    index,
    initialBoundsStateRef,
    isFloatingTerminalInput,
    isPanelFocused,
    item,
    itemCountAfterClose,
    itemCountBeforeClose,
    items,
    lastPersistedBoundsRef,
    latest,
    listeners,
    makePreviewFilePermanent,
    markFileDirty,
    markdownCwd,
    matchOptions,
    matches,
    maximizePanel,
    maximized,
    mountedRef,
    nativeEvent,
    newBrowserShortcut,
    newMarkdownShortcut,
    newTerminalShortcut,
    nextBounds,
    nextFileId,
    onOpenChange,
    open,
    openFile,
    openFloatingMarkdownTab,
    openMarkdownShortcut,
    orchestrationDialogOpen,
    ownedAction,
    panel,
    panelOwnedNow,
    panelRef,
    panelShortcut,
    parkedTerminalTabIds,
    pending,
    pendingEditorCloseQueueRef,
    pendingReclaimArmByFileIdRef,
    pendingReclaimArms,
    persistUserBounds,
    pinFile,
    platform,
    previewUserBounds,
    queueEditorCloseRequests,
    reclaim,
    reclaimTerminalInputOnWindowFocusRef,
    reconcileBounds,
    refreshOrchestrationSetupVisibility,
    reportFloatingFocusFromTarget,
    resolution,
    resolveFloatingPanelShortcut,
    restoreBoundsRef,
    restoredBounds,
    restoredState,
    saveDialogFileIdRef,
    setActiveTab,
    setBounds,
    setCwd,
    setMarkdownCwd,
    setMaximized,
    setOrchestrationDialogOpen,
    setPanelNode,
    setShowOrchestrationSetup,
    setTabColor,
    setTabCustomTitle,
    setTabPaneExpanded,
    shortcutFocusFrameRef,
    shortcutFocusTimeoutRef,
    showOrchestrationSetup,
    sideIds,
    simulatorItems,
    source,
    stagedBoundsRef,
    state,
    status,
    switchAllTypesDirection,
    switchSameTypeDirection,
    tab,
    tabBarOrder,
    tabById,
    tabs,
    target,
    terminalAssignments,
    terminalItems,
    terminalPaneRegistry,
    terminalShortcutPolicy,
    terminalTab,
    terminalTabById,
    terminalTabDirection,
    toggleMaximized,
    tourInteractionSnapshot,
    unifiedTabs,
    url,
    visibleFloatingItemCount,
    visibleFloatingTabOrder,
    visibleId,
    workspace,
  } = context

  return (
    // Why: sit above the z-40 notification cards so the floating workspace is
    // never buried behind them, but stay under the z-50 modal layer so its own
    // orchestration/save dialogs (and every app modal) still open above it.
    // Drop shadow on the outer shell, border on an inner shell — mixing both on
    // one rounded node made corners look stubby. Floating tabs skip their top
    // border so the titlebar curve stays clean.
    <div
      ref={setPanelNode}
      data-floating-terminal-panel
      aria-hidden={!open}
      tabIndex={-1}
      className={`fixed z-[45] flex min-h-[280px] min-w-[420px] rounded-lg bg-transparent text-card-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16),0_24px_64px_rgba(0,0,0,0.32)] outline-none dark:shadow-[0_8px_20px_rgba(0,0,0,0.35),0_28px_72px_rgba(0,0,0,0.58)] ${open ? 'opacity-100' : 'invisible pointer-events-none opacity-0'}`}
      style={{
        visibility: open ? 'visible' : 'hidden',
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      }}
      onMouseUp={(event) => {
        if (maximized || !stagedBoundsRef.current) {
          return
        }
        const rect = event.currentTarget.getBoundingClientRect()
        commitUserBounds({ ...stagedBoundsRef.current, width: rect.width, height: rect.height })
      }}
      onFocusCapture={(event) => reportFloatingFocusFromTarget(event.target)}
      onBlurCapture={(event) => {
        // Why: keep terminal-first shortcut ownership latched during the
        // synchronous macOS IME refresh blur; refocus or its skip callback settles it.
        if (!isTerminalImeInputContextRefreshing(event.target)) {
          reportFloatingFocusFromTarget(event.relatedTarget)
        }
      }}
      onKeyDownCapture={handleShortcutSurfaceKeyDown}
    >
      <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-black/14 bg-card dark:border-white/14">
        <div
          className="flex h-9 shrink-0 cursor-grab items-center border-b border-border bg-[var(--bg-titlebar,var(--card))] active:cursor-grabbing"
          data-floating-terminal-shortcut-surface
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          onDoubleClick={handleTitlebarDoubleClick}
        >
          <div className="flex h-full min-w-0 flex-1">
            <TabBar
              tabs={terminalItems}
              activeTabId={activeTerminalId}
              worktreeId={FLOATING_TERMINAL_WORKTREE_ID}
              expandedPaneByTabId={expandedPaneByTabId}
              onActivate={activateFloatingItem}
              onClose={closeFloatingItemConfirmed}
              onCloseOthers={closeOthers}
              onCloseToRight={closeToRight}
              onCloseToLeft={closeToLeft}
              onNewTerminalTab={() => createFloatingTerminalTab()}
              onNewTerminalWithShell={createFloatingTerminalTab}
              onNewBrowserTab={createFloatingBrowserTab}
              onNewFileTab={createFloatingMarkdownTab}
              onOpenFileTab={openFloatingMarkdownTab}
              newTabMenuOrder="markdown-first"
              onSetCustomTitle={setTabCustomTitle}
              onSetTabColor={setTabColor}
              onTogglePaneExpand={(tabId) =>
                setTabPaneExpanded(tabId, expandedPaneByTabId[tabId] !== true)
              }
              editorFiles={editorItems}
              browserTabs={browserItems}
              activeFileId={activeEditorUnifiedId}
              activeBrowserTabId={activeBrowserId}
              activeSimulatorTabId={activeTab?.contentType === 'simulator' ? activeTab.id : null}
              activeTabType={activeTabType}
              onActivateFile={activateFloatingItem}
              onCloseFile={closeFloatingItemConfirmed}
              onActivateBrowserTab={activateFloatingItem}
              onCloseBrowserTab={closeFloatingItemConfirmed}
              onDuplicateBrowserTab={(browserTabId) => {
                const source = browserTabs.find((tab) => tab.id === browserTabId)
                if (!source) {
                  return
                }
                createBrowserTab(FLOATING_TERMINAL_WORKTREE_ID, source.url, {
                  ...buildDuplicatedBrowserTabOptions(source),
                  targetGroupId: activeGroup?.id,
                  browserRuntimeEnvironmentId: null
                })
              }}
              onCloseAllFiles={closeAllFiles}
              onMakePreviewFilePermanent={makePreviewFilePermanent}
              onPinFile={pinFile}
              tabBarOrder={tabBarOrder}
              tabStripChrome="floating-panel"
            />
          </div>
          <FloatingTerminalWindowControls
            maximized={maximized}
            onToggleMaximized={toggleMaximized}
            onMinimize={() => onOpenChange(false)}
          />
        </div>

        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-background"
          data-contextual-tour-target={
            hasVisibleFloatingTabs ? 'floating-workspace-surface' : undefined
          }
        >
          {cwd
            ? tabs
                .filter((tab) => !parkedTerminalTabIds.has(tab.id))
                .map((tab) => {
                  const isActive = tab.id === activeTerminalId
                  return (
                    <div
                      key={`${tab.id}-${tab.generation ?? 0}`}
                      className={isActive ? 'absolute inset-0' : 'absolute inset-0 hidden'}
                      aria-hidden={!isActive}
                    >
                      <TerminalPane
                        ref={terminalPaneRegistry.getRefCallback(tab.id)}
                        tabId={tab.id}
                        worktreeId={FLOATING_TERMINAL_WORKTREE_ID}
                        cwd={cwd}
                        isActive={isActive}
                        // Why: the closed panel is only CSS-hidden, so gate
                        // visibility on `open` too. This routes the floating
                        // terminal through the standard hidden-terminal
                        // suspend/resume path: no live WebGL context (or glyph
                        // atlas to corrupt) while hidden, and the resume on
                        // reopen rebuilds the renderer from scratch.
                        isVisible={isActive && open}
                        onPtyExit={(ptyId) => {
                          if (shouldDeferParkedPtyExitTabClose(tab.id, ptyId)) {
                            return
                          }
                          closeTerminalTab(tab.id, {
                            reason: 'pty-exit',
                            lifecyclePtyId: ptyId
                          })
                        }}
                        onCloseTab={() => closeFloatingItemConfirmed(tab.id)}
                      />
                    </div>
                  )
                })
            : null}
          {browserTabs.map((tab) => {
            const isActive = tab.id === activeBrowserTab?.id
            return (
              <div
                key={tab.id}
                className={isActive ? 'absolute inset-0 flex' : 'absolute inset-0 hidden'}
                aria-hidden={!isActive}
              >
                <FloatingBrowserSlot browserTab={tab} isActive={open && isActive} />
              </div>
            )
          })}
          {simulatorItems.map((tab) => {
            const isActive = tab.id === activeTab?.id
            return (
              <div
                key={tab.id}
                className={isActive ? 'absolute inset-0 flex' : 'absolute inset-0 hidden'}
                aria-hidden={!isActive}
              >
                <EmulatorPane tab={tab} worktreeId={tab.worktreeId} isActive={open && isActive} />
              </div>
            )
          })}
          {activeEditorFile ? (
            <div className="absolute inset-0 flex min-h-0 min-w-0">
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {translate(
                      'auto.components.floating.terminal.FloatingTerminalPanel.d6b563ae24',
                      'Loading editor...'
                    )}
                  </div>
                }
              >
                {/* Why: floating workspace markdown is scratch/local context,
                    not a repo review surface that should expose agent notes. */}
                <EditorPanel
                  activeFileId={activeEditorFile.id}
                  activeViewStateId={activeEditorUnifiedId}
                  markdownAnnotationsEnabled={false}
                />
              </Suspense>
            </div>
          ) : null}
          {!hasVisibleFloatingTabs ? (
            <FloatingTerminalEmptyState
              onNewTerminal={() => createFloatingTerminalTab()}
              onNewMarkdown={createFloatingMarkdownTab}
              onOpenMarkdown={openFloatingMarkdownTab}
              onNewBrowser={createFloatingBrowserTab}
              onClose={() => onOpenChange(false)}
              onFocusPanel={focusPanelForShortcuts}
              newTerminalShortcut={newTerminalShortcut}
              newBrowserShortcut={newBrowserShortcut}
              newMarkdownShortcut={newMarkdownShortcut}
              openMarkdownShortcut={openMarkdownShortcut}
              closeShortcut={closeShortcut}
            />
          ) : null}
        </div>
      </div>
      {showOrchestrationSetup && activeTabType === 'terminal' ? (
        <div
          className="absolute right-4 bottom-4 z-10 w-[280px] rounded-md border border-border/60 bg-card/95 p-3 text-card-foreground shadow-xs"
          data-floating-terminal-no-drag
        >
          <div className="space-y-2">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalPanel.2a3c5ddf5e',
                  'Enable orchestration'
                )}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalPanel.8cf80db43b',
                  'Set up the Orca CLI and agent skill so agents can coordinate through Orca.'
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={dismissOrchestrationSetup}
              >
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalPanel.adc281394d',
                  'Dismiss'
                )}
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="flex-1"
                onClick={() => setOrchestrationDialogOpen(true)}
              >
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalPanel.bbc177f98f',
                  'Enable'
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {!maximized && (
        <FloatingTerminalResizeHandles
          bounds={bounds}
          onPreviewBounds={previewUserBounds}
          onCommitBounds={commitUserBounds}
        />
      )}
      <FloatingTerminalOrchestrationDialog
        open={orchestrationDialogOpen}
        onOpenChange={setOrchestrationDialogOpen}
        onSetupStateChange={() => void refreshOrchestrationSetupVisibility()}
      />
      <Dialog
        open={saveDialogFileId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleFloatingSaveDialogCancel()
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate(
                'auto.components.floating.terminal.FloatingTerminalPanel.690b6fb98a',
                'Unsaved Changes'
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {saveDialogFile
                ? translate(
                    'auto.components.floating.terminal.FloatingTerminalPanel.5ddc688c52',
                    '"{{value0}}" has unsaved changes. Do you want to save before closing?',
                    { value0: saveDialogFile.relativePath.split('/').pop() }
                  )
                : translate(
                    'auto.components.floating.terminal.FloatingTerminalPanel.b085fb58b5',
                    'This file has unsaved changes.'
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFloatingSaveDialogCancel}
            >
              {translate(
                'auto.components.floating.terminal.FloatingTerminalPanel.e7bf09d4d4',
                'Cancel'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFloatingSaveDialogDiscard}
            >
              {translate(
                'auto.components.floating.terminal.FloatingTerminalPanel.918c2139f3',
                "Don't Save"
              )}
            </Button>
            <Button type="button" size="sm" onClick={handleFloatingSaveDialogSave}>
              {translate(
                'auto.components.floating.terminal.FloatingTerminalPanel.da508bd7f5',
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

