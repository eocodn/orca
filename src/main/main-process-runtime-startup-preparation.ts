import * as startupDeps from './main-process-startup-dependencies'
import { startupState } from './main-process-startup-state'

export async function reapRestoredSubagentsWithoutLiveAgent(): Promise<void> {
  const currentStore = startupState.store
  if (!currentStore) {
    return
  }
  const provider = startupDeps.getDaemonProvider()
  if (!provider) {
    return
  }
  const persistedPtyIdByPaneKey = startupDeps.indexPersistedPaneKeyPtyIds(
    currentStore.getWorkspaceSession().terminalLayoutsByTabId ?? {}
  )
  await startupDeps.sweepRestoredSubagentsWithoutLiveAgent({
    probeLiveLocalPty: (ptyId) => provider.probePtyLiveness(ptyId),
    isLocalExecutionHost: (worktreeId) =>
      startupDeps.isLocalExecutionHost(
        startupDeps.resolveAgentWorkspaceExecutionHostId(worktreeId, {
          getRepo: (repoId) => currentStore.getRepo(repoId),
          getWorktreeMeta: (resolvedWorktreeId) => currentStore.getWorktreeMeta(resolvedWorktreeId),
          getFolderWorkspace: (folderWorkspaceId) =>
            currentStore.getFolderWorkspace(folderWorkspaceId),
          getProjectGroups: () => currentStore.getProjectGroups()
        })
      ),
    getBoundPtyIdForPaneKey: startupDeps.getPtyIdForPaneKey,
    getPersistedPtyIdForPaneKey: (paneKey) => persistedPtyIdByPaneKey.get(paneKey),
    reap: (isLocalHost, isLocalPaneAgentLive, isLocalPaneLivenessEvidenceCurrent) =>
      startupDeps.agentHookServer.reapRestoredClaudeSubagentsWithoutLiveAgent(
        isLocalHost,
        isLocalPaneAgentLive,
        isLocalPaneLivenessEvidenceCurrent
      )
  })
}

export function startTerminalRuntimeStartupServices(): Promise<void> {
  startupDeps.logStartupMilestone('first-window-startup-services-start')
  const startupServices = startupDeps.startFirstWindowStartupServices({
    // Why: both desktop and headless serve must adopt the same persistent provider before creating terminals or a renderer.
    startDaemonPtyProvider: async (signal) => {
      startupDeps.logStartupMilestone('startup-service-start', { service: 'daemon-pty-provider' })
      // Why: only GUI-spawned macOS daemons watch for login-session death; a headless
      // serve daemon must survive its spawning session ending (SSH disconnect).
      await startupDeps.initDaemonPtyProvider(signal, {
        macosLoginSessionWatch: process.platform === 'darwin' && !startupState.isServeMode
      })
      startupDeps.logStartupMilestone('startup-service-done', { service: 'daemon-pty-provider' })
    },
    // Why: PTY spawn env reads ORCA_AGENT_HOOK_* from live server state, so the renderer awaits this before restored terminals reconnect.
    startAgentHookServer: async () => {
      startupDeps.logStartupMilestone('startup-service-start', { service: 'agent-hook-server' })
      await startupDeps.agentHookServer.start({
        env: startupDeps.app.isPackaged ? 'production' : 'development',
        // Why: hooks source this endpoint file at invocation time so old PTY env reaches the current process after restart; dev namespaces it (worktrees share `orca-dev`).
        userDataPath: startupDeps.app.getPath('userData'),
        endpointNamespace: startupState.devAgentHookEndpointNamespace
      })
      startupDeps.logStartupMilestone('startup-service-done', { service: 'agent-hook-server' })
    },
    onDaemonError: (error) => {
      // Why: daemon failure silently falls back to non-persistent local PTYs; log + telemetry so a fleet-wide outage is observable (was invisible in v1.4.129-rc.1).
      const reason = error instanceof Error ? error.message : String(error)
      console.error(
        `[daemon] STARTUP FAILED — falling back to local PTYs; terminals will not persist across quit. Reason: ${reason}`
      )
    },
    onAgentHookServerError: (error) => {
      // Why: hook callbacks are sidebar enrichment only; Orca must still boot if the loopback receiver fails.
      console.error('[agent-hooks] Failed to start local hook server:', error)
    }
  })
  startupState.firstWindowStartupServicesReady = startupServices.firstWindowReady
  startupState.localPtyStartupReady = startupServices.localPtyReady
  startupState.localPtyProviderStartupReady = startupServices.localPtyProviderReady
  void startupState.firstWindowStartupServicesReady.then(() => {
    startupDeps.logStartupMilestone('first-window-startup-services-ready')
  })
  void startupState.localPtyStartupReady.then(() => {
    startupDeps.logStartupMilestone('local-pty-startup-ready')
    void reapRestoredSubagentsWithoutLiveAgent().catch((error) => {
      console.warn('[agent-hooks] restored-subagent liveness probe failed:', error)
    })
  })
  return startupState.firstWindowStartupServicesReady
}

