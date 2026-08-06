import { getClientRuntime } from '../../runtime/client-runtime'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { safeFit } from '@/lib/pane-manager/pane-tree-ops'
import { getFitOverrideForPty } from '@/lib/pane-manager/mobile-fit-overrides'
import { isPtyLocked } from '@/lib/pane-manager/mobile-driver-state'
import type { PtyTransport } from './pty-transport'
import { isRemoteRuntimePtyId } from './pty-connection-routing-policy'
import { reconcilePtySizeAcrossFrames, type PtySizeReconcileHandle } from './pty-size-reconcile'

type SpawnSizeReconcileControllerArgs = {
  pane: ManagedPane
  transport: PtyTransport
  isDisposed: () => boolean
  isRendererResizeAuthoritative: () => boolean
  shouldSuppressDesktopResize: () => boolean
}

export function createPtyConnectionSpawnSizeReconcileController({
  pane,
  transport,
  isDisposed,
  isRendererResizeAuthoritative,
  shouldSuppressDesktopResize
}: SpawnSizeReconcileControllerArgs) {
  let handle: PtySizeReconcileHandle | null = null

  const reconcileAfterSpawn = (ptyId: string, spawnCols: number, spawnRows: number): void => {
    handle?.cancel()
    handle = reconcilePtySizeAcrossFrames({
      spawnCols,
      spawnRows,
      isAlive: () => !isDisposed() && transport.getPtyId() === ptyId,
      // Why: mobile ownership parks the PTY at an intentionally different grid.
      isParked: () => Boolean(getFitOverrideForPty(ptyId)) || isPtyLocked(ptyId),
      isAuthoritative: isRendererResizeAuthoritative,
      measure: () => {
        if (!safeFit(pane)) {
          return null
        }
        const cols = pane.terminal.cols
        const rows = pane.terminal.rows
        return cols > 0 && rows > 0 ? { cols, rows } : null
      },
      resize: (cols, rows) => {
        if (!shouldSuppressDesktopResize()) {
          transport.resize(cols, rows)
        }
      },
      // Why: local/SSH resize is fire-and-forget; confirm the provider applied it.
      getAppliedSize: isRemoteRuntimePtyId(ptyId)
        ? undefined
        : () => getClientRuntime().terminal.getSize(ptyId),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (frame) => {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(frame)
        }
      }
    })
  }

  return {
    reconcileAfterSpawn,
    dispose() {
      handle?.cancel()
      handle = null
    }
  }
}
