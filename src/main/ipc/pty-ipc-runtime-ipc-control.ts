import { ipcMain } from 'electron'
import { setTerminalViewAttributes } from '../runtime/terminal-view-attribute-store'
import { validateTerminalViewAttributes } from '../../shared/terminal-view-attributes'
import {
  recordHiddenRendererPtyDataDrop,
  setRendererPtyDeliveryInterest,
  shouldDropHiddenRendererPtyData
} from './pty-hidden-delivery-gate'
import { redactPtyIdForDiagnostics } from '../../shared/pty-delivery-diagnostics'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { tryGetProviderForPty } from './pty-ipc-runtime-provider-routing'
import { parseAppSshPtyId } from '../providers/ssh-pty-id'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function installPtyIpcControlHandlers(): void {
  const state = getPtyRegistrationSharedState() as Record<string, any>
  const { mainWindow, runtime } = state

  ipcMain.removeAllListeners('pty:terminalViewAttributes')
  ipcMain.on('pty:terminalViewAttributes', (_event, args: unknown) => {
    const attributes = validateTerminalViewAttributes(args)
    if (attributes) {
      setTerminalViewAttributes(attributes)
    }
  })

  ipcMain.removeAllListeners('pty:setPtyDeliveryInterest')
  ipcMain.on('pty:setPtyDeliveryInterest', (_event, args: { id: string; interested: boolean }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return
    }
    const settings = state.getSettings?.()
    const wasDroppable = shouldDropHiddenRendererPtyData(args.id, settings)
    setRendererPtyDeliveryInterest(args.id, args.interested === true)
    if (wasDroppable !== shouldDropHiddenRendererPtyData(args.id, settings)) {
      state.invalidatePendingPtyDrainPolicy(args.id)
    }
    state.syncPtyBackgroundedDelivery(
      args.id,
      args.interested === true ? 'delivery-interest:on' : 'delivery-interest:off'
    )
  })

  ipcMain.removeAllListeners('pty:signal')
  ipcMain.on('pty:signal', (_event, args: { id: string; signal: string }) => {
    tryGetProviderForPty(args.id)
      ?.sendSignal(args.id, args.signal)
      .catch(() => {})
  })

  ipcMain.removeAllListeners('pty:clearBuffer')
  ipcMain.on('pty:clearBuffer', (_event, args: { id: string }) => {
    state.clearPendingPtyDataForPty(args.id)
    mainWindow.webContents.send('pty:clearBuffer:request', { ptyId: args.id })
    tryGetProviderForPty(args.id)
      ?.clearBuffer(args.id)
      .catch(() => {})
    void Promise.resolve(runtime?.clearHeadlessTerminalBuffer?.(args.id)).catch(() => {})
  })

  ipcMain.handle('pty:kill', async (_event, args: { id: string; keepHistory?: boolean }) => {
    if (typeof args?.id !== 'string' || !args.id || args.id.startsWith('remote:')) {
      throw new Error('Invalid PTY provider id')
    }
    const ownedConnectionId = state.ptyOwnership.get(args.id)
    const parsedSshId = ownedConnectionId === undefined ? parseAppSshPtyId(args.id) : null
    const connectionId = ownedConnectionId ?? parsedSshId?.connectionId
    const initialTarget = state.capturePtyShutdownTarget(args.id)
    const startupPromise = state.getLocalPtyProviderStartupPromise(connectionId)
    if (startupPromise) {
      await startupPromise
      if (!state.isPtyShutdownTargetCurrent(args.id, initialTarget)) {
        return
      }
    }
    const provider = connectionId
      ? state.sshProviders.get(connectionId)
      : tryGetProviderForPty(args.id)
    if (!provider && connectionId) {
      const target = state.capturePtyShutdownTarget(args.id)
      const finished = state.finishPtyShutdown(
        args.id,
        connectionId,
        state.store,
        target
      )
      if (!finished) {
        return
      }
      runtime?.onPtyExit(args.id, -1, finished.incarnationId)
      state.rememberSyntheticKillExit(args.id, target)
      state.sendPtyExitToRenderer({
        id: args.id,
        code: -1,
        ...(finished.incarnationId ? { incarnationId: finished.incarnationId } : {})
      })
      return
    }
    const shutdownProvider = provider ?? state.getProviderForPty(args.id)
    const expectedTarget = state.capturePtyShutdownTarget(args.id, shutdownProvider)
    let observation = { providerExitObserved: false as boolean, identityLessExitPayload: undefined as { id: string; code: number; incarnationId?: string } | undefined }
    try {
      observation = await state.shutdownProviderAndDetectExit(shutdownProvider, args.id, {
        immediate: true,
        keepHistory: args.keepHistory ?? false
      })
    } catch (error) {
      if (!state.isPtyAlreadyGoneError(error)) {
        throw error
      }
    }
    const finished = state.finishPtyShutdown(args.id, connectionId, state.store, expectedTarget)
    if (!finished) {
      return
    }
    if (observation.identityLessExitPayload) {
      runtime?.onPtyExit(args.id, observation.identityLessExitPayload.code, undefined, {
        authoritativeIdentityLess: true,
        ...(finished.incarnationId ? { expectedIncarnationId: finished.incarnationId } : {})
      })
      state.sendPtyExitToRenderer({
        ...observation.identityLessExitPayload,
        ...(finished.incarnationId ? { incarnationId: finished.incarnationId } : {})
      })
    } else if (!observation.providerExitObserved) {
      runtime?.onPtyExit(args.id, -1, finished.incarnationId)
      state.rememberSyntheticKillExit(args.id, expectedTarget)
      state.sendPtyExitToRenderer({
        id: args.id,
        code: -1,
        ...(finished.incarnationId ? { incarnationId: finished.incarnationId } : {})
      })
    }
  })

  ipcMain.removeAllListeners('pty:setHiddenRendererPty')
  ipcMain.on('pty:setHiddenRendererPty', (_event, args: { id: string; hidden: boolean }) => {
    if (typeof args?.id !== 'string' || !args.id) {
      return
    }
    ptyRuntimeState.mainDeliveryBreadcrumbs.record(args.hidden ? 'gate-mark' : 'gate-unmark', {
      id: redactPtyIdForDiagnostics(args.id)
    })
    const transition = state.transitionHiddenRendererPtyDeliveryState(args.id, args.hidden === true)
    if (args.hidden === true) {
      state.closeStartupQueryAuthorityForPty(args.id)
      const pending = state.pendingData.get(args.id)
      if (pending && transition.droppable) {
        state.pendingData.delete(args.id)
        if (pending.projectionAdmissionIds) {
          state.sshOutputIntake?.transferProjections(pending.projectionAdmissionIds, 'hidden-drop')
        }
        state.updateProducerFlowControl(args.id)
        state.pendingOverflowMarkedPtys.delete(args.id)
        const drop = recordHiddenRendererPtyDataDrop(args.id, pending.data.length)
        if (drop.shouldEmitRestoreMarker) {
          state.sendModelRestoreNeededMarker(args.id, 'hidden-drop', runtime?.getPtyOutputSequence?.(args.id))
        }
      }
      if (transition.policyChanged) {
        state.invalidatePendingPtyDrainPolicy(args.id)
      }
      state.syncPtyBackgroundedDelivery(args.id, 'gate-mark')
      return
    }
    if (transition.policyChanged) {
      state.invalidatePendingPtyDrainPolicy(args.id)
    }
    state.syncPtyBackgroundedDelivery(args.id, 'gate-unmark')
    if (transition.droppedWhileHidden) {
      state.sendModelRestoreNeededMarker(args.id, 'unhide', runtime?.getPtyOutputSequence?.(args.id))
    }
  })
}
