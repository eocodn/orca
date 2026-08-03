import type { RuntimeTerminalResolvePane } from '../../../../shared/runtime-types'
import { RuntimeRpcCallError } from '../../runtime/runtime-rpc-client'
import {
  getRemoteRuntimePtyEnvironmentId,
  runtimeTerminalErrorMessage,
  toRemoteRuntimePtyId
} from '../../runtime/runtime-terminal-stream'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { listRemoteRuntimeSessionTabsDeduped } from '@/runtime/remote-runtime-session-tabs-inflight'
import { isWebTerminalSurfaceTabId, toHostSessionTabId } from '@/runtime/web-terminal-surface-id'
import { replaceFitOverridePtyId } from '@/lib/pane-manager/mobile-fit-overrides'
import { replaceDriverPtyId } from '@/lib/pane-manager/mobile-driver-state'
import type { RemoteRuntimePtyTransportContext } from './remote-runtime-pty-transport-session-context'
import { armTerminalInputQuarantine } from './terminal-input-quarantine'

export function installRemoteRuntimePtyHostSessionPane(
  context: RemoteRuntimePtyTransportContext
): void {
  context.attachHostSessionMirror = async (
    options,
    notifySpawn = true,
    expectedAttachGeneration,
    expectedLifecycleEpoch
  ) => {
    const { tabId, worktreeId, leafId } = context.opts
    if (!tabId || !isWebTerminalSurfaceTabId(tabId)) return undefined
    const isCurrent = (): boolean =>
      !context.destroyed &&
      (expectedAttachGeneration === undefined || expectedAttachGeneration === context.attachGeneration) &&
      (expectedLifecycleEpoch === undefined || expectedLifecycleEpoch === context.lifecycleEpoch)
    const hostTabId = toHostSessionTabId(tabId)
    const hostHandle = await context.waitForHostSessionHandleWithRecovery(hostTabId, isCurrent)
    if (hostHandle === undefined || !isCurrent()) return undefined
    if (hostHandle === null) {
      context.storedCallbacks.onError?.('Remote terminal was closed.')
      return undefined
    }
    if (!hostHandle || !isCurrent()) {
      if (isCurrent()) context.storedCallbacks.onError?.('Remote terminal was closed.')
      return undefined
    }
    if (leafId && worktreeId && !context.resolvePaneUnavailable) {
      try {
        const resolved = await context.callRuntime<{ terminal: RuntimeTerminalResolvePane }>(
          'terminal.resolvePane',
          { paneKey: `${hostTabId}:${leafId}`, worktreeId }
        )
        const terminal = resolved.terminal
        if (
          terminal.handle === hostHandle &&
          terminal.tabId === hostTabId &&
          terminal.leafId === leafId &&
          (!terminal.worktreeId || terminal.worktreeId === worktreeId)
        ) context.adoptExecutionMetadata(terminal)
      } catch (error) {
        if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
          context.resolvePaneUnavailable = true
        }
      }
    }
    if (!isCurrent() || context.recovery.currentPhase === 'disconnected') return undefined
    context.handle = hostHandle
    context.remotePtyId = toRemoteRuntimePtyId(hostHandle, context.currentRuntimeEnvironmentId)
    context.registerShutdownHandlers(context.remotePtyId)
    context.connected = true
    context.desiredViewport = { cols: options.cols ?? 80, rows: options.rows ?? 24 }
    if (notifySpawn) context.opts.onPtySpawn?.(context.remotePtyId)
    try {
      await context.subscribeToHandle()
    } catch (error) {
      if (!context.recoverAfterSubscribeFailure(error, hostHandle, context.remotePtyId)) throw error
    }
    if (!context.connected || !context.remotePtyId || !isCurrent()) return undefined
    return { id: context.remotePtyId, replay: '', isReattach: true }
  }
  context.resolvePersistedHostPane = async (): Promise<RuntimeTerminalResolvePane | null> => {
    const { tabId, leafId, worktreeId } = context.opts
    if (!tabId || !leafId || !worktreeId || context.resolvePaneUnavailable) return null
    const paneKey = `${tabId}:${leafId}`
    let terminal: RuntimeTerminalResolvePane
    try {
      terminal = (
        await context.callRuntime<{ terminal: RuntimeTerminalResolvePane }>(
          'terminal.resolvePane',
          { paneKey, worktreeId }
        )
      ).terminal
    } catch (error) {
      const message = runtimeTerminalErrorMessage(error)
      if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
        context.resolvePaneUnavailable = true
        return null
      }
      if (message.includes('terminal_not_found') || message.includes('method_not_found')) return null
      throw error
    }
    if (
      terminal.tabId !== tabId ||
      terminal.leafId !== leafId ||
      (terminal.worktreeId !== undefined && terminal.worktreeId !== worktreeId)
    ) throw new Error('terminal_owner_mismatch')
    if (terminal.worktreeId === undefined) {
      const worktree = toRuntimeWorktreeSelector(worktreeId)
      const listed = await listRemoteRuntimeSessionTabsDeduped({
        environmentId: context.currentRuntimeEnvironmentId,
        worktreeId,
        load: () =>
          context.callRuntime('session.tabs.list', {
            worktree
          })
      })
      const exactLegacyOwner = context.getHostSessionTerminalSurfaces(listed, tabId, {
        matchRequestedLeaf: true
      }).some((surface) => surface.status === 'ready' && surface.terminal === terminal.handle)
      if (!exactLegacyOwner) throw new Error('terminal_owner_mismatch')
    }
    return terminal
  }
  context.adoptResolvedHostPane = async (
    terminal,
    options,
    notifySpawn = true,
    expectedAttachGeneration
  ) => {
    if (
      context.destroyed ||
      (expectedAttachGeneration !== undefined && expectedAttachGeneration !== context.attachGeneration)
    ) return undefined
    context.adoptExecutionMetadata(terminal)
    const previousPtyId = context.remotePtyId
    context.handle = terminal.handle
    context.remotePtyId = toRemoteRuntimePtyId(terminal.handle, context.currentRuntimeEnvironmentId)
    context.unregisterShutdownHandlers(previousPtyId)
    context.registerShutdownHandlers(context.remotePtyId)
    context.connected = true
    context.desiredViewport = { cols: options.cols ?? 80, rows: options.rows ?? 24 }
    if (notifySpawn) context.opts.onPtySpawn?.(context.remotePtyId)
    context.emitRecoveryState()
    try {
      await context.subscribeToHandle()
    } catch (error) {
      if (!context.recoverAfterSubscribeFailure(error, context.handle, context.remotePtyId)) {
        throw error
      }
    }
    if (
      context.destroyed ||
      !context.connected ||
      !context.remotePtyId ||
      (expectedAttachGeneration !== undefined && expectedAttachGeneration !== context.attachGeneration)
    ) return undefined
    return { id: context.remotePtyId, replay: '', isReattach: true }
  }
  context.recoverExpiredHostPane = () => {
    const { tabId, leafId, worktreeId } = context.opts
    const expiredHandle = context.handle
    if (!expiredHandle || !tabId || !leafId || !worktreeId || context.recoveringPaneHandle) return
    context.recoveringPaneHandle = expiredHandle
    context.connected = false
    context.inputBatcher.clear()
    context.clearPendingViewportClaim()
    context.closeMultiplexedStream()
    const hostTabId = isWebTerminalSurfaceTabId(tabId) ? toHostSessionTabId(tabId) : tabId
    void context
      .callRuntime<{ terminal: RuntimeTerminalResolvePane }>('terminal.recoverPane', {
        paneKey: `${hostTabId}:${leafId}`,
        worktreeId,
        expectedTerminal: expiredHandle
      })
      .then(async ({ terminal }) => {
        if (context.destroyed || context.handle !== expiredHandle) return
        context.adoptExecutionMetadata(terminal)
        const replacedPtyId = context.remotePtyId
        const nextPtyId = toRemoteRuntimePtyId(
          terminal.handle,
          context.currentRuntimeEnvironmentId
        )
        const endpointReplaced = replacedPtyId !== null && replacedPtyId !== nextPtyId
        if (endpointReplaced && context.opts.tabId) {
          armTerminalInputQuarantine(context.opts.tabId)
        }
        context.handle = terminal.handle
        context.remotePtyId = nextPtyId
        context.unregisterShutdownHandlers(replacedPtyId)
        context.registerShutdownHandlers(context.remotePtyId)
        context.connected = true
        if (replacedPtyId && replacedPtyId !== context.remotePtyId) {
          replaceFitOverridePtyId(replacedPtyId, context.remotePtyId)
          replaceDriverPtyId(replacedPtyId, context.remotePtyId)
          context.opts.onPtyRebind?.(context.remotePtyId, replacedPtyId)
        }
        await context.subscribeToHandle()
      })
      .catch((error) => {
        if (!context.destroyed && context.handle === expiredHandle) {
          context.storedCallbacks.onError?.(runtimeTerminalErrorMessage(error))
        }
      })
      .finally(() => {
        if (context.recoveringPaneHandle === expiredHandle) context.recoveringPaneHandle = null
      })
  }
}
