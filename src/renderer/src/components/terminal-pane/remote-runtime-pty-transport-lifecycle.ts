import type {
  RuntimeCreateAgentSessionResult,
  RuntimeEnsureAgentSessionResult
} from '../../../../shared/agent-session-host-authority'
import {
  AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import type { PtyConnectResult, PtyTransport } from './pty-transport-types'
import {
  getRemoteRuntimePtyEnvironmentId,
  getRemoteRuntimeTerminalHandle,
  runtimeTerminalErrorMessage,
  toRemoteRuntimePtyId
} from '../../runtime/runtime-terminal-stream'
import { toRuntimeTerminalWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { withAgentSessionCreateOperationId } from '@/runtime/agent-session-create-operation'
import { isWebTerminalSurfaceTabId } from '@/runtime/web-terminal-surface-id'
import { runRemoteAgentSessionLaunch } from '@/runtime/remote-agent-session-launch'
import { recordWebAgentSessionHandoff } from '@/runtime/web-agent-session-handoff'
import { refreshWebRuntimeSessionTabsSnapshot } from '@/runtime/web-runtime-session'
import type {
  RemoteAgentSessionLaunchResult,
  RemoteRuntimePtyTransportContext
} from './remote-runtime-pty-transport-session-context'
import { isRemoteTerminalGoneMessage } from './remote-runtime-pty-transport-stream-recovery'

export function createRemoteRuntimePtyTransportLifecycle(
  context: RemoteRuntimePtyTransportContext
): PtyTransport {
  const transport: PtyTransport = {
    async connect(options) {
      context.cancelTerminalCreateRetryWait()
      const connectLifecycleEpoch = ++context.lifecycleEpoch
      const createEnvironmentId = context.currentRuntimeEnvironmentId
      context.lastConnectOptions = options
      context.lastAttachOptions = null
      context.storedCallbacks = options.callbacks
      context.recoveryRequiresReplacement = false
      context.terminalEnded = false
      context.connecting = true
      context.emitRecoveryState(true)
      if (context.destroyed || !context.opts.worktreeId) return
      try {
        if (isWebTerminalSurfaceTabId(context.opts.tabId ?? '')) {
          return await context.attachHostSessionMirror(options, true, undefined, connectLifecycleEpoch)
        }
        if (options.sessionId && !getRemoteRuntimeTerminalHandle(options.sessionId)) {
          const terminal = await context.resolvePersistedHostPane()
          if (terminal) return await context.adoptResolvedHostPane(terminal, options)
        }
        const commandToSend = options.command ?? context.opts.command
        const startupCommandDeliveryToSend =
          options.startupCommandDelivery ?? context.opts.startupCommandDelivery
        const envToSend = options.env ?? context.opts.env
        const envToDeleteToSend = options.envToDelete ?? context.opts.envToDelete
        const launchConfigToSend = options.launchConfig ?? context.opts.launchConfig
        const resumeProviderSessionToSend =
          options.resumeProviderSession ?? context.opts.resumeProviderSession
        const launchTokenToSend = options.launchToken ?? context.opts.launchToken
        const launchAgentToSend = options.launchAgent ?? context.opts.launchAgent
        const legacyCreateParams = {
          worktree: toRuntimeTerminalWorktreeSelector(context.opts.worktreeId!),
          clientMutationId: context.terminalCreateMutationId,
          ...(commandToSend !== undefined ? { command: commandToSend } : {}),
          ...(startupCommandDeliveryToSend !== undefined
            ? { startupCommandDelivery: startupCommandDeliveryToSend }
            : {}),
          ...(envToSend !== undefined ? { env: envToSend } : {}),
          ...(envToDeleteToSend !== undefined ? { envToDelete: envToDeleteToSend } : {}),
          ...(launchConfigToSend !== undefined ? { launchConfig: launchConfigToSend } : {}),
          ...(resumeProviderSessionToSend !== undefined
            ? { resumeProviderSession: resumeProviderSessionToSend }
            : {}),
          ...(launchTokenToSend !== undefined ? { launchToken: launchTokenToSend } : {}),
          ...(launchAgentToSend !== undefined ? { launchAgent: launchAgentToSend } : {}),
          ...(context.opts.terminalColorQueryReplies
            ? { terminalColorQueryReplies: context.opts.terminalColorQueryReplies }
            : {}),
          tabId: context.opts.tabId,
          leafId: context.opts.leafId,
          focus: false,
          presentation: 'background' as const,
          ...(context.opts.activate === true ? { activate: true } : {})
        }
        const legacyCreate = () =>
          context.createWithUnknownOutcomeRecovery(
            'terminal',
            (timeoutMs, reconcileExisting) =>
              context.callRuntimeForEnvironment<{ terminal: import('../../../../shared/runtime-types').RuntimeTerminalCreate }>(
                createEnvironmentId,
                'terminal.create',
                {
                  ...legacyCreateParams,
                  ...(reconcileExisting ? { reconcileExisting: true } : {})
                },
                timeoutMs
              ),
            createEnvironmentId,
            connectLifecycleEpoch
          )
        const hostAuthorityCreate = () =>
          context.createWithUnknownOutcomeRecovery(
            'agent-session',
            (timeoutMs) =>
              resumeProviderSessionToSend
                ? context.callRuntimeForEnvironment<RuntimeEnsureAgentSessionResult>(
                    createEnvironmentId,
                    'terminal.ensureAgentSession',
                    {
                      kind: 'explicit',
                      worktree: toRuntimeTerminalWorktreeSelector(context.opts.worktreeId!),
                      agent: launchAgentToSend!,
                      providerSession: resumeProviderSessionToSend,
                      ...(launchConfigToSend?.ompResumeFilePath
                        ? { ompResumeFilePath: launchConfigToSend.ompResumeFilePath }
                        : {}),
                      ...(context.opts.agentArgsOverride !== undefined
                        ? { agentArgs: context.opts.agentArgsOverride }
                        : {}),
                      ...(context.opts.agentLaunchPreferences
                        ? { launchPreferences: context.opts.agentLaunchPreferences }
                        : {}),
                      placement: { tabId: context.opts.tabId, leafId: context.opts.leafId },
                      presentation: 'background'
                    },
                    timeoutMs
                  )
                : context.callRuntimeForEnvironment<RuntimeCreateAgentSessionResult>(
                    createEnvironmentId,
                    'terminal.createAgentSession',
                    withAgentSessionCreateOperationId(
                      {
                        worktree: toRuntimeTerminalWorktreeSelector(context.opts.worktreeId!),
                        agent: launchAgentToSend!,
                        ...(context.opts.agentPrompt ? { prompt: context.opts.agentPrompt } : {}),
                        ...(context.opts.agentPromptDelivery
                          ? { promptDelivery: context.opts.agentPromptDelivery }
                          : {}),
                        ...(context.opts.agentArgsOverride !== undefined
                          ? { agentArgs: context.opts.agentArgsOverride }
                          : {}),
                        ...(context.opts.agentLaunchPreferences
                          ? { launchPreferences: context.opts.agentLaunchPreferences }
                          : {}),
                        placement: { tabId: context.opts.tabId, leafId: context.opts.leafId },
                        presentation: 'background'
                      },
                      context.agentCreateOperation.clientOperationId
                    ),
                    timeoutMs
                  ),
            createEnvironmentId,
            connectLifecycleEpoch
          )
        const created = launchAgentToSend
          ? context.agentSessionRequiresHostAuthorityReplay
            ? await hostAuthorityCreate()
            : await runRemoteAgentSessionLaunch<RemoteAgentSessionLaunchResult | null>({
                environmentId: createEnvironmentId,
                hostAuthority: hostAuthorityCreate,
                ...(resumeProviderSessionToSend && launchAgentToSend === 'omp'
                  ? { hostAuthorityCapability: AGENT_SESSION_OMP_RESUME_PATH_RUNTIME_CAPABILITY }
                  : {}),
                legacy: legacyCreate
              })
          : await legacyCreate()
        if (!created) {
          if (!context.destroyed && context.lifecycleEpoch === connectLifecycleEpoch) {
            context.connecting = false
            context.recovery.markDisconnected()
          }
          return
        }
        const createdTerminal = created.terminal
        context.adoptExecutionMetadata(createdTerminal)
        if (created.disposition !== undefined && context.opts.tabId && createdTerminal.tabId) {
          recordWebAgentSessionHandoff({
            environmentId: createEnvironmentId,
            worktreeId: context.opts.worktreeId!,
            provisionalTabId: context.opts.tabId,
            hostTabId: createdTerminal.tabId,
            hostTerminalHandle: createdTerminal.handle
          })
          void refreshWebRuntimeSessionTabsSnapshot(createEnvironmentId, context.opts.worktreeId!, {
            expectedEnvironmentPairingRevision: context.runtimeEnvironmentPairingRevision,
            acceptCurrentSnapshot: true,
            confirmAgentSessionHandoff: {
              provisionalTabId: context.opts.tabId,
              hostTabId: createdTerminal.tabId,
              hostTerminalHandle: createdTerminal.handle
            }
          })
        }
        if (context.destroyed || context.lifecycleEpoch !== connectLifecycleEpoch) {
          if (
            !context.hostSnapshotOwnsLaunch(created, createEnvironmentId) &&
            (createdTerminal.handle !== context.handle || createEnvironmentId !== context.currentRuntimeEnvironmentId)
          ) await context.closeRemoteTerminal(createdTerminal.handle, createEnvironmentId)
          return
        }
        context.handle = createdTerminal.handle
        context.remotePtyId = toRemoteRuntimePtyId(context.handle, context.currentRuntimeEnvironmentId)
        context.registerShutdownHandlers(context.remotePtyId)
        context.connected = true
        context.desiredViewport = { cols: options.cols ?? 80, rows: options.rows ?? 24 }
        context.opts.onPtySpawn?.(context.remotePtyId)
        context.emitRecoveryState()
        try {
          await context.subscribeToHandle()
        } catch (error) {
          if (!context.recoverAfterSubscribeFailure(error, context.handle, context.remotePtyId)) throw error
        }
        if (context.destroyed || !context.connected || !context.remotePtyId) return
        return { id: context.remotePtyId, replay: '' } satisfies PtyConnectResult
      } catch (error) {
        if (!context.destroyed && context.lifecycleEpoch === connectLifecycleEpoch) {
          context.connecting = false
          context.recovery.cancel()
          const message = runtimeTerminalErrorMessage(error)
          if (isRemoteTerminalGoneMessage(message)) context.handleRemoteTerminalError(error)
          else {
            context.emitRecoveryState()
            context.storedCallbacks.onError?.(message)
          }
        }
        return undefined
      }
    },
    attach(options) {
      const attachLifecycleEpoch = ++context.lifecycleEpoch
      const generation = ++context.attachGeneration
      context.cancelTerminalCreateRetryWait()
      context.recovery.cancel()
      context.recoveryRequiresReplacement = false
      context.clearPublishedHandleWait()
      context.lastAttachOptions = options
      context.storedCallbacks = options.callbacks
      context.terminalEnded = false
      context.connecting = true
      context.emitRecoveryState(true)
      context.currentRuntimeEnvironmentId = context.runtimeEnvironmentId
      const previousHandle = context.handle
      const previousPtyId = context.remotePtyId
      const nextHandle = getRemoteRuntimeTerminalHandle(options.existingPtyId)
      if (previousHandle && previousHandle !== nextHandle) context.inputBatcher.clear()
      const persistedEnvironmentId = getRemoteRuntimePtyEnvironmentId(options.existingPtyId)
      context.handle = nextHandle
      context.unregisterShutdownHandlers(previousPtyId)
      context.connected = false
      context.remotePtyId = null
      context.clearPendingViewportClaim()
      context.closeMultiplexedStream()
      if (!nextHandle) {
        context.handle = null
        context.connecting = false
        context.emitRecoveryState()
        context.storedCallbacks.onError?.('Remote runtime terminal id is invalid.')
        return
      }
      const persistedHandle = nextHandle
      void (async () => {
        const { tabId, leafId, worktreeId } = context.opts
        if (isWebTerminalSurfaceTabId(tabId ?? '')) {
          await context.attachHostSessionMirror(options, false, generation, attachLifecycleEpoch)
          return
        }
        if (!tabId || !leafId || !worktreeId) {
          await context.adoptResolvedHostPane(
            { handle: persistedHandle, tabId: tabId ?? '', leafId: leafId ?? '', ptyId: null, worktreeId },
            options,
            false,
            generation
          )
          return
        }
        const resolved = await context.resolvePersistedHostPane()
        if (generation !== context.attachGeneration || context.destroyed) return
        if (!resolved && context.resolvePaneUnavailable && persistedEnvironmentId === context.currentRuntimeEnvironmentId) {
          await context.adoptResolvedHostPane(
            { handle: persistedHandle, tabId, leafId, ptyId: null, worktreeId },
            options,
            false,
            generation
          )
          return
        }
        if (!resolved) {
          context.storedCallbacks.onError?.('Remote terminal was closed.')
          return
        }
        await context.adoptResolvedHostPane(resolved, options, false, generation)
      })().catch((error) => {
        if (generation !== context.attachGeneration || attachLifecycleEpoch !== context.lifecycleEpoch || context.destroyed) return
        context.clearPendingViewportClaim()
        context.recovery.cancel()
        context.handleRemoteTerminalError(error)
      })
    },
    disconnect() {
      context.lifecycleEpoch += 1
      context.attachGeneration += 1
      context.cancelTerminalCreateRetryWait()
      context.recovery.cancel()
      context.recoveryRequiresReplacement = false
      context.clearPublishedHandleWait()
      context.inputBatcher.flush()
      context.inputBatcher.clear()
      context.viewportBatcher.flush()
      context.outputProcessor.clearAccumulatedState()
      if (!context.connected && !context.handle) return
      context.connected = false
      context.connecting = false
      context.terminalEnded = true
      context.clearPendingViewportClaim()
      const id = context.remotePtyId
      context.unregisterShutdownHandlers(id)
      context.closeMultiplexedStream()
      context.setAttachmentUnavailable()
      context.handle = null
      context.remotePtyId = null
      context.emitRecoveryState()
      context.storedCallbacks.onDisconnect?.()
      if (id) context.opts.onPtyExit?.(id)
    },
    detach() {
      context.lifecycleEpoch += 1
      context.attachGeneration += 1
      context.cancelTerminalCreateRetryWait()
      context.recovery.cancel()
      context.recoveryRequiresReplacement = false
      context.clearPublishedHandleWait()
      context.inputBatcher.flush()
      context.inputBatcher.clear()
      context.viewportBatcher.flush()
      context.outputProcessor.clearAccumulatedState()
      context.unregisterShutdownHandlers(context.remotePtyId)
      context.connected = false
      context.connecting = false
      context.clearPendingViewportClaim()
      context.closeMultiplexedStream()
      context.setAttachmentUnavailable()
      context.emitRecoveryState()
      context.storedCallbacks = {}
    },
    sendInput(data) {
      if (!context.connected || !context.handle || context.recoveryBlocksIo()) return false
      if (!data) return true
      return context.inputBatcher.push(data)
    },
    sendInputImmediate(data) {
      const targetHandle = context.handle
      if (!context.connected || !targetHandle || context.recoveryBlocksIo()) return false
      if (!data) return true
      if (context.inputBatcher.hasPendingValidation()) {
        const accepted = context.inputBatcher.push(data)
        context.inputBatcher.flush()
        return accepted
      }
      const pending = context.inputBatcher.takePending()
      const text = `${pending}${data}`
      const stream = context.getCurrentMultiplexedStream(targetHandle)
      if (stream?.sendInput(text)) return true
      if (context.pendingViewportClaim) {
        context.pendingClaimInput += text
        return true
      }
      void context.callRuntime('terminal.send', {
        terminal: targetHandle,
        text,
        client: { id: context.clientId, type: 'desktop' },
        ...(context.desiredViewport
          ? { viewport: context.desiredViewport, claimViewport: true as const }
          : {})
      }).catch((error) => context.handleRemoteTerminalError(error))
      return true
    },
    sendInputAccepted: (data) => context.sendInputAcceptedToRuntime(data),
    claimViewport(cols, rows) {
      if (!context.connected || !context.handle) return false
      context.rememberViewport(cols, rows)
      if (context.recoveryBlocksIo()) return true
      context.viewportBatcher.clear()
      context.sendViewportUpdate(cols, rows, true)
      return true
    },
    setOutputPaused(paused) {
      context.desiredOutputPaused = paused
      if (!context.connected || !context.handle) return false
      const supported = context.getCurrentMultiplexedStream(context.handle)?.setOutputPaused(paused) === true
      context.storedCallbacks.onOutputPauseChanged?.(paused, supported)
      return supported
    },
    resize(cols, rows, meta) {
      if (!context.connected || !context.handle) return false
      context.rememberViewport(cols, rows)
      if (context.recoveryBlocksIo()) return true
      if (meta?.claim) {
        context.viewportBatcher.clear()
        context.sendViewportUpdate(cols, rows, true)
        return true
      }
      context.viewportBatcher.queue(cols, rows)
      return true
    },
    isConnected() {
      return (
        context.connected &&
        !context.recoveryBlocksIo() &&
        context.attachmentReady &&
        context.multiplexedStream !== null &&
        context.multiplexedStreamHandle === context.handle
      )
    },
    getRecoveryState: context.getRecoveryState,
    retryRecovery() {
      if (
        !context.destroyed &&
        !context.terminalEnded &&
        !context.connected &&
        isWebTerminalSurfaceTabId(context.opts.tabId ?? '') &&
        context.recovery.currentPhase === 'disconnected'
      ) {
        context.recovery.cancel()
        if (context.lastAttachOptions) {
          transport.attach(context.lastAttachOptions)
          return true
        }
        if (context.lastConnectOptions) {
          void transport.connect(context.lastConnectOptions)
          return true
        }
      }
      if (
        !context.destroyed &&
        !context.terminalEnded &&
        !context.connected &&
        !context.handle &&
        (context.terminalCreateNeedsReconciliation || context.agentSessionRequiresHostAuthorityReplay) &&
        context.lastConnectOptions &&
        context.recovery.currentPhase === 'disconnected'
      ) {
        context.recovery.begin()
        void transport.connect(context.lastConnectOptions)
        return true
      }
      if (
        context.destroyed ||
        context.terminalEnded ||
        !context.connected ||
        !context.handle ||
        context.recovery.currentPhase !== 'disconnected'
      ) return false
      const recoveryEpoch = context.recovery.begin()
      context.scheduleResubscribeAfterTransportClose(context.recoveryRequiresReplacement, recoveryEpoch)
      return true
    },
    getPtyId: () => context.remotePtyId,
    getConnectionId: () => null,
    getRuntimeEnvironmentId: () => context.currentRuntimeEnvironmentId,
    getExecutionHostId: () => context.authoritativeExecutionHostId,
    getRemotePlatform: () => context.authoritativeHostPlatform,
    async serializeBuffer(opts) {
      if (!context.connected || !context.handle) return null
      if (!(await context.waitForAttachmentReady()) || !context.handle) return null
      return context.getCurrentMultiplexedStream(context.handle)?.serializeBuffer(opts) ?? null
    },
    destroy() {
      context.destroyed = true
      context.setAttachmentUnavailable()
      transport.disconnect()
      context.recovery.dispose()
      context.inputBatcher.clear()
      context.viewportBatcher.clear()
    }
  }
  return transport
}
