import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Minimize2,
  MoreHorizontal,
  PanelLeft,
  PanelRight
} from 'lucide-react'
import logo from '../../../resources/logo.svg'
import { SYNC_FIT_PANES_EVENT, TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'
import { syncZoomCSSVar } from '@/lib/ui-zoom'
import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'
import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { resolveLeftTitlebarChromeLayout } from '@/lib/titlebar-left-chrome'
import { shouldShowWorktreeCreationSurface } from '@/lib/worktree-creation-surface'
import { buildAppFontFamily } from '@/lib/app-font-family'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useAppStore } from './store'
import { WORKTREE_REFRESH_CONCURRENCY } from './store/slices/worktrees'
import { useShallow } from 'zustand/react/shallow'
import { isRemoteWorkspaceSnapshotApplyInProgress, useIpcEvents } from './hooks/useIpcEvents'
import RetainedAgentsSyncGate from './components/dashboard/RetainedAgentsSyncGate'
import { AgentHibernationGate } from './components/AgentHibernationGate'
import { ActivityTitlebarControls } from './components/activity/ActivityTitlebarControls'
import Sidebar from './components/Sidebar'
import { shutdownBufferCaptures } from './components/terminal-pane/shutdown-buffer-captures'
import { dispatchWindowCloseRequest } from './components/window-close-request-coordinator'
import {
  getSystemPrefersDarkSnapshot,
  useSystemPrefersDark
} from './components/terminal-pane/use-system-prefers-dark'
import RightSidebar from './components/right-sidebar'
import { StarNagCard } from './components/StarNagCard'
import { StarNagAgentValueMomentObserver } from './components/star-nag/StarNagAgentValueMomentObserver'
import { StarNagToastHost } from './components/star-nag/StarNagToastHost'
import { SkillFreshnessNudge } from './components/skills/SkillFreshnessNudge'
import { SkillFreshnessUpdateDialog } from './components/skills/SkillFreshnessUpdateDialog'
import { TelemetryFirstLaunchSurface } from './components/TelemetryFirstLaunchSurface'
import { ZoomOverlay } from './components/ZoomOverlay'
import { onOnboardingReopened } from './components/onboarding/show-onboarding-event'
import { shouldShowOnboarding } from './components/onboarding/should-show-onboarding'
import { MarkdownTemplatePicker } from './components/editor/MarkdownTemplatePicker'
import { FloatingTerminalToggleButton } from './components/floating-terminal/FloatingTerminalToggleButton'
import { OrcaProfileSwitcher } from './components/orca-profiles/OrcaProfileSwitcher'
import {
  TOGGLE_FLOATING_TERMINAL_EVENT,
  requestFloatingTerminalOpenMaximized
} from '@/lib/floating-terminal'
import {
  isFloatingWorkspacePanelFocused,
  isFloatingWorkspaceTerminalInputTarget,
  matchFloatingWorkspacePanelChord,
  shouldMinimizeFloatingWorkspacePanelOnCloseShortcut
} from '@/lib/floating-workspace-terminal-actions'
import { createFloatingWorkspaceTourInteractionSnapshot } from '@/lib/floating-workspace-tour-interaction-snapshot'
import { requestScrollToCurrentWorkspaceRevealAndRename } from '@/lib/scroll-to-current-workspace-status'
import { OPEN_WORKSPACE_BOARD_EVENT } from './components/sidebar/useWorkspaceBoardPanel'
import { WorkspacePortScanner } from './components/ports/WorkspacePortScanner'
import { CrashReportDialog } from './components/crash-report/CrashReportDialog'
import NewWorkspaceComposerModal from './components/NewWorkspaceComposerModal'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import { ConfirmationDialogProvider } from './components/confirmation-dialog'
import { LinkRoutingPreferenceDialogProvider } from './components/link-routing-preference-dialog'
import RecentTabSwitcher from './components/tab-bar/RecentTabSwitcher'
import { useGitStatusPolling } from './components/right-sidebar/useGitStatusPolling'
import { useEditorExternalWatch } from './hooks/useEditorExternalWatch'
import { useAutoAckViewedAgent } from './hooks/useAutoAckViewedAgent'
import { useDashboardPopoutBridge } from './components/dashboard/useDashboardPopoutBridge'
import { useUnreadDockBadge } from './hooks/useUnreadDockBadge'
import {
  resolvePrimarySelectionMiddleClickPaste,
  usePrimarySelectionPaste
} from './hooks/usePrimarySelectionPaste'
import { useAppMenuPaste } from './hooks/useAppMenuPaste'
import { useLargeTextControlPaste } from './hooks/useLargeTextControlPaste'
import {
  canSkipRuntimeMobileSessionSyncKeyBuild,
  getRuntimeMobileSessionSyncKey,
  runtimeMobileSessionSyncKeysEqual,
  scheduleRuntimeGraphSync,
  setRuntimeGraphStoreStateGetter,
  setRuntimeGraphSyncEnabled
} from './runtime/sync-runtime-graph'
import { useWebSessionTabsSync } from './runtime/web-session-tabs-sync'
import { useGlobalFileDrop } from './hooks/useGlobalFileDrop'
import { MacosTccPromptNoticeHost } from './hooks/MacosTccPromptNoticeHost'
import { useRadixBodyPointerEventsRecovery } from './hooks/useRadixBodyPointerEventsRecovery'
import { registerUpdaterBeforeUnloadBypass } from './lib/updater-beforeunload'
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT
} from '../../shared/updater-renderer-events'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../shared/renderer-shutdown-events'
import {
  buildWorkspaceSessionPayload,
  shouldPersistWorkspaceSession
} from './lib/workspace-session'
import { createSessionWriteSubscriber } from './lib/session-write-subscriber'
import { buildActiveViewUnloadPatch } from './lib/active-view-persist'
import {
  buildWorkspaceSessionHostSnapshots,
  fetchWorkspaceSessionWithRuntimeHostOwners,
  patchWorkspaceSessionByHost
} from './lib/workspace-session-host-persistence'
import {
  createShutdownCheckpointBeforeUnloadHandler,
  createShutdownCheckpointGuard
} from './lib/shutdown-checkpoint-guard'
import {
  collectFolderWorkspaceKeysFromSession,
  collectWorktreeHydrationRepoIdsFromSession
} from './lib/workspace-session-hydration-keys'
import {
  getStartupErrorFallbackUI,
  hydratePersistedUIAfterStartupRead
} from './lib/startup-ui-hydration'
import {
  logRendererStartupDiagnostic,
  timeRendererStartupStep,
  timeRendererStartupSyncStep
} from './startup/startup-diagnostics'
import { reconnectSshTargetForRendererStartup } from './startup/ssh-startup-reconnect'
import { shouldRenderPetOverlay } from './components/pet/pet-overlay-visibility'
import { applyDocumentTheme } from './lib/document-theme'
import { getSystemPrefersDark } from './lib/terminal-theme'
import { publishTerminalViewAttributesAtAppStart } from './components/terminal-pane/terminal-appearance'
import { isEditableTarget } from './lib/editable-target'
import { getSelectedTextForFileSearch } from './lib/file-search-selection'
import { useShortcutLabel } from './hooks/useShortcutLabel'
import {
  folderRelativePathToIncludeGlob,
  selectedExplorerFolderRelativePath
} from './components/right-sidebar/file-search-include-pattern'
import { shouldShowWorktreeHistoryControls } from './lib/titlebar-worktree-history-controls'
import {
  canGoBackWorktreeHistory,
  canGoForwardWorktreeHistory
} from '@/store/slices/worktree-nav-history'
import { selectFloatingVisibleTabCount } from './store/selectors'
import { selectActiveTerminalChromeState } from './store/active-terminal-chrome-selector'
import type { VirtualizedScrollAnchor } from './hooks/useVirtualizedScrollAnchor'
import type { OnboardingState } from '../../shared/types'
import { getFeatureTipsAppOpenDecision } from './components/feature-tips/feature-tip-startup-gate'
import { trackCmdJPaletteFeatureTipShown } from './components/feature-tips/feature-tip-telemetry'
import {
  keybindingMatchesAction,
  type KeybindingActionId,
  type KeybindingContext,
  type KeybindingMatchOptions
} from '../../shared/keybindings'
import { PLUGIN_COMMAND_ALIAS_ACTION_IDS } from '../../shared/plugins/plugin-command-actions'
import { registerAppCommandDispatcher } from '@/lib/app-command-dispatch'
import { executePluginCommand } from '@/lib/plugin-command-execution'
import { findPluginCommandForKeybinding } from '@/lib/plugin-command-keybindings'
import { usePluginCommands } from '@/store/plugin-panels'
import {
  getRepoExecutionHostId,
  isRuntimeOwnedSshTargetId,
  parseExecutionHostId
} from '../../shared/execution-host'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import {
  ModifierDoubleTapDetector,
  toModifierDoubleTapEvent
} from '../../shared/modifier-double-tap-detector'
import { isGitRepoKind } from '../../shared/repo-kind'
import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'
import { resolveMountedLazyModalIds, type LazyModalId } from './lazy-modal-mount-state'
import { translate } from '@/i18n/i18n'
import PinnedTabCloseDialog from './components/terminal-pane/PinnedTabCloseDialog'
import WorktreeBaseFallbackDialog from './components/WorktreeBaseFallbackDialog'
import { useOsc52ClipboardDefaultOnNotice } from './components/terminal-pane/osc52-clipboard-default-on-notice'
import {
  hasRequestedBackgroundTerminalWorktreeMount,
  subscribeBackgroundTerminalWorktreeMountRequests
} from './components/terminal/background-terminal-worktree-mount'
import { useRemoteRuntimeRecoveryTriggers } from './runtime/use-remote-runtime-recovery-triggers'
import {
  getKeybindingContext,
  hasCustomTitleBar,
  isMacPlatform,
  SLEEPING_AGENT_RESUME_CAPTURE_INTERVAL_MS,
  shortcutPlatform,
  type ShortcutDispatchInput
} from './app-shell-model'
import { listRuntimeSessionHostIdsForStartup } from './app-shell-actions'
import {
  ActivityPrototypePage,
  applyRemoteWorkspacePatchStatus,
  AddProjectFromFolderDialog,
  AddRepoDialog,
  ContextualTourOverlay,
  DeleteWorktreeDialog,
  DictationController,
  FeatureTipsModal,
  FeatureWallModal,
  FloatingTerminalPanel,
  Landing,
  MobilePage,
  NonGitFolderDialog,
  OnboardingFlow,
  PetOverlay,
  ProjectAddedDialog,
  QuickOpen,
  RemoteServerUpdateDialog,
  Settings,
  SetupGuideModal,
  SetupGuideTelemetryObserver,
  shouldMountUpdateCardForStatus,
  SkillsPage,
  SshPassphraseDialog,
  StatusBar,
  TaskPage,
  Terminal,
  UpdateCard,
  WindowControls,
  WorkspaceCleanupDialog,
  WorktreeCreationPanel,
  WorktreeJumpPalette,
  WorkspaceSpacePage
} from './app-shell-dependencies'
export function AppShellPageRenderer(props: Record<string, unknown>): React.JSX.Element {
  const {
    actions,
    activeModal,
    activePendingCreationId,
    activeView,
    activeWorktreeId,
    beginOnboardingSettingsDetour,
    collapsedSidebarHeaderWidth,
    creationLayoutActive,
    floatingTerminalOpen,
    floatingWorkspaceTourInteractionSnapshotRef,
    hasSshCredentialRequest,
    leftSidebarStyle,
    leftTitlebarChromeLayout,
    onboarding,
    onboardingSettingsDetourActive,
    petVisible,
    renderPetOverlay,
    resolvedMountedLazyModalIds,
    rightSidebarExplorerView,
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarToggle,
    setAppRootNode,
    setFloatingTerminalOpenWithFocus,
    setOnboarding,
    settings,
    shouldMountAddRepoDialog,
    shouldMountContextualTourOverlay,
    shouldMountDictationController,
    shouldMountFloatingTerminalPanel,
    shouldMountSetupGuideTelemetryObserver,
    shouldMountTerminalWorkbench,
    shouldMountUpdateCard,
    shouldRenderOnboarding,
    showFloatingTerminalButton,
    showRightSidebarControls,
    showSidebar,
    sidebarOpen,
    stackedSidebarOpen,
    statusBarVisible,
    terminalWorkbenchVisible,
    titlebarLeftControls,
    titlebarMainStrip,
    workspaceChromeActive,
    workspaceProfileSwitcher,
    workspaceSessionReady,
    worktreeSidebarScrollAnchorRef,
    worktreeSidebarScrollOffsetRef
  } = props as any
  return (
    <div
      ref={setAppRootNode}
      className="app-layout"
      style={
        {
          '--collapsed-sidebar-header-width': `${collapsedSidebarHeaderWidth}px`,
          // Shared so surfaces can avoid the Windows/Linux window-controls overlay without hardcoding 138px everywhere.
          '--window-controls-width': hasCustomTitleBar ? '138px' : '0px',
          // Side-position activity bar uses this to push icons below the Windows/Linux window-controls overlay.
          '--window-controls-height': hasCustomTitleBar ? '36px' : '0px'
        } as React.CSSProperties
      }
    >
      <TooltipProvider delayDuration={400}>
        <ConfirmationDialogProvider>
          <LinkRoutingPreferenceDialogProvider>
            <WorkspacePortScanner enabled={workspaceSessionReady} />
            {/* Why: plugin language-pack discovery must not re-render the App shell. */}
            <MacosTccPromptNoticeHost />
            {/* Why: leaf-mounted retention sync keeps agent-status subscriptions out of the App render tree. */}
            <RetainedAgentsSyncGate />
            <AgentHibernationGate />
            {/* Why: workspace activation is a hot path; activeWorktreeId in reset keys would remount whole surfaces during wake. */}
            <RecoverableRenderErrorBoundary
              boundaryId="app.workspace-shell"
              surface="workspace-shell"
              resetKey={activeView}
              title={translate('auto.App.df1d56bf87', 'The workspace shell hit an error.')}
              description={translate(
                'auto.App.8504ddf267',
                'The app is still running. Retry the shell or use the menu to report the crash details.'
              )}
            >
              <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
                {/* Why: keep the non-workspace titlebar inside this left+center wrapper so it doesn't span over the right-sidebar column. */}
                <div className="flex flex-col flex-1 min-w-0 min-h-0">
                  {/* Why: workspace view drops the full-width titlebar so tab groups extend to the top; settings/landing/tasks keep it. */}
                  {!leftTitlebarChromeLayout.shouldMount ? (
                    <div className="titlebar">
                      <div className="flex items-center shrink-0 mr-2">{titlebarLeftControls}</div>
                      {titlebarMainStrip}
                    </div>
                  ) : null}
                  <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
                    {showSidebar ? (
                      leftTitlebarChromeLayout.shouldMount ? (
                        /* Why: when the sidebar is collapsed, take this titlebar-height header out of flex layout so the terminal/editor reclaim the left edge. */
                        <div
                          className={`flex min-h-0 flex-col shrink-0${sidebarOpen ? '' : ' relative w-0 overflow-visible'}`}
                        >
                          <div
                            // Why: floating titlebar-left occludes the center column's border-l seam; border-r restores that line, w-max sizes it to its own controls.
                            className={`titlebar-left${
                              leftTitlebarChromeLayout.isFloating
                                ? ' titlebar-left-floating absolute top-0 left-0 z-10 w-max border-r border-border'
                                : ''
                            }`}
                            style={{
                              // Why: custom sidebar appearances are scoped to the sidebar root; mirror those vars onto the header in the same left-column panel.
                              ...(sidebarOpen ? leftSidebarStyle : undefined),
                              // Why: size from the wrapper's live width so the header tracks in-flight drag resizes (persisted to Zustand only on mouseup).
                              width: sidebarOpen ? '100%' : undefined
                            }}
                          >
                            {titlebarLeftControls}
                          </div>
                          <div className="flex min-h-0 flex-1">
                            {/* Why: flex-1/min-h-0 slot needed under the fixed 36px header, else the sidebar collapses to content height and loses its scroll viewport. */}
                            <RecoverableRenderErrorBoundary
                              boundaryId="sidebar.worktrees"
                              surface="sidebar"
                              resetKey={activeView}
                              title={translate(
                                'auto.App.1468601e7b',
                                'The workspace list hit an error.'
                              )}
                              description={translate(
                                'auto.App.bdc71dddc9',
                                'The active workspace remains open. Retry the list or switch views.'
                              )}
                            >
                              <Sidebar
                                worktreeScrollOffsetRef={worktreeSidebarScrollOffsetRef}
                                worktreeScrollAnchorRef={worktreeSidebarScrollAnchorRef}
                              />
                            </RecoverableRenderErrorBoundary>
                          </div>
                        </div>
                      ) : (
                        <RecoverableRenderErrorBoundary
                          boundaryId="sidebar.worktrees"
                          surface="sidebar"
                          resetKey={activeView}
                          title={translate(
                            'auto.App.1468601e7b',
                            'The workspace list hit an error.'
                          )}
                          description={translate(
                            'auto.App.cba0fafda5',
                            'The active page remains open. Retry the list or switch views.'
                          )}
                        >
                          <Sidebar
                            worktreeScrollOffsetRef={worktreeSidebarScrollOffsetRef}
                            worktreeScrollAnchorRef={worktreeSidebarScrollAnchorRef}
                          />
                        </RecoverableRenderErrorBoundary>
                      )
                    ) : null}
                    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
                      {stackedSidebarOpen ? (
                        <div className="titlebar">{titlebarMainStrip}</div>
                      ) : null}
                      <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
                        {/* Why: match the RightSidebar header's 36px/top-0 so the toggle's vertical center is identical open vs closed â else the icon jitters. */}
                        {workspaceChromeActive && !rightSidebarOpen && (
                          <div
                            className="absolute top-0 z-10 flex items-center h-[36px]"
                            style={
                              {
                                // Why: --window-controls-width keeps the toggle clear of the fixed window-controls overlay (138px on custom chrome, 0px otherwise); no internal spacer â one would cover the pane-actions Ellipsis button with an unclickable div.
                                right: 'var(--window-controls-width)',
                                WebkitAppRegion: 'no-drag'
                              } as React.CSSProperties
                            }
                          >
                            {rightSidebarToggle}
                          </div>
                        )}
                        {workspaceProfileSwitcher}
                        <div className="flex flex-1 min-w-0 min-h-0 flex-col">
                          {shouldMountTerminalWorkbench ? (
                            <div
                              className={
                                !terminalWorkbenchVisible
                                  ? 'hidden flex-1 min-w-0 min-h-0'
                                  : 'flex flex-1 min-w-0 min-h-0'
                              }
                            >
                              <Suspense fallback={null}>
                                <RecoverableRenderErrorBoundary
                                  boundaryId="terminal.workbench"
                                  surface="terminal-workbench"
                                  resetKey="terminal"
                                  title={translate(
                                    'auto.App.5a9519aef0',
                                    'The workspace workbench hit an error.'
                                  )}
                                  description={translate(
                                    'auto.App.98d4ea2823',
                                    'Terminal, browser, or editor rendering failed in this workspace. Retry to remount it.'
                                  )}
                                >
                                  <Terminal />
                                </RecoverableRenderErrorBoundary>
                              </Suspense>
                            </div>
                          ) : null}
                          <Suspense fallback={null}>
                            <RecoverableRenderErrorBoundary
                              boundaryId={`page.${activeView}`}
                              surface="page"
                              resetKey={activeView}
                              title={translate('auto.App.b7a714db1e', 'This page hit an error.')}
                              description={translate(
                                'auto.App.03a14f6b5b',
                                'Retry the page or navigate to another Orca surface.'
                              )}
                            >
                              {activeView === 'settings' ? <Settings /> : null}
                              {activeView === 'skills' ? <SkillsPage /> : null}
                              {activeView === 'tasks' ? <TaskPage /> : null}
                              {activeView === 'activity' ? <ActivityPrototypePage /> : null}
                              {activeView === 'space' ? <WorkspaceSpacePage /> : null}
                              {activeView === 'mobile' ? <MobilePage /> : null}
                              {activeView === 'terminal' &&
                              creationLayoutActive &&
                              activePendingCreationId ? (
                                <WorktreeCreationPanel
                                  creationId={activePendingCreationId}
                                  reserveCollapsedSidebarHeaderSpace={
                                    leftTitlebarChromeLayout.isFloating
                                  }
                                />
                              ) : null}
                              {activeView === 'terminal' &&
                              !activeWorktreeId &&
                              !creationLayoutActive ? (
                                <Landing />
                              ) : null}
                            </RecoverableRenderErrorBoundary>
                          </Suspense>
                        </div>
                        {showFloatingTerminalButton ? (
                          <FloatingTerminalToggleButton
                            open={floatingTerminalOpen}
                            onToggle={() => setFloatingTerminalOpenWithFocus((open) => !open)}
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Why: keep the shell mounted for layout stability (heavy panels disconnect while closed); unmount on the distraction-free tasks view. */}
                {showRightSidebarControls ? (
                  <RecoverableRenderErrorBoundary
                    boundaryId="right-sidebar"
                    surface="right-sidebar"
                    resetKey={
                      rightSidebarTab === 'explorer'
                        ? `${rightSidebarTab}:${rightSidebarExplorerView}`
                        : rightSidebarTab
                    }
                    title={translate('auto.App.ed6b168d00', 'The right sidebar hit an error.')}
                    description={translate(
                      'auto.App.8d1e160ed1',
                      'Retry the sidebar or switch tabs to reload this surface.'
                    )}
                  >
                    <RightSidebar />
                  </RecoverableRenderErrorBoundary>
                ) : null}
              </div>
            </RecoverableRenderErrorBoundary>
            {shouldMountFloatingTerminalPanel ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.floating-workspace"
                  surface="overlay"
                  resetKey={floatingTerminalOpen}
                  compact
                  title={translate('auto.App.1b3024bcd6', 'The floating workspace hit an error.')}
                  description={translate(
                    'auto.App.7cbfbf622f',
                    'Retry the floating workspace or close and reopen it.'
                  )}
                >
                  <FloatingTerminalPanel
                    open={floatingTerminalOpen}
                    onOpenChange={setFloatingTerminalOpenWithFocus}
                    tourInteractionSnapshot={floatingWorkspaceTourInteractionSnapshotRef.current}
                  />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {statusBarVisible ? (
              <Suspense
                fallback={
                  <div className="h-6 min-h-[24px] shrink-0 border-t border-border bg-[var(--bg-titlebar,var(--card))]" />
                }
              >
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.status-bar"
                  surface="overlay"
                  resetKey={activeView}
                  compact
                  title={translate('auto.App.2e8ff36f94', 'The status bar hit an error.')}
                  description={translate(
                    'auto.App.8a023cea1f',
                    'Retry the status bar to remount its controls.'
                  )}
                >
                  <StatusBar floatingTerminalOpen={floatingTerminalOpen} />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {/* Why: keep in the entry bundle so a stale/corrupt lazy chunk can't strand users at Create. */}
            {activeModal === 'new-workspace-composer' ? (
              <RecoverableRenderErrorBoundary
                boundaryId="modal.new-workspace-composer"
                surface="modal"
                resetKey
                compact
              >
                <NewWorkspaceComposerModal />
              </RecoverableRenderErrorBoundary>
            ) : null}
            <Suspense fallback={null}>
              {shouldMountAddRepoDialog ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.add-repo"
                  surface="modal"
                  resetKey={activeModal === 'add-repo'}
                  compact
                >
                  <AddRepoDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {/* Why: Settings can start Add Project without Sidebar, so its handoff dialogs must share the root host. */}
              {activeModal === 'confirm-non-git-folder' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.confirm-non-git-folder"
                  surface="modal"
                  resetKey
                  compact
                >
                  <NonGitFolderDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {activeModal === 'confirm-add-project-from-folder' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.confirm-add-project-from-folder"
                  surface="modal"
                  resetKey
                  compact
                >
                  <AddProjectFromFolderDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {activeModal === 'project-added' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.project-added"
                  surface="modal"
                  resetKey
                  compact
                >
                  <ProjectAddedDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            {/* Why: root overlays can render Radix <Tooltip>s; keep inside the shared provider so lazy surfaces mount from any entry point. */}
            <Suspense fallback={null}>
              {resolvedMountedLazyModalIds.has('workspace-cleanup') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.workspace-cleanup"
                  surface="modal"
                  resetKey={activeModal === 'workspace-cleanup'}
                  compact
                >
                  <WorkspaceCleanupDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            <Suspense fallback={null}>
              {resolvedMountedLazyModalIds.has('quick-open') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.quick-open"
                  surface="modal"
                  resetKey={activeModal === 'quick-open'}
                  compact
                >
                  <QuickOpen />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('worktree-palette') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.worktree-palette"
                  surface="modal"
                  resetKey={activeModal === 'worktree-palette'}
                  compact
                >
                  <WorktreeJumpPalette />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('setup-guide') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.setup-guide"
                  surface="modal"
                  resetKey={activeModal === 'setup-guide'}
                  compact
                >
                  <SetupGuideModal />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('feature-wall') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.feature-wall"
                  surface="modal"
                  resetKey={activeModal === 'feature-wall'}
                  compact
                >
                  <FeatureWallModal />
                </RecoverableRenderErrorBoundary>
              ) : null}
              {resolvedMountedLazyModalIds.has('feature-tips') ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.feature-tips"
                  surface="modal"
                  resetKey={activeModal === 'feature-tips'}
                  compact
                >
                  <FeatureTipsModal />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            {shouldMountSetupGuideTelemetryObserver ? (
              <Suspense fallback={null}>
                <SetupGuideTelemetryObserver />
              </Suspense>
            ) : null}
            {shouldMountContextualTourOverlay ? (
              <Suspense fallback={null}>
                <ContextualTourOverlay />
              </Suspense>
            ) : null}
            {/* Why: mount only after UI hydration, else a hidden pet flashes while the store still holds default visibility. */}
            {renderPetOverlay ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.pet"
                  surface="overlay"
                  resetKey={petVisible}
                  compact
                >
                  <PetOverlay />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {shouldMountUpdateCard ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.update-card"
                  surface="overlay"
                  resetKey={activeView}
                  compact
                >
                  <UpdateCard />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.star-nag"
              surface="overlay"
              resetKey={activeView}
              compact
            >
              <StarNagCard />
            </RecoverableRenderErrorBoundary>
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.star-nag-toast"
              surface="overlay"
              resetKey={activeView}
              compact
            >
              <StarNagToastHost />
            </RecoverableRenderErrorBoundary>
            <StarNagAgentValueMomentObserver />
            {/* Why: mount at App root to render once per session; internal cohort gate limits it to pre-telemetry users â see telemetry-plan.md Â§First-launch experience. */}
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.telemetry-first-launch"
              surface="overlay"
              resetKey={settings?.telemetry?.optedIn ?? 'unknown'}
              compact
            >
              <TelemetryFirstLaunchSurface />
            </RecoverableRenderErrorBoundary>
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.zoom"
              surface="overlay"
              resetKey={activeView}
              compact
            >
              <ZoomOverlay />
            </RecoverableRenderErrorBoundary>
            <Suspense fallback={null}>
              {activeModal === 'delete-worktree' ? (
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.delete-worktree"
                  surface="modal"
                  resetKey
                  compact
                >
                  <DeleteWorktreeDialog />
                </RecoverableRenderErrorBoundary>
              ) : null}
            </Suspense>
            {hasSshCredentialRequest ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.ssh-passphrase"
                  surface="modal"
                  resetKey={activeModal}
                  compact
                >
                  <SshPassphraseDialog />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            <RecoverableRenderErrorBoundary
              boundaryId="modal.markdown-template-picker"
              surface="modal"
              resetKey={activeModal}
              compact
            >
              <MarkdownTemplatePicker />
            </RecoverableRenderErrorBoundary>
            <RecoverableRenderErrorBoundary
              boundaryId="modal.crash-report"
              surface="modal"
              reportAsCrash={false}
              resetKey={activeModal}
              compact
              title={translate('auto.App.722d03aa62', 'The crash report dialog hit an error.')}
              description={translate(
                'auto.App.acd66311dc',
                'Use the Help menu after retrying if you still need diagnostics.'
              )}
            >
              <CrashReportDialog />
            </RecoverableRenderErrorBoundary>
            {onboarding && shouldRenderOnboarding && !onboardingSettingsDetourActive ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="modal.onboarding"
                  surface="modal"
                  resetKey={onboardingSettingsDetourActive}
                  title={translate('auto.App.f02d37278a', 'Onboarding hit an error.')}
                  description={translate(
                    'auto.App.221a95ba38',
                    'Retry onboarding or close it and continue in the app.'
                  )}
                >
                  <OnboardingFlow
                    onboarding={onboarding}
                    onOnboardingChange={setOnboarding}
                    onSettingsDetourStart={beginOnboardingSettingsDetour}
                  />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            {shouldMountDictationController ? (
              <Suspense fallback={null}>
                <RecoverableRenderErrorBoundary
                  boundaryId="overlay.dictation"
                  surface="overlay"
                  resetKey={activeView}
                  compact
                >
                  <DictationController />
                </RecoverableRenderErrorBoundary>
              </Suspense>
            ) : null}
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.recent-tab-switcher"
              surface="overlay"
              resetKey={activeView}
              compact
            >
              <RecentTabSwitcher />
            </RecoverableRenderErrorBoundary>
            {/* Why: hosts a live terminal pane needing the link-routing preference context; mounting outside crashes it. */}
            <RecoverableRenderErrorBoundary
              boundaryId="overlay.skill-freshness-update-dialog"
              surface="overlay"
              compact
            >
              <SkillFreshnessUpdateDialog />
            </RecoverableRenderErrorBoundary>
            <Suspense fallback={null}>
              <RecoverableRenderErrorBoundary
                boundaryId="overlay.remote-server-update-dialog"
                surface="overlay"
                compact
              >
                <RemoteServerUpdateDialog />
              </RecoverableRenderErrorBoundary>
            </Suspense>
          </LinkRoutingPreferenceDialogProvider>
        </ConfirmationDialogProvider>
      </TooltipProvider>
      <Toaster closeButton toastOptions={{ className: 'font-sans text-sm' }} />
      <SkillFreshnessNudge />
      <WorktreeBaseFallbackDialog />
      <PinnedTabCloseDialog />
      {/* Why: Electron's drag-region hit-test is DOM-order-based (ignores z-index); render last so WindowControls stay clickable. */}
      {hasCustomTitleBar && <WindowControls />}
    </div>
  )
}
