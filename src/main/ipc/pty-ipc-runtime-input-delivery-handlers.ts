import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import type { IPtyProvider } from '../providers/types'
import { closeStartupQueryAuthorityForPty, tryGetProviderForPty } from './pty-ipc-runtime-provider-routing'
import { isPtyWriteUnavailableError } from '../providers/pty-write-unavailable-error'
import { isTerminalInputTooLargeWithDeferredMeasurement, iterateTerminalInputChunks } from '../../shared/terminal-input'
import { recordHiddenRendererPtyDataDrop } from './pty-hidden-delivery-gate'
import { PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS } from './pty-ipc-runtime-renderer-delivery-constants'
import { redactPtyIdForDiagnostics } from '../../shared/pty-delivery-diagnostics'
import type {
  PtyDeliveryWriteOff,
  PtyRendererDeliveryHealth,
  PtyRendererDeliveryHealthReply,
  PtyRendererProcessedChars,
  PtyRendererDeliveryStateReport
} from '../../shared/pty-renderer-delivery-health'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function installPtyInputDeliveryHandlers(state: PtyRendererDeliveryContext & Record<string, any>): void {
  // Re-registration must replace these handlers before the next registration stage installs its controls.
  ipcMain.removeHandler('pty:reportRendererDeliveryState')
  ipcMain.removeHandler('pty:writeAccepted')
  ipcMain.removeAllListeners('pty:write')
  ipcMain.removeAllListeners('pty:ackColdRestore')
  ipcMain.removeAllListeners('pty:ackData')
  ipcMain.removeAllListeners('pty:deliveryResyncResponse')

  const {
    mainWindow, runtime, ptyOwnership, ptySizes, lastInputAtByPty, interactiveOutputCharsByPty,
    visibleRendererPtys, activeRendererPtys, rendererVisibilityKnownPtys,
    pendingHiddenRendererResizeOutputPtys, deliveredHiddenRendererResizeOutputPtys, pendingOverflowMarkedPtys,
    pendingData, sshOutputIntake, rendererDeliveryAccountingByPty,
    clearDeliveryResyncProbe, applyCumulativeAck,
    schedulePendingDataAfterCreditReport, writeOffLostRendererDelivery,
    clearDispatcherReadyWatchdog, resetRendererDeliveryAccountingForLifecycleReset, schedulePendingDataFlush,
    invalidatePendingPtyDrainPriority, invalidatePendingPtyDrainPolicy, syncPtyBackgroundedDelivery,
    updateProducerFlowControl, sendModelRestoreNeededMarker, rendererPtyIsKnownHidden
  } = state

  const clearHiddenRendererResizeOutput = state.clearHiddenRendererResizeOutput
  const clearDeliveredHiddenRendererResizeOutput = state.clearDeliveredHiddenRendererResizeOutput
  const mainDeliveryBreadcrumbs = ptyRuntimeState.mainDeliveryBreadcrumbs
  const reportUnavailablePtyWrite = (id: string, error: unknown): void => {
    if (
      !isPtyWriteUnavailableError(error) ||
      mainWindow.isDestroyed() ||
      (typeof mainWindow.webContents.isDestroyed === 'function' &&
        mainWindow.webContents.isDestroyed())
    ) {
      return
    }
    mainWindow.webContents.send('pty:writeUnavailable', { id })
  }

  const writePtyProviderInputWithinLimit = (
    provider: IPtyProvider,
    id: string,
    data: string
  ): boolean | Promise<boolean> => {
    const chunks = iterateTerminalInputChunks(data)
    const first = chunks.next()
    if (first.done) {
      provider.write(id, data)
      return true
    }
    const second = chunks.next()
    if (second.done) {
      provider.write(id, first.value)
      return true
    }
    return writePtyProviderInputChunks(provider, id, chunks, first.value, second.value)
  }

  const writePtyProviderInput = (
    provider: IPtyProvider,
    id: string,
    data: string
  ): boolean | Promise<boolean> => {
    try {
      const tooLarge = isTerminalInputTooLargeWithDeferredMeasurement(data)
      if (typeof tooLarge === 'boolean') {
        return tooLarge ? false : writePtyProviderInputWithinLimit(provider, id, data)
      }
      return tooLarge
        .then((result) => (result ? false : writePtyProviderInputWithinLimit(provider, id, data)))
        .catch((error) => {
          reportUnavailablePtyWrite(id, error)
          return false
        })
    } catch (error) {
      reportUnavailablePtyWrite(id, error)
      return false
    }
  }

  const writePtyProviderInputChunks = async (
    provider: IPtyProvider,
    id: string,
    chunks: Iterator<string>,
    firstChunk: string,
    secondChunk: string
  ): Promise<boolean> => {
    try {
      let chunk: IteratorResult<string> = { done: false, value: firstChunk }
      let nextChunk: IteratorResult<string> = { done: false, value: secondChunk }
      while (!chunk.done) {
        provider.write(id, chunk.value)
        if (!nextChunk.done) {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        chunk = nextChunk
        nextChunk = chunks.next()
      }
      return true
    } catch (error) {
      reportUnavailablePtyWrite(id, error)
      return false
    }
  }

  type PtyWritePayload = { id: string; data: string }
  type PtyViewportClaimPayload = { id: string; cols: number; rows: number }

  const isPtyWritePayload = (value: unknown): value is PtyWritePayload =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id.length > 0 &&
    typeof (value as { data?: unknown }).data === 'string'

  const isPtyViewportClaimPayload = (value: unknown): value is PtyViewportClaimPayload =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string' &&
    (value as { id: string }).id.length > 0 &&
    typeof (value as { cols?: unknown }).cols === 'number' &&
    Number.isFinite((value as { cols: number }).cols) &&
    typeof (value as { rows?: unknown }).rows === 'number' &&
    Number.isFinite((value as { rows: number }).rows) &&
    (value as { cols: number }).cols > 0 &&
    (value as { rows: number }).rows > 0

  const isPtyWriteEventFromMainWindow = (
    event: IpcMainEvent | IpcMainInvokeEvent,
    mainWebContents: WebContents
  ): boolean =>
    event.sender === mainWebContents &&
    !mainWindow.isDestroyed() &&
    !(typeof mainWebContents.isDestroyed === 'function' && mainWebContents.isDestroyed())

  const writePtyInput = (args: PtyWritePayload): boolean | Promise<boolean> => {
    // Why: mobile-presence-lock defense-in-depth — the renderer's onData guard can let one keystroke slip during the state-flip lag, so catch it server-side. See docs/mobile-presence-lock.md.
    if (runtime?.getDriver(args.id).kind === 'mobile') {
      return false
    }
    const provider = ptyOwnership.has(args.id) ? tryGetProviderForPty(args.id) : undefined
    if (!provider) {
      return false
    }
    try {
      const now = performance.now()
      lastInputAtByPty.set(args.id, now)
      interactiveOutputCharsByPty.set(args.id, 0)
      if (visibleRendererPtys.has(args.id)) {
        clearHiddenRendererResizeOutput(args.id)
      }
      return writePtyProviderInput(provider, args.id, args.data)
    } catch {
      return false
    }
  }

  const writePtyInputAccepted = (args: PtyWritePayload): boolean | Promise<boolean> => {
    if (runtime?.getDriver(args.id).kind === 'mobile') {
      return false
    }
    // Why: the ack infers Ctrl+C/Escape reached the local PTY; SSH providers are fire-and-forget relay notifications and can't truthfully acknowledge yet.
    if (ptyOwnership.get(args.id) !== null) {
      return false
    }
    const provider = tryGetProviderForPty(args.id)
    if (!provider?.hasPty?.(args.id)) {
      return false
    }
    try {
      const now = performance.now()
      lastInputAtByPty.set(args.id, now)
      interactiveOutputCharsByPty.set(args.id, 0)
      if (visibleRendererPtys.has(args.id)) {
        clearHiddenRendererResizeOutput(args.id)
      }
      return writePtyProviderInput(provider, args.id, args.data)
    } catch {
      return false
    }
  }

  const hostViewportClaimTails = new Map<string, Promise<boolean>>()

  ipcMain.on('pty:write', (event, args: unknown) => {
    if (!isPtyWriteEventFromMainWindow(event, mainWindow.webContents) || !isPtyWritePayload(args)) {
      return
    }
    const claimTail = hostViewportClaimTails.get(args.id)
    if (claimTail) {
      void claimTail.then((claimed) => (claimed ? writePtyInput(args) : false))
      return
    }
    writePtyInput(args)
  })
  ipcMain.handle('pty:writeAccepted', (event, args: unknown): boolean | Promise<boolean> => {
    if (!isPtyWriteEventFromMainWindow(event, mainWindow.webContents) || !isPtyWritePayload(args)) {
      return false
    }
    const claimTail = hostViewportClaimTails.get(args.id)
    return claimTail
      ? claimTail.then((claimed) => (claimed ? writePtyInputAccepted(args) : false))
      : writePtyInputAccepted(args)
  })

  ipcMain.removeAllListeners('pty:claimViewport')
  ipcMain.on('pty:claimViewport', (event, args: unknown) => {
    if (
      !isPtyWriteEventFromMainWindow(event, mainWindow.webContents) ||
      !runtime ||
      !isPtyViewportClaimPayload(args)
    ) {
      return
    }
    const prior = hostViewportClaimTails.get(args.id)
    // Why: two panes can mirror one PTY — never let a later no-op claim replace the in-flight resize that the following host input must await.
    const claim = (
      prior
        ? prior.then(
            () => runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows),
            () => runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows)
          )
        : runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows)
    ).catch(() => false)
    hostViewportClaimTails.set(args.id, claim)
    void claim.then(() => {
      if (hostViewportClaimTails.get(args.id) === claim) {
        hostViewportClaimTails.delete(args.id)
      }
    })
  })

  // Why: resize is fire-and-forget — ipcMain.on (not .handle) halves IPC traffic by skipping the empty acknowledgement reply.
  ipcMain.removeAllListeners('pty:resize')
  ipcMain.on('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    // Why: after a desktop-fit override change the renderer's safeFit cascade re-measures ALL panes (background ones at full width), so suppress every pty:resize in this window to avoid corrupting PTY dimensions.
    if (runtime?.isResizeSuppressed()) {
      return
    }
    // Why: presence-lock defense-in-depth — while a phone or remote-desktop viewer drives the width, host-side resizes must not reach the PTY or its alt-screen grid garbles; load-bearing because the renderer mirror lags one IPC hop. See docs/mobile-presence-lock.md.
    const mobileOwnsResize = runtime?.getDriver(args.id).kind === 'mobile'
    const remoteDesktopOwnsResize = runtime?.isRemoteDesktopResizeDriven?.(args.id) === true
    if (mobileOwnsResize || remoteDesktopOwnsResize) {
      if (remoteDesktopOwnsResize) {
        runtime?.recordRemoteDesktopHostReclaimTarget(args.id, args.cols, args.rows)
      }
      return
    }
    const provider = tryGetProviderForPty(args.id)
    if (!provider) {
      return
    }
    const markedHiddenResizeOutput = rendererPtyIsKnownHidden(args.id)
    if (markedHiddenResizeOutput) {
      // Why: alt-screen TUIs repaint on SIGWINCH; a hidden repaint read after switch-back must not masquerade as live output and overwrite the correctly-sized screen.
      pendingHiddenRendererResizeOutputPtys.add(args.id)
      deliveredHiddenRendererResizeOutputPtys.delete(args.id)
    } else if (visibleRendererPtys.has(args.id)) {
      // Why: after the stale hidden-resize repaint is observed, the renderer's visible resize pulse owns the next repaint.
      clearDeliveredHiddenRendererResizeOutput(args.id)
    }
    try {
      provider.resize(args.id, args.cols, args.rows)
    } catch {
      if (markedHiddenResizeOutput) {
        pendingHiddenRendererResizeOutputPtys.delete(args.id)
      }
      return
    }
    ptySizes.set(args.id, { cols: args.cols, rows: args.rows })
    runtime?.onExternalPtyResize(args.id, args.cols, args.rows)
  })

  // Why: pty:reportGeometry is a measurement-only sibling of pty:resize — it refreshes the restore-target cache (never resizes) so mobile-fit hold learns real desktop dims even while resize is blocked. See docs/mobile-fit-hold.md.
  ipcMain.removeAllListeners('pty:reportGeometry')
  ipcMain.on('pty:reportGeometry', (_event, args: { id: string; cols: number; rows: number }) => {
    runtime?.recordRendererGeometry(args.id, args.cols, args.rows)
  })

  // Why: fire-and-forget — clears the DaemonPtyAdapter's sticky cold-restore cache after the renderer consumed it; no-op for non-daemon providers.
  ipcMain.on('pty:ackColdRestore', (_event, args: { id: string }) => {
    const provider = tryGetProviderForPty(args.id)
    if (provider && 'ackColdRestore' in provider && typeof provider.ackColdRestore === 'function') {
      provider.ackColdRestore(args.id)
    }
  })

  // Why: renderer ACKs bound main→renderer delivery without stopping PTY ingestion — agent/status consumers still see every chunk via the provider/runtime path.
  ipcMain.on(
    'pty:ackData',
    (_event, args: { id: string; charCount?: number; processedChars?: number; incarnationId: string }) => {
      const accounting = rendererDeliveryAccountingByPty.get(args.id)
      if (!accounting || accounting.incarnationId !== args.incarnationId) {
        return
      }
      accounting.lastAckAtMs = Date.now()
      // Why: a live ACK channel means a future unanswered probe is a fresh diagnostic event, not a continuation of the last silent streak.
      state.deliveryResyncUnansweredWarnLogged = false
      let acknowledged = 0
      if (typeof args.processedChars === 'number' && Number.isFinite(args.processedChars)) {
        acknowledged = applyCumulativeAck(args.id, Math.max(0, args.processedChars), args.incarnationId)
      } else {
        // Why: tolerate legacy per-chunk delta payloads — dev hot-reload can pair an old renderer with a new main.
        const delta = Number.isFinite(args.charCount) ? Math.max(0, args.charCount ?? 0) : 0
        acknowledged = applyCumulativeAck(args.id, accounting.ackedChars + delta, args.incarnationId)
      }
      tryGetProviderForPty(args.id)?.acknowledgeDataEvent(args.id, acknowledged)
      schedulePendingDataAfterCreditReport(acknowledged > 0)
    }
  )

  ipcMain.on(
    'pty:deliveryResyncResponse',
    (_event, args: { requestId: number; processedCharsByPty: Record<string, number | PtyRendererProcessedChars> }) => {
      if (
        state.deliveryResyncOutstandingRequestId === null ||
        args?.requestId !== state.deliveryResyncOutstandingRequestId
      ) {
        return
      }
      clearDeliveryResyncProbe()
      state.deliveryResyncUnansweredWarnLogged = false
      // Why max-merge: the renderer's cumulative totals are authoritative for what it processed, draining exactly the in-flight debt from lost ACKs.
      let creditedAny = false
      for (const [id, report] of Object.entries(args.processedCharsByPty ?? {})) {
        const processedChars = typeof report === 'number' ? report : report?.processedChars
        const incarnationId = typeof report === 'number' ? undefined : report?.incarnationId
        if (typeof processedChars !== 'number' || !Number.isFinite(processedChars)) {
          continue
        }
        const acknowledged = applyCumulativeAck(id, Math.max(0, processedChars), incarnationId)
        if (acknowledged > 0) {
          creditedAny = true
          tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
        }
      }
      schedulePendingDataAfterCreditReport(creditedAny)
    }
  )

  // Why invoke + renderer-initiated: the field wedge (v1.4.121-rc.0) kills every main→renderer push channel while invoke survives, so the resync rides here plus a write-off lane.
  ipcMain.handle(
    'pty:reportRendererDeliveryState',
    (_event, args: PtyRendererDeliveryStateReport): PtyRendererDeliveryHealthReply => {
      // Extra repair lane for the lost-ACK variant: identical max-merge to the resync response, so a heal is only reached when merging cannot drain.
      let creditedAny = false
      for (const [id, report] of Object.entries(args?.processedCharsByPty ?? {})) {
        const processedChars = typeof report === 'number' ? report : report?.processedChars
        const incarnationId = typeof report === 'number' ? undefined : report?.incarnationId
        if (typeof processedChars !== 'number' || !Number.isFinite(processedChars)) {
          continue
        }
        const acknowledged = applyCumulativeAck(id, Math.max(0, processedChars), incarnationId)
        if (acknowledged > 0) {
          creditedAny = true
          tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
        }
      }
      let writtenOff: PtyDeliveryWriteOff[] = []
      // Why: only a PTY whose own ACK lane is silent may be written off; another PTY's recent ACK cannot protect or condemn it.
      const hasStalledPty = [...rendererDeliveryAccountingByPty.values()].some((accounting) => {
        if (accounting.sentChars <= accounting.ackedChars) {
          return false
        }
        return accounting.lastAckAtMs === null ||
          Date.now() - accounting.lastAckAtMs >= PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS
      })
      if (args?.heal === true && hasStalledPty) {
        writtenOff = writeOffLostRendererDelivery(args)
        creditedAny ||= writtenOff.length > 0
      }
      schedulePendingDataAfterCreditReport(creditedAny)
      let inFlightPtyCount = 0
      const perPty: PtyRendererDeliveryHealth[] = []
      let msSinceLastAck: number | null = 0
      for (const [id, accounting] of rendererDeliveryAccountingByPty) {
        const inFlightChars = accounting.sentChars - accounting.ackedChars
        if (inFlightChars > 0) {
          inFlightPtyCount++
          const ptyMsSinceLastAck =
            accounting.lastAckAtMs === null ? null : Date.now() - accounting.lastAckAtMs
          if (ptyMsSinceLastAck === null) {
            msSinceLastAck = null
          } else if (msSinceLastAck !== null) {
            msSinceLastAck = Math.max(msSinceLastAck, ptyMsSinceLastAck)
          }
          perPty.push({
            id,
            ...(accounting.incarnationId ? { incarnationId: accounting.incarnationId } : {}),
            inFlightChars,
            msSinceLastAck: ptyMsSinceLastAck
          })
        }
      }
      return {
        inFlightTotalChars: state.rendererInFlightTotalChars,
        inFlightPtyCount,
        msSinceLastAck: inFlightPtyCount === 0 ? null : msSinceLastAck,
        perPty,
        ...(writtenOff.length > 0 ? { writtenOff } : {})
      }
    }
  )

  // Why: renderer signals its pty:data listener is live; until then sends are held so boot-window bytes can't drop into a listener-less page and pin the gate.
  ipcMain.removeAllListeners('pty:rendererDispatcherReady')
  ipcMain.on('pty:rendererDispatcherReady', (event) => {
    // Why: the reconcile below destructively clears delivery accounting, so a straggler handshake from a dying window must not reset the new window.
    if (!isPtyWriteEventFromMainWindow(event, mainWindow.webContents)) {
      return
    }
    // Why: a handshake while the gate is already open means a page load whose lifecycle reset was missed; clear the dead page's stale accounting so it can't permanently gate survivors.
    if (state.rendererPtyDispatcherReady) {
      resetRendererDeliveryAccountingForLifecycleReset()
    }
    // Why: real handshake landed — cancel the diagnostic watchdog before opening the gate.
    clearDispatcherReadyWatchdog()
    state.rendererPtyDispatcherReady = true
    pendingData.reactivateBlocked()
    schedulePendingDataFlush(0)
  })

  ipcMain.removeAllListeners('pty:setActiveRendererPty')
  ipcMain.on('pty:setActiveRendererPty', (_event, args: { id: string; active: boolean }) => {
    if (typeof args.id !== 'string' || !args.id) {
      return
    }
    // Why: renderer scheduling hint only — active panes just get first chance at the bounded output reserve; reads/state/notifications continue for inactive terminals.
    if (args.active) {
      if (activeRendererPtys.has(args.id)) {
        return
      }
      activeRendererPtys.add(args.id)
    } else if (!activeRendererPtys.delete(args.id)) {
      return
    }
    invalidatePendingPtyDrainPriority(args.id)
  })

  ipcMain.removeAllListeners('pty:setRendererPtyVisible')
  ipcMain.on('pty:setRendererPtyVisible', (_event, args: { id: string; visible: boolean }) => {
    if (typeof args.id !== 'string' || !args.id) {
      return
    }
    // Why: data produced while no renderer can see this PTY must keep that origin through batching, even if the user switches back before the flush lands.
    rendererVisibilityKnownPtys.add(args.id)
    if (args.visible) {
      visibleRendererPtys.add(args.id)
      closeStartupQueryAuthorityForPty(args.id)
    } else {
      visibleRendererPtys.delete(args.id)
    }
    syncPtyBackgroundedDelivery(args.id, 'visibility-report')
  })

  ipcMain.removeAllListeners('pty:setHiddenRendererPty')
  ipcMain.on('pty:setHiddenRendererPty', (_event, args: { id: string; hidden: boolean }) => {
    if (typeof args.id !== 'string' || !args.id) {
      return
    }
    mainDeliveryBreadcrumbs.record(args.hidden === true ? 'gate-mark' : 'gate-unmark', {
      id: redactPtyIdForDiagnostics(args.id)
    })
    const transition = state.transitionHiddenRendererPtyDeliveryState(args.id, args.hidden === true)
    if (args.hidden === true) {
      closeStartupQueryAuthorityForPty(args.id)
      // Why: drop bytes queued for a newly hidden PTY instead of holding them under ACK starvation; reveal restores from the snapshot.
      const pending = pendingData.get(args.id)
      if (pending && transition.droppable) {
        pendingData.delete(args.id)
        if (pending.projectionAdmissionIds) {
          sshOutputIntake?.transferProjections(pending.projectionAdmissionIds, 'hidden-drop')
        }
        updateProducerFlowControl(args.id)
        pendingOverflowMarkedPtys.delete(args.id)
        const drop = recordHiddenRendererPtyDataDrop(args.id, pending.data.length)
        if (drop.shouldEmitRestoreMarker) {
          sendModelRestoreNeededMarker(
            args.id,
            'hidden-drop',
            runtime?.getPtyOutputSequence(args.id)
          )
        }
      }
      if (transition.policyChanged) {
        invalidatePendingPtyDrainPolicy(args.id)
      }
      syncPtyBackgroundedDelivery(args.id, 'gate-mark')
      return
    }
    if (transition.policyChanged) {
      invalidatePendingPtyDrainPolicy(args.id)
    }
    syncPtyBackgroundedDelivery(args.id, 'gate-unmark')
    // Why: a reload/remount may have replaced the view that latched restore-needed, so re-emit on unhide; a redundant replay is cheap/idempotent, a missed restore corrupts the pane.
    if (transition.droppedWhileHidden) {
      sendModelRestoreNeededMarker(args.id, 'unhide', runtime?.getPtyOutputSequence(args.id))
    }
  })

  ipcMain.removeAllListeners('pty:terminalViewAttributes')
}
