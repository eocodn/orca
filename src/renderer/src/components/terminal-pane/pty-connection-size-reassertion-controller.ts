import { getClientRuntime } from '../../runtime/client-runtime'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import type { ManagedPaneInternal } from '@/lib/pane-manager/pane-manager-types'
import { safeFitAndThen } from '@/lib/pane-manager/pane-tree-ops'
import { requestStablePaneFit } from '@/lib/pane-manager/pane-fit-resize-observer'
import type { PtyTransport } from './pty-transport'
import type { PtyConnectionDeps } from './pty-connection-types'
import { isRemoteRuntimePtyId } from './pty-connection-routing-policy'
import { getAppliedSizeReadE2eDelayMs } from './pty-applied-size-read-e2e-delay'
import { createPtySizeReassertion } from './pty-size-reassertion'
import { FOREGROUND_GRID_DRIFT_CHECK_MIN_MS } from './pty-connection-runtime-state'

type TerminalGrid = { cols: number; rows: number }

type SizeReassertionControllerArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  transport: PtyTransport
  isDisposed: () => boolean
  shouldSuppressDesktopResize: () => boolean
  forwardResize: (cols: number, rows: number) => void
  readProposedGrid: () => TerminalGrid | null
}

export function createPtyConnectionSizeReassertionController({
  pane,
  deps,
  transport,
  isDisposed,
  shouldSuppressDesktopResize,
  forwardResize,
  readProposedGrid
}: SizeReassertionControllerArgs) {
  let pendingDriftCheckRaf: number | null = null
  let lastDriftCheckAt = Number.NEGATIVE_INFINITY

  const reassertion = createPtySizeReassertion({
    isDisposed,
    getPtyId: () => transport.getPtyId(),
    isRemotePtyId: isRemoteRuntimePtyId,
    shouldSuppressDesktopResize,
    fitAndRun: (continuation) => safeFitAndThen(pane, 'pty-size-reassertion', continuation),
    getTerminalDimensions: () => ({ cols: pane.terminal.cols, rows: pane.terminal.rows }),
    getAppliedSize: async (ptyId) => {
      const delayMs = getAppliedSizeReadE2eDelayMs()
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      return getClientRuntime().terminal.getSize(ptyId)
    },
    forwardResize
  })

  const request = (): void => {
    reassertion.request({ fit: false })
  }

  const terminalGridDriftedFromFit = (): boolean => {
    const proposed = readProposedGrid()
    return Boolean(
      proposed && (pane.terminal.cols !== proposed.cols || pane.terminal.rows !== proposed.rows)
    )
  }

  const scheduleForegroundGridDriftCheck = (): void => {
    if (
      isDisposed() ||
      !deps.isVisibleRef.current ||
      shouldSuppressDesktopResize() ||
      pendingDriftCheckRaf !== null
    ) {
      return
    }
    const now = performance.now()
    if (now - lastDriftCheckAt < FOREGROUND_GRID_DRIFT_CHECK_MIN_MS) {
      return
    }
    lastDriftCheckAt = now
    pendingDriftCheckRaf = requestAnimationFrame(() => {
      pendingDriftCheckRaf = null
      if (
        isDisposed() ||
        !deps.isVisibleRef.current ||
        shouldSuppressDesktopResize() ||
        !terminalGridDriftedFromFit()
      ) {
        return
      }
      // Why: cell metrics can settle after the pane box stops resizing.
      requestStablePaneFit(pane as ManagedPaneInternal, request)
    })
  }

  return {
    request,
    scheduleForegroundGridDriftCheck,
    dispose() {
      reassertion.dispose()
      if (pendingDriftCheckRaf !== null) {
        cancelAnimationFrame(pendingDriftCheckRaf)
        pendingDriftCheckRaf = null
      }
    }
  }
}
