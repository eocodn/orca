import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type SetStateAction } from 'react'; import { ArrowLeft, ArrowRight, Minimize2, MoreHorizontal, PanelLeft, PanelRight } from 'lucide-react'; import logo from '../../../resources/logo.svg'; import { SYNC_FIT_PANES_EVENT, TOGGLE_TERMINAL_PANE_EXPAND_EVENT } from '@/constants/terminal'; import { syncZoomCSSVar } from '@/lib/ui-zoom'; import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'; import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'; import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'; import { resolveLeftTitlebarChromeLayout } from '@/lib/titlebar-left-chrome'; import { shouldShowWorktreeCreationSurface } from '@/lib/worktree-creation-surface'; import { buildAppFontFamily } from '@/lib/app-font-family'; import { toast } from 'sonner'; import { Toaster } from '@/components/ui/sonner'; import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'; import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'; import { useAppStore } from './store'; import { WORKTREE_REFRESH_CONCURRENCY } from './store/slices/worktrees'; import { useShallow } from 'zustand/react/shallow'; import { isRemoteWorkspaceSnapshotApplyInProgress, useIpcEvents } from './hooks/useIpcEvents'; import { useAutomationDispatchEvents } from './hooks/useAutomationDispatchEvents'; import RetainedAgentsSyncGate from './components/dashboard/RetainedAgentsSyncGate'; import { AgentHibernationGate } from './components/AgentHibernationGate'; import { ActivityTitlebarControls } from './components/activity/ActivityTitlebarControls'; import Sidebar from './components/Sidebar'; import { shutdownBufferCaptures } from './components/terminal-pane/shutdown-buffer-captures'; import { dispatchWindowCloseRequest } from './components/window-close-request-coordinator'; import { getSystemPrefersDarkSnapshot, useSystemPrefersDark } from './components/terminal-pane/use-system-prefers-dark'; import RightSidebar from './components/right-sidebar'; import { StarNagCard } from './components/StarNagCard'; import { StarNagAgentValueMomentObserver } from './components/star-nag/StarNagAgentValueMomentObserver'; import { StarNagToastHost } from './components/star-nag/StarNagToastHost'; import { SkillFreshnessNudge } from './components/skills/SkillFreshnessNudge'; import { SkillFreshnessUpdateDialog } from './components/skills/SkillFreshnessUpdateDialog'; import { TelemetryFirstLaunchSurface } from './components/TelemetryFirstLaunchSurface'; import { ZoomOverlay } from './components/ZoomOverlay'; import { onOnboardingReopened } from './components/onboarding/show-onboarding-event'; import { shouldShowOnboarding } from './components/onboarding/should-show-onboarding'; import { MarkdownTemplatePicker } from './components/editor/MarkdownTemplatePicker'; import { FloatingTerminalToggleButton } from './components/floating-terminal/FloatingTerminalToggleButton'; import { OrcaProfileSwitcher } from './components/orca-profiles/OrcaProfileSwitcher'; import { TOGGLE_FLOATING_TERMINAL_EVENT, requestFloatingTerminalOpenMaximized } from '@/lib/floating-terminal'; import { isFloatingWorkspacePanelFocused, isFloatingWorkspaceTerminalInputTarget, matchFloatingWorkspacePanelChord, shouldMinimizeFloatingWorkspacePanelOnCloseShortcut } from '@/lib/floating-workspace-terminal-actions'; import { createFloatingWorkspaceTourInteractionSnapshot } from '@/lib/floating-workspace-tour-interaction-snapshot'; import { requestScrollToCurrentWorkspaceRevealAndRename } from '@/lib/scroll-to-current-workspace-status'; import { OPEN_WORKSPACE_BOARD_EVENT } from './components/sidebar/useWorkspaceBoardPanel'; import { WorkspacePortScanner } from './components/ports/WorkspacePortScanner'; import { CrashReportDialog } from './components/crash-report/CrashReportDialog'; import NewWorkspaceComposerModal from './components/NewWorkspaceComposerModal'; import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'; import { ConfirmationDialogProvider } from './components/confirmation-dialog'; import { LinkRoutingPreferenceDialogProvider } from './components/link-routing-preference-dialog'; import RecentTabSwitcher from './components/tab-bar/RecentTabSwitcher'; import { useGitStatusPolling } from './components/right-sidebar/useGitStatusPolling'; import { useEditorExternalWatch } from './hooks/useEditorExternalWatch'; import { useAutoAckViewedAgent } from './hooks/useAutoAckViewedAgent'; import { useDashboardPopoutBridge } from './components/dashboard/useDashboardPopoutBridge'; import { useUnreadDockBadge } from './hooks/useUnreadDockBadge'; import { resolvePrimarySelectionMiddleClickPaste, usePrimarySelectionPaste } from './hooks/usePrimarySelectionPaste'; import { useAppMenuPaste } from './hooks/useAppMenuPaste'; import { useLargeTextControlPaste } from './hooks/useLargeTextControlPaste'; import { canSkipRuntimeMobileSessionSyncKeyBuild, getRuntimeMobileSessionSyncKey, runtimeMobileSessionSyncKeysEqual, scheduleRuntimeGraphSync, setRuntimeGraphStoreStateGetter, setRuntimeGraphSyncEnabled } from './runtime/sync-runtime-graph'; import { useWebSessionTabsSync } from './runtime/web-session-tabs-sync'; import { useGlobalFileDrop } from './hooks/useGlobalFileDrop'; import { MacosTccPromptNoticeHost } from './hooks/MacosTccPromptNoticeHost'; import { useRadixBodyPointerEventsRecovery } from './hooks/useRadixBodyPointerEventsRecovery'; import { registerUpdaterBeforeUnloadBypass } from './lib/updater-beforeunload'; import { ORCA_APP_RESTART_ABORTED_EVENT, ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT } from '../../shared/updater-renderer-events'; import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../shared/renderer-shutdown-events'; import { buildWorkspaceSessionPayload, shouldPersistWorkspaceSession } from './lib/workspace-session'; import { createSessionWriteSubscriber } from './lib/session-write-subscriber'; import { buildActiveViewUnloadPatch } from './lib/active-view-persist'; import { buildWorkspaceSessionHostSnapshots, fetchWorkspaceSessionWithRuntimeHostOwners, patchWorkspaceSessionByHost } from './lib/workspace-session-host-persistence'; import { createShutdownCheckpointBeforeUnloadHandler, createShutdownCheckpointGuard } from './lib/shutdown-checkpoint-guard'; import { collectFolderWorkspaceKeysFromSession, collectWorktreeHydrationRepoIdsFromSession } from './lib/workspace-session-hydration-keys'; import { getStartupErrorFallbackUI, hydratePersistedUIAfterStartupRead } from './lib/startup-ui-hydration'; import { logRendererStartupDiagnostic, timeRendererStartupStep, timeRendererStartupSyncStep } from './startup/startup-diagnostics'; import { reconnectSshTargetForRendererStartup } from './startup/ssh-startup-reconnect'; import { shouldRenderPetOverlay } from './components/pet/pet-overlay-visibility'; import { applyDocumentTheme } from './lib/document-theme'; import { getSystemPrefersDark } from './lib/terminal-theme'; import { publishTerminalViewAttributesAtAppStart } from './components/terminal-pane/terminal-appearance'; import { isEditableTarget } from './lib/editable-target'; import { getSelectedTextForFileSearch } from './lib/file-search-selection'; import { useShortcutLabel } from './hooks/useShortcutLabel'; import { folderRelativePathToIncludeGlob, selectedExplorerFolderRelativePath } from './components/right-sidebar/file-search-include-pattern'; import { shouldShowWorktreeHistoryControls } from './lib/titlebar-worktree-history-controls'; import { canGoBackWorktreeHistory, canGoForwardWorktreeHistory } from '@/store/slices/worktree-nav-history'; import { selectFloatingVisibleTabCount } from './store/selectors'; import { selectActiveTerminalChromeState } from './store/active-terminal-chrome-selector'; import type { VirtualizedScrollAnchor } from './hooks/useVirtualizedScrollAnchor'; import type { OnboardingState } from '../../shared/types'; import { getFeatureTipsAppOpenDecision, isCliFeatureTipCompleted } from './components/feature-tips/feature-tip-startup-gate'; import { trackCmdJPaletteFeatureTipShown } from './components/feature-tips/feature-tip-telemetry'; import { keybindingMatchesAction, type KeybindingActionId, type KeybindingContext, type KeybindingMatchOptions } from '../../shared/keybindings'; import { PLUGIN_COMMAND_ALIAS_ACTION_IDS } from '../../shared/plugins/plugin-command-actions'; import { registerAppCommandDispatcher } from '@/lib/app-command-dispatch'; import { executePluginCommand } from '@/lib/plugin-command-execution'; import { findPluginCommandForKeybinding } from '@/lib/plugin-command-keybindings'; import { usePluginCommands } from '@/store/plugin-panels'; import { getRepoExecutionHostId, isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../shared/execution-host'; import { mapWithConcurrency } from '../../shared/map-with-concurrency'; import { ModifierDoubleTapDetector, toModifierDoubleTapEvent } from '../../shared/modifier-double-tap-detector'; import { isGitRepoKind } from '../../shared/repo-kind'; import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'; import { resolveMountedLazyModalIds, type LazyModalId } from './lazy-modal-mount-state'; import { translate } from '@/i18n/i18n'; import PinnedTabCloseDialog from './components/terminal-pane/PinnedTabCloseDialog'; import WorktreeBaseFallbackDialog from './components/WorktreeBaseFallbackDialog'; import { useOsc52ClipboardDefaultOnNotice } from './components/terminal-pane/osc52-clipboard-default-on-notice'; import { hasRequestedBackgroundTerminalWorktreeMount, subscribeBackgroundTerminalWorktreeMountRequests } from './components/terminal/background-terminal-worktree-mount'; import { useRemoteRuntimeRecoveryTriggers } from './runtime/use-remote-runtime-recovery-triggers'; import { getKeybindingContext, hasCustomTitleBar, isMacPlatform, SLEEPING_AGENT_RESUME_CAPTURE_INTERVAL_MS, shortcutPlatform, type ShortcutDispatchInput } from './app-shell-model'; import { listRuntimeSessionHostIdsForStartup } from './app-shell-actions'; import { ActivityPrototypePage, applyRemoteWorkspacePatchStatus, AddProjectFromFolderDialog, AddRepoDialog, AutomationsPage, ContextualTourOverlay, DeleteWorktreeDialog, DictationController, FeatureTipsModal, FeatureWallModal, FloatingTerminalPanel, Landing, MobilePage, NonGitFolderDialog, OnboardingFlow, PetOverlay, ProjectAddedDialog, QuickOpen, RemoteServerUpdateDialog, Settings, SetupGuideModal, SetupGuideTelemetryObserver, shouldMountUpdateCardForStatus, SkillsPage, SshPassphraseDialog, StatusBar, TaskPage, Terminal, UpdateCard, WindowControls, WorkspaceCleanupDialog, WorktreeCreationPanel, WorktreeJumpPalette, WorkspaceSpacePage } from './app-shell-dependencies'
export function useAppShellPageStartupEffects(context: Record<string, unknown>) {
  const { actions, keybindings, onboarding, persistedUIReady, rightSidebarOpen, setOnboarding, setOnboardingLoaded, settings, sidebarOpen, workspaceSessionReady } = context as any
  // Why: useLayoutEffect fires before paint, so dispatching SYNC_FIT_PANES_EVENT reflows the terminal in the same frame as the width change — no wrongly-sized transient.
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
  }, [sidebarOpen, rightSidebarOpen])

  // Fetch initial data + hydrate GitHub cache from disk
  useEffect(() => {
    let cancelled = false
    // Why: declared outside the async block so cleanup can abort it — under StrictMode the first (unmounted) pass would otherwise keep spawning PTYs.
    const abortController = new AbortController()

    // Why (issue #1158): hydrate persisted UI right after ui.get() succeeds; the UI writer is gated only on persistedUIReady, so later default fallback would serialize defaults to disk.
    let uiHydrated = false
    // Why (issue #1158): track whether success-path reconnect started so the catch doesn't re-run it — re-entering on partially-mutated state would double-set ptyIds and drain pending* twice.
    let reconnectStarted = false
    void (async () => {
      const startupStartedAt = performance.now()
      logRendererStartupDiagnostic('startup-chain-start')
      try {
        // Why: nothing in the hydration chain reads profile state synchronously, so don't let it add a serial IPC round-trip before fetchSettings.
        void actions.fetchOrcaProfiles()
        // Why: repo/worktree hydration routes through settings.activeRuntimeEnvironmentId; load settings first so a persisted remote runtime doesn't hydrate stale local state.
        await timeRendererStartupStep('fetch-settings', () => actions.fetchSettings())
        // Why: hidden-at-launch PTYs can query OSC 10/11 before any pane mounts; publish view attributes as soon as settings exist so main's silent-until-push responder has data.
        publishTerminalViewAttributesAtAppStart(
          useAppStore.getState().settings,
          getSystemPrefersDark()
        )
        // Why: start keybindings + onboarding now so their IPC overlaps the local catalog scans; await them at their original spots. The .catch marks rejections handled if an earlier await throws first.
        // Why: browser session profiles are NOT started early — on a remote runtime the RPC may be unconnected and a failed fetch clears the list.
        const keybindingsPromise = timeRendererStartupStep('fetch-keybindings', () =>
          actions.fetchKeybindings()
        )
        keybindingsPromise.catch(() => {})
        const onboardingPromise = timeRendererStartupStep('onboarding-get', () =>
          window.api.onboarding.get()
        )
        onboardingPromise.catch(() => {})
        // Why: await ui.get() (not overlap) so persisted view settings hydrate before the local catalog/session steps and first paint reflects them.
        const persistedUI = await timeRendererStartupStep('ui-get', () => window.api.ui.get())
        uiHydrated = timeRendererStartupSyncStep('hydrate-persisted-ui', () =>
          hydratePersistedUIAfterStartupRead({
            persistedUI,
            cancelled,
            hydratePersistedUI: actions.hydratePersistedUI
          })
        )
        // Why: list-runtime-session-hosts reads no repo state, so overlap it with the repo scan
        // instead of paying its IPC round-trip serially before repos. .catch marks rejections handled
        // if an earlier await throws first; the value is awaited below and surfaces any error there.
        const runtimeHostsPromise = timeRendererStartupStep(
          'list-runtime-session-hosts',
          listRuntimeSessionHostIdsForStartup
        )
        runtimeHostsPromise.catch(() => {})
        // Why: saved remote runtimes can spend the full connect timeout; load only the local catalog for first paint and refresh remotes after hydration.
        await timeRendererStartupStep('fetch-repos-local', () =>
          actions.fetchReposForAllHosts({ remoteHosts: 'skip' })
        )
        await timeRendererStartupStep('repo-catalog-settlement', () =>
          actions.awaitLocalRepoCatalogSettlement()
        )
        // Why: folder workspaces merge against projectGroups (repos.ts fetchFolderWorkspacesForAllHosts),
        // so keep this chain ordered while overlapping it with session-scoped hydration.
        const localCatalogChain = (async () => {
          await timeRendererStartupStep('fetch-project-groups-local', () =>
            actions.fetchProjectGroupsForAllHosts({ remoteHosts: 'skip' })
          )
          await timeRendererStartupStep('fetch-folder-workspaces-local', () =>
            actions.fetchFolderWorkspacesForAllHosts({ remoteHosts: 'skip' })
          )
        })()
        const sessionReadPromise = runtimeHostsPromise.then((startupRuntimeHostIds) =>
          // Why: include saved runtime host ids so per-host worktree session slices restore from local settings without waiting on network reachability; unreadable partitions skip.
          timeRendererStartupStep('session-get', () =>
            fetchWorkspaceSessionWithRuntimeHostOwners(
              window.api.session,
              useAppStore.getState().repos,
              startupRuntimeHostIds
            )
          )
        )
        const hydrationSessionChain = sessionReadPromise.then(async (sessionRead) => {
          const hydrationRepoIds = collectWorktreeHydrationRepoIdsFromSession(
            sessionRead.session,
            sessionRead.runtimeHostIdByWorkspaceSessionKey
          )
          const hydrationRepoIdSet = new Set(hydrationRepoIds)
          const hydrationRepos = useAppStore.getState().repos.filter(
            (repo) =>
              hydrationRepoIdSet.has(repo.id) &&
              // Why: disconnected SSH repos hydrate from local metadata; only runtime-owned repos use placeholders.
              parseExecutionHostId(getRepoExecutionHostId(repo))?.kind !== 'runtime'
          )
          await timeRendererStartupStep('fetch-hydration-worktrees', () =>
            mapWithConcurrency(hydrationRepos, WORKTREE_REFRESH_CONCURRENCY, (repo) =>
              actions.fetchWorktrees(repo.id, { executionHostId: getRepoExecutionHostId(repo) })
            )
          )
          return sessionRead
        })
        // Why: wait for both writers to settle before recovery so neither can mutate hydrated state afterward.
        const [sessionOutcome, catalogOutcome] = await Promise.allSettled([
          hydrationSessionChain,
          localCatalogChain
        ])
        if (sessionOutcome.status === 'rejected') {
          throw sessionOutcome.reason
        }
        if (catalogOutcome.status === 'rejected') {
          throw catalogOutcome.reason
        }
        const sessionRead = sessionOutcome.value
        await keybindingsPromise
        await timeRendererStartupStep('repo-catalog-final-settlement', () =>
          actions.awaitLocalRepoCatalogSettlement()
        )
        if (!cancelled) {
          const sessionHydrationOptions = {
            additionalValidWorkspaceKeys: collectFolderWorkspaceKeysFromSession(sessionRead.session)
          }
          timeRendererStartupSyncStep('hydrate-session-stores', () => {
            actions.hydrateWorkspaceSession(sessionRead.session, {
              ...sessionHydrationOptions,
              runtimeHostIdByWorkspaceSessionKey: sessionRead.runtimeHostIdByWorkspaceSessionKey
            })
            actions.hydrateTabsSession(sessionRead.session, sessionHydrationOptions)
            actions.hydrateEditorSession(sessionRead.session, sessionHydrationOptions)
            actions.hydrateBrowserSession(sessionRead.session, sessionHydrationOptions)
          })
          // Why: prune visit timestamps AFTER hydration (earlier, worktreesByRepo may be empty and prune would drop entries for worktrees about to appear); seed the active worktree if missing.
          // See docs/cmd-j-empty-query-ordering.md.
          timeRendererStartupSyncStep('visit-timestamp-prune', () => {
            actions.pruneLastVisitedTimestamps()
            actions.seedActiveWorktreeLastVisitedIfMissing()
          })
          await timeRendererStartupStep('fetch-browser-session-profiles', () =>
            actions.fetchBrowserSessionProfiles()
          )
          const onboardingState = await onboardingPromise
          if (!cancelled) {
            setOnboarding(onboardingState)
            setOnboardingLoaded(true)
          }

          // Why: re-establish SSH before terminal reconnect so SSH-backed tabs route through pty.attach; passphrase targets defer to tab focus to avoid stacked credential dialogs.
          // Why: never dial runtime-owned (ephemeral-VM) targets from the renderer — ssh.connect would dispose the runtime layer's live relay session; filter them out here too.
          const connectionIds = (sessionRead.session.activeConnectionIdsAtShutdown ?? []).filter(
            (targetId) => !isRuntimeOwnedSshTargetId(targetId)
          )
          if (connectionIds.length > 0) {
            try {
              const SSH_RECONNECT_TIMEOUT_MS = 15_000
              const allTargets = await timeRendererStartupStep('ssh-list-targets', () =>
                window.api.ssh.listTargets()
              )
              const targetMap = new Map(allTargets.map((t) => [t.id, t]))
              const targets = connectionIds.map((targetId) => ({
                targetId,
                needsPassphrase: targetMap.get(targetId)?.lastRequiredPassphrase ?? false
              }))

              const eagerTargets = targets.filter((t) => !t.needsPassphrase)
              const deferredTargets = targets.filter((t) => t.needsPassphrase)

              if (deferredTargets.length > 0) {
                actions.setDeferredSshReconnectTargets(deferredTargets.map((t) => t.targetId))
              }

              // Why: treat timed-out eager targets as deferred so their PTYs reattach on tab focus (ssh.connect keeps running in main and likely finishes by then).
              const timedOutTargets: string[] = []
              await timeRendererStartupStep(
                'ssh-reconnect',
                () =>
                  Promise.all(
                    eagerTargets.map(async ({ targetId }) => {
                      const result = await reconnectSshTargetForRendererStartup({
                        targetId,
                        timeoutMs: SSH_RECONNECT_TIMEOUT_MS,
                        connect: (id) => window.api.ssh.connect({ targetId: id }),
                        publishState: actions.setSshConnectionState,
                        onFailure: (id, error) => {
                          console.warn(`SSH auto-reconnect failed for ${id}:`, error)
                        }
                      })
                      if (result.timedOut) {
                        timedOutTargets.push(targetId)
                      }
                    })
                  ),
                {
                  eagerTargets: eagerTargets.length,
                  deferredTargets: deferredTargets.length
                }
              )
              if (timedOutTargets.length > 0) {
                actions.setDeferredSshReconnectTargets([
                  ...deferredTargets.map((t) => t.targetId),
                  ...timedOutTargets
                ])
              }

              // Why: older/wrapped providers may return no state from connect; poll main once as a compatibility fallback before terminal restoration.
              for (const { targetId } of eagerTargets) {
                if (timedOutTargets.includes(targetId)) {
                  continue
                }
                try {
                  const state = await window.api.ssh.getState({ targetId })
                  console.warn(
                    `[ssh-restore] Polled state for ${targetId}: status=${state?.status}`
                  )
                  if (state?.status === 'connected') {
                    actions.setSshConnectionState(targetId, state)
                  }
                } catch {
                  /* best-effort */
                }
              }
            } catch (err) {
              console.warn('SSH startup reconnect failed:', err)
            }
          } else {
            logRendererStartupDiagnostic('ssh-reconnect-skipped', { connectionIds: 0 })
          }

          // Why: main overlaps daemon/hook startup with hydration, but restored terminals need those services ready before they spawn/reconnect PTYs.
          await timeRendererStartupStep('first-window-services-await', () =>
            window.api.app.awaitFirstWindowStartupServices()
          )
          await timeRendererStartupStep('recover-legacy-worker-terminals-pre-reconnect', () =>
            window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
          )
          reconnectStarted = true
          await timeRendererStartupStep('reconnect-terminals', () =>
            actions.reconnectPersistedTerminals(abortController.signal)
          )
          await timeRendererStartupStep('recover-legacy-worker-terminals-post-reconnect', () =>
            window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
          )
          syncZoomCSSVar()
          // Why (issue #1158): unlock the session writer only after hydration and all dependent steps succeeded, so a mid-startup throw can't serialize partially-mutated state to disk.
          actions.setHydrationSucceeded(true)
          logRendererStartupDiagnostic('startup-hydration-done', {
            durationMs: Math.round(performance.now() - startupStartedAt)
          })
          void (async () => {
            try {
              try {
                await timeRendererStartupStep('remote-catalog-refresh', async () => {
                  await actions.fetchReposForAllHosts()
                  await actions.fetchProjectGroupsForAllHosts()
                  await actions.fetchFolderWorkspacesForAllHosts()
                })
              } catch (err) {
                console.warn('Remote startup catalog refresh failed:', err)
              }
              if (!cancelled) {
                try {
                  await timeRendererStartupStep('remote-worktree-refresh', async () => {
                    // Why: the full scan is not required for session recovery, so keep it off the startup-critical path.
                    await actions.fetchAllWorktrees()
                    // Why: the startup prune only saw session-referenced repos; use the deferred scan's
                    // authoritative results to drop deleted-worktree visit timestamps that would
                    // otherwise accumulate unbounded (disconnected SSH stays non-authoritative and is kept).
                    actions.pruneLastVisitedTimestamps()
                    await actions.fetchWorktreeLineage()
                  })
                } catch (err) {
                  console.warn('Deferred startup worktree refresh failed:', err)
                }
              }
            } finally {
              if (!cancelled) {
                useAppStore.setState({ startupWorktreeRefreshCompleted: true })
              }
            }
          })()
        }
      } catch (error) {
        // Why (issue #1158): leave in-memory state untouched and keep hydrationSucceeded false (default-hydrating here once erased saved tabs); still flip the ready flags so the UI mounts.
        const stepLabel = error instanceof Error && error.message ? error.message : String(error)
        console.error(
          '[startup] Workspace session hydration failed; leaving disk state untouched:',
          stepLabel,
          error
        )
        if (!cancelled) {
          // Why: degraded mode stays interactive; later repo/runtime changes must not remain gated forever.
          useAppStore.setState({ startupWorktreeRefreshCompleted: true })
          // Why (issue #1158): only apply default UI if ui.get() never hydrated; otherwise defaults would clobber ui.json via the debounced writer.
          const fallbackUI = getStartupErrorFallbackUI(uiHydrated)
          if (fallbackUI) {
            actions.hydratePersistedUI(fallbackUI, 'startup')
          }
          // Why (issue #1158): sticky toast so the user knows they're in degraded "no-save" mode (hydrationSucceeded stays false); "Restart now" calls app.relaunch to recover.
          toast.error(translate('auto.App.12e77cf12b', 'Session restore failed'), {
            description: translate(
              'auto.App.0a9e810705',
              "Changes won't be saved until restart. Your previous tabs are safe on disk."
            ),
            duration: Infinity,
            dismissible: true,
            action: {
              label: translate('auto.App.caea5b51b9', 'Restart now'),
              onClick: () => {
                void window.api.app.relaunch()
              }
            }
          })
          // Why: reconnect flips workspaceSessionReady so the UI mounts, but hydrationSucceeded stays false so the session writer can't overwrite the file we failed to load.
          if (!reconnectStarted) {
            try {
              await window.api.app.awaitFirstWindowStartupServices()
              await window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
              await actions.reconnectPersistedTerminals(abortController.signal)
              await window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
            } catch (reconnectErr) {
              console.error(
                '[startup] reconnectPersistedTerminals failed in error path:',
                reconnectErr
              )
              // Why (issue #1158): the await may have run during StrictMode teardown; re-check !cancelled so a cancelled pass 1 doesn't stomp pass 2's hydration.
              if (!cancelled) {
                // Why (issue #1158): recovery threw too; force the flag so the shell still mounts, and clear pending* maps (normally drained by reconnect) to avoid phantom reconnects on dead PTYs.
                useAppStore.setState({
                  workspaceSessionReady: true,
                  pendingReconnectWorktreeIds: [],
                  pendingReconnectTabByWorktree: {},
                  pendingReconnectPtyIdByTabId: {}
                })
              }
            }
          } else {
            // Why (issue #1158): reconnect already started; re-running over its partially-mutated state would double-set ptyIds and drain pending* twice — force the flag, clear pending*.
            useAppStore.setState({
              workspaceSessionReady: true,
              pendingReconnectWorktreeIds: [],
              pendingReconnectTabByWorktree: {},
              pendingReconnectPtyIdByTabId: {}
            })
          }
        }
      }
      void actions.initGitHubCache()
    })()

    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [actions, setOnboarding, setOnboardingLoaded])
}
