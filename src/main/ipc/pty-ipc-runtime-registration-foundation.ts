import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence'
import type { GlobalSettings } from '../../shared/types'
import type { IPtyProvider, PtySpawnResult } from '../providers/types'
import { app, ipcMain } from 'electron'
import { isPwshAvailable } from '../pwsh'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import {
  clearProviderPtyState,
  rollbackPtyIncarnation
} from './pty-ipc-runtime-provider-lifecycle-state'
import {
  rememberProviderClearedPtyExit,
  scheduleCurrentPtyCleanupReconciliation,
  schedulePendingPtyCleanupReconciliation,
  setPendingPtyCleanupForResult,
  restorePtyPublication,
  ptyCleanupAuthorityChanged,
  deletePendingPtyCleanupExact,
  type PtyCleanupAuthoritySnapshot
} from './pty-ipc-runtime-cleanup-reconciliation'
import {
  getCompatibleSelectedCodexHomePath,
  shouldStripInheritedOrcaCodexHome,
  type GetSelectedCodexHomePath,
  type PrepareCodexSessionResume
} from './pty-ipc-runtime-host-env-foundation'
import { buildPtyHostEnv } from './pty-ipc-runtime-host-env-assembly'
import { registerRendererLifecycleResetHandlers } from './pty-ipc-runtime-renderer-lifecycle-state'
import { isCurrentPtyExit } from './pty-ipc-runtime-provider-routing'
import { addOrcaWslInteropEnv, stampWslOrchestrationCompatibilityHost } from '../pty/wsl-orca-env'
import { markPtyExited } from '../pty/pty-lifecycle-state'
import { ptyRuntimeState, type PtyPublicationSnapshot } from './pty-ipc-runtime-state'
import {
  beginPtyRegistrationSharedState,
  getPtyRegistrationSharedState
} from './pty-ipc-runtime-registration-shared-state'
import type { CodexAccountSelectionTarget } from '../runtime/provider-lane-types'

export type PtyRegistrationFoundationArgs = {
  mainWindow: BrowserWindow
  runtime?: OrcaRuntimeService
  getSelectedCodexHomePath?: GetSelectedCodexHomePath
  getSettings?: () => GlobalSettings
  store?: Store
  options?: {
    prepareCodexSessionResume?: PrepareCodexSessionResume
    awaitLocalPtyStartup?: () => Promise<void>
    awaitLocalPtyProviderStartup?: () => Promise<void>
    isRecoveryReloadInFlight?: (webContentsId: number) => boolean
  }
}

export type PtyRegistrationFoundation = {
  getLocalPtyStartupPromise: (connectionId?: string | null) => Promise<void> | undefined
  getLocalPtyProviderStartupPromise: (connectionId?: string | null) => Promise<void> | undefined
  assertPtyCleanupComplete: (
    ptyId: string | undefined,
    authority?: PtyCleanupAuthoritySnapshot | null
  ) => void
  restorePublicationAfterExactCleanup: (
    result: PtySpawnResult,
    snapshot: PtyPublicationSnapshot | null,
    notifyRuntimeExit?: boolean,
    failedStateToken?: symbol
  ) => boolean
  cleanUpFailedFreshSpawn: (
    provider: IPtyProvider,
    result: PtySpawnResult,
    snapshot: PtyPublicationSnapshot | null,
    runtimeExitObservedBeforeQuarantine?: boolean
  ) => Promise<void>
}

