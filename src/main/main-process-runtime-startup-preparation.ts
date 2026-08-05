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
      if (!startupDeps.isAgentStatusHooksEnabled(startupState.store?.getSettings())) {
        return
      }
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
  const ensureRealHomeHooksIfSelected = (): boolean => {
    if (
      target?.runtime === 'wsl' ||
      !startupState.codexRuntimeHome!.isHostSystemDefaultRealHomeSelected(launchEnv)
    ) {
      return false
    }
    // Why (flag ON, system default): the hook entry must exist — appended last
    // and trusted by codex's own app-server grant — in the real ~/.codex before
    // the pane spawns. An incapable grant flips the lane gate so the launch
    // below falls back to the managed home instead of a status-blind pane.
    startupDeps.ensureRealHomeCodexHookState({
      hooksEnabled: startupDeps.isAgentStatusHooksEnabled(startupState.store?.getSettings()),
      userDataPath: startupDeps.app.getPath('userData')
    })
    return true
  }
  let realHomeHooksPrepared = ensureRealHomeHooksIfSelected()
  let runtimeHomePath = startupState.codexRuntimeHome!.prepareForCodexLaunch(target, launchEnv)
  if (runtimeHomePath === null && !realHomeHooksPrepared) {
    // Why: a managed home can lose auth during launch prep, which clears its
    // selection and falls through to real home. Establish hook capability for
    // that newly selected lane, then re-resolve if the capability gate rejects it.
    realHomeHooksPrepared = ensureRealHomeHooksIfSelected()
    if (realHomeHooksPrepared) {
      runtimeHomePath = startupState.codexRuntimeHome!.prepareForCodexLaunch(target, launchEnv)
    }
  }
  if (runtimeHomePath === null && target?.runtime !== 'wsl') {
    // Why: Codex runs on the user's real ~/.codex; the managed-home hook
    // install below would target a home Codex never reads on this lane.
    return null
  }
  const hookTarget =
    target?.runtime === 'wsl'
      ? {
          runtime: 'wsl' as const,
          wslDistro: target.wslDistro?.trim() || startupDeps.getDefaultWslDistro()
        }
      : target
  const hooksEnabled = startupDeps.isAgentStatusHooksEnabled(startupState.store?.getSettings())
  try {
    // Why: honor the persisted off switch so post-startup launches can't reinstall removed hooks.
    const status = hooksEnabled
      ? (startupDeps.codexHookService.installForRuntimeHome(runtimeHomePath, hookTarget) ??
        // Why: a managed account's launch home is its own self-contained
        // CODEX_HOME, so hooks/trust must install there, not the shared mirror.
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
  if (args.target.runtime === 'wsl' || !startupState.codexRuntimeHome || !startupState.store) {
    return null
  }
  const systemHomePath = startupDeps.getSystemCodexHomePath()
  // Why: codexSessionSourceHome is import-only; treating it as CODEX_HOME would mutate history sources and bypass account auth.
  const trustedHomes = [
    systemHomePath,
    ...startupState.codexRuntimeHome.getHostCodexHomePathsForSessionDiscovery()
  ]
  const settingsStore = startupState.store
  // Why: a `fresh` outcome must skip migration, trust and hook repair entirely — there is
  // no verified origin home to prepare, so the PTY layer drops the resume argv (#10793).
  return startupDeps.prepareCodexSessionResume({
    sessionId: args.providerSession.id,
    transcriptPath: args.providerSession.transcriptPath,
    trustedCodexHomes: trustedHomes,
    // Why: the legacy id rescan's winning home becomes this pane's CODEX_HOME, i.e. its account;
    // rank it by the current selection so settings insertion order can never decide the account.
    // Lazy: only the legacy branch ranks, so a provenance-present resume never stats the marker.
    getSelectedAccountCodexHome: () =>
      startupState.codexRuntimeHome!.getSelectedHostAccountCodexHomePath(),
    systemCodexHomePath: systemHomePath,
    // Why: the mirror winning is what triggers the migration into ~/.codex below, so it must
    // outrank the path-sorted account homes or a system-default selection resumes as an account.
    sharedRuntimeCodexHomePath: startupDeps.getOrcaManagedCodexHomePath(),
    resolveVerifiedResumeHome: async (sessionSource) => {
      let migrated = { useRealCodexHome: false }
      try {
        migrated = await startupDeps.prepareLegacySharedCodexSessionResume(
          {
            agent: 'codex',
            executionHostId: 'local',
            filePath: sessionSource.transcriptPath,
            codexHome: sessionSource.homePath
          },
          {
            isHostSystemDefaultRealHome: () =>
              startupState.codexRuntimeHome!.isHostSystemDefaultRealHome(),
            systemCodexHomePath: systemHomePath
          }
        )
      } catch (error) {
        // Why: migration is a compatibility repair; its failure must not prevent the PTY from resuming from its trusted origin home.
        console.warn(
          '[codex-session-resume] Legacy rollout migration failed; using origin home:',
          error
        )
      }
      const resumeHome = migrated.useRealCodexHome ? systemHomePath : sessionSource.homePath

      if (args.workspacePath) {
        try {
          startupDeps.markCodexProjectTrusted(args.workspacePath)
        } catch (error) {
          console.warn('[codex-project-trust] failed to pre-mark resumed workspace:', error)
        }
      }
      const isSystemHome =
        startupDeps.normalizeRuntimePathForComparison(resumeHome) ===
        startupDeps.normalizeRuntimePathForComparison(systemHomePath)
      const hooksEnabled = startupDeps.isAgentStatusHooksEnabled(settingsStore.getSettings())
      try {
        if (isSystemHome) {
          startupDeps.ensureRealHomeCodexHookState({
            hooksEnabled,
            userDataPath: startupDeps.app.getPath('userData')
          })
        } else if (hooksEnabled) {
          startupDeps.codexHookService.install(resumeHome)
        } else {
          startupDeps.codexHookService.refreshRuntimeUserHooks(resumeHome)
        }
      } catch (error) {
        // Why: hook repair is best-effort; session provenance must still win over the currently selected home.
        console.warn('[codex-hook-service] failed to prepare automatic resume home:', error)
      }
      return resumeHome
    }
  })
}
