import type { RuntimePtyController } from '../runtime/orca-runtime-context-2'
import type { PtyRendererDeliveryContext, PtyShutdownObservation } from './pty-ipc-runtime-renderer-delivery-context'
import type { IPtyProvider } from '../providers/types'
import { createPtySpawnHandler } from './pty-ipc-runtime-controller-spawn-execution'
import { parseAppSshPtyId } from '../providers/ssh-pty-id'
import { delay, verifyPtyStopped } from './pty-ipc-runtime-shutdown-state'
import { inspectPtyProviderProcess } from '../providers/pty-process-inspection'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function createPtyController(state: PtyRendererDeliveryContext & Record<string, any>): RuntimePtyController {
  const {
    mainWindow, runtime, store, sshProviders, ptyOwnership, ptyIncarnationById, ptySizes, pendingPtySizes,
    getLocalPtyProviderStartupPromise, getProviderForPty, getProvider, shutdownProviderAndDetectExit,
    finishPtyShutdown, rememberSyntheticKillExit, sendPtyExitToRenderer, reversibleStopOwnersByPtyId,
    isPtyAlreadyGoneError, capturePtyShutdownTarget, isPtyShutdownTargetCurrent,
    requestSerializedBuffer, rendererSerializerReadiness
  } = state

  return {
    spawn: createPtySpawnHandler(state),
    write: (ptyId, data) => {
    try {
      getProviderForPty(ptyId).write(ptyId, data)
      return true
    } catch {
      return false
    }
    },
    kill: (ptyId) => {
    let connectionId: string | null | undefined = ptyOwnership.get(ptyId)
    const parsedSshId = connectionId === undefined ? parseAppSshPtyId(ptyId) : null
    connectionId ??= parsedSshId?.connectionId
    const expectedTarget = capturePtyShutdownTarget(ptyId)
    const killWithCurrentProvider = (): boolean => {
      if (!isPtyShutdownTargetCurrent(ptyId, expectedTarget)) {
        return false
      }
      let provider: IPtyProvider
      try {
        provider = connectionId ? getProvider(connectionId) : getProviderForPty(ptyId)
      } catch {
        if (connectionId) {
          // Why: runtime/CLI close can target a detached SSH PTY after its
          // provider was unregistered. Tombstone the lease so reconnect does
          // not revive a terminal the user explicitly closed.
          const finished = finishPtyShutdown(ptyId, connectionId, store, expectedTarget)
          if (!finished) {
            return false
          }
          runtime?.onPtyExit(ptyId, -1, finished.incarnationId)
          rememberSyntheticKillExit(ptyId, expectedTarget)
          sendPtyExitToRenderer({ id: ptyId, code: -1 })
          return true
        }
        return false
      }
      // Why: controller is synchronous, but keep ownership until async shutdown proves whether the provider emitted an exit.
      void shutdownProviderAndDetectExit(provider, ptyId, { immediate: false })
        .then((observation) => {
          const finished = finishPtyShutdown(ptyId, connectionId, store, expectedTarget)
          if (!finished) {
            return
          }
          if (observation.identityLessExitPayload) {
            runtime?.onPtyExit(ptyId, observation.identityLessExitPayload.code, undefined, {
              authoritativeIdentityLess: true,
              ...(finished.incarnationId ? { expectedIncarnationId: finished.incarnationId } : {})
            })
            sendPtyExitToRenderer(observation.identityLessExitPayload)
          } else if (!observation.providerExitObserved) {
            runtime?.onPtyExit(ptyId, -1, finished.incarnationId)
            rememberSyntheticKillExit(ptyId, expectedTarget)
            sendPtyExitToRenderer({ id: ptyId, code: -1 })
          }
        })
        .catch((err) => {
          if (isPtyAlreadyGoneError(err)) {
            const finished = finishPtyShutdown(ptyId, connectionId, store, expectedTarget)
            if (!finished) {
              return
            }
            runtime?.onPtyExit(ptyId, -1, finished.incarnationId)
            rememberSyntheticKillExit(ptyId, expectedTarget)
            sendPtyExitToRenderer({ id: ptyId, code: -1 })
            return
          }
          if (!isPtyShutdownTargetCurrent(ptyId, expectedTarget)) {
            return
          }
          console.warn(
            `[pty] Failed to stop PTY ${ptyId}: ${err instanceof Error ? err.message : String(err)}`
          )
          // Why: close runtime tails without clearing provider ownership, so
          // a retry can still target a PTY that survived the failed shutdown.
          runtime?.onPtyExit(ptyId, -1, ptyIncarnationById.get(ptyId))
        })
      return true
    }
    const startupPromise = getLocalPtyProviderStartupPromise(connectionId)
    if (startupPromise) {
      // Why: select the provider after the daemon swap; the fallback first can report success while orphaning a daemon PTY.
      void startupPromise.then(killWithCurrentProvider).catch((err) => {
        console.warn(
          `[pty] Failed to stop PTY ${ptyId}: ${err instanceof Error ? err.message : String(err)}`
        )
      })
      return true
    }
    return killWithCurrentProvider()
    },
    markReversibleStops: (ptyIds) => {
    for (const ptyId of ptyIds) {
      reversibleStopOwnersByPtyId.set(ptyId, (reversibleStopOwnersByPtyId.get(ptyId) ?? 0) + 1)
    }
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      for (const ptyId of ptyIds) {
        const owners = (reversibleStopOwnersByPtyId.get(ptyId) ?? 0) - 1
        if (owners > 0) {
          reversibleStopOwnersByPtyId.set(ptyId, owners)
        } else {
          reversibleStopOwnersByPtyId.delete(ptyId)
        }
      }
    }
    },
    stopAndWait: async (ptyId, opts) => {
    let connectionId: string | null | undefined = ptyOwnership.get(ptyId)
    const parsedSshId = connectionId === undefined ? parseAppSshPtyId(ptyId) : null
    connectionId ??= parsedSshId?.connectionId
    const expectedTarget = capturePtyShutdownTarget(ptyId)
    // Why: destructive teardown threads one absolute deadline through every await
    // below; each RPC leaf converts it to the remaining time when it issues, so
    // sequential RPCs share the budget and cannot overrun the sweep deadline.
    const deadlineMs = opts?.deadlineMs
    const startupPromise = getLocalPtyProviderStartupPromise(connectionId)
    if (startupPromise) {
      // Why: exact-stop must resolve the provider after daemon startup just
      // like renderer kills, or the fallback can falsely confirm teardown.
      if (deadlineMs !== undefined) {
        // Why: bound the cold-start await by the teardown deadline instead of the
        // 60s startup fail-open cap; fail closed so the sweep records the miss.
        const won = await Promise.race([
          // Why: () => false on rejection both fails closed on a startup error and
          // keeps the losing branch's rejection from surfacing as unhandled.
          startupPromise.then(
            () => true,
            () => false
          ),
          delay(Math.max(1, deadlineMs - Date.now())).then(() => false)
        ])
        if (!won) {
          return false
        }
      } else {
        await startupPromise
      }
      if (!isPtyShutdownTargetCurrent(ptyId, expectedTarget)) {
        return false
      }
    }
    let provider: IPtyProvider
    try {
      provider = connectionId ? getProvider(connectionId) : getProviderForPty(ptyId)
    } catch {
      if (connectionId) {
        // Why: an absent SSH provider means there is no live target left to
        // await, but the relay lease must still be tombstoned.
        const finished = finishPtyShutdown(ptyId, connectionId, store, expectedTarget)
        if (!finished) {
          return false
        }
        runtime?.onPtyExit(ptyId, -1, finished.incarnationId)
        rememberSyntheticKillExit(ptyId, expectedTarget)
        sendPtyExitToRenderer({ id: ptyId, code: -1 })
        return true
      }
      return false
    }
    let observation: PtyShutdownObservation = { providerExitObserved: false }
    try {
      observation = await shutdownProviderAndDetectExit(provider, ptyId, {
        immediate: true,
        keepHistory: opts?.keepHistory ?? false,
        deadlineMs
      })
    } catch (err) {
      if (!isPtyAlreadyGoneError(err)) {
        console.warn(
          `[pty] Failed to stop PTY ${ptyId}: ${err instanceof Error ? err.message : String(err)}`
        )
        return false
      }
    }
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      return false
    }
    try {
      if (!(await verifyPtyStopped(provider, ptyId, opts))) {
        return false
      }
    } catch (err) {
      console.warn(
        `[pty] Failed to verify PTY ${ptyId} stopped: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
      return false
    }
    if (observation.providerExitObserved && !isPtyShutdownTargetCurrent(ptyId, expectedTarget)) {
      return true
    }
    const finished = finishPtyShutdown(ptyId, connectionId, store, expectedTarget)
    if (!finished) {
      return false
    }
    if (observation.identityLessExitPayload) {
      runtime?.onPtyExit(ptyId, observation.identityLessExitPayload.code, undefined, {
        authoritativeIdentityLess: true,
        ...(finished.incarnationId ? { expectedIncarnationId: finished.incarnationId } : {})
      })
      sendPtyExitToRenderer(observation.identityLessExitPayload)
    } else if (!observation.providerExitObserved) {
      runtime?.onPtyExit(ptyId, -1, finished.incarnationId)
      rememberSyntheticKillExit(ptyId, expectedTarget)
      sendPtyExitToRenderer({ id: ptyId, code: -1 })
    }
    return true
    },
    getForegroundProcess: async (ptyId) => {
    try {
      return await getProviderForPty(ptyId).getForegroundProcess(ptyId)
    } catch {
      return null
    }
    },
    inspectProcess: async (ptyId) => inspectPtyProviderProcess(getProviderForPty(ptyId), ptyId),
    confirmForegroundProcess: async (ptyId) => {
    try {
      const provider = getProviderForPty(ptyId)
      // Why: cached foreground evidence cannot resolve a fresh shell conflict.
      return (await provider.confirmForegroundProcess?.(ptyId)) ?? null
    } catch {
      return null
    }
    },
    getCwd: async (ptyId) => {
    try {
      const cwd = await getProviderForPty(ptyId).getCwd(ptyId)
      return cwd || null
    } catch {
      return null
    }
    },
    hasChildProcesses: async (ptyId) => {
    try {
      return await getProviderForPty(ptyId).hasChildProcesses(ptyId)
    } catch {
      return false
    }
    },
    clearBuffer: async (ptyId) => {
    // Why: desktop xterm and daemon/SSH providers hold separate buffers; clear both so mobile resubscribe can't resurrect cleared history.
    state.clearPendingPtyDataForPty(ptyId)
    mainWindow.webContents.send('pty:clearBuffer:request', { ptyId })
    try {
      await getProviderForPty(ptyId).clearBuffer(ptyId)
    } catch {
      /* best effort: renderer clear still handles local PTYs */
    }
    },
    hasPty: (ptyId) => {
    try {
      return getProviderForPty(ptyId).hasPty?.(ptyId) ?? null
    } catch {
      return null
    }
    },
    listProcesses: async (connectionId) => {
    if (connectionId === null) {
      return ptyRuntimeState.localProvider.listProcesses()
    }
    if (connectionId !== undefined) {
      return getProvider(connectionId).listProcesses()
    }
    const providerSessions = await Promise.all([
      ptyRuntimeState.localProvider.listProcesses(),
      ...Array.from((sshProviders as Map<string, IPtyProvider>).values(), (provider) => provider.listProcesses())
    ])
    return providerSessions.flat()
    },
    serializeBuffer: (ptyId, opts) => {
    // Why: mobile xterm must start from the desktop's exact screen state/dimensions before live TUI chunks render correctly.
    return requestSerializedBuffer(ptyId, opts)
    },
    serializeProviderBuffer: async (ptyId, opts) => {
    try {
      // Why: restored daemon PTYs can be live while their desktop pane is unmounted; query the provider model so phone-local navigation works.
      return (await getProviderForPty(ptyId).getBufferSnapshot?.(ptyId, opts)) ?? null
    } catch {
      return null
    }
    },
    hasRendererSerializer: (ptyId) => {
    // Why: a synchronous probe lets the runtime decide whether to skip the daemon-snapshot seed (renderer will hydrate) or run it (no renderer authoritative).
    return rendererSerializerReadiness.has(ptyId)
    },
    getRendererSerializerGeneration: (ptyId) => {
    return rendererSerializerReadiness.generation(ptyId)
    },
    waitForRendererSerializer: (ptyId, afterGeneration, timeoutMs, signal) => {
    return rendererSerializerReadiness.wait(ptyId, afterGeneration, timeoutMs, signal)
    },
    getSize: (ptyId) => ptySizes.get(ptyId) ?? null,
    getProvisionalSize: (ptyId) => pendingPtySizes.get(ptyId) ?? null,
    getAppliedSize: async (ptyId) =>
    (await getProviderForPty(ptyId).getAppliedSize?.(ptyId)) ?? null,
    resize: (ptyId, cols, rows) => {
    try {
      getProviderForPty(ptyId).resize(ptyId, cols, rows)
      ptySizes.set(ptyId, { cols, rows })
      return true
    } catch {
      return false
    }
    },
    resizeIfCurrent: async (ptyId, expectedIncarnationId, cols, rows) => {
    const provider = getProviderForPty(ptyId)
    if (!provider.resizeIfCurrent) {
      return false
    }
    const applied = await provider.resizeIfCurrent(ptyId, expectedIncarnationId, cols, rows)
    if (applied) {
      ptySizes.set(ptyId, { cols, rows })
    }
    return applied
    }
  }
}
