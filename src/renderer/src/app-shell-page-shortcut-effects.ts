import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from 'react'; import { ArrowLeft, ArrowRight, Minimize2, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react'; import logo from '../../../resources/logo.svg'; import { SYNC_FIT_PANES_EVENT, TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'; import { syncZoomCSSVar } from '@/lib/ui-zoom'; import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'; import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'; import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'; import { resolveLeftTitlebarChromeLayout } from '@/lib/titlebar-left-chrome'; import { shouldShowWorktreeCreationSurface } from '@/lib/worktree-creation-surface'; import { buildAppFontFamily } from '@/lib/app-font-family'; import { toast } from 'sonner'; import { Toaster } from '@/components/ui/sonner'; import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'; import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'; import { useAppStore } from './store'; import { WORKTREE_REFRESH_CONCURRENCY } from './store/slices/worktrees'; import { useShallow } from 'zustand/react/shallow'; import { isRemoteWorkspaceSnapshotApplyInProgress, useIpcEvents } from './hooks/useIpcEvents'; import { useAutomationDispatchEvents } from './hooks/useAutomationDispatchEvents'; import RetainedAgentsSyncGate from './components/dashboard/RetainedAgentsSyncGate'; import { AgentHibernationGate } from './components/AgentHibernationGate'; import { ActivityTitlebarControls } from './components/activity/ActivityTitlebarControls'; import Sidebar from './components/Sidebar'; import { shutdownBufferCaptures } from './components/terminal-pane/shutdown-buffer-captures'; import { dispatchWindowCloseRequest } from './components/window-close-request-coordinator'; import { getSystemPrefersDarkSnapshot, useSystemPrefersDark } from './components/terminal-pane/use-system-prefers-dark'; import RightSidebar from './components/right-sidebar'; import { StarNagCard } from './components/StarNagCard'; import { StarNagAgentValueMomentObserver } from './components/star-nag/StarNagAgentValueMomentObserver'; import { StarNagToastHost } from './components/star-nag/StarNagToastHost'; import { SkillFreshnessNudge } from './components/skills/SkillFreshnessNudge'; import { SkillFreshnessUpdateDialog } from './components/skills/SkillFreshnessUpdateDialog'; import { TelemetryFirstLaunchSurface } from './components/TelemetryFirstLaunchSurface'; import { ZoomOverlay } from './components/ZoomOverlay'; import { onOnboardingReopened } from './components/onboarding/show-onboarding-event'; import { shouldShowOnboarding } from './components/onboarding/should-show-onboarding'; import { MarkdownTemplatePicker } from './components/editor/MarkdownTemplatePicker'; import { FloatingTerminalToggleButton } from './components/floating-terminal/FloatingTerminalToggleButton'; import { OrcaProfileSwitcher } from './components/orca-profiles/OrcaProfileSwitcher'; import { TOGGLE_FLOATING_TERMINAL_EVENT, requestFloatingTerminalOpenMaximized } from '@/lib/floating-terminal'; import { isFloatingWorkspacePanelFocused, isFloatingWorkspaceTerminalInputTarget, matchFloatingWorkspacePanelChord, shouldMinimizeFloatingWorkspacePanelOnCloseShortcut } from '@/lib/floating-workspace-terminal-actions'; import { createFloatingWorkspaceTourInteractionSnapshot } from '@/lib/floating-workspace-tour-interaction-snapshot'; import { requestScrollToCurrentWorkspaceRevealAndRename } from '@/lib/scroll-to-current-workspace-status'; import { OPEN_WORKSPACE_BOARD_EVENT } from './components/sidebar/useWorkspaceBoardPanel'; import { WorkspacePortScanner } from './components/ports/WorkspacePortScanner'; import { CrashReportDialog } from './components/crash-report/CrashReportDialog'; import NewWorkspaceComposerModal from './components/NewWorkspaceComposerModal'; import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'; import { ConfirmationDialogProvider } from './components/confirmation-dialog'; import { LinkRoutingPreferenceDialogProvider } from './components/link-routing-preference-dialog'; import RecentTabSwitcher from './components/tab-bar/RecentTabSwitcher'; import { useGitStatusPolling } from './components/right-sidebar/useGitStatusPolling'; import { useEditorExternalWatch } from './hooks/useEditorExternalWatch'; import { useAutoAckViewedAgent } from './hooks/useAutoAckViewedAgent'; import { useDashboardPopoutBridge } from './components/dashboard/useDashboardPopoutBridge'; import { useUnreadDockBadge } from './hooks/useUnreadDockBadge'; import { resolvePrimarySelectionMiddleClickPaste, usePrimarySelectionPaste } from './hooks/usePrimarySelectionPaste'; import { useAppMenuPaste } from './hooks/useAppMenuPaste'; import { useLargeTextControlPaste } from './hooks/useLargeTextControlPaste'; import { canSkipRuntimeMobileSessionSyncKeyBuild, getRuntimeMobileSessionSyncKey, runtimeMobileSessionSyncKeysEqual, scheduleRuntimeGraphSync, setRuntimeGraphStoreStateGetter, setRuntimeGraphSyncEnabled } from './runtime/sync-runtime-graph'; import { useWebSessionTabsSync } from './runtime/web-session-tabs-sync'; import { useGlobalFileDrop } from './hooks/useGlobalFileDrop'; import { MacosTccPromptNoticeHost } from './hooks/MacosTccPromptNoticeHost'; import { useRadixBodyPointerEventsRecovery } from './hooks/useRadixBodyPointerEventsRecovery'; import { registerUpdaterBeforeUnloadBypass } from './lib/updater-beforeunload'; import { ORCA_APP_RESTART_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT } from '../../shared/updater-renderer-events'; import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../shared/renderer-shutdown-events'; import { buildWorkspaceSessionPayload, shouldPersistWorkspaceSession } from './lib/workspace-session'; import { createSessionWriteSubscriber } from './lib/session-write-subscriber'; import { buildActiveViewUnloadPatch } from './lib/active-view-persist'; import { buildWorkspaceSessionHostSnapshots, fetchWorkspaceSessionWithRuntimeHostOwners, patchWorkspaceSessionByHost } from './lib/workspace-session-host-persistence'; import { createShutdownCheckpointBeforeUnloadHandler, createShutdownCheckpointGuard } from './lib/shutdown-checkpoint-guard'; import { collectFolderWorkspaceKeysFromSession, collectWorktreeHydrationRepoIdsFromSession } from './lib/workspace-session-hydration-keys'; import { getStartupErrorFallbackUI, hydratePersistedUIAfterStartupRead } from './lib/startup-ui-hydration'; import { logRendererStartupDiagnostic, timeRendererStartupStep, timeRendererStartupSyncStep } from './startup/startup-diagnostics'; import { reconnectSshTargetForRendererStartup } from './startup/ssh-startup-reconnect'; import { shouldRenderPetOverlay } from './components/pet/pet-overlay-visibility'; import { applyDocumentTheme } from './lib/document-theme'; import { getSystemPrefersDark } from './lib/terminal-theme'; import { publishTerminalViewAttributesAtAppStart } from './components/terminal-pane/terminal-appearance'; import { isEditableTarget } from './lib/editable-target'; import { getSelectedTextForFileSearch } from './lib/file-search-selection'; import { useShortcutLabel } from './hooks/useShortcutLabel'; import { folderRelativePathToIncludeGlob, selectedExplorerFolderRelativePath } from './components/right-sidebar/file-search-include-pattern'; import { shouldShowWorktreeHistoryControls } from './lib/titlebar-worktree-history-controls'; import { canGoBackWorktreeHistory, canGoForwardWorktreeHistory } from '@/store/slices/worktree-nav-history'; import { selectFloatingVisibleTabCount } from './store/selectors'; import { selectActiveTerminalChromeState } from './store/active-terminal-chrome-selector'; import type { VirtualizedScrollAnchor } from './hooks/useVirtualizedScrollAnchor'; import type { OnboardingState } from '../../shared/types'; import { getFeatureTipsAppOpenDecision, isCliFeatureTipCompleted } from './components/feature-tips/feature-tip-startup-gate'; import { trackCmdJPaletteFeatureTipShown, trackOrcaCliFeatureTipShown } from './components/feature-tips/feature-tip-telemetry'; import { keybindingMatchesAction, type KeybindingActionId, type KeybindingContext, type KeybindingMatchOptions } from '../../shared/keybindings'; import { PLUGIN_COMMAND_ALIAS_ACTION_IDS } from '../../shared/plugins/plugin-command-actions'; import { registerAppCommandDispatcher } from '@/lib/app-command-dispatch'; import { executePluginCommand } from '@/lib/plugin-command-execution'; import { findPluginCommandForKeybinding } from '@/lib/plugin-command-keybindings'; import { usePluginCommands } from '@/store/plugin-panels'; import { getRepoExecutionHostId, isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../shared/execution-host'; import { mapWithConcurrency } from '../../shared/map-with-concurrency'; import { ModifierDoubleTapDetector, toModifierDoubleTapEvent } from '../../shared/modifier-double-tap-detector'; import { isGitRepoKind } from '../../shared/repo-kind'; import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'; import { resolveMountedLazyModalIds, type LazyModalId } from './lazy-modal-mount-state'; import { translate } from '@/i18n/i18n'; import PinnedTabCloseDialog from './components/terminal-pane/PinnedTabCloseDialog'; import WorktreeBaseFallbackDialog from './components/WorktreeBaseFallbackDialog'; import { useOsc52ClipboardDefaultOnNotice } from './components/terminal-pane/osc52-clipboard-default-on-notice'; import { hasRequestedBackgroundTerminalWorktreeMount, subscribeBackgroundTerminalWorktreeMountRequests } from './components/terminal/background-terminal-worktree-mount'; import { useRemoteRuntimeRecoveryTriggers } from './runtime/use-remote-runtime-recovery-triggers'; import { getKeybindingContext, hasCustomTitleBar, isMacPlatform, SLEEPING_AGENT_RESUME_CAPTURE_INTERVAL_MS, shortcutPlatform, type ShortcutDispatchInput } from './app-shell-model'; import { listRuntimeSessionHostIdsForStartup } from './app-shell-actions'; import { ActivityPrototypePage, applyRemoteWorkspacePatchStatus, AddProjectFromFolderDialog, AddRepoDialog, AutomationsPage, ContextualTourOverlay, DeleteWorktreeDialog, DictationController, FeatureTipsModal, FeatureWallModal, FloatingTerminalPanel, Landing, MobilePage, NonGitFolderDialog, OnboardingFlow, PetOverlay, ProjectAddedDialog, QuickOpen, RemoteServerUpdateDialog, Settings, SetupGuideModal, SetupGuideTelemetryObserver, shouldMountUpdateCardForStatus, SkillsPage, SshPassphraseDialog, StatusBar, TaskPage, Terminal, UpdateCard, WindowControls, WorkspaceCleanupDialog, WorktreeCreationPanel, WorktreeJumpPalette, WorkspaceSpacePage } from './app-shell-dependencies'
export function useAppShellPageShortcutEffects(context: Record<string, unknown>) {
  const { actions, activeView, activeWorktreeId, creationLayoutActive, floatingTerminalEnabled, floatingTerminalOpen, floatingVisibleTabCount, globalShortcutStateRef, isFullScreen, keybindings, leftTitlebarChromeLayout, pluginCommands, setCollapsedSidebarHeaderWidth, setFloatingTerminalOpenWithFocus, settings, showSidebar, showSleepingWorkspaces, sidebarOpen, titlebarLeftControlsRef, workspaceChromeActive } = context as any
  useEffect(() => {
    const doubleTapDetector = new ModifierDoubleTapDetector()

    const createRegisteredCommandHandlers = (
      input?: ShortcutDispatchInput,
      keybindingContext: KeybindingContext = 'app'
    ): Map<KeybindingActionId, () => boolean> => {
      const {
        activeView,
        activeWorktreeId,
        actions,
        floatingTerminalEnabled,
        floatingTerminalOpen,
        terminalShortcutPolicy,
        keybindings,
        setFloatingTerminalOpenWithFocus,
        workspaceChromeActive,
        creationLayoutActive
      } = globalShortcutStateRef.current
      const floatingWorkspaceFocused = isFloatingWorkspacePanelFocused()
      const canRevealRightSidebar = !creationLayoutActive && canShowRightSidebarForView(activeView)
      const claim = (actionId: KeybindingActionId, run: () => void): boolean => {
        input?.preventDefault()
        if (
          input &&
          keybindingContext === 'terminal' &&
          (terminalShortcutPolicy ?? 'orca-first') === 'orca-first'
        ) {
          showTerminalShortcutCaptureNotification({
            actionId,
            platform: shortcutPlatform,
            keybindings
          })
        }
        run()
        return true
      }

      return new Map<KeybindingActionId, () => boolean>([
        [
          'worktree.history.back',
          () => {
            if (creationLayoutActive || !shouldShowWorktreeHistoryControls(activeView)) {
              return false
            }
            return claim('worktree.history.back', () => useAppStore.getState().goBackWorktree())
          }
        ],
        [
          'worktree.history.forward',
          () => {
            if (creationLayoutActive || !shouldShowWorktreeHistoryControls(activeView)) {
              return false
            }
            return claim('worktree.history.forward', () =>
              useAppStore.getState().goForwardWorktree()
            )
          }
        ],
        ['sidebar.left.toggle', () => claim('sidebar.left.toggle', () => actions.toggleSidebar())],
        [
          'sidebar.sleepingWorkspaces.toggle',
          () =>
            claim('sidebar.sleepingWorkspaces.toggle', () => {
              const store = useAppStore.getState()
              const nextShowSleeping = !store.showSleepingWorkspaces
              store.setShowSleepingWorkspaces(nextShowSleeping)
              if (nextShowSleeping) {
                store.setSidebarOpen(true)
              }
            })
        ],
        [
          'floatingWorkspace.maximize',
          () => {
            if (floatingTerminalOpen || !floatingTerminalEnabled) {
              return false
            }
            return claim('floatingWorkspace.maximize', () => {
              requestFloatingTerminalOpenMaximized()
              setFloatingTerminalOpenWithFocus(true)
            })
          }
        ],
        [
          'tab.rename',
          () => {
            const store = useAppStore.getState()
            if (
              !workspaceChromeActive ||
              floatingWorkspaceFocused ||
              store.activeTabType !== 'terminal' ||
              !store.activeTabId
            ) {
              return false
            }
            return claim('tab.rename', () => store.setRenamingTabId(store.activeTabId!))
          }
        ],
        [
          'workspace.rename',
          () => {
            if (!workspaceChromeActive || floatingWorkspaceFocused || !activeWorktreeId) {
              return false
            }
            return claim('workspace.rename', () => {
              useAppStore.getState().setSidebarOpen(true)
              requestScrollToCurrentWorkspaceRevealAndRename()
            })
          }
        ],
        [
          'workspace.openBoard',
          () => {
            if (activeView === 'settings') {
              return false
            }
            return claim('workspace.openBoard', () => {
              useAppStore.getState().setSidebarOpen(true)
              window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_BOARD_EVENT))
            })
          }
        ],
        [
          'view.tasks',
          () => {
            const store = useAppStore.getState()
            if (activeView === 'settings' || !store.repos.some((repo) => isGitRepoKind(repo))) {
              return false
            }
            return claim('view.tasks', () => store.openTaskPage())
          }
        ],
        [
          'sidebar.right.toggle',
          () =>
            canRevealRightSidebar
              ? claim('sidebar.right.toggle', () => actions.toggleRightSidebar())
              : false
        ],
        [
          'sidebar.explorer.toggle',
          () =>
            canRevealRightSidebar
              ? claim('sidebar.explorer.toggle', () => actions.showRightSidebarFiles())
              : false
        ],
        [
          'sidebar.search.toggle',
          () =>
            canRevealRightSidebar
              ? claim('sidebar.search.toggle', () => actions.showRightSidebarSearch())
              : false
        ],
        [
          'sidebar.sourceControl.toggle',
          () => {
            if (!canRevealRightSidebar || document.querySelector('[data-terminal-search-root]')) {
              return false
            }
            return claim('sidebar.sourceControl.toggle', () => {
              actions.setRightSidebarTab('source-control')
              actions.setRightSidebarOpen(true)
            })
          }
        ],
        [
          'sidebar.checks.toggle',
          () =>
            canRevealRightSidebar
              ? claim('sidebar.checks.toggle', () => {
                  actions.setRightSidebarTab('checks')
                  actions.setRightSidebarOpen(true)
                })
              : false
        ],
        [
          'sidebar.ports.toggle',
          () =>
            canRevealRightSidebar
              ? claim('sidebar.ports.toggle', () => {
                  actions.setRightSidebarTab('ports')
                  actions.setRightSidebarOpen(true)
                })
              : false
        ]
      ])
    }

    const unregisterAppCommandDispatcher = registerAppCommandDispatcher((actionId) =>
      (createRegisteredCommandHandlers().get(actionId) ?? (() => false))()
    )

    const dispatchShortcutInput = (input: ShortcutDispatchInput): void => {
      const {
        activeView,
        activeWorktreeId,
        actions,
        floatingTerminalEnabled,
        floatingTerminalOpen,
        floatingVisibleTabCount,
        keybindings,
        pluginCommands,
        terminalShortcutPolicy,
        setFloatingTerminalOpenWithFocus,
        creationLayoutActive
      } = globalShortcutStateRef.current

      // Child handlers (e.g. terminal search) share this window capture phase and fire first; bail if they already preventDefault'd so both don't act.
      if (input.defaultPrevented) {
        return
      }
      // The Settings shortcut recorder captures existing shortcuts, so global handlers must not fire while its button has focus.
      if (
        input.target instanceof Element &&
        input.target.closest('[data-shortcut-recorder-active]') !== null
      ) {
        return
      }
      const context = getKeybindingContext(input.target)

      // Note: some shortcuts are also intercepted in createMainWindow.ts before-input-event (for browser-guest focus); the renderer keeps handlers for local focus.

      const matchShortcut = (actionId: KeybindingActionId): boolean =>
        keybindingMatchesAction(actionId, input, shortcutPlatform, keybindings, {
          context,
          terminalShortcutPolicy
        })
      const notifyTerminalCapture = (actionId: KeybindingActionId): void => {
        if (context !== 'terminal' || (terminalShortcutPolicy ?? 'orca-first') !== 'orca-first') {
          return
        }
        showTerminalShortcutCaptureNotification({
          actionId,
          platform: shortcutPlatform,
          keybindings
        })
      }

      const canRevealRightSidebar = !creationLayoutActive && canShowRightSidebarForView(activeView)

      const openSearchSidebar = (query: string | null): void => {
        actions.showRightSidebarSearch(query ? { query } : undefined)
      }

      if (matchShortcut('sidebar.search.toggle') && canRevealRightSidebar) {
        // With a folder selected in the explorer, Cmd/Ctrl+Shift+F means "Find in Folder" — seed the include pattern with it, not a text search.
        const selectedFolderRelativePath =
          document.activeElement instanceof Element
            ? selectedExplorerFolderRelativePath(document.activeElement)
            : null
        if (selectedFolderRelativePath !== null && activeWorktreeId) {
          input.preventDefault()
          notifyTerminalCapture('sidebar.search.toggle')
          actions.showRightSidebarSearch({
            includePattern: folderRelativePathToIncludeGlob(selectedFolderRelativePath)
          })
          return
        }

        const selectedText = getSelectedTextForFileSearch()
        if (selectedText) {
          input.preventDefault()
          notifyTerminalCapture('sidebar.search.toggle')
          openSearchSidebar(selectedText)
          return
        }
      }

      // An empty floating workspace has no tab to close, so Cmd/Ctrl+W hides the overlay before other surfaces act.
      if (
        keybindingMatchesAction('tab.close', input, shortcutPlatform, keybindings, {
          context: 'app'
        }) &&
        shouldMinimizeFloatingWorkspacePanelOnCloseShortcut({
          floatingTerminalOpen,
          floatingVisibleTabCount
        })
      ) {
        input.preventDefault()
        setFloatingTerminalOpenWithFocus(false)
        return
      }

      // Floating panel closed → its keydown handler is gone, so honor the maximize chord here by opening it pre-maximized (no-op while it's open).
      if (
        !floatingTerminalOpen &&
        matchShortcut('floatingWorkspace.maximize') &&
        floatingTerminalEnabled
      ) {
        input.preventDefault()
        requestFloatingTerminalOpenMaximized()
        setFloatingTerminalOpenWithFocus(true)
        return
      }

      // Skip editable surfaces so TipTap's Cmd+B bold works; this renderer-side fallback covers the blur→press IPC race (docs/markdown-cmd-b-bold-design.md).
      if (isEditableTarget(input.target)) {
        return
      }

      // Let floating-terminal SSH/tmux control chords reach the terminal (xterm's helper textarea isn't a generic editable target).
      if (isFloatingWorkspaceTerminalInputTarget(input.target)) {
        return
      }

      // Only short-circuit chords the floating panel itself claims; suppressing others here would silently no-op them when focus is in the panel.
      const floatingWorkspaceFocused = isFloatingWorkspacePanelFocused()
      if (floatingWorkspaceFocused) {
        const floatingMatchOptions: KeybindingMatchOptions = { context, terminalShortcutPolicy }
        if (
          matchFloatingWorkspacePanelChord(
            input,
            shortcutPlatform,
            null,
            keybindings,
            floatingMatchOptions
          ) !== null
        ) {
          return
        }
      }

      // Plugin chords are user-reviewed instructional content. They win over
      // built-in defaults only in app focus; terminal/editor/browser handlers
      // retain their own shortcut authority.
      if (context === 'app') {
        const pluginCommand = findPluginCommandForKeybinding(
          pluginCommands,
          input,
          shortcutPlatform,
          keybindings,
          Boolean(activeWorktreeId)
        )
        if (pluginCommand) {
          input.preventDefault()
          void executePluginCommand(pluginCommand, 'plugin-keybinding').catch(() => {
            toast.error(
              translate('auto.App.pluginCommandFailed', 'Could not run the plugin command.')
            )
          })
          return
        }
      }

      const handlers = createRegisteredCommandHandlers(input, context)
      for (const actionId of PLUGIN_COMMAND_ALIAS_ACTION_IDS) {
        if (matchShortcut(actionId) && handlers.get(actionId)?.()) {
          return
        }
      }

      // Unbound by default, so it runs after the built-in alias handlers above; only consumes the chord when the active worktree has unsent notes.
      if (canRevealRightSidebar && matchShortcut('sourceControl.sendReviewNotes')) {
        if (actions.openDiffNotesSendMenuForActiveWorktree()) {
          input.preventDefault()
          notifyTerminalCapture('sourceControl.sendReviewNotes')
        }
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const detected = doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: 'keyDown',
          code: e.code,
          key: e.key,
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey,
          isAutoRepeat: e.repeat
        }),
        Date.now()
      )
      if (e.repeat) {
        return
      }
      if (detected) {
        // Synthetic input: no key/modifier flags, so only DoubleTap bindings match.
        dispatchShortcutInput({
          doubleTapModifier: detected.modifier,
          target: e.target,
          defaultPrevented: e.defaultPrevented,
          preventDefault: () => e.preventDefault()
        })
        return
      }
      dispatchShortcutInput({
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        target: e.target,
        defaultPrevented: e.defaultPrevented,
        preventDefault: () => e.preventDefault()
      })
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: 'keyUp',
          code: e.code,
          key: e.key,
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey
        }),
        Date.now()
      )
    }

    // Why: a window blur mid-gesture must not leave the detector armed.
    const onBlur = (): void => doubleTapDetector.reset()

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      unregisterAppCommandDispatcher()
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useLayoutEffect(() => {
    const controls = titlebarLeftControlsRef.current
    if (!controls) {
      return
    }

    const updateWidth = (): void => {
      setCollapsedSidebarHeaderWidth(controls.getBoundingClientRect().width)
    }

    updateWidth()
    const observer = new ResizeObserver(() => {
      updateWidth()
    })
    observer.observe(controls)
    return () => observer.disconnect()
  }, [
    isFullScreen,
    settings?.showTitlebarAppName,
    showSidebar,
    leftTitlebarChromeLayout.isFloating,
    sidebarOpen
}
