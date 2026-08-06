import { app } from 'electron'
import type { RuntimePtyController } from '../runtime/orca-runtime-context-2'
import type { IPtyProvider, PtySpawnOptions } from '../providers/types'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { resolveLocalWindowsTerminalRuntimeOptions } from '../../shared/local-windows-terminal-runtime'
import {
  isSafePtySessionId,
  mintPtySessionId,
  ptySessionIdForAgentCreateOperation
} from '../daemon/pty-session-id'
import {
  routesFreshSpawnsToLocalProvider
} from './pty-ipc-runtime-spawn-routing'
import { stampWslOrchestrationCompatibilityHost } from '../pty/wsl-orca-env'
import {
  CODEX_HOME_ENV_KEYS,
  getCompatibleSelectedCodexHomePath,
  getCodexSelectionTargetForPty,
  shouldSkipCodexHomeEnvForWindowsShell,
  shouldStripInheritedOrcaCodexHome,
  promoteAgentTeamsShimPath,
  deleteRequestedEnvKeys,
  mergePtyEnvDeletions,
  removeCodexHomeDeletionRequests,
  getInheritedClaudeSessionStampEnvKeysToDelete
} from './pty-ipc-runtime-host-env-foundation'
import { buildPtyHostEnv } from './pty-ipc-runtime-host-env-assembly'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import {
  makePtySpawnDuplicatePreparationOutcome,
  type PtySpawnPreparationOutcome
} from './pty-ipc-runtime-spawn-preparation-types'

type PtySpawnArgs = Parameters<NonNullable<RuntimePtyController['spawn']>>[0]

