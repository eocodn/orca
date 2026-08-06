import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { getFitOverrideForPty, onOverrideChange } from '@/lib/pane-manager/mobile-fit-overrides'
import type { PtyTransport } from './pty-transport'
import type { PtyConnectionDeps } from './pty-connection-types'
import { isRemoteRuntimePtyId } from './pty-connection-routing-policy'

type RemoteViewportClaimControllerArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  getTransport: () => PtyTransport
}

export function createPtyConnectionRemoteViewportClaimController({
  pane,
  deps,
  getTransport
}: RemoteViewportClaimControllerArgs) {
  let claimedPtyId: string | null = null
  let pending = false

  const claimForUserActivity = (): void => {
    const transport = getTransport()
    const ptyId = transport.getPtyId()
    if (!ptyId || getFitOverrideForPty(ptyId)?.mode !== 'remote-desktop-fit') {
      return
    }
    let proposed: { cols: number; rows: number } | undefined
    try {
      proposed = pane.fitAddon.proposeDimensions()
    } catch {
      proposed = undefined
    }
    const cols = proposed?.cols ?? pane.terminal.cols
    const rows = proposed?.rows ?? pane.terminal.rows
    if (cols > 0 && rows > 0) {
      // Why: retain the hold until the runtime confirms desktop-fit.
      transport.claimViewport?.(cols, rows)
    }
  }

  const claimPending = (): void => {
    if (
      !pending ||
      !deps.isVisibleRef.current ||
      typeof document === 'undefined' ||
      document.visibilityState === 'hidden' ||
      typeof document.hasFocus !== 'function' ||
      !document.hasFocus()
    ) {
      return
    }
    claimForUserActivity()
  }

  const armCurrent = (): void => {
    const ptyId = getTransport().getPtyId()
    if (!ptyId || !isRemoteRuntimePtyId(ptyId)) {
      claimedPtyId = null
      pending = false
      return
    }
    if (
      claimedPtyId !== ptyId ||
      pending ||
      getFitOverrideForPty(ptyId)?.mode === 'remote-desktop-fit'
    ) {
      claimedPtyId = ptyId
      pending = true
    }
  }

  const unsubscribe = onOverrideChange((event) => {
    const ptyId = getTransport().getPtyId()
    if (event.ptyId !== ptyId || !isRemoteRuntimePtyId(event.ptyId)) {
      return
    }
    if (event.mode === 'desktop-fit') {
      claimedPtyId = event.ptyId
      pending = false
      return
    }
    if (event.mode === 'remote-desktop-fit') {
      if (deps.isVisibleRef.current && claimedPtyId !== event.ptyId) {
        claimedPtyId = event.ptyId
        pending = true
      }
      claimPending()
    }
  })

  return {
    armForPaneBinding(ptyId: string) {
      if (deps.isVisibleRef.current && isRemoteRuntimePtyId(ptyId) && claimedPtyId !== ptyId) {
        // Why: initial fit consumes this arm before later peer ownership changes.
        claimedPtyId = ptyId
        pending = true
      }
    },
    claimForUserActivity,
    claimPending,
    armCurrent,
    clearPending() {
      pending = false
    },
    clear() {
      claimedPtyId = null
      pending = false
    },
    dispose: unsubscribe
  }
}
