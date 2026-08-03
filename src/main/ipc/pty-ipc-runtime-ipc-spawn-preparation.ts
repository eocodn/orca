import { app } from 'electron'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { isClaudeAuthSwitchInProgress } from '../claude-accounts/live-pty-gate'
import { hasClaudeAuthEnvConflict, CLAUDE_AUTH_ENV_VARS } from '../claude-accounts/environment'
import { resolveLocalWindowsTerminalRuntimeOptions } from '../../shared/local-windows-terminal-runtime'
import { isSafePtySessionId, mintPtySessionId } from '../daemon/pty-session-id'
import { isClaudeLaunchCommand, routesFreshSpawnsToLocalProvider, beginPtySpawnForWorktree } from './pty-ipc-runtime-spawn-routing'
import type { PtySpawnOptions } from '../providers/types'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import { createPtySpawnTiming } from './pty-spawn-timing'
import { CODEX_HOME_ENV_KEYS } from './pty-ipc-runtime-host-env-foundation'
import { isNativeWindowsLocalPtySpawn } from '../runtime/terminal-model-query-authority'
import { clearProviderPtyState } from './pty-ipc-runtime-provider-lifecycle-state'

export function createPtyIpcSpawnPreparation(state: PtyRendererDeliveryContext & Record<string, any>): (args: Record<string, any>) => Promise<Record<string, any>> {
  const {
    runtime, getSettings, ptySizes, pendingPtySizes,
    getLocalPtyStartupPromise, assertFolderWorkspacePtyPathUsable, resolvePtySpawnStartupCwd, localStartupCwdDirectoryExists,
    getProvider, getAppPtyId, getRelayPtyId, resolveWslSessionContext, getCodexSelectionTargetForPty,
    prepareClaudeAuth, getStartupTerminalColorQueryReplyColors, stripRemotePaneEnvWhenHooksDisabled,
    parseValidPaneKey, makePaneKey, parseLegacyNumericPaneKey, isValidTerminalTabId, isTerminalLeafId,
    shouldRefreshNativeClaudeAgentTeamsEnv, getSelectedCodexHomePath, prepareCodexResumeHome,
    resolveCodexResumeLaunch, noCodexResumeLaunch, stripSequencedStartupResumeArgv, isTuiAgent,
    getCompatibleSelectedCodexHomePath, shouldSkipCodexHomeEnvForWindowsShell, shouldStripInheritedOrcaCodexHome,
    isAgentStatusHooksEnabled, buildPtyHostEnv, stampWslOrchestrationCompatibilityHost, promoteAgentTeamsShimPath,
    mergePtyEnvDeletions, getInheritedAgentHookEnvKeysToDelete, getInheritedClaudeSessionStampEnvKeysToDelete,
    removeCodexHomeDeletionRequests, deleteRequestedEnvKeys, snapshotPtyPublication, paneSpawnReservationsByPaneKey,
    reservePaneSpawn, transitionSpawnHiddenRendererPtyDeliveryState
  } = state

  return async (args: Record<string, any>): Promise<Record<string, any>> => {
    const spawnTiming = createPtySpawnTiming()
    const startupPromise = getLocalPtyStartupPromise(args.connectionId)
    if (startupPromise) {
      await startupPromise
    }
    await assertFolderWorkspacePtyPathUsable(args.worktreeId)
    // Why: honor the fallback only for fresh local spawns — reattach needs exact cwd and SSH can't probe the local filesystem.
    const allowMissingCwdFallback =
      !args.connectionId && !args.sessionId && args.cwdFallback === 'worktree'
    let didFallbackToWorkspaceRootCwd = false
    const cwd = resolvePtySpawnStartupCwd(
      args.worktreeId,
      args.cwd,
      allowMissingCwdFallback
        ? {
            directoryExists: localStartupCwdDirectoryExists,
            onFallbackToWorkspaceRoot: () => {
              didFallbackToWorkspaceRootCwd = true
            }
          }
        : undefined
    )
    const startupCwdFallback =
      didFallbackToWorkspaceRootCwd && cwd ? ({ kind: 'worktree', cwd } as const) : undefined
    spawnTiming.mark('preflight')
    const provider = getProvider(args.connectionId)
    const isClaudeLaunch = !args.connectionId && isClaudeLaunchCommand(args.command)
    if (isClaudeLaunch && isClaudeAuthSwitchInProgress()) {
      throw new Error('A Claude account switch is in progress. Try again after it finishes.')
    }
    const terminalRuntimeOptions =
      process.platform === 'win32' && !args.connectionId
        ? resolveLocalWindowsTerminalRuntimeOptions({
            requestedShellOverride: args.shellOverride,
            settings: getSettings?.(),
            projectRuntime: args.projectRuntime,
            fallbackHostShell: process.env.COMSPEC || 'powershell.exe'
          })
        : { shellOverride: args.shellOverride, terminalWindowsWslDistro: null }
    const initialShellOverride = terminalRuntimeOptions.shellOverride
    const isDaemonHostSpawn =
      !args.connectionId &&
      !(provider instanceof LocalPtyProvider) &&
      !routesFreshSpawnsToLocalProvider(provider)
    // Why: daemon host-env setup needs a stable id BEFORE provider.spawn so buildPtyHostEnv hooks/Pi cleanup can run; daemon still honors opts.sessionId ?? mint().
    // Note: sessionId is STABLE across daemon restarts by design — do NOT simplify to a fresh UUID per spawn; that orphans reconnectable state.
    // Why: only clear ids minted in THIS request on failure — a caller-supplied args.sessionId may name an existing PTY we must not clobber.
    const isMintedSessionId = args.sessionId === undefined && isDaemonHostSpawn
    const effectiveSessionId =
      args.sessionId ?? (isDaemonHostSpawn ? mintPtySessionId(args.worktreeId) : undefined)
    const effectiveSessionAppId =
      effectiveSessionId !== undefined
        ? getAppPtyId(args.connectionId, effectiveSessionId)
        : undefined
    const effectiveSessionRelayId =
      effectiveSessionId !== undefined
        ? getRelayPtyId(args.connectionId, effectiveSessionId)
        : undefined
    const expectedWslDistro = !args.connectionId
      ? (resolveWslSessionContext({
          cwd,
          sessionId: effectiveSessionId,
          shellOverride: terminalRuntimeOptions.shellOverride,
          terminalWindowsWslDistro: terminalRuntimeOptions.terminalWindowsWslDistro
        })?.distro ?? null)
      : null
    const initialSelectionTarget = getCodexSelectionTargetForPty(
      initialShellOverride,
      cwd,
      expectedWslDistro
    )
    const claudeAuth =
      isClaudeLaunch && prepareClaudeAuth ? await prepareClaudeAuth(initialSelectionTarget) : null
    spawnTiming.mark('auth')
    if (isClaudeLaunch && isClaudeAuthSwitchInProgress()) {
      throw new Error('A Claude account switch is in progress. Try again after it finishes.')
    }
    if (claudeAuth?.stripAuthEnv && hasClaudeAuthEnvConflict(args.env)) {
      throw new Error(
        'This Claude launch defines explicit Anthropic auth environment variables. Remove those overrides before using a managed Claude account.'
      )
    }
    // Why: the daemon-backed provider skips LocalPtyProvider's buildSpawnEnv, so assemble the same host-local env here for parity.
    // Safety: skip entirely for SSH — every injection is a loopback secret or a local path that leaks or misleads on the remote host.
    const startupTerminalColorQueryReplyColors = getStartupTerminalColorQueryReplyColors(args)
    // Why: forward pane env to SSH only when the relay hook path is enabled, or a newer relay could emit statuses this build can't route.
    const sshSourceEnv = stripRemotePaneEnvWhenHooksDisabled(args.connectionId, args.env)
    const baseEnvWithAuth = claudeAuth
      ? { ...sshSourceEnv, ...claudeAuth.envPatch }
      : sshSourceEnv
    const spawnPaneKey = baseEnvWithAuth?.ORCA_PANE_KEY
    const parsedSpawnPaneKey = parseValidPaneKey(spawnPaneKey)
    const verifiedPaneKey =
      parsedSpawnPaneKey &&
      typeof args.tabId === 'string' &&
      args.tabId === parsedSpawnPaneKey.tabId &&
      args.leafId === parsedSpawnPaneKey.leafId
        ? makePaneKey(parsedSpawnPaneKey.tabId, parsedSpawnPaneKey.leafId)
        : null
    const verifiedLeafId =
      verifiedPaneKey && parsedSpawnPaneKey ? parsedSpawnPaneKey.leafId : null
    const metadataLeafId =
      typeof args.leafId === 'string' && isTerminalLeafId(args.leafId) ? args.leafId : null
    const metadataPaneKey =
      typeof args.tabId === 'string' &&
      isValidTerminalTabId(args.tabId) &&
      args.tabId.length <= 512 &&
      metadataLeafId
        ? makePaneKey(args.tabId, metadataLeafId)
        : null
    const legacySpawnPaneKey = verifiedPaneKey ? null : parseLegacyNumericPaneKey(spawnPaneKey)
    const migrationUnsupportedPaneKey =
      legacySpawnPaneKey &&
      typeof args.tabId === 'string' &&
      args.tabId === legacySpawnPaneKey.tabId &&
      typeof args.leafId === 'string' &&
      isTerminalLeafId(args.leafId)
        ? makePaneKey(args.tabId, args.leafId)
        : null
    const stablePaneKey = verifiedPaneKey ?? migrationUnsupportedPaneKey
    let baseEnv = baseEnvWithAuth ? { ...baseEnvWithAuth } : undefined
    const shouldRefreshAgentTeamsEnv =
      !args.connectionId &&
      runtime !== undefined &&
      stablePaneKey !== null &&
      shouldRefreshNativeClaudeAgentTeamsEnv({
        command: args.command,
        launchConfig: args.launchConfig
      })
    let effectiveLaunchConfig = args.launchConfig
    const shouldPreAllocateTerminalHandle =
      runtime !== undefined &&
      ((!(provider instanceof LocalPtyProvider) && !routesFreshSpawnsToLocalProvider(provider)) ||
        shouldRefreshAgentTeamsEnv)
    const preAllocatedHandle = shouldPreAllocateTerminalHandle
      ? runtime.createPreAllocatedTerminalHandle()
      : null
    if (shouldRefreshAgentTeamsEnv && preAllocatedHandle) {
      // Why: Agent Teams ids/tokens are process-local, so the team env must be regenerated for the new leader PTY.
      const prepared = await runtime.prepareClaudeAgentTeamsLeaderForHandle({
        handle: preAllocatedHandle,
        baseEnv: baseEnv ?? {}
      })
      baseEnv = {
        ...baseEnv,
        ...prepared.env
      }
      if (args.launchConfig) {
        effectiveLaunchConfig = {
          ...args.launchConfig,
          agentEnv: {
            ...args.launchConfig.agentEnv,
            ...prepared.env
          }
        }
      }
    }
    const requestedAgentTeamsPath = baseEnv?.ORCA_AGENT_TEAMS_TEAM_ID ? baseEnv.PATH : undefined
    const agentTeamsEnvToDelete = shouldRefreshAgentTeamsEnv
      ? ['TERM_PROGRAM', 'ORCA_ATTRIBUTION_SHIM_DIR']
      : undefined
    if (baseEnv && stablePaneKey) {
      baseEnv.ORCA_PANE_KEY = stablePaneKey
      if (typeof args.tabId === 'string') {
        baseEnv.ORCA_TAB_ID = args.tabId
      } else if (!args.connectionId) {
        delete baseEnv.ORCA_TAB_ID
      }
      if (typeof args.worktreeId === 'string') {
        baseEnv.ORCA_WORKTREE_ID = args.worktreeId
      } else if (!args.connectionId) {
        delete baseEnv.ORCA_WORKTREE_ID
      }
    } else if (baseEnv) {
      // Why: ORCA_PANE_KEY crosses into shells/hook registries; only a key proven to match this spawn's tab+leaf may cross the IPC boundary.
      delete baseEnv.ORCA_PANE_KEY
      delete baseEnv.ORCA_TAB_ID
      delete baseEnv.ORCA_WORKTREE_ID
      delete baseEnv.ORCA_AGENT_LAUNCH_TOKEN
    }
    const validatedPaneKey = stablePaneKey
    // Why: SSH can strip ORCA_PANE_KEY when remote hooks are off; IPC tab/leaf metadata still names the pane.
    const reservationPaneKey = metadataPaneKey ?? validatedPaneKey
    const validatedLeafId = verifiedLeafId ?? metadataLeafId
    const effectiveShellOverride = terminalRuntimeOptions.shellOverride
    const nativeWindowsConptySpawn = isNativeWindowsLocalPtySpawn({
      connectionId: args.connectionId,
      cwd: args.cwd,
      shellOverride: effectiveShellOverride
    })
    const codexSelectionTarget = getCodexSelectionTargetForPty(
      effectiveShellOverride,
      cwd,
      expectedWslDistro
    )
    const codexResumePreparation = prepareCodexResumeHome({
      connectionId: args.connectionId,
      launchAgent: args.launchAgent,
      providerSession: args.resumeProviderSession,
      target: codexSelectionTarget,
      launchEnv: baseEnv,
      workspacePath: cwd
    })
    const codexResumeLaunch = codexResumePreparation
      ? await resolveCodexResumeLaunch(args.command, codexResumePreparation)
      : noCodexResumeLaunch(args.command)
    const codexResumeHome = codexResumeLaunch.codexResumeHome
    const launchCommand = codexResumeLaunch.command
    baseEnv = stripSequencedStartupResumeArgv(baseEnv, codexResumeLaunch)
    // Why: declared after the strip so a local-provider spawn cannot capture the
    // pre-strip env — only the daemon branch below re-derives this from baseEnv.
    let env: Record<string, string> | undefined = baseEnv
    const selectedCodexHomePath = isDaemonHostSpawn
      ? getCompatibleSelectedCodexHomePath(
          codexSelectionTarget,
          codexResumeHome
            ? codexResumeHome.codexHomePath
            : (getSelectedCodexHomePath?.(codexSelectionTarget, baseEnv, {
                workspacePath: cwd,
                launchAgent: isTuiAgent(args.launchAgent) ? args.launchAgent : undefined
              }) ?? null)
        )
      : null
    const skipCodexHomeEnv =
      isDaemonHostSpawn &&
      shouldSkipCodexHomeEnvForWindowsShell(effectiveShellOverride, cwd) &&
      !selectedCodexHomePath
    const stripInheritedOrcaCodexHome =
      isDaemonHostSpawn &&
      shouldStripInheritedOrcaCodexHome({
        target: codexSelectionTarget,
        selectedCodexHomePath,
        skipCodexHomeEnv,
        settings: getSettings?.()
      })
    if (isDaemonHostSpawn) {
      if (effectiveSessionId === undefined) {
        // Should be unreachable: effectiveSessionId is a string when isDaemonHostSpawn; defense-in-depth.
        throw new Error('Invariant violation: daemon spawn without sessionId')
      }
      const sessionIdForEnv = effectiveSessionId
      // Why: this id reaches filesystem paths; reject traversal/separators so a crafted IPC payload can't escape the expected roots.
      if (!isSafePtySessionId(sessionIdForEnv, app.getPath('userData'))) {
        throw new Error('Invalid PTY session id')
      }
      // Why: clone before mutating so injections don't leak back into args.env (renderer may reuse it).
      env = { ...baseEnv }
      try {
        buildPtyHostEnv(sessionIdForEnv, env, {
          isPackaged: app.isPackaged,
          userDataPath: app.getPath('userData'),
          selectedCodexHomePath,
          skipCodexHomeEnv,
          stripInheritedOrcaCodexHome,
          githubAttributionEnabled: getSettings?.()?.enableGitHubAttribution ?? false,
          launchCommand,
          launchAgent: isTuiAgent(args.launchAgent) ? args.launchAgent : undefined,
          shellPath: effectiveShellOverride ?? process.env.COMSPEC,
          isWsl: shouldSkipCodexHomeEnvForWindowsShell(effectiveShellOverride, cwd),
          wslDistro: codexSelectionTarget.runtime === 'wsl' ? expectedWslDistro : null,
          agentStatusHooksEnabled: isAgentStatusHooksEnabled(getSettings?.()),
          networkProxySettings: getSettings?.(),
          deferGitConfigGuardToDaemon:
            provider.supportsGitCredentialGuardHost?.(effectiveSessionId) === true
        })
        stampWslOrchestrationCompatibilityHost(
          env,
          runtime?.getOrchestrationCompatibilityHostId?.(),
          codexSelectionTarget.runtime === 'wsl' ? expectedWslDistro : null
        )
        promoteAgentTeamsShimPath(env, requestedAgentTeamsPath)
      } catch (err) {
        // Why: buildPtyHostEnv has fs side-effects (Pi/OMP install); clear per-PTY state on throw, but only minted ids — caller ids may name existing PTYs.
        if (isMintedSessionId) {
          clearProviderPtyState(sessionIdForEnv)
        }
        throw err
      }
    }
    spawnTiming.mark('host_env')
    const spawnEnv = preAllocatedHandle
      ? { ...env, ORCA_TERMINAL_HANDLE: preAllocatedHandle }
      : env
    const envToDelete = claudeAuth?.stripAuthEnv
      ? [...CLAUDE_AUTH_ENV_VARS, 'ANTHROPIC_CUSTOM_HEADERS']
      : undefined
    let combinedEnvToDelete = mergePtyEnvDeletions(
      envToDelete,
      args.envToDelete ?? [],
      agentTeamsEnvToDelete ?? [],
      isDaemonHostSpawn ? getInheritedAgentHookEnvKeysToDelete(spawnEnv) : [],
      getInheritedClaudeSessionStampEnvKeysToDelete(spawnEnv),
      skipCodexHomeEnv ? CODEX_HOME_ENV_KEYS : [],
      // Why: the persistent daemon compares its own merged CODEX_HOME pair;
      // main cannot safely decide ownership for a process it may not parent.
      stripInheritedOrcaCodexHome ? ['ORCA_CODEX_HOME'] : []
    )
    if (codexResumeHome?.codexHomePath) {
      combinedEnvToDelete = removeCodexHomeDeletionRequests(combinedEnvToDelete)
    }
    deleteRequestedEnvKeys(spawnEnv, combinedEnvToDelete)
    promoteAgentTeamsShimPath(spawnEnv, requestedAgentTeamsPath)
    const spawnOptions: PtySpawnOptions = {
      cols: args.cols,
      rows: args.rows,
      cwd,
      env: spawnEnv,
      ...(isMintedSessionId ? { isNewSession: true } : {})
    }
    if (!isDaemonHostSpawn && codexResumeHome) {
      spawnOptions.codexHomePathOverride = { value: codexResumeHome.codexHomePath }
    }
    if (combinedEnvToDelete) {
      spawnOptions.envToDelete = combinedEnvToDelete
    }
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
    if (reservationPaneKey) {
      spawnOptions.paneKey = reservationPaneKey
    }
    if (typeof args.tabId === 'string' && args.tabId.length > 0 && args.tabId.length <= 512) {
      spawnOptions.tabId = args.tabId
    }
    if (effectiveSessionId !== undefined) {
      spawnOptions.sessionId = effectiveSessionId
    }
    // Why: without this, the Windows daemon path ignores the user's Default Shell preference (LocalPtyProvider already honors it via getWindowsShell()).
    if (effectiveShellOverride !== undefined) {
      spawnOptions.shellOverride = effectiveShellOverride
    }
    let publicationSnapshot = effectiveSessionAppId
      ? snapshotPtyPublication(effectiveSessionAppId)
      : null
    const hadSessionSizeBeforeAttach =
      effectiveSessionAppId !== undefined ? ptySizes.has(effectiveSessionAppId) : false
    const sessionSizeBeforeAttach =
      effectiveSessionAppId !== undefined ? ptySizes.get(effectiveSessionAppId) : undefined
    if (effectiveSessionId !== undefined) {
      // Why: daemon PTYs can emit before spawn() resolves; set real geometry now or early bytes default to 80x24 and wrap TUIs.
      pendingPtySizes.set(effectiveSessionAppId ?? effectiveSessionId, {
        cols: args.cols,
        rows: args.rows
      })
    }
    if (process.platform === 'win32' && !args.connectionId) {
      // Why: the renderer models PowerShell as one shell family; thread the implementation choice so both PTY paths resolve the same executable.
      spawnOptions.terminalWindowsWslDistro = expectedWslDistro
      spawnOptions.terminalWindowsPowerShellImplementation = getSettings
        ? (getSettings()?.terminalWindowsPowerShellImplementation ?? 'auto')
        : undefined
    }
    if (startupTerminalColorQueryReplyColors) {
      spawnOptions.startupIngress = {
        colors: startupTerminalColorQueryReplyColors,
        deadlineMs: 5_000
      }
    }
    const existingPaneSpawn = reservationPaneKey
      ? paneSpawnReservationsByPaneKey.get(reservationPaneKey)
      : undefined
    if (existingPaneSpawn) {
      return await existingPaneSpawn.promise
    }
    const finishTerminalInstall = beginPtySpawnForWorktree(
      args.worktreeId,
      cwd,
      args.connectionId
    )
    const paneSpawnReservation = reservationPaneKey ? reservePaneSpawn(reservationPaneKey) : null
    const initiallyHidden = args.initiallyHidden === true
    // Why: daemon PTYs can emit before spawn() resolves, so the hidden mark must beat byte zero (terminal-query-authority.md §races); other providers are safe with the post-spawn mark below.
    const preSpawnHiddenMarkId =
      initiallyHidden && isDaemonHostSpawn && effectiveSessionAppId !== undefined
        ? effectiveSessionAppId
        : null
    if (preSpawnHiddenMarkId !== null) {
      transitionSpawnHiddenRendererPtyDeliveryState(preSpawnHiddenMarkId, true)
    }
    return { args, spawnTiming, startupPromise, allowMissingCwdFallback, didFallbackToWorkspaceRootCwd, cwd, startupCwdFallback, provider, isClaudeLaunch, terminalRuntimeOptions, initialShellOverride, isDaemonHostSpawn, isMintedSessionId, effectiveSessionId, effectiveSessionAppId, effectiveSessionRelayId, expectedWslDistro, initialSelectionTarget, claudeAuth, startupTerminalColorQueryReplyColors, sshSourceEnv, baseEnvWithAuth, spawnPaneKey, parsedSpawnPaneKey, verifiedPaneKey, verifiedLeafId, metadataLeafId, metadataPaneKey, legacySpawnPaneKey, migrationUnsupportedPaneKey, stablePaneKey, baseEnv, shouldRefreshAgentTeamsEnv, effectiveLaunchConfig, shouldPreAllocateTerminalHandle, preAllocatedHandle, requestedAgentTeamsPath, agentTeamsEnvToDelete, validatedPaneKey, reservationPaneKey, validatedLeafId, effectiveShellOverride, nativeWindowsConptySpawn, codexSelectionTarget, codexResumePreparation, codexResumeLaunch, codexResumeHome, launchCommand, env, selectedCodexHomePath, skipCodexHomeEnv, stripInheritedOrcaCodexHome, spawnEnv, envToDelete, combinedEnvToDelete, spawnOptions, publicationSnapshot, hadSessionSizeBeforeAttach, sessionSizeBeforeAttach, existingPaneSpawn, finishTerminalInstall, paneSpawnReservation, initiallyHidden, preSpawnHiddenMarkId }
  }
}