export function prepareCodexRuntimeHomeForLaunch(
  target?: startupDeps.CodexAccountSelectionTarget,
  launchEnv?: NodeJS.ProcessEnv,
  launchContext?: { workspacePath?: string; launchAgent?: startupDeps.TuiAgent }
): string | null {
  if (
    target?.runtime !== 'wsl' &&
    launchContext?.launchAgent === 'codex' &&
    launchContext.workspacePath
  ) {
    try {
      // Why: renderer quick-launch cannot await trust IPC before its PTY mounts; launch prep runs synchronously before every recognized Codex spawn.
      startupDeps.markCodexProjectTrusted(launchContext.workspacePath)
    } catch (error) {
      console.warn('[codex-project-trust] failed to pre-mark launch workspace:', error)
    }
  }
  // Account routing was removed; an explicit CODEX_HOME remains a supported
  // user override, while an unset value means Codex should use ~/.codex.
  const runtimeHomePath = launchEnv?.CODEX_HOME?.trim() || null
  if (runtimeHomePath === null && target?.runtime === 'host') {
    startupDeps.ensureRealHomeCodexHookState({
      hooksEnabled: true,
      userDataPath: startupDeps.app.getPath('userData')
    })
    return null
  }
  if (target?.runtime === 'wsl' || runtimeHomePath === null) {
    return runtimeHomePath
  }
  const hookTarget = target
  const hooksEnabled = true
  try {
    // Why: honor the persisted off switch so post-startup launches can't reinstall removed hooks.
    const status = hooksEnabled
      ? (startupDeps.codexHookService.installForRuntimeHome(runtimeHomePath, hookTarget) ??
        startupDeps.codexHookService.install(runtimeHomePath ?? undefined))
      : (startupDeps.codexHookService.refreshRuntimeUserHooksForRuntimeHome(
          runtimeHomePath,
          hookTarget
        ) ?? startupDeps.codexHookService.refreshRuntimeUserHooks(runtimeHomePath ?? undefined))
    if (status.state === 'error') {
      console.warn(
        `[codex-hook-service] failed to ${
          hooksEnabled ? 'refresh' : 'refresh user'
        } runtime hooks before launch`,
        status.detail
      )
    }
  } catch (error) {
    // Why: hook install is best-effort launch prep; a malformed hooks file must not block Codex from starting.
    console.warn(
      `[codex-hook-service] failed to ${
        hooksEnabled ? 'refresh' : 'refresh user'
      } runtime hooks before launch`,
      error
    )
  }
  return runtimeHomePath
}

export async function prepareCodexSessionResumeForLaunch(args: {
  providerSession: startupDeps.AgentProviderSessionMetadata
  target: startupDeps.CodexAccountSelectionTarget
  launchEnv?: NodeJS.ProcessEnv
  workspacePath?: string
}): Promise<startupDeps.CodexSessionResumePreparation | null> {
  // Transcript migration/resume selection belonged to the retired account lane.
  // Generic PTYs still launch normally; resume requests start fresh when no
  // explicit launch-home integration is available.
  void args
  return null
}
