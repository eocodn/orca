import type {
  RuntimeCreateAgentSessionResult,
  RuntimeEnsureAgentSessionResult
} from '../../../../shared/agent-session-host-authority'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type {
  RuntimeMobileSessionTerminalClientTab,
  RuntimeMobileSessionTabsResult,
  RuntimeTerminalCreate,
  RuntimeTerminalResolvePane
} from '../../../../shared/runtime-types'
import type { RemoteRuntimeMultiplexedTerminal } from '../../runtime/remote-runtime-terminal-multiplexer'
import type {
  IpcPtyTransportOptions,
  PtyConnectResult,
  PtyTransport,
  PtyTransportRecoveryState
} from './pty-transport-types'
import { createPtyOutputProcessor } from './pty-transport'
import {
  createRemoteRuntimePtyTextBatcher,
  createRemoteRuntimeViewportBatcher,
  type RemoteRuntimePtyBatcher,
  type RemoteRuntimeViewportBatcher
} from './remote-runtime-pty-batching'
import { RemoteRuntimePtyRecoveryState } from './remote-runtime-pty-recovery-state'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { createAgentSessionCreateOperation } from '@/runtime/agent-session-create-operation'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { isWebTerminalSurfaceTabId, toHostSessionTabId } from '@/runtime/web-terminal-surface-id'
import { useAppStore } from '@/store'
import { toRemoteRuntimePtyId } from '../../runtime/runtime-terminal-stream'
import {
  drainRolledBackPtyShutdownData,
  isPtyDataHandlerShutdownPending,
  ptyDataHandlers,
  ptyReplayHandlers,
  ptyShutdownLifecycleHandlers
} from './pty-shutdown-data-suspension'

export type RemoteAgentSessionLaunchResult =
  | RuntimeEnsureAgentSessionResult
  | RuntimeCreateAgentSessionResult
  | { terminal: RuntimeTerminalCreate; disposition?: undefined }

