import { ipcMain } from 'electron'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import type { PtyRendererDeliveryDebugSnapshot } from './pty-ipc-runtime-renderer-lifecycle-state'
import { tryGetProviderForPty } from './pty-ipc-runtime-provider-routing'
import {
  getPtyRendererDeliveryDebugSnapshot,
  resetPtyRendererDeliveryDebug,
  installPowerSignalBreadcrumbs
} from './pty-ipc-runtime-renderer-lifecycle-state'

export function installPtySnapshotHandlers(
  state: PtyRendererDeliveryContext & Record<string, any>
): void {
  const { runtime, providerSnapshotRequiredPtys, pendingData } = state
  function normalizeSnapshotScrollbackRows(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    return Math.max(0, Math.min(50_000, Math.floor(value)))
  }
  ipcMain.handle(
    'pty:getMainBufferSnapshot',
    async (
      _event,
      args: { id?: unknown; opts?: { scrollbackRows?: unknown } }
    ): Promise<{
      data: string
      cols: number
      rows: number
      cwd?: string | null
      lastTitle?: string
      seq?: number
      pendingDeliveryStartSeq?: number
      source?: 'headless' | 'renderer'
      alternateScreen?: boolean
      scrollbackAnsi?: string
      pendingEscapeTailAnsi?: string
    } | null> => {
      if (!runtime || typeof args?.id !== 'string' || args.id.length === 0) {
        return null
      }
      const scrollbackRows = normalizeSnapshotScrollbackRows(args.opts?.scrollbackRows)
      try {
        const runtimeSeqBeforeSnapshot = runtime.getPtyOutputSequence(args.id)
        const providerSnapshotRequired = providerSnapshotRequiredPtys.has(args.id)
        const providerSnapshot = providerSnapshotRequired
          ? await tryGetProviderForPty(args.id)?.getBufferSnapshot?.(args.id, {
              scrollbackRows
            })
          : null
        // Why: after a data gap main holds only the retained tail; returning it as a full snapshot would erase older scrollback.
        if (providerSnapshotRequired && !providerSnapshot) {
          return null
        }
        const snapshot =
          providerSnapshot ??
          (await runtime.serializeHiddenOutputRecoveryBuffer(args.id, {
            scrollbackRows
          }))
        if (!snapshot || typeof snapshot.seq !== 'number') {
          return snapshot
        }
        // Why: the renderer's post-restore dedupe needs this pending-queue bound, or a stale baseline swallows new chunks whose seq sits below the snapshot counter.
        const pending = pendingData.get(args.id)
        if (pending && typeof pending.startSeq !== 'number') {
          // Why: a seq-less backlog cannot be bounded — stay conservative.
          return snapshot
        }
        return {
          ...snapshot,
          pendingDeliveryStartSeq: Math.min(
            pending?.startSeq ?? (providerSnapshot ? runtimeSeqBeforeSnapshot : snapshot.seq),
            snapshot.seq
          )
        }
      } catch {
        return null
      }
    }
  )

  // Why: main owns side effects, so this replay restores title state only — never historical bells/completions (no-attention-replay rule, terminal-side-effect-authority.md).
  ipcMain.handle('pty:sideEffectSnapshot', (_event, args: { id: string }) => {
    if (!runtime || typeof args?.id !== 'string' || args.id.length === 0) {
      return null
    }
    return runtime.getTerminalSideEffectSnapshot(args.id)
  })

  installPowerSignalBreadcrumbs()
  ipcMain.handle('pty:getRendererDeliveryDebugSnapshot', (): PtyRendererDeliveryDebugSnapshot => {
    return getPtyRendererDeliveryDebugSnapshot()
  })
  ipcMain.handle('pty:resetRendererDeliveryDebug', (): void => {
    resetPtyRendererDeliveryDebug()
  })
}
