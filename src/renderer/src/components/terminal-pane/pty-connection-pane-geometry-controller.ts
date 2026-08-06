import { getClientRuntime } from '../../runtime/client-runtime'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import type { ManagedPaneInternal } from '@/lib/pane-manager/pane-manager-types'
import { requestStablePaneFit } from '@/lib/pane-manager/pane-fit-resize-observer'
import { getFitOverrideForPty } from '@/lib/pane-manager/mobile-fit-overrides'
import { deferTerminalGeometryMutationDuringRebuild } from '@/lib/pane-manager/terminal-scroll-intent-rebuild'
import type { PtyTransport } from './pty-transport'
import type { PtyConnectionDeps } from './pty-connection-types'
import { isRemoteRuntimePtyId } from './pty-connection-routing-policy'
import { shouldClaimRemoteDesktopViewport } from './remote-desktop-viewport-claim'

type TerminalGrid = { cols: number; rows: number }

type PaneGeometryControllerArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  transport: PtyTransport
  isDisposed: () => boolean
  shouldSuppressDesktopResize: () => boolean
  requestPtySizeReassertion: () => void
  resizeTerminalForViewportClaim: (cols: number, rows: number) => void
}

export function createPtyConnectionPaneGeometryController({
  pane,
  deps,
  transport,
  isDisposed,
  shouldSuppressDesktopResize,
  requestPtySizeReassertion,
  resizeTerminalForViewportClaim
}: PaneGeometryControllerArgs) {
  let pendingReportRaf: number | null = null
  let lastObservedDesktopGrid: TerminalGrid | null = null
  let pendingPaneGeometryChanged = false

  const readProposedGrid = (): TerminalGrid | null => {
    try {
      const proposed = pane.fitAddon.proposeDimensions()
      return proposed && proposed.cols > 0 && proposed.rows > 0 ? proposed : null
    } catch {
      return null
    }
  }

  const readPaneSize = (): { width: number; height: number } | null => {
    if (typeof pane.container.getBoundingClientRect !== 'function') {
      return null
    }
    const rect = pane.container.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  }
  let lastObservedPaneSize = readPaneSize()

  const requestStableReassertion = (): void => {
    requestStablePaneFit(pane as ManagedPaneInternal, requestPtySizeReassertion)
  }

  const handleObservedPaneGeometry = (): void => {
    pendingReportRaf = null
    if (isDisposed()) {
      return
    }
    if (
      deferTerminalGeometryMutationDuringRebuild(
        pane.terminal,
        'observed-pane-geometry',
        handleObservedPaneGeometry
      )
    ) {
      return
    }
    const paneGeometryChanged = pendingPaneGeometryChanged
    pendingPaneGeometryChanged = false
    const ptyId = transport.getPtyId()
    if (!ptyId) {
      lastObservedDesktopGrid = readProposedGrid() ?? lastObservedDesktopGrid
      return
    }
    const fitOverride = getFitOverrideForPty(ptyId)
    if (!fitOverride) {
      if (pane.terminal.cols > 0 && pane.terminal.rows > 0) {
        lastObservedDesktopGrid = {
          cols: pane.terminal.cols,
          rows: pane.terminal.rows
        }
      }
      if (!shouldSuppressDesktopResize()) {
        requestStableReassertion()
      }
      return
    }
    const proposed = readProposedGrid()
    if (!proposed) {
      return
    }
    const prior = lastObservedDesktopGrid
    lastObservedDesktopGrid = proposed
    if (fitOverride.mode === 'remote-desktop-fit') {
      if (
        shouldClaimRemoteDesktopViewport({
          holdMode: fitOverride.mode,
          prior,
          current: proposed,
          paneGeometryChanged,
          paneVisible: deps.isVisibleRef.current,
          documentVisible: document.visibilityState !== 'hidden',
          documentFocused: document.hasFocus()
        })
      ) {
        resizeTerminalForViewportClaim(proposed.cols, proposed.rows)
        transport.resize(proposed.cols, proposed.rows, { claim: true })
      }
      return
    }
    if (isRemoteRuntimePtyId(ptyId)) {
      transport.resize(proposed.cols, proposed.rows)
    } else {
      getClientRuntime().terminal.reportGeometry(ptyId, proposed.cols, proposed.rows)
    }
  }

  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          const paneSize = readPaneSize()
          if (
            paneSize &&
            lastObservedPaneSize &&
            (paneSize.width !== lastObservedPaneSize.width ||
              paneSize.height !== lastObservedPaneSize.height)
          ) {
            pendingPaneGeometryChanged = true
          }
          lastObservedPaneSize = paneSize
          if (pendingReportRaf === null) {
            pendingReportRaf = requestAnimationFrame(handleObservedPaneGeometry)
          }
        })
  if (observer && pane.container instanceof Element) {
    observer.observe(pane.container)
  }

  return {
    readProposedGrid,
    dispose() {
      observer?.disconnect()
      if (pendingReportRaf !== null) {
        cancelAnimationFrame(pendingReportRaf)
        pendingReportRaf = null
      }
    }
  }
}