export type RemoteRuntimePtyTransportContext = {
  readonly opts: IpcPtyTransportOptions
  readonly runtimeEnvironmentId: string
  readonly runtimeEnvironmentPairingRevision: number | undefined
  connected: boolean
  attachmentReady: boolean
  destroyed: boolean
  terminalEnded: boolean
  connecting: boolean
  readonly attachmentReadyWaiters: Set<(ready: boolean) => void>
  lifecycleEpoch: number
  handle: string | null
  remotePtyId: string | null
  authoritativeExecutionHostId: ExecutionHostId | null
  authoritativeHostPlatform: NodeJS.Platform | null
  currentRuntimeEnvironmentId: string
  multiplexedStream: RemoteRuntimeMultiplexedTerminal | null
  multiplexedStreamHandle: string | null
  desiredOutputPaused: boolean
  desiredViewport: { cols: number; rows: number } | null
  storedCallbacks: Parameters<PtyTransport['connect']>[0]['callbacks']
  resubscribeEpoch: number | null
  resubscribeRequestedHandle: string | null
  resubscribeRequestedRequiresReplacement: boolean
  recoveryRequiresReplacement: boolean
  stopWaitingForPublishedHandle: (() => void) | null
  settleHostSessionAttachRetry: ((retry: boolean) => void) | null
  attachGeneration: number
  subscriptionGeneration: number
  recovery: RemoteRuntimePtyRecoveryState
  lastRecoveryStateKey: string
  pendingViewportClaim: boolean
  pendingClaimInput: string
  terminalCreateRetryWait: {
    timer: ReturnType<typeof setTimeout>
    resolve: (continueRetrying: boolean) => void
  } | null
  terminalCreateNeedsReconciliation: boolean
  agentSessionRequiresHostAuthorityReplay: boolean
  terminalCreateUnknownOutcomeError: unknown
  lastConnectOptions: Parameters<PtyTransport['connect']>[0] | null
  lastAttachOptions: Parameters<PtyTransport['attach']>[0] | null
  resolvePaneUnavailable: boolean
  recoveringPaneHandle: string | null
  readonly viewportClaimReadyWaiters: Set<(ready: boolean) => void>
  readonly clientId: string
  readonly terminalCreateMutationId: string
  readonly agentCreateOperation: ReturnType<typeof createAgentSessionCreateOperation>
  outputProcessor: ReturnType<typeof createPtyOutputProcessor>
  shutdownDataHandler: (
    data: string,
    meta?: Parameters<ReturnType<typeof createPtyOutputProcessor>['processData']>[3]
  ) => void
  shutdownReplayHandler: (data: string) => void
  shutdownLifecycle: {
    pause: () => void
    rollback: () => void
    commit: () => void
  }
  inputBatcher: RemoteRuntimePtyBatcher
  viewportBatcher: RemoteRuntimeViewportBatcher
  setAttachmentReady: (ready: boolean) => void
  setAttachmentUnavailable: () => void
  waitForAttachmentReady: () => Promise<boolean>
  adoptExecutionMetadata: (terminal: {
    executionHostId?: ExecutionHostId
    hostPlatform?: NodeJS.Platform
  }) => void
  clearPendingViewportClaim: () => void
  registerShutdownHandlers: (ptyId: string) => void
  unregisterShutdownHandlers: (ptyId: string | null) => void
  getRecoveryState: () => PtyTransportRecoveryState
  emitRecoveryState: (force?: boolean) => void
  hostSnapshotOwnsLaunch: (
    result: RemoteAgentSessionLaunchResult,
    environmentId: string
  ) => boolean
  findReadyHostSessionHandle: (
    snapshot: RuntimeMobileSessionTabsResult,
    hostTabId: string
  ) => string | null
  getHostSessionTerminalSurfaces: (
    snapshot: RuntimeMobileSessionTabsResult,
    hostTabId: string,
    options: { matchRequestedLeaf: boolean }
  ) => RuntimeMobileSessionTerminalClientTab[]
  hasHostSessionTerminalSurface: (
    snapshot: RuntimeMobileSessionTabsResult,
    hostTabId: string
  ) => boolean
  waitForHostSessionHandle: (
    hostTabId: string,
    isCurrent: () => boolean
  ) => Promise<string | null | undefined | false>
  waitForHostSessionAttachRetry: (recoveryEpoch: number) => Promise<boolean>
  waitForHostSessionHandleWithRecovery: (
    hostTabId: string,
    isCurrent: () => boolean
  ) => Promise<string | null | undefined | false>
  waitForResubscribeHostSessionHandle: (
    hostTabId: string,
    previousHandle: string,
    requireReplacement: boolean
  ) => Promise<string | null | undefined>
  attachHostSessionMirror: (
    options: { cols?: number; rows?: number },
    notifySpawn?: boolean,
    expectedAttachGeneration?: number,
    expectedLifecycleEpoch?: number
  ) => Promise<PtyConnectResult | undefined>
  callRuntimeForEnvironment: <TResult>(
    environmentId: string,
    method: string,
    params?: unknown,
    timeoutMs?: number
  ) => Promise<TResult>
  callRuntime: <TResult>(method: string, params?: unknown, timeoutMs?: number) => Promise<TResult>
  cancelTerminalCreateRetryWait: () => void
  waitForTerminalCreateRetry: (delayMs: number) => Promise<boolean>
  terminalCreateRecoveryCutoffReached: () => boolean
  createWithUnknownOutcomeRecovery: (
    kind: 'terminal' | 'agent-session',
    invoke: (
      timeoutMs: number,
      reconcileExisting: boolean
    ) => Promise<RemoteAgentSessionLaunchResult>,
    environmentId: string,
    expectedLifecycleEpoch: number
  ) => Promise<RemoteAgentSessionLaunchResult | null>
  resolvePersistedHostPane: () => Promise<RuntimeTerminalResolvePane | null>
  adoptResolvedHostPane: (
    terminal: RuntimeTerminalResolvePane,
    options: { cols?: number; rows?: number },
    notifySpawn?: boolean,
    expectedAttachGeneration?: number
  ) => Promise<PtyConnectResult | undefined>
  recoverExpiredHostPane: () => void
  closeRemoteTerminal: (handleOverride?: string, environmentId?: string) => Promise<void>
  recoveryBlocksIo: () => boolean
  sendInputAcceptedToRuntime: (data: string) => Promise<boolean>
  sendViewportUpdate: (cols: number, rows: number, claim?: boolean) => void
  rememberViewport: (cols: number, rows: number) => void
  getCurrentMultiplexedStream: (targetHandle: string) => RemoteRuntimeMultiplexedTerminal | null
  closeMultiplexedStream: () => void
  clearPublishedHandleWait: () => void
  isCurrentRemoteTerminal: (targetHandle: string, targetPtyId: string | null) => boolean
  retireRemoteTerminalId: () => void
  rebindRemoteTerminalHandle: (nextHandle: string) => void
  waitForPublishedHostSessionHandle: (hostTabId: string, previousHandle: string) => void
  handleRemoteTerminalError: (error: unknown) => void
  recoverAfterSubscribeFailure: (
    error: unknown,
    targetHandle: string,
    targetPtyId: string | null
  ) => boolean
  resubscribeAfterTransportClose: (
    previousHandle: string,
    requireReplacement: boolean,
    recoveryEpoch: number
  ) => Promise<void>
  scheduleResubscribeAfterTransportClose: (
    requireReplacement?: boolean,
    requestedRecoveryEpoch?: number
  ) => void
  scheduleCapacityPressureRetry: () => void
  subscribeToHandle: (expectedRecoveryEpoch?: number) => Promise<void>
}

