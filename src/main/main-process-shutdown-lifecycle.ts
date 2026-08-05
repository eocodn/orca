import * as startupDeps from './main-process-startup-dependencies'
import { startupState } from './main-process-startup-state'
import { shutdownWatchersOnce } from './main-process-crash-lifecycle'

export function installMainProcessShutdownLifecycle(): void {
  // Why: app.exit() skips Electron quit events, so keep its log child from surviving forced exits.
  process.once('exit', startupDeps.stopTccPromptNotice)

  startupDeps.app.on('before-quit', () => {
    if (startupDeps.isQuittingForUpdate()) {
      startupDeps.recordUpdaterLifecycle('before_quit_allowed', undefined, {
        message: 'before-quit allowed for update install'
      })
    }
    startupState.isQuitting = true
    startupState.desktopRelayService?.fenceAndCloseNow()
    startupState.runtimeRpc?.setMobileRelayPairingProvider(null)
    startupState.unsubscribeSystemResumeBroadcast?.()
    startupState.unsubscribeSystemResumeBroadcast = null
    startupState.unsubscribeAgentAwakeStatusChanges?.()
    startupState.unsubscribeAgentAwakeStatusChanges = null
    startupState.agentAwakeService?.dispose()
    startupState.agentAwakeService = null
    // Why: defer PTY cleanup to will-quit so the renderer captures scrollback before PTY-exit events unmount TerminalPane (dropping its capture callbacks).
    startupState.rateLimits?.stop()
  })

  // Why: will-quit fires twice — first pass runs sync cleanup + preventDefault to await checkpoint writes; second pass exits.
  startupDeps.app.on('will-quit', (e) => {
    // Why: renderer guards can still cancel before this committed phase; `log stream` must survive those vetoes.
    startupDeps.stopTccPromptNotice()
    const updateQuitInProgress = startupDeps.isQuittingForUpdate()
    if (updateQuitInProgress) {
      startupDeps.recordUpdaterLifecycle(
        'will_quit_cleanup_started',
        { daemonTeardown: 'disconnect' },
        { message: 'will-quit cleanup for update install; daemonTeardown=disconnect' }
      )
    }
    // Why: before-quit can still be aborted by renderer beforeunload; only remove the Windows tray icon on the committed quit path.
    startupDeps.destroySystemTray()
    // Why: stats.flush() must precede killAllPty() so still-running agents emit synthetic agent_stop events (killAllPty skips runtime.onPtyExit()).
    startupState.starNag?.stop()
    // Why: plugin hosts are forked children; dispose sends shutdown and
    // escalates to SIGKILL so they cannot outlive the app. The promise joins
    // the teardown barrier below — quitting before it resolves would let
    // Electron exit first and orphan the hosts.
    startupDeps.setPluginServiceForRpc(null)
    startupState.pluginKillListService = null
    const pluginHostShutdown = startupState.pluginService?.dispose() ?? Promise.resolve()
    startupState.pluginService = null
    startupDeps.setUnreadDockBadgeCount(0)
    startupDeps.agentHookServer.stop()
    // Why: cancels relay restart/reinstall timers and kills wsl.exe children deterministically, not via stdio-pipe teardown.
    startupDeps.wslHookRelayManager.disposeAll()
    startupState.stats?.flush()
    startupState.runtime?.getOffscreenBrowserBackend()?.destroyAll?.()
    startupDeps.browserManager.setBrowserGuestStateChangedListener(null)
    startupDeps.killAllPty()
    const durableRetirementsFlushed =
      startupState.runtime?.flushPendingPtyDurableRetirements() ?? true
    if (!durableRetirementsFlushed) {
      console.warn('[shutdown] Pending PTY durable retirements require an asynchronous drain')
    }
    const durableRetirementsDrain =
      startupState.runtime?.waitForPendingPtyDurableRetirements({
        timeoutMs: startupDeps.WILL_QUIT_TEARDOWN_DEADLINE_MS
      }) ?? Promise.resolve(true)
    const watcherShutdown = shutdownWatchersOnce()
    startupState.store?.flush()
    // Why: usage-cache writes are queued off the main thread, so a quit right after setEnabled or a
    // scan completion would drop the final snapshot. Captured before any await; joins the barrier below.
    const usageCacheFlush = Promise.all([
      startupState.claudeUsage?.flush(),
      startupState.codexUsage?.flush(),
      startupState.openCodeUsage?.flush()
    ]).then(() => {})

    // Why: preventDefault to await disconnectDaemon's async checkpoint writes (else data lost); guard prevents an infinite quit loop on the re-fired will-quit.
    if (!startupState.daemonDisconnectDone) {
      e.preventDefault()
      // Why: capture pid/runtimeId synchronously (before any await) so a later teardown path can't null them out mid-chain.
      const ownedPid = process.pid
      const ownedRuntimeId = startupState.runtime?.getRuntimeId()
      // Why: keep inside the !daemonDisconnectDone guard so the re-fired will-quit doesn't re-run RPC.stop()/metadata-clear against the updater's replacement process.
      const rpcStopAndClear = startupState.runtimeRpc
        ? startupState.runtimeRpc
            .stop()
            .then(() => startupDeps.awaitRuntimeFileWatcherUnsubscribes())
            .then(() => {
              if (ownedRuntimeId) {
                // Why: must match the path the runtime server wrote metadata to (getCanonicalUserDataPath), not late app.getPath('userData').
                startupDeps.clearRuntimeMetadataIfOwned(
                  startupDeps.getCanonicalUserDataPath(),
                  ownedPid,
                  ownedRuntimeId
                )
              }
            })
            .catch((error) => {
              console.error('[runtime] Failed to stop local RPC transport:', error)
            })
        : Promise.resolve()
      // Why: allSettled (not all) keeps fail-open — a daemon-disconnect rejection still quits instead of hanging.
      // Why: telemetry flush folds in before app.quit() (bounded 2s); catch defensively so a flush failure can't cancel the quit chain.
      // Why: normal quits keep the detached daemon for warm reattach, but a dead dev parent leaves the temp/dev profile ownerless.
      const daemonTeardown = startupDeps.isDevParentShutdownRequested()
        ? startupDeps.shutdownDaemon()
        : startupDeps.disconnectDaemon()
      // Why: a wedged transport (half-open post-sleep socket) can leave one
      // member unsettled forever and block app.quit() until Force Quit (#9447).
      startupDeps
        .settleTeardownWithinDeadline([
          { name: 'daemon', promise: daemonTeardown },
          { name: 'runtime-rpc', promise: rpcStopAndClear },
          { name: 'watchers', promise: watcherShutdown },
          { name: 'plugin-hosts', promise: pluginHostShutdown },
          { name: 'usage-cache', promise: usageCacheFlush }
        ])
        .then((pendingTeardowns) => {
          if (pendingTeardowns.length > 0) {
            console.warn('[shutdown] Quit teardown deadline reached', { pendingTeardowns })
          }
        })
        .then(() => durableRetirementsDrain)
        .then((drained) => {
          if (!drained) {
            console.error(
              '[shutdown] Durable PTY retirements remain unresolved; durable state was not acknowledged'
            )
          }
        })
        .then(() => startupDeps.shutdownObservability())
        .catch(() => {
          /* swallow — telemetry must never prevent startupDeps.app.quit() */
        })
        .then(() => {
          startupState.daemonDisconnectDone = true
          startupDeps.app.quit()
        })
    }
  })

  startupDeps.app.on('window-all-closed', () => {
    // Why: serve mode / disposable offscreen browser windows must not take down runtime RPC — the policy fn keeps the app alive.
    // Why: on macOS a quit-in-progress (Cmd+Q) is canceled by the renderer buffer-capture deferral; re-trigger quit so it actually exits.
    if (
      startupDeps.shouldQuitWhenAllWindowsClosed({
        platform: process.platform,
        isQuitting: startupState.isQuitting,
        isServeMode: startupState.isServeMode
      })
    ) {
      startupDeps.app.quit()
    }
  })
}