export function createPtySpawnPreparation(
  state: PtyRendererDeliveryContext & Record<string, any>
): (
  args: PtySpawnArgs
) => Promise<PtySpawnPreparationOutcome<Record<string, any>, Record<string, any>>> {
  const {
    getLocalPtyStartupPromise,
    assertFolderWorkspacePtyPathUsable,
    resolvePtySpawnStartupCwd,
    capturePtyProviderIdentity,
    getSettings,
    store,
    runtime,
    resolveLocalProjectRuntimeForWorktreeId,
    getRelayPtyId,
    getAppPtyId,
    resolveWslSessionContext,
    prepareCodexResumeHome,
    resolveCodexResumeLaunch,
    noCodexResumeLaunch,
    stripSequencedStartupResumeArgv,
    getSelectedCodexHomePath,
    isTuiAgent,
    snapshotPtyPublication,
    ptySizes,
    pendingPtySizes,
    makePaneKey,
    isValidTerminalTabId,
    isTerminalLeafId,
    getStartupTerminalColorQueryReplyColors,
    beginPtySpawnForWorktree,
    reservePaneSpawn,
    paneSpawnReservationsByPaneKey
  } = state

  return async (
    args: PtySpawnArgs
  ): Promise<PtySpawnPreparationOutcome<Record<string, any>, Record<string, any>>> => {
    const startupPromise = getLocalPtyStartupPromise(args.connectionId)
    if (startupPromise) {
      await startupPromise
    }
    await assertFolderWorkspacePtyPathUsable(args.worktreeId)
    const cwd = resolvePtySpawnStartupCwd(args.worktreeId, args.cwd)
    const providerIdentity = capturePtyProviderIdentity(args.connectionId)
    const provider = providerIdentity.provider
    // Why: runtime-created terminals carry no renderer-computed projectRuntime; resolve from worktreeId to honor the project's Windows runtime.
    const terminalRuntimeOptions =
      process.platform === 'win32' && !args.connectionId
        ? resolveLocalWindowsTerminalRuntimeOptions({
            requestedShellOverride: undefined,
            settings: getSettings?.(),
            projectRuntime: resolveLocalProjectRuntimeForWorktreeId(store, args.worktreeId),
            fallbackHostShell: process.env.COMSPEC || 'powershell.exe'
          })
        : { shellOverride: undefined, terminalWindowsWslDistro: null }
    const daemonShellOverride = terminalRuntimeOptions.shellOverride
    const isDaemonHostSpawn =
      !args.connectionId &&
      !(provider instanceof LocalPtyProvider) &&
      !routesFreshSpawnsToLocalProvider(provider)
    const callerRequestedSessionId = args.sessionId?.trim()
    const requestedSessionId =
      callerRequestedSessionId ??
      (isDaemonHostSpawn && args.agentSessionCreateOperationId
        ? ptySessionIdForAgentCreateOperation(args.worktreeId, args.agentSessionCreateOperationId)
        : undefined)
    const sessionId =
      requestedSessionId ?? (isDaemonHostSpawn ? mintPtySessionId(args.worktreeId) : undefined)
    const effectiveSessionRelayId =
      sessionId !== undefined ? getRelayPtyId(args.connectionId, sessionId) : undefined
    const effectiveSessionAppId =
      sessionId !== undefined ? getAppPtyId(args.connectionId, sessionId) : undefined
    const isMintedSessionId = callerRequestedSessionId === undefined && isDaemonHostSpawn
    const expectedWslDistro = !args.connectionId
      ? (resolveWslSessionContext({
          cwd,
          sessionId,
          shellOverride: terminalRuntimeOptions.shellOverride,
          terminalWindowsWslDistro: terminalRuntimeOptions.terminalWindowsWslDistro
        })?.distro ?? null)
      : null
    const codexSelectionTarget = getCodexSelectionTargetForPty(
      daemonShellOverride,
      cwd,
      expectedWslDistro
    )
    const codexResumePreparation = prepareCodexResumeHome({
      connectionId: args.connectionId,
      launchAgent: args.launchAgent,
      providerSession: args.resumeProviderSession,
      target: codexSelectionTarget,
      launchEnv: args.env,
      workspacePath: cwd
    })
    const codexResumeLaunch = codexResumePreparation
      ? await resolveCodexResumeLaunch(args.command, codexResumePreparation)
      : noCodexResumeLaunch(args.command)
    const codexResumeHome = codexResumeLaunch.codexResumeHome
    // Why: the drop still applies here, but this controller's result has no field for
    // notifyResumeUnavailable — runtime/relay panes start fresh without the notice.
    const launchCommand = codexResumeLaunch.command
    const shouldPersistHostSessionBinding = args.persistHostSessionBinding === true
    let hostSessionBinding: {
      store: NonNullable<typeof store>
      worktreeId: string
      tabId: string
      leafId: string
    } | null = null
    if (shouldPersistHostSessionBinding) {
      if (
        !store ||
        typeof args.worktreeId !== 'string' ||
        typeof args.tabId !== 'string' ||
        !isValidTerminalTabId(args.tabId) ||
        typeof args.leafId !== 'string' ||
        !isTerminalLeafId(args.leafId)
      ) {
        throw new Error('Cannot persist runtime PTY binding without worktreeId, tabId, and leafId')
      }
      hostSessionBinding = {
        store,
        worktreeId: args.worktreeId,
        tabId: args.tabId,
        leafId: args.leafId
      }
    }
    const sshScopedEnv = args.env
    let env: Record<string, string> | undefined = sshScopedEnv
    const requestedAgentTeamsPath = env?.ORCA_AGENT_TEAMS_TEAM_ID ? env.PATH : undefined
    env = stripSequencedStartupResumeArgv(env, codexResumeLaunch)
    if (args.preAllocatedHandle) {
      env = { ...env, ORCA_TERMINAL_HANDLE: args.preAllocatedHandle }
    }
    const selectedCodexHomePath = isDaemonHostSpawn
      ? getCompatibleSelectedCodexHomePath(
          codexSelectionTarget,
          codexResumeHome
            ? codexResumeHome.codexHomePath
            : (getSelectedCodexHomePath?.(codexSelectionTarget, env, {
                workspacePath: cwd,
                launchAgent: isTuiAgent(args.launchAgent) ? args.launchAgent : undefined
              }) ?? null)
        )
      : null
    const skipCodexHomeEnv =
      isDaemonHostSpawn &&
      shouldSkipCodexHomeEnvForWindowsShell(daemonShellOverride, cwd) &&
      !selectedCodexHomePath
    const stripInheritedOrcaCodexHome =
      isDaemonHostSpawn &&
      shouldStripInheritedOrcaCodexHome({
        target: codexSelectionTarget,
        selectedCodexHomePath,
        skipCodexHomeEnv,
        settings: getSettings?.()
      })
    if (isDaemonHostSpawn && sessionId) {
      if (!isSafePtySessionId(sessionId, app.getPath('userData'))) {
        throw new Error('Invalid PTY session id')
      }
      env = buildPtyHostEnv(sessionId, env ?? {}, {
        isPackaged: app.isPackaged,
        userDataPath: app.getPath('userData'),
        selectedCodexHomePath,
        skipCodexHomeEnv,
        stripInheritedOrcaCodexHome,
        launchCommand,
        launchAgent: isTuiAgent(args.launchAgent) ? args.launchAgent : undefined,
        shellPath: daemonShellOverride ?? process.env.COMSPEC,
        isWsl: shouldSkipCodexHomeEnvForWindowsShell(daemonShellOverride, cwd),
        wslDistro: codexSelectionTarget.runtime === 'wsl' ? expectedWslDistro : null,
        networkProxySettings: getSettings?.(),
        deferGitConfigGuardToDaemon: provider.supportsGitCredentialGuardHost?.(sessionId) === true
      })
      stampWslOrchestrationCompatibilityHost(
        env,
        runtime?.getOrchestrationCompatibilityHostId?.(),
        codexSelectionTarget.runtime === 'wsl' ? expectedWslDistro : null
      )
      promoteAgentTeamsShimPath(env, requestedAgentTeamsPath)
    }

    const spawnOptions: PtySpawnOptions = {
      cols: args.cols,
      rows: args.rows,
      cwd,
      env,
      ...(isMintedSessionId ? { isNewSession: true } : {})
    }
    if (!isDaemonHostSpawn && codexResumeHome) {
      spawnOptions.codexHomePathOverride = { value: codexResumeHome.codexHomePath }
    }
    const startupTerminalColorQueryReplyColors = getStartupTerminalColorQueryReplyColors(args)
    if (startupTerminalColorQueryReplyColors) {
      spawnOptions.startupIngress = {
        colors: startupTerminalColorQueryReplyColors,
        deadlineMs: 5_000
      }
    }
    let ptySpawnCommitReported = false
    const reportPtySpawnCommitted = (): void => {
      if (ptySpawnCommitReported) {
        return
      }
      ptySpawnCommitReported = true
      args.onPtySpawnCommitted?.()
    }
    spawnOptions.envToDelete = mergePtyEnvDeletions(
      args.envToDelete ?? [],
      // Why: ungated, unlike the agent-hook keys — the local provider and the relay host also spread their own process.env into every spawn.
      getInheritedClaudeSessionStampEnvKeysToDelete(env)
    )
    if (skipCodexHomeEnv) {
      spawnOptions.envToDelete = mergePtyEnvDeletions(spawnOptions.envToDelete, CODEX_HOME_ENV_KEYS)
    } else if (stripInheritedOrcaCodexHome) {
      // Why: the daemon owns a persistent inherited environment that may
      // differ from main. ORCA_CODEX_HOME asks it to compare/delete the pair.
      spawnOptions.envToDelete = mergePtyEnvDeletions(spawnOptions.envToDelete, ['ORCA_CODEX_HOME'])
    }
    if (codexResumeHome?.codexHomePath) {
      spawnOptions.envToDelete = removeCodexHomeDeletionRequests(spawnOptions.envToDelete)
    }
    deleteRequestedEnvKeys(env, spawnOptions.envToDelete)
    promoteAgentTeamsShimPath(env, requestedAgentTeamsPath)
    if (launchCommand !== undefined) {
      spawnOptions.command = launchCommand
    }
    if (args.commandDelivery !== undefined) {
      spawnOptions.commandDelivery = args.commandDelivery
    }
    if (args.startupCommandDelivery !== undefined) {
      spawnOptions.startupCommandDelivery = args.startupCommandDelivery
    }
    if (isTuiAgent(args.launchAgent)) {
      spawnOptions.launchAgent = args.launchAgent
    }
    if (args.worktreeId !== undefined) {
      spawnOptions.worktreeId = args.worktreeId
    }
    let publicationSnapshot = effectiveSessionAppId
      ? snapshotPtyPublication(effectiveSessionAppId)
      : null
    const hadSessionSizeBeforeAttach =
      effectiveSessionAppId !== undefined ? ptySizes.has(effectiveSessionAppId) : false
    const sessionSizeBeforeAttach =
      effectiveSessionAppId !== undefined ? ptySizes.get(effectiveSessionAppId) : undefined
    if (sessionId !== undefined) {
      spawnOptions.sessionId = sessionId
      pendingPtySizes.set(effectiveSessionAppId ?? sessionId, {
        cols: args.cols,
        rows: args.rows
      })
    }
    const materializedPaneKey = hostSessionBinding
      ? makePaneKey(hostSessionBinding.tabId, hostSessionBinding.leafId)
      : null
    const metadataLeafId =
      typeof args.leafId === 'string' && isTerminalLeafId(args.leafId) ? args.leafId : null
    const metadataPaneKey =
      typeof args.tabId === 'string' &&
      isValidTerminalTabId(args.tabId) &&
      args.tabId.length <= 512 &&
      metadataLeafId
        ? makePaneKey(args.tabId, metadataLeafId)
        : null
    const spawnIdentityPaneKey = materializedPaneKey ?? metadataPaneKey
    if (spawnIdentityPaneKey) {
      spawnOptions.paneKey = spawnIdentityPaneKey
    }
    if (typeof args.tabId === 'string' && args.tabId.length > 0 && args.tabId.length <= 512) {
      spawnOptions.tabId = args.tabId
    }
    if (process.platform === 'win32' && !args.connectionId) {
      spawnOptions.shellOverride = terminalRuntimeOptions.shellOverride
      spawnOptions.terminalWindowsWslDistro = expectedWslDistro
      spawnOptions.terminalWindowsPowerShellImplementation = getSettings
        ? (getSettings()?.terminalWindowsPowerShellImplementation ?? 'auto')
        : undefined
    }
    if (
      args.agentSessionEnsure &&
      (await (provider as IPtyProvider).supportsAgentSessionClaims?.()) === false
    ) {
      // Why: runtime routing must select legacy before dispatch; never downgrade here after it began.
      throw new Error('agent_session_claim_unavailable')
    }
    if (
      args.agentSessionCreateOperationId &&
      (await (provider as IPtyProvider).supportsAgentSessionCreateOperations?.()) === false
    ) {
      throw new Error('execution_owner_unavailable')
    }
    if (args.agentSessionEnsure) {
      spawnOptions.agentSessionEnsure = args.agentSessionEnsure
    }
    if (args.agentSessionCreateOperationId) {
      spawnOptions.agentSessionCreateOperationId = args.agentSessionCreateOperationId
    }
    if (args.signal) {
      spawnOptions.signal = args.signal
    }
    if (
      args.onPtySpawnCommitted &&
      (provider instanceof LocalPtyProvider || routesFreshSpawnsToLocalProvider(provider))
    ) {
      // Why: local fallback has no lower operation ledger, so commit must be reported at native spawn.
      spawnOptions.onPtySpawnCommitted = reportPtySpawnCommitted
    }

    const existingPaneSpawn = materializedPaneKey
      ? paneSpawnReservationsByPaneKey.get(materializedPaneKey)
      : undefined
    if (existingPaneSpawn) {
      return makePtySpawnDuplicatePreparationOutcome(existingPaneSpawn.promise)
    }
    const finishTerminalInstall = beginPtySpawnForWorktree(args.worktreeId, cwd, args.connectionId)
    const paneSpawnReservation = materializedPaneKey ? reservePaneSpawn(materializedPaneKey) : null
    return {
      kind: 'fresh',
      prepared: {
        args,
        startupPromise,
        cwd,
        provider,
        providerIdentity,
        terminalRuntimeOptions,
        daemonShellOverride,
        isDaemonHostSpawn,
        callerRequestedSessionId,
        requestedSessionId,
        sessionId,
        effectiveSessionRelayId,
        effectiveSessionAppId,
        isMintedSessionId,
        expectedWslDistro,
        codexSelectionTarget,
        codexResumePreparation,
        codexResumeLaunch,
        codexResumeHome,
        launchCommand,
        shouldPersistHostSessionBinding,
        hostSessionBinding,
        sshScopedEnv,
        env,
        requestedAgentTeamsPath,
        selectedCodexHomePath,
        skipCodexHomeEnv,
        stripInheritedOrcaCodexHome,
        spawnOptions,
        startupTerminalColorQueryReplyColors,
        reportPtySpawnCommitted,
        publicationSnapshot,
        hadSessionSizeBeforeAttach,
        sessionSizeBeforeAttach,
        materializedPaneKey,
        metadataLeafId,
        metadataPaneKey,
        spawnIdentityPaneKey,
        existingPaneSpawn,
        finishTerminalInstall,
        paneSpawnReservation
      }
    }
  }
}