export function createRemoteRuntimePtyTransportContext(
  runtimeEnvironmentId: string,
  opts: IpcPtyTransportOptions
): RemoteRuntimePtyTransportContext {
  const context = {
    opts,
    runtimeEnvironmentId,
    runtimeEnvironmentPairingRevision: getRuntimeEnvironmentRevision(runtimeEnvironmentId),
    connected: false,
    attachmentReady: false,
    destroyed: false,
    terminalEnded: false,
    connecting: false,
    attachmentReadyWaiters: new Set<(ready: boolean) => void>(),
    lifecycleEpoch: 0,
    handle: null,
    remotePtyId: null,
    authoritativeExecutionHostId: opts.executionHostId ?? null,
    authoritativeHostPlatform: null,
    currentRuntimeEnvironmentId: runtimeEnvironmentId,
    multiplexedStream: null,
    multiplexedStreamHandle: null,
    desiredOutputPaused: false,
    desiredViewport: null,
    storedCallbacks: {},
    resubscribeEpoch: null,
    resubscribeRequestedHandle: null,
    resubscribeRequestedRequiresReplacement: false,
    recoveryRequiresReplacement: false,
    stopWaitingForPublishedHandle: null,
    settleHostSessionAttachRetry: null,
    attachGeneration: 0,
    subscriptionGeneration: 0,
    lastRecoveryStateKey: '',
    pendingViewportClaim: false,
    pendingClaimInput: '',
    terminalCreateRetryWait: null,
    terminalCreateNeedsReconciliation: false,
    agentSessionRequiresHostAuthorityReplay: false,
    terminalCreateUnknownOutcomeError: null,
    lastConnectOptions: null,
    lastAttachOptions: null,
    resolvePaneUnavailable: false,
    recoveringPaneHandle: null,
    viewportClaimReadyWaiters: new Set<(ready: boolean) => void>(),
    clientId: `desktop:${opts.tabId ?? 'tab'}:${opts.leafId ?? 'leaf'}:${createBrowserUuid()}`,
    terminalCreateMutationId: createBrowserUuid(),
    agentCreateOperation: createAgentSessionCreateOperation()
  } as RemoteRuntimePtyTransportContext

  context.adoptExecutionMetadata = (terminal) => {
    context.authoritativeExecutionHostId =
      terminal.executionHostId ?? context.authoritativeExecutionHostId
    context.authoritativeHostPlatform = terminal.hostPlatform ?? context.authoritativeHostPlatform
  }
  context.outputProcessor = createPtyOutputProcessor({
    onTitleChange: opts.onTitleChange,
    onBell: opts.onBell,
    onAgentBecameIdle: opts.onAgentBecameIdle,
    onAgentBecameWorking: opts.onAgentBecameWorking,
    onAgentExited: opts.onAgentExited,
    onAgentStatus: opts.onAgentStatus
  })
  context.storedCallbacks = {}
  context.shutdownDataHandler = (data, meta) => {
    context.outputProcessor.processData(data, context.storedCallbacks, undefined, meta)
  }
  context.shutdownReplayHandler = (data) => {
    context.outputProcessor.processData(data, context.storedCallbacks, {
      replayingBufferedData: true,
      suppressAttentionEvents: true
    })
  }
  context.shutdownLifecycle = {
    pause: context.outputProcessor.pausePendingSideEffects,
    rollback: context.outputProcessor.flushPendingSideEffects,
    commit: context.outputProcessor.clearAccumulatedState
  }
  context.registerShutdownHandlers = (ptyId) => {
    ptyDataHandlers.set(ptyId, context.shutdownDataHandler)
    ptyReplayHandlers.set(ptyId, context.shutdownReplayHandler)
    ptyShutdownLifecycleHandlers.set(ptyId, context.shutdownLifecycle)
    if (!isPtyDataHandlerShutdownPending(ptyId)) {
      drainRolledBackPtyShutdownData(ptyId)
    }
  }
  context.unregisterShutdownHandlers = (ptyId) => {
    if (!ptyId) return
    if (ptyDataHandlers.get(ptyId) === context.shutdownDataHandler) ptyDataHandlers.delete(ptyId)
    if (ptyReplayHandlers.get(ptyId) === context.shutdownReplayHandler) ptyReplayHandlers.delete(ptyId)
    if (ptyShutdownLifecycleHandlers.get(ptyId) === context.shutdownLifecycle) {
      ptyShutdownLifecycleHandlers.delete(ptyId)
    }
  }
  context.clearPendingViewportClaim = () => {
    context.pendingViewportClaim = false
    context.pendingClaimInput = ''
    for (const resolve of context.viewportClaimReadyWaiters) resolve(false)
    context.viewportClaimReadyWaiters.clear()
  }
  context.getRecoveryState = () => {
    const phase = context.destroyed
      ? 'disposed'
      : context.terminalEnded
        ? 'ended'
        : context.recovery.currentPhase === 'recovering'
          ? 'recovering'
          : context.recovery.currentPhase === 'backoff'
            ? 'backoff'
            : context.recovery.currentPhase === 'disconnected'
              ? 'disconnected'
              : context.connecting
                ? 'connecting'
                : context.connected && context.attachmentReady
                  ? 'connected'
                  : 'offline'
    return {
      phase,
      epoch: context.recovery.currentEpoch,
      attempt: context.recovery.attemptCount
    }
  }
  context.emitRecoveryState = (force = false) => {
    const state = context.getRecoveryState()
    const key = `${state.phase}:${state.epoch}:${state.attempt}`
    if (!force && key === context.lastRecoveryStateKey) return
    context.lastRecoveryStateKey = key
    context.storedCallbacks.onRecoveryStateChange?.(state)
  }
  context.hostSnapshotOwnsLaunch = (result, environmentId) => {
    if (result.disposition !== undefined) return true
    const scopedPtyId = toRemoteRuntimePtyId(result.terminal.handle, environmentId)
    return (useAppStore.getState().tabsByWorktree[context.opts.worktreeId ?? ''] ?? []).some(
      (tab) =>
        tab.ptyId === scopedPtyId ||
        (result.terminal.tabId !== undefined &&
          isWebTerminalSurfaceTabId(tab.id) &&
          toHostSessionTabId(tab.id) === result.terminal.tabId)
    )
  }
  context.setAttachmentReady = (ready) => {
    context.attachmentReady = ready
    if (!ready) return
    for (const resolve of context.attachmentReadyWaiters) resolve(true)
    context.attachmentReadyWaiters.clear()
  }
  context.setAttachmentUnavailable = () => {
    context.attachmentReady = false
    for (const resolve of context.attachmentReadyWaiters) resolve(false)
    context.attachmentReadyWaiters.clear()
  }
  context.waitForAttachmentReady = () => {
    if (context.attachmentReady) return Promise.resolve(true)
    if (context.destroyed || context.terminalEnded || !context.connected || !context.handle) {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        context.attachmentReadyWaiters.delete(settle)
        resolve(false)
      }, 15_000)
      const settle = (ready: boolean): void => {
        clearTimeout(timer)
        resolve(ready)
      }
      context.attachmentReadyWaiters.add(settle)
    })
  }
  context.recovery = new RemoteRuntimePtyRecoveryState(() => {
    if (context.recovery.currentPhase === 'disconnected') {
      context.clearPublishedHandleWait()
      context.subscriptionGeneration += 1
      context.closeMultiplexedStream()
    }
    if (
      context.recovery.currentPhase === 'disconnected' ||
      context.recovery.currentPhase === 'disposed' ||
      context.recovery.currentPhase === 'idle'
    ) {
      context.settleHostSessionAttachRetry?.(false)
    }
    context.emitRecoveryState()
  })
  context.inputBatcher = createRemoteRuntimePtyTextBatcher(8, (text) => {
    const targetHandle = context.handle
    if (!context.connected || !targetHandle || context.recoveryBlocksIo()) return
    const stream = context.getCurrentMultiplexedStream(targetHandle)
    if (stream?.sendInput(text)) return
    if (context.pendingViewportClaim) {
      context.pendingClaimInput += text
      return
    }
    void context.callRuntime('terminal.send', {
      terminal: targetHandle,
      text,
      client: { id: context.clientId, type: 'desktop' },
      ...(context.desiredViewport
        ? { viewport: context.desiredViewport, claimViewport: true as const }
        : {})
    }).catch((error) => context.handleRemoteTerminalError(error))
  })
  context.viewportBatcher = createRemoteRuntimeViewportBatcher(33, (cols, rows, claim) => {
    context.sendViewportUpdate(cols, rows, claim)
  })
  return context
}