export function createPtyRegistrationFoundation(
  args: PtyRegistrationFoundationArgs
): PtyRegistrationFoundation {
  const { mainWindow, runtime, getSelectedCodexHomePath, getSettings, options } = args
  const registrationState = beginPtyRegistrationSharedState()
  Object.assign(registrationState, args)
  ptyRuntimeState.mainWindow = mainWindow
  const rememberFinalizedCleanupExit = (id: string, incarnationId: string): void => {
    const state = getPtyRegistrationSharedState()
    state.rememberFinalizedCleanupExit(id, incarnationId)
  }

  // Why: a re-registration means a new window owns delivery — cancel the prior closure's watchdog and neutralize its bridged reset so mark-hidden below can't arm a timer against the dead closure.
  ptyRuntimeState.clearRendererDispatcherReadyWatchdog()
  ptyRuntimeState.resetRendererDeliveryAccountingForLifecycleReset = () => {}
  ptyRuntimeState.invalidatePendingPtyDrainPriority = () => {}
  ptyRuntimeState.invalidatePendingPtyDrainPolicy = () => {}
  registerRendererLifecycleResetHandlers(mainWindow.webContents)

  const getLocalPtyStartupPromise = (connectionId?: string | null): Promise<void> | undefined => {
    if (connectionId) {
      return undefined
    }
    // Why: during cold start the daemon provider swap overlaps first paint, so local spawns must wait; SSH/headless don't use the desktop daemon.
    return options?.awaitLocalPtyStartup?.()
  }

  const getLocalPtyProviderStartupPromise = (
    connectionId?: string | null
  ): Promise<void> | undefined => {
    if (connectionId) {
      return undefined
    }
    return options?.awaitLocalPtyProviderStartup?.() ?? options?.awaitLocalPtyStartup?.()
  }

  const assertPtyCleanupComplete = (
    ptyId: string | undefined,
    authorityAtProviderSpawnStart?: PtyCleanupAuthoritySnapshot | null
  ): void => {
    if (
      ptyId &&
      (ptyRuntimeState.cleanupPendingPtyById.get(ptyId)?.size ?? 0) > 0 &&
      (authorityAtProviderSpawnStart === undefined ||
        authorityAtProviderSpawnStart === null ||
        ptyCleanupAuthorityChanged(ptyId, authorityAtProviderSpawnStart))
    ) {
      throw new Error('pty_cleanup_pending')
    }
  }

  const restorePublicationAfterExactCleanup = (
    result: PtySpawnResult,
    snapshot: PtyPublicationSnapshot | null,
    notifyRuntimeExit = true,
    failedStateToken?: symbol
  ): boolean => {
    const current = ptyRuntimeState.ptyIncarnationById.get(result.id)
    const pending = ptyRuntimeState.pendingPtyIncarnationById.get(result.id)
    const currentStateToken = ptyRuntimeState.ptyStateTokenById.get(result.id)
    const isCurrentIdentityLessFailedLifecycle =
      result.incarnationId === undefined &&
      failedStateToken !== undefined &&
      currentStateToken === failedStateToken
    if (
      snapshot?.stateToken !== undefined &&
      currentStateToken !== snapshot.stateToken &&
      !isCurrentIdentityLessFailedLifecycle &&
      (result.incarnationId === undefined || pending !== result.incarnationId)
    ) {
      return false
    }
    if (
      result.incarnationId &&
      ((current !== undefined && current !== result.incarnationId) ||
        (pending !== undefined && pending !== result.incarnationId))
    ) {
      if (pending === result.incarnationId) {
        rollbackPtyIncarnation(result.id, result.incarnationId)
      }
      return false
    }
    clearProviderPtyState(result.id)
    ptyRuntimeState.ptyOwnership.delete(result.id)
    ptyRuntimeState.pendingPtySizes.delete(result.id)
    if (snapshot) {
      restorePtyPublication(snapshot)
    }
    if (result.incarnationId) {
      rememberFinalizedCleanupExit(result.id, result.incarnationId)
    }
    if (notifyRuntimeExit) {
      if (result.incarnationId === undefined) {
        runtime?.onPtyExit?.(result.id, -1, undefined, {
          authoritativeIdentityLess: true
        })
      } else {
        runtime?.onPtyExit?.(result.id, -1, result.incarnationId)
      }
    }
    return true
  }

  // Cleanup reconciliation supplies only the failed state token; runtime-exit notification belongs to the provider exit path.
  ptyRuntimeState.pendingPtyCleanupFinalizer = (result, snapshot, failedStateToken) =>
    restorePublicationAfterExactCleanup(result, snapshot, false, failedStateToken)

  const cleanUpFailedFreshSpawn = async (
    provider: IPtyProvider,
    result: PtySpawnResult,
    snapshot: PtyPublicationSnapshot | null,
    runtimeExitObservedBeforeQuarantine = false
  ): Promise<void> => {
    if (result.isReattach) {
      return
    }
    ptyRuntimeState.pendingPtySizes.delete(result.id)
    const failedStateToken = ptyRuntimeState.ptyStateTokenById.get(result.id)
    // Why: reserve the failed incarnation before awaiting provider shutdown, so a same-id replacement cannot enter the provider while cleanup is still authoritative.
    setPendingPtyCleanupForResult(provider, result, snapshot)
    try {
      await provider.shutdown(result.id, { immediate: true })
    } catch (error) {
      console.warn('[pty] failed to prove PTY cleanup after publication failure:', error)
      if (
        runtimeExitObservedBeforeQuarantine ||
        (result.incarnationId !== undefined &&
          runtime?.hasObservedExactPtyExit?.(result.id, result.incarnationId) === true)
      ) {
        deletePendingPtyCleanupExact(result.id, result.incarnationId)
        restorePublicationAfterExactCleanup(result, snapshot, false, failedStateToken)
        return
      }
      setPendingPtyCleanupForResult(provider, result, snapshot)
      schedulePendingPtyCleanupReconciliation(provider)
      scheduleCurrentPtyCleanupReconciliation(result.id)
      return
    }

    const runtimeExitObserved =
      runtimeExitObservedBeforeQuarantine ||
      (result.incarnationId !== undefined &&
        runtime?.hasObservedExactPtyExit?.(result.id, result.incarnationId) === true)
    let absent = runtimeExitObserved
    if (!absent && provider.listProcesses) {
      try {
        const processes = await provider.listProcesses()
        absent = !processes.some(
          (process) =>
            process.id === result.id &&
            (result.incarnationId === undefined ||
              process.incarnationId === undefined ||
              process.incarnationId === result.incarnationId)
        )
      } catch {
        absent = false
      }
    }
    if (!absent && !provider.listProcesses) {
      absent = provider.hasPty?.(result.id) === false
    }
    if (!absent) {
      setPendingPtyCleanupForResult(provider, result, snapshot)
      schedulePendingPtyCleanupReconciliation(provider)
      scheduleCurrentPtyCleanupReconciliation(result.id)
      return
    }
    deletePendingPtyCleanupExact(result.id, result.incarnationId)
    restorePublicationAfterExactCleanup(result, snapshot, !runtimeExitObserved, failedStateToken)
  }

  // Remove prior handlers so re-registration (e.g. macOS re-activate creating a new window) doesn't double-register.
  ipcMain.removeHandler('pty:spawn')
  ipcMain.removeHandler('pty:kill')
  ipcMain.removeHandler('pty:listSessions')
  ipcMain.removeHandler('pty:hasPty')
  ipcMain.removeHandler('pty:hasChildProcesses')
  ipcMain.removeHandler('pty:getForegroundProcess')
  ipcMain.removeHandler('pty:inspectProcess')
  ipcMain.removeHandler('pty:confirmForegroundProcess')
  ipcMain.removeHandler('pty:getCwd')
  ipcMain.removeHandler('pty:getSize')
  ipcMain.removeAllListeners('pty:getAuthoritativeBufferSnapshotCapabilitiesSync')
  ipcMain.removeHandler('pty:declarePendingPaneSerializer')
  ipcMain.removeHandler('pty:settlePaneSerializer')
  ipcMain.removeHandler('pty:clearPendingPaneSerializer')
  ipcMain.removeHandler('pty:reportRendererSerializerReady')
  ipcMain.removeHandler('pty:getMainBufferSnapshot')
  ipcMain.removeHandler('pty:sideEffectSnapshot')
  ipcMain.removeHandler('pty:getRendererDeliveryDebugSnapshot')
  ipcMain.removeHandler('pty:resetRendererDeliveryDebug')
  ipcMain.removeHandler('pty:reportRendererDeliveryState')
  ipcMain.removeHandler('pty:writeAccepted')
  ipcMain.removeAllListeners('pty:write')
  ipcMain.removeAllListeners('pty:ackColdRestore')
  ipcMain.removeAllListeners('pty:ackData')
  ipcMain.removeAllListeners('pty:deliveryResyncResponse')
  ipcMain.removeAllListeners('pty:serializeBuffer:response')

  // Why: only LocalPtyProvider needs main-process hook injection; daemon-backed providers spawn subprocesses internally.
  if (ptyRuntimeState.localProvider instanceof LocalPtyProvider) {
    const configuredLocalProvider = ptyRuntimeState.localProvider
    ptyRuntimeState.localProvider.configure({
      isHistoryEnabled: () => getSettings?.()?.terminalScopeHistoryByWorktree ?? true,
      getWindowsShell: () => getSettings?.()?.terminalWindowsShell,
      getWindowsPowerShellImplementation: () =>
        getSettings
          ? (getSettings()?.terminalWindowsPowerShellImplementation ?? 'auto')
          : undefined,
      pwshAvailable: () => isPwshAvailable(),
      buildSpawnEnv: (id, baseEnv, ctx) => {
        const codexSelectionTarget: CodexAccountSelectionTarget =
          ctx?.isWsl === true
            ? { runtime: 'wsl', wslDistro: ctx.wslDistro ?? null }
            : { runtime: 'host' }
        const selectedCodexHomePath = getCompatibleSelectedCodexHomePath(
          codexSelectionTarget,
          ctx?.codexHomePathOverride
            ? ctx.codexHomePathOverride.value
            : (getSelectedCodexHomePath?.(codexSelectionTarget, baseEnv, {
                workspacePath: ctx?.cwd,
                launchAgent: ctx?.launchAgent
              }) ?? null)
        )
        const skipCodexHomeEnv = ctx?.isWsl === true && !selectedCodexHomePath
        const env = buildPtyHostEnv(id, baseEnv, {
          isPackaged: app.isPackaged,
          userDataPath: app.getPath('userData'),
          selectedCodexHomePath,
          skipCodexHomeEnv,
          stripInheritedOrcaCodexHome: shouldStripInheritedOrcaCodexHome({
            target: codexSelectionTarget,
            selectedCodexHomePath,
            skipCodexHomeEnv,
            settings: getSettings?.()
          }),
          launchCommand: ctx?.command,
          launchAgent: ctx?.launchAgent,
          shellPath: ctx?.shellPath,
          isWsl: ctx?.isWsl,
          wslDistro: ctx?.wslDistro ?? null,
          agentStatusHooksEnabled: true,
          networkProxySettings: getSettings?.()
        })
        // Why: agents need their terminal handle at process start to self-identify in orchestration messages without an extra RPC.
        const requestedHandle = baseEnv.ORCA_TERMINAL_HANDLE
        const preAllocatedHandle =
          requestedHandle && ptyRuntimeState.trustedTerminalHandleEnv.has(requestedHandle)
            ? requestedHandle
            : runtime?.preAllocateHandleForPty(id)
        if (requestedHandle && requestedHandle !== preAllocatedHandle) {
          delete env.ORCA_TERMINAL_HANDLE
        }
        if (preAllocatedHandle) {
          env.ORCA_TERMINAL_HANDLE = preAllocatedHandle
        }
        stampWslOrchestrationCompatibilityHost(
          env,
          runtime?.getOrchestrationCompatibilityHostId?.(),
          ctx?.isWsl === true ? ctx.wslDistro : null
        )
        if (ctx?.isWsl === true) {
          addOrcaWslInteropEnv(env)
        }
        return env
      },
      onSpawned: (id, incarnationId) => runtime?.onPtySpawned(id, incarnationId),
      onExit: (id, code, incarnationId) => {
        if (ptyRuntimeState.localProvider !== configuredLocalProvider) {
          // Why: after provider replacement, the retained callback has no authority over the new provider's same-id lifecycle.
          return
        }
        if (!isCurrentPtyExit({ id, incarnationId })) {
          return
        }
        if (incarnationId !== undefined) {
          rememberProviderClearedPtyExit(id, incarnationId)
        }
        clearProviderPtyState(id)
        ptyRuntimeState.ptyOwnership.delete(id)
        markPtyExited(id)
        runtime?.onPtyExit(id, code, incarnationId)
      }
    })
  }

  const foundation = {
    getLocalPtyStartupPromise,
    getLocalPtyProviderStartupPromise,
    assertPtyCleanupComplete,
    restorePublicationAfterExactCleanup,
    cleanUpFailedFreshSpawn
  }
  Object.assign(registrationState, { foundation, ...foundation })
  return foundation
}
