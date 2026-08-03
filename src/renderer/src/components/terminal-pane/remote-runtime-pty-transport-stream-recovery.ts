import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../../shared/remote-runtime-client-error-classification'
import { REMOTE_TERMINAL_SNAPSHOT_TOO_LARGE } from '../../runtime/remote-runtime-terminal-multiplexer'
import { runtimeTerminalErrorMessage, toRemoteRuntimePtyId } from '../../runtime/runtime-terminal-stream'
import {
  getRemoteRuntimeTerminalMultiplexer
} from '../../runtime/remote-runtime-terminal-multiplexer'
import { replaceFitOverridePtyId, setFitOverride } from '@/lib/pane-manager/mobile-fit-overrides'
import { replaceDriverPtyId, setDriverForPty } from '@/lib/pane-manager/mobile-driver-state'
import { isWebTerminalSurfaceTabId, toHostSessionTabId } from '@/runtime/web-terminal-surface-id'
import { subscribeAcceptedWebSessionTerminalHandle } from '@/runtime/web-session-terminal-handle-events'
import { bufferPtyShutdownData, bufferPtyShutdownReplayData } from './pty-shutdown-data-suspension'
import type { RemoteRuntimePtyTransportContext } from './remote-runtime-pty-transport-session-context'
import { armTerminalInputQuarantine } from './terminal-input-quarantine'

const SSH_SESSION_EXPIRED_ERROR = 'SSH_SESSION_EXPIRED'

function isRemoteTerminalStaleMessage(message: string): boolean {
  return message.includes('terminal_handle_stale')
}

export function isRemoteTerminalGoneMessage(message: string): boolean {
  return (
    message.includes('terminal_exited') ||
    message.includes('terminal_gone') ||
    message.includes('no_connected_pty') ||
    message.toLocaleLowerCase('en-US').includes('explicitly killed')
  )
}

