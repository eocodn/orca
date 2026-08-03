import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from 'react'; import { ArrowLeft, ArrowRight, Minimize2, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react'; import logo from '../../../resources/logo.svg'; import { SYNC_FIT_PANES_EVENT, TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'; import { syncZoomCSSVar } from '@/lib/ui-zoom'; import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'; import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'; import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'; import { resolveLeftTitlebarChromeLayout } from '@/lib/titlebar-left-chrome'; import { shouldShowWorktreeCreationSurface } from '@/lib/worktree-creation-surface'; import { buildAppFontFamily } from '@/lib/app-font-family'; import { toast } from 'sonner'; import { Toaster } from '@/components/ui/sonner'; import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'; import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'; import { useAppStore } from './store'; import { WORKTREE_REFRESH_CONCURRENCY } from './store/slices/worktrees'; import { useShallow } from 'zustand/react/shallow'; import { isRemoteWorkspaceSnapshotApplyInProgress, useIpcEvents } from './hooks/useIpcEvents'; import { useAutomationDispatchEvents } from './hooks/useAutomationDispatchEvents'; import RetainedAgentsSyncGate from './components/dashboard/RetainedAgentsSyncGate'; import { AgentHibernationGate } from './components/AgentHibernationGate'; import { ActivityTitlebarControls } from './components/activity/ActivityTitlebarControls'; import Sidebar from './components/Sidebar'; import { shutdownBufferCaptures } from './components/terminal-pane/shutdown-buffer-captures'; import { dispatchWindowCloseRequest } from './components/window-close-request-coordinator'; import { getSystemPrefersDarkSnapshot, useSystemPrefersDark } from './components/terminal-pane/use-system-prefers-dark'; import RightSidebar from './components/right-sidebar'; import { StarNagCard } from './components/StarNagCard'; import { StarNagAgentValueMomentObserver } from './components/star-nag/StarNagAgentValueMomentObserver'; import { StarNagToastHost } from './components/star-nag/StarNagToastHost'; import { SkillFreshnessNudge } from './components/skills/SkillFreshnessNudge'; import { SkillFreshnessUpdateDialog } from './components/skills/SkillFreshnessUpdateDialog'; import { TelemetryFirstLaunchSurface } from './components/TelemetryFirstLaunchSurface'; import { ZoomOverlay } from './components/ZoomOverlay'; import { onOnboardingReopened } from './components/onboarding/show-onboarding-event'; import { shouldShowOnboarding } from './components/onboarding/should-show-onboarding'; import { MarkdownTemplatePicker } from './components/editor/MarkdownTemplatePicker'; import { FloatingTerminalToggleButton } from './components/floating-terminal/FloatingTerminalToggleButton'; import { OrcaProfileSwitcher } from './components/orca-profiles/OrcaProfileSwitcher'; import { TOGGLE_FLOATING_TERMINAL_EVENT, requestFloatingTerminalOpenMaximized } from '@/lib/floating-terminal'; import { isFloatingWorkspacePanelFocused, isFloatingWorkspaceTerminalInputTarget, matchFloatingWorkspacePanelChord, shouldMinimizeFloatingWorkspacePanelOnCloseShortcut } from '@/lib/floating-workspace-terminal-actions'; import { createFloatingWorkspaceTourInteractionSnapshot } from '@/lib/floating-workspace-tour-interaction-snapshot'; import { requestScrollToCurrentWorkspaceRevealAndRename } from '@/lib/scroll-to-current-workspace-status'; import { OPEN_WORKSPACE_BOARD_EVENT } from './components/sidebar/useWorkspaceBoardPanel'; import { WorkspacePortScanner } from './components/ports/WorkspacePortScanner'; import { CrashReportDialog } from './components/crash-report/CrashReportDialog'; import NewWorkspaceComposerModal from './components/NewWorkspaceComposerModal'; import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'; import { ConfirmationDialogProvider } from './components/confirmation-dialog'; import { LinkRoutingPreferenceDialogProvider } from './components/link-routing-preference-dialog'; import RecentTabSwitcher from './components/tab-bar/RecentTabSwitcher'; import { useGitStatusPolling } from './components/right-sidebar/useGitStatusPolling'; import { useEditorExternalWatch } from './hooks/useEditorExternalWatch'; import { useAutoAckViewedAgent } from './hooks/useAutoAckViewedAgent'; import { useDashboardPopoutBridge } from './components/dashboard/useDashboardPopoutBridge'; import { useUnreadDockBadge } from './hooks/useUnreadDockBadge'; import { resolvePrimarySelectionMiddleClickPaste, usePrimarySelectionPaste } from './hooks/usePrimarySelectionPaste'; import { useAppMenuPaste } from './hooks/useAppMenuPaste'; import { useLargeTextControlPaste } from './hooks/useLargeTextControlPaste'; import { canSkipRuntimeMobileSessionSyncKeyBuild, getRuntimeMobileSessionSyncKey, runtimeMobileSessionSyncKeysEqual, scheduleRuntimeGraphSync, setRuntimeGraphStoreStateGetter, setRuntimeGraphSyncEnabled } from './runtime/sync-runtime-graph'; import { useWebSessionTabsSync } from './runtime/web-session-tabs-sync'; import { useGlobalFileDrop } from './hooks/useGlobalFileDrop'; import { MacosTccPromptNoticeHost } from './hooks/MacosTccPromptNoticeHost'; import { useRadixBodyPointerEventsRecovery } from './hooks/useRadixBodyPointerEventsRecovery'; import { registerUpdaterBeforeUnloadBypass } from './lib/updater-beforeunload'; import { ORCA_APP_RESTART_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT } from '../../shared/updater-renderer-events'; import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../shared/renderer-shutdown-events'; import { buildWorkspaceSessionPayload, shouldPersistWorkspaceSession } from './lib/workspace-session'; import { createSessionWriteSubscriber } from './lib/session-write-subscriber'; import { buildActiveViewUnloadPatch } from './lib/active-view-persist'; import { buildWorkspaceSessionHostSnapshots, fetchWorkspaceSessionWithRuntimeHostOwners, patchWorkspaceSessionByHost } from './lib/workspace-session-host-persistence'; import { createShutdownCheckpointBeforeUnloadHandler, createShutdownCheckpointGuard } from './lib/shutdown-checkpoint-guard'; import { collectFolderWorkspaceKeysFromSession, collectWorktreeHydrationRepoIdsFromSession } from './lib/workspace-session-hydration-keys'; import { getStartupErrorFallbackUI, hydratePersistedUIAfterStartupRead } from './lib/startup-ui-hydration'; import { logRendererStartupDiagnostic, timeRendererStartupStep, timeRendererStartupSyncStep } from './startup/startup-diagnostics'; import { reconnectSshTargetForRendererStartup } from './startup/ssh-startup-reconnect'; import { shouldRenderPetOverlay } from './components/pet/pet-overlay-visibility'; import { applyDocumentTheme } from './lib/document-theme'; import { getSystemPrefersDark } from './lib/terminal-theme'; import { publishTerminalViewAttributesAtAppStart } from './components/terminal-pane/terminal-appearance'; import { isEditableTarget } from './lib/editable-target'; import { getSelectedTextForFileSearch } from './lib/file-search-selection'; import { useShortcutLabel } from './hooks/useShortcutLabel'; import { folderRelativePathToIncludeGlob, selectedExplorerFolderRelativePath } from './components/right-sidebar/file-search-include-pattern'; import { shouldShowWorktreeHistoryControls } from './lib/titlebar-worktree-history-controls'; import { canGoBackWorktreeHistory, canGoForwardWorktreeHistory } from '@/store/slices/worktree-nav-history'; import { selectFloatingVisibleTabCount } from './store/selectors'; import { selectActiveTerminalChromeState } from './store/active-terminal-chrome-selector'; import type { VirtualizedScrollAnchor } from './hooks/useVirtualizedScrollAnchor'; import type { OnboardingState } from '../../shared/types'; import { getFeatureTipsAppOpenDecision, isCliFeatureTipCompleted } from './components/feature-tips/feature-tip-startup-gate'; import { trackCmdJPaletteFeatureTipShown, trackOrcaCliFeatureTipShown } from './components/feature-tips/feature-tip-telemetry'; import { keybindingMatchesAction, type KeybindingActionId, type KeybindingContext, type KeybindingMatchOptions } from '../../shared/keybindings'; import { PLUGIN_COMMAND_ALIAS_ACTION_IDS } from '../../shared/plugins/plugin-command-actions'; import { registerAppCommandDispatcher } from '@/lib/app-command-dispatch'; import { executePluginCommand } from '@/lib/plugin-command-execution'; import { findPluginCommandForKeybinding } from '@/lib/plugin-command-keybindings'; import { usePluginCommands } from '@/store/plugin-panels'; import { getRepoExecutionHostId, isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../shared/execution-host'; import { mapWithConcurrency } from '../../shared/map-with-concurrency'; import { ModifierDoubleTapDetector, toModifierDoubleTapEvent } from '../../shared/modifier-double-tap-detector'; import { isGitRepoKind } from '../../shared/repo-kind'; import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'; import { resolveMountedLazyModalIds, type LazyModalId } from './lazy-modal-mount-state'; import { translate } from '@/i18n/i18n'; import PinnedTabCloseDialog from './components/terminal-pane/PinnedTabCloseDialog'; import WorktreeBaseFallbackDialog from './components/WorktreeBaseFallbackDialog'; import { useOsc52ClipboardDefaultOnNotice } from './components/terminal-pane/osc52-clipboard-default-on-notice'; import { hasRequestedBackgroundTerminalWorktreeMount, subscribeBackgroundTerminalWorktreeMountRequests } from './components/terminal/background-terminal-worktree-mount'; import { useRemoteRuntimeRecoveryTriggers } from './runtime/use-remote-runtime-recovery-triggers'; import { getKeybindingContext, hasCustomTitleBar, isMacPlatform, SLEEPING_AGENT_RESUME_CAPTURE_INTERVAL_MS, shortcutPlatform, type ShortcutDispatchInput } from './app-shell-model'; import { listRuntimeSessionHostIdsForStartup } from './app-shell-actions'; import { ActivityPrototypePage, applyRemoteWorkspacePatchStatus, AddProjectFromFolderDialog, AddRepoDialog, AutomationsPage, ContextualTourOverlay, DeleteWorktreeDialog, DictationController, FeatureTipsModal, FeatureWallModal, FloatingTerminalPanel, Landing, MobilePage, NonGitFolderDialog, OnboardingFlow, PetOverlay, ProjectAddedDialog, QuickOpen, RemoteServerUpdateDialog, Settings, SetupGuideModal, SetupGuideTelemetryObserver, shouldMountUpdateCardForStatus, SkillsPage, SshPassphraseDialog, StatusBar, TaskPage, Terminal, UpdateCard, WindowControls, WorkspaceCleanupDialog, WorktreeCreationPanel, WorktreeJumpPalette, WorkspaceSpacePage } from './app-shell-dependencies'; import { AppShellPageRenderer } from './app-shell-page-renderer'; import { useAppShellPageOnboardingEffects } from './app-shell-page-onboarding-effects'; import { useAppShellPageStartupEffects } from './app-shell-page-startup-effects'; import { useAppShellPageSessionEffects } from './app-shell-page-session-effects'; import { useAppShellPageShortcutEffects } from './app-shell-page-shortcut-effects';

function App(): React.JSX.Element {
  const clearUnreadDockBadge = useUnreadDockBadge()
  useRadixBodyPointerEventsRecovery()
  useWebSessionTabsSync()
  const [floatingTerminalOpen, setFloatingTerminalOpen] = useState(false)
  const floatingWorkspaceTourInteractionSnapshotRef = useRef<{
    wasPreviouslyInteracted?: boolean
    persisted?: Promise<void>
    recordFeatureInteractionForTour: boolean
  } | null>(null)

  // Why: consolidate action refs into one useShallow subscription so React runs one equality check per store mutation instead of one per action.
  const actions = useAppStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      fetchRepos: s.fetchRepos,
      fetchReposForAllHosts: s.fetchReposForAllHosts,
      awaitLocalRepoCatalogSettlement: s.awaitLocalRepoCatalogSettlement,
      fetchProjectGroups: s.fetchProjectGroups,
      fetchProjectGroupsForAllHosts: s.fetchProjectGroupsForAllHosts,
      fetchFolderWorkspaces: s.fetchFolderWorkspaces,
      fetchFolderWorkspacesForAllHosts: s.fetchFolderWorkspacesForAllHosts,
      fetchAllWorktrees: s.fetchAllWorktrees,
      fetchWorktrees: s.fetchWorktrees,
      fetchWorktreeLineage: s.fetchWorktreeLineage,
      fetchOrcaProfiles: s.fetchOrcaProfiles,
      fetchSettings: s.fetchSettings,
      fetchKeybindings: s.fetchKeybindings,
      initGitHubCache: s.initGitHubCache,
      refreshAllGitHub: s.refreshAllGitHub,
      reportVisibleGitHubPRRefreshCandidates: s.reportVisibleGitHubPRRefreshCandidates,
      bumpGitHubPRVisibleRefreshGeneration: s.bumpGitHubPRVisibleRefreshGeneration,
      hydrateWorkspaceSession: s.hydrateWorkspaceSession,
      hydrateTabsSession: s.hydrateTabsSession,
      hydrateEditorSession: s.hydrateEditorSession,
      hydrateBrowserSession: s.hydrateBrowserSession,
      fetchBrowserSessionProfiles: s.fetchBrowserSessionProfiles,
      reconnectPersistedTerminals: s.reconnectPersistedTerminals,
      setDeferredSshReconnectTargets: s.setDeferredSshReconnectTargets,
      setSshConnectionState: s.setSshConnectionState,
      hydratePersistedUI: s.hydratePersistedUI,
      setHydrationSucceeded: s.setHydrationSucceeded,
      openModal: s.openModal,
      closeModal: s.closeModal,
      markFeatureTipsSeen: s.markFeatureTipsSeen,
      setContextualToursAutoEligible: s.setContextualToursAutoEligible,
      setContextualToursOnboardingVisible: s.setContextualToursOnboardingVisible,
      cancelContextualTour: s.cancelContextualTour,
      toggleRightSidebar: s.toggleRightSidebar,
      setRightSidebarOpen: s.setRightSidebarOpen,
      setRightSidebarTab: s.setRightSidebarTab,
      showRightSidebarFiles: s.showRightSidebarFiles,
      showRightSidebarSearch: s.showRightSidebarSearch,
      openDiffNotesSendMenuForActiveWorktree: s.openDiffNotesSendMenuForActiveWorktree,
      setActiveView: s.setActiveView,
      updateSettings: s.updateSettings,
      pruneLastVisitedTimestamps: s.pruneLastVisitedTimestamps,
      seedActiveWorktreeLastVisitedIfMissing: s.seedActiveWorktreeLastVisitedIfMissing
    }))
  )

  const activeView = useAppStore((s) => s.activeView)
  const activeModal = useAppStore((s) => s.activeModal)
  const featureTipsSeenIds = useAppStore((s) => s.featureTipsSeenIds)
  const featureInteractions = useAppStore((s) => s.featureInteractions)
  const contextualToursAutoEligible = useAppStore((s) => s.contextualToursAutoEligible)
  const {
    activeWorktreeId,
    tabCount,
    effectiveActiveTabId,
    activeTabCanExpand,
    effectiveActiveTabExpanded
  } = useAppStore(useShallow(selectActiveTerminalChromeState))
  const activePendingCreationId = useAppStore((s) => s.activePendingCreationId)
  // Why: the creation surface owns the tab strip from the first pending frame; gating on the delayed loader flag swapped the tab bar mid-create.
  const activePendingCreationExists = useAppStore(
    (s) =>
      s.activePendingCreationId !== null &&
      s.pendingWorktreeCreations[s.activePendingCreationId] !== undefined
  )
  // Why: keep virtualized scroll memory above the sidebar's workspace/landing remount so the left list doesn't restart at scrollTop 0.
  const worktreeSidebarScrollOffsetRef = useRef(0)
  const worktreeSidebarScrollAnchorRef = useRef<VirtualizedScrollAnchor>(null)
  const floatingVisibleTabCount = useAppStore(selectFloatingVisibleTabCount)
  const workspaceSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const backgroundTerminalMountRequested = useSyncExternalStore(
    subscribeBackgroundTerminalWorktreeMountRequests,
    hasRequestedBackgroundTerminalWorktreeMount,
    hasRequestedBackgroundTerminalWorktreeMount
  )
  const keybindings = useAppStore((s) => s.keybindings)
  const pluginCommands = usePluginCommands()
  const updateStatus = useAppStore((s) => s.updateStatus)
  const activeContextualTourId = useAppStore((s) => s.activeContextualTourId)
  const leftSidebarShortcutLabel = useShortcutLabel('sidebar.left.toggle')
  const rightSidebarShortcutLabel = useShortcutLabel('sidebar.right.toggle')
  const historyBackShortcutLabel = useShortcutLabel('worktree.history.back')
  const historyForwardShortcutLabel = useShortcutLabel('worktree.history.forward')
  const floatingTerminalEnabled = useAppStore((s) => s.settings?.floatingTerminalEnabled === true)
  const floatingTerminalTriggerLocation = useAppStore(
    (s) => s.settings?.floatingTerminalTriggerLocation ?? 'floating-button'
  )
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const showFloatingTerminalButton =
    floatingTerminalEnabled &&
    (floatingTerminalTriggerLocation === 'floating-button' || !statusBarVisible)
  const hasMountedTerminalWorkbenchRef = useRef(false)
  if (activeWorktreeId !== null || backgroundTerminalMountRequested) {
    hasMountedTerminalWorkbenchRef.current = true
  }
  // Why: skip the terminal bundle on the landing path, but once mounted keep hidden panes alive through sleep/shutdown when activeWorktreeId briefly goes null.
  const shouldMountTerminalWorkbench =
    activeWorktreeId !== null ||
    backgroundTerminalMountRequested ||
    hasMountedTerminalWorkbenchRef.current
  // Why: visible worktree creation owns its faux tab strip start to finish; keep the previous workspace mounted for retention without real chrome.
  const creationLayoutActive = shouldShowWorktreeCreationSurface({
    activeView,
    activePendingCreationId,
    hasActivePendingCreation: activePendingCreationExists
  })
  const workspaceChromeActive =
    activeView === 'terminal' && activeWorktreeId !== null && !creationLayoutActive
  const terminalWorkbenchVisible =
    activeView === 'terminal' && activeWorktreeId !== null && !creationLayoutActive
  // Why: once the floating workspace owns tabs, keep it mounted while closed so hidden terminal/browser/editor panes retain local state.
  const shouldMountFloatingTerminalPanel =
    floatingTerminalEnabled && (floatingTerminalOpen || floatingVisibleTabCount > 0)
  // Why: floating workspace is a transient overlay; hotkey minimize returns focus to the surface the user came from.
  const floatingTerminalReturnFocusRef = useRef<HTMLElement | null>(null)
  const floatingTerminalReturnFocusFrameRef = useRef<number | null>(null)

  const cancelFloatingTerminalReturnFocusFrame = useCallback((): void => {
    if (floatingTerminalReturnFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(floatingTerminalReturnFocusFrameRef.current)
    floatingTerminalReturnFocusFrameRef.current = null
  }, [])

  const setAppRootNode = useCallback(
    (node: HTMLDivElement | null): void => {
      // Why: these best-effort App chrome cleanups share the App root lifetime.
      if (!node) {
        cancelFloatingTerminalReturnFocusFrame()
        clearUnreadDockBadge()
      }
    },
    [cancelFloatingTerminalReturnFocusFrame, clearUnreadDockBadge]
  )

  const rememberFloatingTerminalReturnFocus = useCallback((): void => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) {
      floatingTerminalReturnFocusRef.current = null
      return
    }
    if (
      active.closest('[data-floating-terminal-panel]') ||
      active.closest('[data-floating-terminal-toggle]')
    ) {
      return
    }
    floatingTerminalReturnFocusRef.current = active
  }, [])

  const restoreFloatingTerminalReturnFocus = useCallback((): void => {
    const target = floatingTerminalReturnFocusRef.current
    floatingTerminalReturnFocusRef.current = null
    if (!target || !document.contains(target)) {
      return
    }
    cancelFloatingTerminalReturnFocusFrame()
    floatingTerminalReturnFocusFrameRef.current = requestAnimationFrame(() => {
      floatingTerminalReturnFocusFrameRef.current = null
      if (!document.contains(target)) {
        return
      }
      target.focus({ preventScroll: true })
    })
  }, [cancelFloatingTerminalReturnFocusFrame])

  const setFloatingTerminalOpenWithFocus = useCallback(
    (nextOpen: SetStateAction<boolean>): void => {
      const resolvedOpen =
        typeof nextOpen === 'function' ? nextOpen(floatingTerminalOpen) : nextOpen
      // Why: recordFeatureInteraction updates Zustand subscribers; running it inside the state updater logs a render-phase update warning.
      if (resolvedOpen && !floatingTerminalOpen) {
        const state = useAppStore.getState()
        floatingWorkspaceTourInteractionSnapshotRef.current =
          createFloatingWorkspaceTourInteractionSnapshot(state)
        rememberFloatingTerminalReturnFocus()
      } else if (!resolvedOpen && floatingTerminalOpen) {
        restoreFloatingTerminalReturnFocus()
      }
      setFloatingTerminalOpen(resolvedOpen)
    },
    [floatingTerminalOpen, rememberFloatingTerminalReturnFocus, restoreFloatingTerminalReturnFocus]
  )

  useEffect(() => {
    const toggleFloatingTerminal = (): void => {
      if (floatingTerminalEnabled) {
        setFloatingTerminalOpenWithFocus((open) => !open)
      }
    }
    window.addEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggleFloatingTerminal)
    return () => window.removeEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggleFloatingTerminal)
  }, [floatingTerminalEnabled, setFloatingTerminalOpenWithFocus])

  useEffect(() => {
    if (!floatingTerminalEnabled) {
      setFloatingTerminalOpenWithFocus(false)
    }
  }, [floatingTerminalEnabled, setFloatingTerminalOpenWithFocus])

  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const groupBy = useAppStore((s) => s.groupBy)
  const sortBy = useAppStore((s) => s.sortBy)
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const showSleepingWorkspaces = useAppStore((s) => s.showSleepingWorkspaces)
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const hideAutomationGeneratedWorkspaces = useAppStore((s) => s.hideAutomationGeneratedWorkspaces)
  const hideCliCreatedWorkspaces = useAppStore((s) => s.hideCliCreatedWorkspaces)
  const hideDetachedHeadWorkspaces = useAppStore((s) => s.hideDetachedHeadWorkspaces)
  const showDotfilesByWorktree = useAppStore((s) => s.showDotfilesByWorktree)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const acknowledgedAgentsByPaneKey = useAppStore((s) => s.acknowledgedAgentsByPaneKey)
  const persistedUIReady = useAppStore((s) => s.persistedUIReady)
  const shouldMountContextualTourOverlay = activeContextualTourId !== null
  useOsc52ClipboardDefaultOnNotice(persistedUIReady)
  const shouldMountSetupGuideTelemetryObserver = persistedUIReady
  const shouldMountUpdateCard = shouldMountUpdateCardForStatus(updateStatus)
  const rightSidebarWidth = useAppStore((s) => s.rightSidebarWidth)
  const markdownTocPanelWidth = useAppStore((s) => s.markdownTocPanelWidth)
  const combinedDiffFileTreeWidth = useAppStore((s) => s.combinedDiffFileTreeWidth)
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarTab = useAppStore((s) => s.rightSidebarTab)
  const rightSidebarExplorerView = useAppStore((s) => s.rightSidebarExplorerView)
  const isFullScreen = useAppStore((s) => s.isFullScreen)
  const settings = useAppStore((s) => s.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const leftSidebarStyle = useMemo(
    () => resolveLeftSidebarStyleVariables(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  ) as React.CSSProperties | undefined
  const dictationState = useAppStore((s) => s.dictationState)
  const hasSshCredentialRequest = useAppStore((s) => s.sshCredentialQueue.length > 0)
  const shouldMountDictationController =
    settings?.voice?.enabled === true || dictationState !== 'idle'
  const primarySelectionMiddleClickPaste = resolvePrimarySelectionMiddleClickPaste(
    settings?.primarySelectionMiddleClickPaste
  )
  usePrimarySelectionPaste(primarySelectionMiddleClickPaste)

  useAppMenuPaste()
  useLargeTextControlPaste()
  const petEnabled = useAppStore((s) => s.settings?.experimentalPet === true)
  const petVisible = useAppStore((s) => s.petVisible)
  const renderPetOverlay = shouldRenderPetOverlay({
    persistedUIReady,
    petEnabled,
    petVisible
  })
  const canGoBackWorktree = useAppStore(canGoBackWorktreeHistory)
  const canGoForwardWorktree = useAppStore(canGoForwardWorktreeHistory)
  const titlebarLeftControlsRef = useRef<HTMLDivElement | null>(null)
  const [collapsedSidebarHeaderWidth, setCollapsedSidebarHeaderWidth] = useState(0)
  const [mountedLazyModalIds, setMountedLazyModalIds] = useState<Set<LazyModalId>>(() => new Set())
  const [shouldMountAddRepoDialog, setShouldMountAddRepoDialog] = useState(false)
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [onboardingLoaded, setOnboardingLoaded] = useState(false)
  const featureTipsPromptedThisSessionRef = useRef(false)
  const featureTipsSuppressedByOnboardingThisSessionRef = useRef(false)
  const unmountAddRepoDialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [featureTipCliInstalled, setFeatureTipCliInstalled] = useState<boolean | null>(null)
  const [onboardingSettingsDetour, setOnboardingSettingsDetour] = useState(false)
  const shouldRenderOnboarding = onboarding !== null && shouldShowOnboarding(onboarding)
  const onboardingSettingsDetourActive =
    onboardingSettingsDetour && activeView === 'settings' && shouldRenderOnboarding
  if (onboardingSettingsDetour && !onboardingSettingsDetourActive) {
    // Why: the detour is valid only while Settings is onscreen; clear it during render so onboarding resumes without an extra Effect pass.
    setOnboardingSettingsDetour(false)
  }

  const { beginOnboardingSettingsDetour } = useAppShellPageOnboardingEffects({ actions, activeModal, contextualToursAutoEligible, featureInteractions, featureTipCliInstalled, featureTipsPromptedThisSessionRef, featureTipsSeenIds, featureTipsSuppressedByOnboardingThisSessionRef, onboarding, onboardingLoaded, persistedUIReady, setFeatureTipCliInstalled, setOnboarding, setOnboardingSettingsDetour, setShouldMountAddRepoDialog, settings, shouldMountAddRepoDialog, unmountAddRepoDialogTimerRef, workspaceSessionReady })
  useAppShellPageStartupEffects({ actions, keybindings, onboarding, persistedUIReady, rightSidebarOpen, setOnboarding, setOnboardingLoaded, settings, sidebarOpen, workspaceSessionReady })

  useAppShellPageSessionEffects({ acknowledgedAgentsByPaneKey, actions, activeView, combinedDiffFileTreeWidth, filterRepoIds, groupBy, hideAutomationGeneratedWorkspaces, hideCliCreatedWorkspaces, hideDefaultBranchWorkspace, hideDetachedHeadWorkspaces, markdownTocPanelWidth, persistedUIReady, projectOrderBy, rightSidebarExplorerView, rightSidebarOpen, rightSidebarTab, rightSidebarWidth, settings, showDotfilesByWorktree, showSleepingWorkspaces, sidebarWidth, sortBy, workspaceSessionReady })

  const hasTabBar = tabCount >= 2
  const showTitlebarExpandButton = workspaceChromeActive && !hasTabBar && effectiveActiveTabExpanded
  // Activity/Space are full-page navigation surfaces (like Settings), so the worktree sidebar is hidden there.
  const showSidebar =
    activeView !== 'settings' &&
    activeView !== 'activity' &&
    activeView !== 'space' &&
    activeView !== 'skills'
  // Tasks/Landing show the full titlebar only when the sidebar is collapsed; open, they mirror workspace view (creation suppresses it).
  const stackedSidebarOpen =
    !workspaceChromeActive && !creationLayoutActive && showSidebar && sidebarOpen
  // Visible creation keeps only the top-left window chrome; tabs and right-sidebar chrome stay gated by workspaceChromeActive.
  const leftTitlebarChromeLayout = resolveLeftTitlebarChromeLayout({
    workspaceChromeActive,
    stackedSidebarOpen,
    creationLayoutActive,
    sidebarOpen
  })
  // Full-page navigation surfaces own the whole content area, so suppress right-sidebar controls.
  const showRightSidebarControls = !creationLayoutActive && canShowRightSidebarForView(activeView)
  const showProfileSwitcherInSidebarFooter = showSidebar && sidebarOpen
  const showProfileSwitcherInTopRight = !showProfileSwitcherInSidebarFooter

  const handleToggleExpand = (): void => {
    if (!effectiveActiveTabId) {
      return
    }
    window.dispatchEvent(
      new CustomEvent(TOGGLE_TERMINAL_PANE_EXPAND_EVENT, {
        detail: { tabId: effectiveActiveTabId }
      })
    )
  }

  const globalShortcutStateRef = useRef({
    activeView,
    activeWorktreeId,
    actions,
    floatingTerminalEnabled,
    floatingTerminalOpen,
    floatingVisibleTabCount,
    keybindings,
    pluginCommands,
    terminalShortcutPolicy: settings?.terminalShortcutPolicy,
    setFloatingTerminalOpenWithFocus,
    workspaceChromeActive,
    creationLayoutActive
  })
  // Window key listeners are global and long-lived: one registration, but the handler reads current shortcut state each key event.
  globalShortcutStateRef.current = {
    activeView,
    activeWorktreeId,
    actions,
    floatingTerminalEnabled,
    floatingTerminalOpen,
    floatingVisibleTabCount,
    keybindings,
    pluginCommands,
    terminalShortcutPolicy: settings?.terminalShortcutPolicy,
    setFloatingTerminalOpenWithFocus,
    workspaceChromeActive,
    creationLayoutActive
  }

  useAppShellPageShortcutEffects({ actions, activeView, activeWorktreeId, creationLayoutActive, floatingTerminalEnabled, floatingTerminalOpen, floatingVisibleTabCount, globalShortcutStateRef, isFullScreen, keybindings, leftTitlebarChromeLayout, pluginCommands, setCollapsedSidebarHeaderWidth, setFloatingTerminalOpenWithFocus, settings, showSidebar, showSleepingWorkspaces, sidebarOpen, titlebarLeftControlsRef, workspaceChromeActive })

  const resolvedMountedLazyModalIds = resolveMountedLazyModalIds(activeModal, mountedLazyModalIds)
  if (resolvedMountedLazyModalIds !== mountedLazyModalIds) {
    // Why: lazy-load modals on first use, then keep them mounted so repeat opens preserve state and avoid re-fetch flashes.
    setMountedLazyModalIds(new Set(resolvedMountedLazyModalIds))
  }

  // Why: extracted so the full-width titlebar and the sidebar-width left header share these controls without duplicating the agent badge popover.
  const titlebarLeftControls = (
    // Why: measure the ENTIRE row so TabGroupPanel's collapse spacer reserves enough width; measuring only the inner cluster left back/forward over the first tab.
    // Why: collapsed mode floats in a w-0 wrapper; w-max stops Windows Chromium from shrinking the app name to one glyph.
    <div
      ref={titlebarLeftControlsRef}
      className={`flex h-full shrink-0 items-center${
        leftTitlebarChromeLayout.isFloating ? ' w-max' : ' w-full'
      }`}
    >
      <div className="flex h-full items-center">
        {isMacPlatform() && !isFullScreen ? (
          <div className="titlebar-traffic-light-pad" />
        ) : hasCustomTitleBar ? (
          /* Why: Windows/Linux remove the native title bar, so render the logo plus a ··· button that pops the application menu (as Alt does). */
          <>
            <img src={logo} alt="" aria-hidden className="titlebar-logo" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="titlebar-icon-button"
                  aria-label={translate('auto.App.8b0b8eb54f', 'Application menu')}
                  onClick={() => window.api.ui.popupMenu()}
                >
                  <MoreHorizontal size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate('auto.App.8b0b8eb54f', 'Application menu')}
              </TooltipContent>
            </Tooltip>
          </>
        ) : (
          <div className="pl-2" />
        )}
        {showSidebar && !hasCustomTitleBar && (
          <>
            {settings?.showTitlebarAppName !== false && (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className="titlebar-app-name"
                    aria-label={translate('auto.App.5096cbbc86', 'Orca')}
                  >
                    <span className="titlebar-app-name-main">
                      {translate('auto.App.5096cbbc86', 'Orca')}
                    </span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      void actions.updateSettings({ showTitlebarAppName: false })
                    }}
                  >
                    {translate('auto.App.e81217c1b7', 'Hide App Name')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </>
        )}
        {showSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle"
                onClick={actions.toggleSidebar}
                aria-label={translate('auto.App.e4b9e7dff7', 'Toggle sidebar')}
              >
                <PanelLeft size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.App.ce37cf5279', 'Toggle sidebar ({{value0}})', {
                value0: leftSidebarShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* Why: Back/Forward span worktree + page history, so show the cluster wherever the shortcut is live (hidden in Settings/non-stack views). */}
      {shouldShowWorktreeHistoryControls(activeView) && (
        // With the sidebar collapsed the header shrink-wraps and ml-auto has no spare width, so keep a fixed gutter before Back.
        <div className="ml-auto mr-3 flex items-center pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goBackWorktree()}
                disabled={!canGoBackWorktree}
                aria-label={translate('auto.App.064bd07810', 'Go back')}
              >
                <ArrowLeft size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.App.fe21e8f6f5', 'Go back ({{value0}})', {
                value0: historyBackShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goForwardWorktree()}
                disabled={!canGoForwardWorktree}
                aria-label={translate('auto.App.cf9099fe98', 'Go forward')}
              >
                <ArrowRight size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.App.f7aa73e785', 'Go forward ({{value0}})', {
                value0: historyForwardShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )

  const rightSidebarToggle = showRightSidebarControls ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="sidebar-toggle mr-2"
          onClick={actions.toggleRightSidebar}
          aria-label={translate('auto.App.9e0b441a91', 'Toggle right sidebar')}
        >
          <PanelRight size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate('auto.App.c184e056de', 'Toggle right sidebar ({{value0}})', {
          value0: rightSidebarShortcutLabel
        })}
      </TooltipContent>
    </Tooltip>
  ) : null

  const titlebarMainStrip = (
    <>
      {activeView === 'activity' ? (
        <ActivityTitlebarControls />
      ) : creationLayoutActive ? null : (
        <div
          id="titlebar-tabs"
          className={`flex flex-1 min-w-0 self-stretch${!workspaceChromeActive ? ' invisible pointer-events-none' : ''}`}
        />
      )}
      {showTitlebarExpandButton && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="titlebar-icon-button"
              onClick={handleToggleExpand}
              aria-label={translate('auto.App.c1cf0b0e4a', 'Collapse pane')}
              disabled={!activeTabCanExpand}
            >
              <Minimize2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.App.c1cf0b0e4a', 'Collapse pane')}
          </TooltipContent>
        </Tooltip>
      )}
      {showProfileSwitcherInTopRight ? <OrcaProfileSwitcher /> : null}
      {/* Why: the open right sidebar's header renders its own close button, so hide this duplicate. */}
      {!rightSidebarOpen && rightSidebarToggle}
      {/* Why: reserve space so the Windows/Linux window-controls overlay doesn't obscure content. */}
      {hasCustomTitleBar && <div className="window-controls-titlebar-spacer" />}
    </>
  )
  const workspaceProfileSwitcher =
    showProfileSwitcherInTopRight &&
    workspaceChromeActive &&
    leftTitlebarChromeLayout.shouldMount &&
    !stackedSidebarOpen ? (
      <div
        className="absolute top-0 z-10 flex h-[36px] items-center"
        style={
          {
            right: showRightSidebarControls
              ? 'calc(var(--window-controls-width) + 42px)'
              : 'var(--window-controls-width)',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      >
        <OrcaProfileSwitcher />
      </div>
    ) : null

  return <AppShellPageRenderer {...{ actions, activeModal, activePendingCreationId, activeView, activeWorktreeId, beginOnboardingSettingsDetour, collapsedSidebarHeaderWidth, creationLayoutActive, floatingTerminalOpen, floatingWorkspaceTourInteractionSnapshotRef, hasSshCredentialRequest, leftSidebarStyle, leftTitlebarChromeLayout, onboarding, onboardingSettingsDetourActive, petVisible, renderPetOverlay, resolvedMountedLazyModalIds, rightSidebarExplorerView, rightSidebarOpen, rightSidebarTab, rightSidebarToggle, setAppRootNode, setFloatingTerminalOpenWithFocus, setOnboarding, settings, shouldMountAddRepoDialog, shouldMountContextualTourOverlay, shouldMountDictationController, shouldMountFloatingTerminalPanel, shouldMountSetupGuideTelemetryObserver, shouldMountTerminalWorkbench, shouldMountUpdateCard, shouldRenderOnboarding, showFloatingTerminalButton, showRightSidebarControls, showSidebar, sidebarOpen, stackedSidebarOpen, statusBarVisible, terminalWorkbenchVisible, titlebarLeftControls, titlebarMainStrip, workspaceChromeActive, workspaceProfileSwitcher, workspaceSessionReady, worktreeSidebarScrollAnchorRef, worktreeSidebarScrollOffsetRef }} />
}

export default App
