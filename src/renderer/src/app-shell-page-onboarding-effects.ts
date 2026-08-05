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
export function useAppShellPageOnboardingEffects(context: Record<string, unknown>) {
  const {
    actions,
    activeModal,
    contextualToursAutoEligible,
    featureInteractions,
    featureTipsPromptedThisSessionRef,
    featureTipsSeenIds,
    featureTipsSuppressedByOnboardingThisSessionRef,
    onboarding,
    onboardingLoaded,
    persistedUIReady,
    setOnboarding,
    setOnboardingSettingsDetour,
    setShouldMountAddRepoDialog,
    settings,
    shouldMountAddRepoDialog,
    unmountAddRepoDialogTimerRef,
    workspaceSessionReady
  } = context as any
  useEffect(() => {
    if (activeModal === 'add-repo') {
      if (unmountAddRepoDialogTimerRef.current) {
        clearTimeout(unmountAddRepoDialogTimerRef.current)
        unmountAddRepoDialogTimerRef.current = null
      }
      setShouldMountAddRepoDialog(true)
      return
    }
    if (shouldMountAddRepoDialog && !unmountAddRepoDialogTimerRef.current) {
      // Why: AddRepoDialog's close effect aborts in-flight clone work; keep one closed render before unmounting hidden SSH/remote subscriptions.
      unmountAddRepoDialogTimerRef.current = setTimeout(() => {
        setShouldMountAddRepoDialog(false)
        unmountAddRepoDialogTimerRef.current = null
      }, 0)
    }
    return () => {
      if (unmountAddRepoDialogTimerRef.current) {
        clearTimeout(unmountAddRepoDialogTimerRef.current)
        unmountAddRepoDialogTimerRef.current = null
      }
    }
  }, [activeModal, shouldMountAddRepoDialog])

  // Subscribe to IPC push events
  useIpcEvents()
  useRemoteRuntimeRecoveryTriggers()
  // Why: retention runs at App level (in <RetainedAgentsSyncGate />, a null leaf) so "done" agents survive card collapse and its high-churn subscriptions don't re-render App.
  // Why: git polling lives at App level (RightSidebar unmounts when closed, stranding stale Rebasing/Merging badges); gate on workspaceSessionReady so it doesn't compete with first paint.
  useGitStatusPolling({ enabled: workspaceSessionReady })
  // Why: wire file-change watching at App level so the editor keeps hearing FS changes when Explorer unmounts (right-sidebar switches to Source Control/Checks).
  useEditorExternalWatch()
  useGlobalFileDrop()
  useAutoAckViewedAgent()
  useDashboardPopoutBridge(settings?.experimentalAgentDashboardPopout === true)

  useEffect(() => {
    return onOnboardingReopened(setOnboarding)
  }, [])

  useEffect(() => {
    // Why: suppress tours until onboarding state is known (null = loading) so a first-run user can't mark a tour seen before onboarding appears.
    const suppressTours = !onboardingLoaded || shouldShowOnboarding(onboarding)
    actions.setContextualToursOnboardingVisible(suppressTours)
  }, [actions, onboarding, onboardingLoaded])

  useEffect(() => {
    if (!persistedUIReady || !onboardingLoaded || contextualToursAutoEligible !== null) {
      return
    }
    // Why: rollout targets first-run onboarding users; existing profiles are classified once and never auto-toured.
    actions.setContextualToursAutoEligible(shouldShowOnboarding(onboarding))
  }, [actions, contextualToursAutoEligible, onboarding, onboardingLoaded, persistedUIReady])

  useEffect(() => {
    const featureTipsDecision = getFeatureTipsAppOpenDecision({
      activeModal,
      featureTipsSeenIds,
      featureInteractions,
      onboarding,
      persistedUIReady,
      promptedThisSession: featureTipsPromptedThisSessionRef.current,
      settings,
      suppressedByOnboardingThisSession: featureTipsSuppressedByOnboardingThisSessionRef.current
    })

    if (featureTipsDecision.kind === 'suppress-for-onboarding') {
      // Why: first-run users should finish onboarding without a second education modal in the same session.
      featureTipsSuppressedByOnboardingThisSessionRef.current = true
      return
    }

    if (featureTipsDecision.kind !== 'open') {
      return
    }

    featureTipsPromptedThisSessionRef.current = true
    if (featureTipsDecision.tipId === 'cmd-j-palette') {
    }
    // Why: mark seen on show so a quit/crash before dismiss doesn't reappear it next launch.
    actions.markFeatureTipsSeen([featureTipsDecision.tipId])
    actions.openModal('feature-tips', { source: 'app_open', tipId: featureTipsDecision.tipId })
  }, [
    activeModal,
    actions,
    featureInteractions,
    featureTipsSeenIds,
    onboarding,
    persistedUIReady,
    settings
  ])

  const beginOnboardingSettingsDetour = useCallback(() => {
    setOnboardingSettingsDetour(true)
  }, [])

  return { beginOnboardingSettingsDetour }
}
