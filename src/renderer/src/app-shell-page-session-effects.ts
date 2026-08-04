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
export function useAppShellPageSessionEffects(context: Record<string, unknown>) {
  const {
    acknowledgedAgentsByPaneKey,
    actions,
    activeView,
    combinedDiffFileTreeWidth,
    filterRepoIds,
    groupBy,
    hideCliCreatedWorkspaces,
    hideDefaultBranchWorkspace,
    hideDetachedHeadWorkspaces,
    markdownTocPanelWidth,
    persistedUIReady,
    projectOrderBy,
    rightSidebarExplorerView,
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarWidth,
    settings,
    showDotfilesByWorktree,
    showSleepingWorkspaces,
    sidebarWidth,
    sortBy,
    workspaceSessionReady
  } = context as any
  useEffect(() => {
    setRuntimeGraphStoreStateGetter(useAppStore.getState)
    return () => {
      setRuntimeGraphStoreStateGetter(null)
    }
  }, [])

  useEffect(() => {
    let previousKey = getRuntimeMobileSessionSyncKey(useAppStore.getState())
    return useAppStore.subscribe((state, previousState) => {
      // Why: this fires on every store mutation; read the cached prefers-dark snapshot instead of allocating a throwaway MediaQueryList via matchMedia each tick.
      const systemPrefersDark = getSystemPrefersDarkSnapshot()
      // Why: skip the key build when every input is reference-unchanged; the gate mirrors every field getRuntimeMobileSessionSyncKey uses.
      if (
        canSkipRuntimeMobileSessionSyncKeyBuild(
          state,
          previousState,
          systemPrefersDark,
          previousKey.systemPrefersDark
        )
      ) {
        return
      }
      const nextKey = getRuntimeMobileSessionSyncKey(
        state,
        previousState,
        previousKey,
        systemPrefersDark
      )
      if (runtimeMobileSessionSyncKeysEqual(nextKey, previousKey)) {
        return
      }
      previousKey = nextKey
      scheduleRuntimeGraphSync()
    })
  }, [])

  useEffect(() => registerUpdaterBeforeUnloadBypass(), [])

  useEffect(() => {
    setRuntimeGraphSyncEnabled(workspaceSessionReady)
    return () => {
      setRuntimeGraphSyncEnabled(false)
    }
  }, [workspaceSessionReady])

  // Why: session persistence only writes to disk; a Zustand subscribe() outside React drops ~15 render-cycle subscriptions and their re-renders on every tab/file/browser change.
  useEffect(() => {
    return createSessionWriteSubscriber({
      store: useAppStore,
      shouldSchedulePersist: () => !isRemoteWorkspaceSnapshotApplyInProgress(),
      persist: ({ patch }) => {
        const state = useAppStore.getState()
        // Why: route each host's worktree-scoped slice to its own partition; return the local write so the remote-workspace upload chain below keeps its ordering.
        const localWrite = patchWorkspaceSessionByHost(window.api.session, patch, state)
        void localWrite
        const hydratedTargetIds = Array.from(state.remoteWorkspaceHydratedTargetIds).filter(
          (targetId) => state.remoteWorkspaceSyncStatusByTargetId[targetId]?.phase !== 'conflict'
        )
        if (hydratedTargetIds.length > 0) {
          void localWrite
            .then(() => window.api.remoteWorkspace?.setForConnectedTargets({ hydratedTargetIds }))
            .then((results) => {
              for (const { targetId, result } of results ?? []) {
                applyRemoteWorkspacePatchStatus(targetId, result)
              }
            })
            .catch((err) => {
              for (const targetId of hydratedTargetIds) {
                useAppStore.getState().setRemoteWorkspaceSyncStatus(targetId, {
                  phase: 'error',
                  direction: 'push',
                  message: err instanceof Error ? err.message : 'Workspace upload failed'
                })
              }
            })
        }
      }
    })
  }, [])

  // On shutdown, capture terminal scrollback buffers and flush all durable
  // renderer state through one synchronous main-process checkpoint.
  useEffect(() => {
    // Why: beforeunload fires twice during a manual quit â once from the
    // synthetic dispatch in the onWindowCloseRequested handler (captures
    // good data while TerminalPanes are still mounted), and again from the
    // native window close triggered by confirmWindowClose(). Between these
    // two firings, PTY exit events can arrive and unmount TerminalPanes,
    // emptying shutdownBufferCaptures. The guard prevents the second call
    // from overwriting the good session data with an empty snapshot.
    const shutdownCheckpoint = createShutdownCheckpointGuard(() => {
      const shouldCaptureSession = shouldPersistWorkspaceSession(useAppStore.getState())
      if (shouldCaptureSession) {
        for (const capture of shutdownBufferCaptures.values()) {
          try {
            capture({ includeLocalBuffers: false })
          } catch {
            // Don't let one pane's failure block the rest.
          }
        }
        // Why: agent provider session ids live only in agentStatusByPaneKey,
        // which is in-memory. Capture them into the persisted sleeping-session
        // map so a daemon/session death while the app is closed can still
        // cold-restore via the agent's resume command (#5232).
        useAppStore.getState().captureAllSleepingAgentSessions('quit')
      }
      // Why: re-read state after capture() calls populated scrollback buffers
      // into the store via Zustand setters. The earlier read is only for the
      // gating flags and would miss those updates.
      const freshState = useAppStore.getState()
      const sessionSnapshots = shouldCaptureSession
        ? buildWorkspaceSessionHostSnapshots(buildWorkspaceSessionPayload(freshState), freshState)
        : []
      // Why: one blocking checkpoint closes the immediate-quit race for both
      // the narrow view preference and the larger session recovery snapshots.
      window.api.app.persistBeforeUnloadSync({
        sessions: sessionSnapshots,
        ui: buildActiveViewUnloadPatch(freshState)
      })
    })
    const persistBeforeUnload = createShutdownCheckpointBeforeUnloadHandler(shutdownCheckpoint)
    window.addEventListener('beforeunload', persistBeforeUnload)
    window.addEventListener(ORCA_APP_RESTART_ABORTED_EVENT, shutdownCheckpoint.reset)
    window.addEventListener(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT, shutdownCheckpoint.reset)
    window.addEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, shutdownCheckpoint.reset)
    return () => {
      window.removeEventListener('beforeunload', persistBeforeUnload)
      window.removeEventListener(ORCA_APP_RESTART_ABORTED_EVENT, shutdownCheckpoint.reset)
      window.removeEventListener(
        ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
        shutdownCheckpoint.reset
      )
      window.removeEventListener(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT, shutdownCheckpoint.reset)
    }
  }, [])

  // Why: beforeunload never fires on a hard kill (crash, forced update, TerminateProcess), so periodically capture agent session ids (not scrollback) so live agents keep a resume record.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!shouldPersistWorkspaceSession(useAppStore.getState())) {
        return
      }
      useAppStore.getState().captureAllSleepingAgentSessions('periodic')
    }, SLEEPING_AGENT_RESUME_CAPTURE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  // Why: subscribe at the always-mounted App root â Terminal owns the confirm flow but isn't mounted on the landing page, so subscribing there left FileâExit / Ctrl+Q with no listener (#5144).
  useEffect(() => {
    return window.api.ui.onWindowCloseRequested(dispatchWindowCloseRequest)
  }, [])

  // Why no periodic scrollback save: the old 3-min re-serialize (#461) stalled the main thread for seconds; the out-of-process daemon (#729) is the durable replacement, non-daemon users lose in-session scrollback on unexpected exit.

  useEffect(() => {
    if (!persistedUIReady) {
      return
    }

    const timer = window.setTimeout(() => {
      void window.api.ui.set({
        sidebarWidth,
        rightSidebarOpen,
        rightSidebarTab,
        rightSidebarExplorerView,
        rightSidebarWidth,
        markdownTocPanelWidth,
        combinedDiffFileTreeWidth,
        groupBy,
        sortBy,
        projectOrderBy,
        showActiveOnly: false,
        hideSleepingWorkspaces: !showSleepingWorkspaces,
        showSleepingWorkspaces,
        hideDefaultBranchWorkspace,
        hideCliCreatedWorkspaces,
        hideDetachedHeadWorkspaces,
        showDotfilesByWorktree,
        filterRepoIds,
        // Why (#9002): activeView is deliberately NOT included here. It used to
        // ride this same 150ms writer (#8265), which meant every top-level view
        // switch scheduled a full durable-state save. The narrow preference
        // effect below persists it without touching the recovery snapshot.
        // Why: rides the same debounced save so dashboard auto-acks (which fire
        // on focus/visibility) and the in-memory ack cleanup paths in
        // agent-status.ts (close/dismiss) both flow to disk through map
        // identity changes. Without persisting, agent rows that survive
        // restart come back bold even when the user had already visited them.
        acknowledgedAgentsByPaneKey
      })
    }, 150)

    return () => window.clearTimeout(timer)
  }, [
    persistedUIReady,
    sidebarWidth,
    rightSidebarOpen,
    rightSidebarTab,
    rightSidebarExplorerView,
    rightSidebarWidth,
    markdownTocPanelWidth,
    combinedDiffFileTreeWidth,
    groupBy,
    sortBy,
    projectOrderBy,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces,
    showDotfilesByWorktree,
    filterRepoIds,
    acknowledgedAgentsByPaneKey
  ])

  // Why (#9002): activeView has its own tiny profile preference, so it can track
  // every switch without scheduling the multi-MB durable-state writer.
  useEffect(() => {
    if (!persistedUIReady) {
      return
    }
    void window.api.ui.set({ activeView })
  }, [activeView, persistedUIReady])

  // Apply theme to document
  useEffect(() => {
    if (!settings) {
      return
    }

    if (settings.theme === 'dark') {
      applyDocumentTheme('dark')
      return undefined
    } else if (settings.theme === 'light') {
      applyDocumentTheme('light')
      return undefined
    } else {
      // system
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyDocumentTheme('system')
      const handler = (): void => {
        applyDocumentTheme('system')
        // System theme changes don't mutate the store, so mobile terminal colors need an explicit graph republish.
        scheduleRuntimeGraphSync()
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [settings])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--app-font-family',
      buildAppFontFamily(settings?.appFontFamily)
    )
  }, [settings?.appFontFamily])

  // Refresh GitHub data (PR/issue status) when window regains focus
  useEffect(() => {
    const handler = (): void => {
      if (document.visibilityState === 'visible') {
        actions.refreshAllGitHub()
        actions.bumpGitHubPRVisibleRefreshGeneration()
      } else {
        actions.reportVisibleGitHubPRRefreshCandidates([], Date.now())
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [actions])

  // Why (STA-2383): macOS throttles the backgrounded window; on occlusion-uncover only `focus`
  // fires (invalidate-only), so the app-shell's dvh height stays stale and the bottom status bar
  // is clipped off-screen until a manual resize. Relay the genuine hiddenâvisible reveal so main
  // runs the same full repaint (size jiggle) that show/restore/resume get, recomputing the layout.
  useEffect(() => {
    if (!isMacPlatform() || isPairedWebClientWindow()) {
      return
    }
    const handler = (): void => {
      if (document.visibilityState !== 'visible') {
        return
      }
      window.api?.ui?.notifyWindowRevealed?.()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
}