export function installRemoteRuntimePtyStreamRecovery(
  context: RemoteRuntimePtyTransportContext
): void {
  context.getCurrentMultiplexedStream = (targetHandle) =>
    context.multiplexedStreamHandle === targetHandle ? context.multiplexedStream : null
  context.closeMultiplexedStream = () => {
    context.multiplexedStream?.close()
    context.multiplexedStream = null
    context.multiplexedStreamHandle = null
    context.setAttachmentReady(false)
  }
  context.clearPublishedHandleWait = () => {
    context.stopWaitingForPublishedHandle?.()
    context.stopWaitingForPublishedHandle = null
  }
  context.isCurrentRemoteTerminal = (targetHandle, targetPtyId) =>
    !context.destroyed &&
    context.connected &&
    context.handle === targetHandle &&
    context.remotePtyId === targetPtyId &&
    targetPtyId !== null
  context.retireRemoteTerminalId = () => {
    context.recovery.cancel()
    context.recoveryRequiresReplacement = false
    context.connected = false
    context.connecting = false
    context.terminalEnded = true
    context.clearPublishedHandleWait()
    context.clearPendingViewportClaim()
    const stalePtyId = context.remotePtyId
    context.unregisterShutdownHandlers(stalePtyId)
    context.handle = null
    context.remotePtyId = null
    context.closeMultiplexedStream()
    context.setAttachmentUnavailable()
    context.emitRecoveryState()
    if (stalePtyId) context.opts.onPtyExit?.(stalePtyId)
  }
  context.rebindRemoteTerminalHandle = (nextHandle) => {
    context.clearPublishedHandleWait()
    const replacedPtyId = context.remotePtyId
    context.unregisterShutdownHandlers(replacedPtyId)
    context.handle = nextHandle
    context.remotePtyId = toRemoteRuntimePtyId(nextHandle, context.currentRuntimeEnvironmentId)
    context.registerShutdownHandlers(context.remotePtyId)
    context.setAttachmentReady(false)
    if (replacedPtyId) {
      replaceFitOverridePtyId(replacedPtyId, context.remotePtyId)
      replaceDriverPtyId(replacedPtyId, context.remotePtyId)
      context.opts.onPtyRebind?.(context.remotePtyId, replacedPtyId)
    }
  }
  context.waitForPublishedHostSessionHandle = (hostTabId, previousHandle) => {
    const { worktreeId, leafId } = context.opts
    if (!worktreeId) return
    context.clearPublishedHandleWait()
    context.stopWaitingForPublishedHandle = subscribeAcceptedWebSessionTerminalHandle(
      {
        environmentId: context.currentRuntimeEnvironmentId,
        worktreeId,
        hostTabId,
        leafId
      },
      (update) => {
        if (context.destroyed || !context.connected || context.handle !== previousHandle) {
          context.clearPublishedHandleWait()
          return
        }
        if (!update.surfacePresent) {
          context.retireRemoteTerminalId()
          return
        }
        if (!update.terminalHandle || update.terminalHandle === previousHandle) return
        context.rebindRemoteTerminalHandle(update.terminalHandle)
        const reboundHandle = context.handle
        const reboundPtyId = context.remotePtyId
        void context
          .subscribeToHandle()
          .then(() => {
            if (context.opts.tabId) armTerminalInputQuarantine(context.opts.tabId)
          })
          .catch((error) => {
          if (
            reboundHandle &&
            !context.recoverAfterSubscribeFailure(error, reboundHandle, reboundPtyId)
          ) {
            context.handleRemoteTerminalError(error)
          }
        })
      }
    )
  }
  context.handleRemoteTerminalError = (error) => {
    const message = runtimeTerminalErrorMessage(error)
    if (message === REMOTE_TERMINAL_SNAPSHOT_TOO_LARGE) return
    if (isRemoteTerminalStaleMessage(message)) {
      if (context.opts.tabId && context.opts.leafId && context.opts.worktreeId) {
        context.closeMultiplexedStream()
        context.scheduleResubscribeAfterTransportClose(true)
      } else context.retireRemoteTerminalId()
      return
    }
    if (isRemoteTerminalGoneMessage(message)) {
      context.retireRemoteTerminalId()
      return
    }
    if (message.includes(SSH_SESSION_EXPIRED_ERROR)) {
      context.recoverExpiredHostPane()
      return
    }
    if (isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))) {
      context.scheduleResubscribeAfterTransportClose()
      return
    }
    context.connecting = false
    context.emitRecoveryState()
    context.storedCallbacks.onError?.(message)
  }
  context.recoverAfterSubscribeFailure = (error, targetHandle, targetPtyId) => {
    if (!context.isCurrentRemoteTerminal(targetHandle, targetPtyId)) return true
    if (context.multiplexedStreamHandle !== targetHandle) context.closeMultiplexedStream()
    context.clearPendingViewportClaim()
    if (!isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))) {
      return false
    }
    if (context.recovery.currentPhase === 'disconnected') return true
    context.scheduleResubscribeAfterTransportClose()
    return true
  }
  context.resubscribeAfterTransportClose = async (
    previousHandle,
    requireReplacement,
    recoveryEpoch
  ) => {
    const { tabId, leafId, worktreeId } = context.opts
    let endpointReplaced = false
    if (tabId && isWebTerminalSurfaceTabId(tabId)) {
      const nextHandle = await context.waitForResubscribeHostSessionHandle(
        toHostSessionTabId(tabId),
        previousHandle,
        requireReplacement
      )
      if (
        context.destroyed ||
        !context.connected ||
        context.handle !== previousHandle ||
        !context.recovery.isCurrent(recoveryEpoch)
      ) return
      if (nextHandle === undefined) return
      if (!nextHandle) {
        context.retireRemoteTerminalId()
        return
      }
      if (nextHandle !== previousHandle) context.rebindRemoteTerminalHandle(nextHandle)
    } else if (tabId && leafId && worktreeId) {
      const resolved = await context.resolvePersistedHostPane()
      if (context.destroyed || !context.connected || context.handle !== previousHandle) return
      if (!resolved || (requireReplacement && resolved.handle === previousHandle)) {
        context.retireRemoteTerminalId()
        return
      }
      if (resolved.handle !== previousHandle) {
        context.rebindRemoteTerminalHandle(resolved.handle)
        endpointReplaced = true
      }
    }
    context.clearPublishedHandleWait()
    await context.subscribeToHandle(recoveryEpoch)
    if (endpointReplaced && tabId) armTerminalInputQuarantine(tabId)
  }
  context.scheduleResubscribeAfterTransportClose = (
    requireReplacement = false,
    requestedRecoveryEpoch
  ) => {
    if (context.destroyed || !context.connected || !context.handle) return
    const recoveryWasActive = context.recovery.isActive
    const recoveryEpoch = requestedRecoveryEpoch ?? context.recovery.begin()
    if (!context.recovery.isCurrent(recoveryEpoch)) return
    if (!recoveryWasActive) {
      context.inputBatcher.clear()
      context.viewportBatcher.clear()
      context.clearPendingViewportClaim()
    }
    context.recoveryRequiresReplacement ||= requireReplacement
    if (requireReplacement && context.stopWaitingForPublishedHandle) return
    if (context.resubscribeEpoch === recoveryEpoch) {
      if (context.resubscribeRequestedHandle !== context.handle) {
        context.resubscribeRequestedHandle = context.handle
        context.resubscribeRequestedRequiresReplacement = requireReplacement
      } else {
        context.resubscribeRequestedRequiresReplacement ||= requireReplacement
      }
      return
    }
    const resubscribeHandle = context.handle
    context.clearPublishedHandleWait()
    if (context.opts.tabId && isWebTerminalSurfaceTabId(context.opts.tabId)) {
      context.waitForPublishedHostSessionHandle(toHostSessionTabId(context.opts.tabId), resubscribeHandle)
    }
    context.resubscribeEpoch = recoveryEpoch
    context.resubscribeRequestedHandle = null
    context.resubscribeRequestedRequiresReplacement = false
    let retryScheduled = false
    void context
      .resubscribeAfterTransportClose(resubscribeHandle, requireReplacement, recoveryEpoch)
      .catch((error) => {
        if (!context.destroyed && context.connected && context.handle && context.recovery.isCurrent(recoveryEpoch)) {
          context.clearPendingViewportClaim()
          if (isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))) {
            retryScheduled = context.recovery.schedule(recoveryEpoch, (nextEpoch) =>
              context.scheduleResubscribeAfterTransportClose(requireReplacement, nextEpoch)
            )
          } else {
            context.recovery.cancel()
            context.handleRemoteTerminalError(error)
          }
        }
      })
      .finally(() => {
        if (context.resubscribeEpoch !== recoveryEpoch) return
        context.resubscribeEpoch = null
        const pendingHandle = context.resubscribeRequestedHandle
        const pendingRequiresReplacement = context.resubscribeRequestedRequiresReplacement
        context.resubscribeRequestedHandle = null
        context.resubscribeRequestedRequiresReplacement = false
        if (
          !retryScheduled &&
          context.recovery.isCurrent(recoveryEpoch) &&
          !context.stopWaitingForPublishedHandle &&
          pendingHandle &&
          pendingHandle === context.handle &&
          !context.getCurrentMultiplexedStream(pendingHandle)
        ) context.scheduleResubscribeAfterTransportClose(pendingRequiresReplacement)
      })
  }
  context.scheduleCapacityPressureRetry = () => {
    if (context.destroyed || !context.connected || !context.handle) return
    const recoveryWasActive = context.recovery.isActive
    const recoveryEpoch = context.recovery.begin()
    if (!recoveryWasActive) {
      context.inputBatcher.clear()
      context.viewportBatcher.clear()
      context.clearPendingViewportClaim()
    }
    context.recovery.schedule(recoveryEpoch, (nextEpoch) =>
      context.scheduleResubscribeAfterTransportClose(false, nextEpoch)
    )
  }
  context.subscribeToHandle = async (expectedRecoveryEpoch) => {
    if (!context.handle) return
    const subscribedHandle = context.handle
    const subscribedPtyId = context.remotePtyId
    const generation = ++context.subscriptionGeneration
    context.setAttachmentReady(false)
    let transportClosed = false
    let subscriptionAttached = false
    const subscribedViewport = context.desiredViewport
    const isCurrentSubscription = (): boolean =>
      !transportClosed &&
      generation === context.subscriptionGeneration &&
      (expectedRecoveryEpoch === undefined || context.recovery.ownsEpoch(expectedRecoveryEpoch)) &&
      context.isCurrentRemoteTerminal(subscribedHandle, subscribedPtyId)
    const nextStream = await getRemoteRuntimeTerminalMultiplexer(
      context.currentRuntimeEnvironmentId
    ).subscribeTerminal({
      terminal: subscribedHandle,
      client: { id: context.clientId, type: 'desktop' },
      viewport: subscribedViewport ?? undefined,
      callbacks: {
        onData: (data, meta) => {
          if (isCurrentSubscription()) {
            if (subscribedPtyId && bufferPtyShutdownData(subscribedPtyId, data, meta)) return
            context.shutdownDataHandler(data, meta)
          }
        },
        onSnapshot: (data, meta) => {
          if ((data || meta?.pendingEscapeTailAnsi) && isCurrentSubscription()) {
            if (subscribedPtyId && bufferPtyShutdownReplayData(subscribedPtyId, data)) return
            context.outputProcessor.processData(data, context.storedCallbacks, {
              replayingBufferedData: true,
              suppressAttentionEvents: true,
              ...(meta?.pendingEscapeTailAnsi
                ? { pendingEscapeTailAnsi: meta.pendingEscapeTailAnsi }
                : {})
            })
          }
        },
        onOutputPauseCapability: () => {
          if (isCurrentSubscription()) {
            context.storedCallbacks.onOutputPauseChanged?.(
              context.desiredOutputPaused,
              nextStream.setOutputPaused(context.desiredOutputPaused)
            )
          }
        },
        onSubscribed: () => {
          if (!isCurrentSubscription()) return
          context.storedCallbacks.onOutputPauseChanged?.(
            context.desiredOutputPaused,
            nextStream.setOutputPaused(context.desiredOutputPaused)
          )
          subscriptionAttached = true
          context.setAttachmentReady(true)
          context.connecting = false
          context.recoveryRequiresReplacement = false
          context.recovery.markHealthy()
          context.emitRecoveryState()
          context.storedCallbacks.onConnect?.()
          context.storedCallbacks.onStatus?.('shell')
        },
        onEnd: () => {
          if (!isCurrentSubscription()) return
          context.outputProcessor.clearAccumulatedState()
          if (context.opts.tabId && isWebTerminalSurfaceTabId(context.opts.tabId)) {
            context.setAttachmentReady(false)
            context.multiplexedStream = null
            context.multiplexedStreamHandle = null
            context.clearPendingViewportClaim()
            context.scheduleResubscribeAfterTransportClose(true)
            return
          }
          context.unregisterShutdownHandlers(subscribedPtyId)
          context.connected = false
          context.connecting = false
          context.handle = null
          context.remotePtyId = null
          context.multiplexedStream = null
          context.multiplexedStreamHandle = null
          context.setAttachmentUnavailable()
          context.terminalEnded = true
          context.clearPendingViewportClaim()
          context.emitRecoveryState()
          context.storedCallbacks.onExit?.(0)
          context.storedCallbacks.onDisconnect?.()
          if (subscribedPtyId) context.opts.onPtyExit?.(subscribedPtyId)
        },
        onError: (message) => {
          if (isCurrentSubscription()) context.handleRemoteTerminalError(message)
        },
        onFitOverrideChanged: (event) => {
          if (isCurrentSubscription() && subscribedPtyId) {
            setFitOverride(subscribedPtyId, event.mode, event.cols, event.rows)
          }
        },
        onDriverChanged: (driver) => {
          if (isCurrentSubscription() && subscribedPtyId) setDriverForPty(subscribedPtyId, driver)
        },
        onTransportClose: ({ recoverable, retryWithBackoff }) => {
          transportClosed = true
          if (generation !== context.subscriptionGeneration) return
          if (!isCurrentSubscription() && !context.isCurrentRemoteTerminal(subscribedHandle, subscribedPtyId)) return
          context.multiplexedStream = null
          context.multiplexedStreamHandle = null
          context.setAttachmentReady(false)
          if (recoverable) {
            if (retryWithBackoff) context.scheduleCapacityPressureRetry()
            else context.scheduleResubscribeAfterTransportClose()
          } else {
            context.connecting = false
            context.recovery.cancel()
            context.setAttachmentUnavailable()
            context.emitRecoveryState()
          }
        }
      }
    })
    if (
      transportClosed ||
      generation !== context.subscriptionGeneration ||
      (expectedRecoveryEpoch !== undefined && !context.recovery.ownsEpoch(expectedRecoveryEpoch)) ||
      context.destroyed ||
      !context.connected ||
      context.handle !== subscribedHandle ||
      context.remotePtyId !== subscribedPtyId
    ) {
      nextStream.close()
      return
    }
    context.closeMultiplexedStream()
    context.multiplexedStream = nextStream
    context.multiplexedStreamHandle = subscribedHandle
    context.setAttachmentReady(subscriptionAttached)
    if (subscriptionAttached) {
      context.recoveryRequiresReplacement = false
      context.recovery.markHealthy()
    }
    if (context.pendingViewportClaim && context.desiredViewport) {
      nextStream.claimViewport(context.desiredViewport.cols, context.desiredViewport.rows)
      context.pendingViewportClaim = false
      const queuedInput = context.pendingClaimInput
      context.pendingClaimInput = ''
      if (queuedInput) nextStream.sendInput(queuedInput)
      for (const resolve of context.viewportClaimReadyWaiters) resolve(true)
      context.viewportClaimReadyWaiters.clear()
    } else if (
      context.desiredViewport &&
      (context.desiredViewport.cols !== subscribedViewport?.cols ||
        context.desiredViewport.rows !== subscribedViewport?.rows)
    ) {
      nextStream.resize(context.desiredViewport.cols, context.desiredViewport.rows)
    }
  }
}
