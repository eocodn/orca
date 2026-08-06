import type { IDisposable } from '@xterm/xterm'
import { useAppStore } from '@/store'
import type { HasPty } from './terminal-dead-session-reconcile'
import { e2eConfig } from '@/lib/e2e-config'
import {
  isAgentTaskCompleteOsNotificationEnabledFromState,
  isAgentTaskCompleteTrackingEnabledFromState
} from './agent-task-complete-policy'
import { PTY_CONNECT_DIAG_LIMIT } from './pty-connection-runtime-state'

export type PanePtyBinding = IDisposable & {
  syncProcessTracking: () => void
  noteVisibilityResume: () => void
  reassertPtySizeAfterWindowWake: () => void
  /** Navigation-free hibernation wake: fires the armed cold-restore --resume
   *  without the size-reassert/foreground-sample side effects of a real reveal.
   *  Used by the mobile wake fanout so a hidden hibernated pane resumes with no
   *  desktop hidden→visible transition. Returns the sleeping record's provider
   *  session claim key when this pane started (or latched) the in-place wake,
   *  so the follow-up generic resume never launches the same session twice. */
  wakeHibernatedAgentIfArmed: (claimedProviderSessions?: Set<string>) => string | null
  /** Re-sample process identity when the pane gains intra-tab focus: the tab
   *  icon follows the active leaf, and a shell-marked entry on a still-running
   *  agent pane has no OSC boundary left to correct it. */
  sampleForegroundAgentOnFocus: () => void
  /** Reconfirm after direct shortcut input, which bypasses PTY onData. */
  requestDroidReconfirmation: () => void
  reconcileIfSessionDead: (liveSessionIds: Set<string>, snapshotRequestedAt?: number) => void
  reconcileIfSessionMissing: (hasPty: HasPty, livenessRequestedAt?: number) => void
}

export function isAgentTaskCompleteNotificationEnabled(): boolean {
  return isAgentTaskCompleteOsNotificationEnabledFromState(useAppStore.getState())
}

export function isAgentTaskCompleteTrackingEnabled(): boolean {
  return isAgentTaskCompleteTrackingEnabledFromState(useAppStore.getState())
}

export const agentTaskCompleteTrackingEnabledListeners = new Set<() => void>()
export let agentTaskCompleteTrackingSettingsUnsubscribe: (() => void) | null = null
export let agentTaskCompleteTrackingSettingsSnapshot: string | null = null

export function getAgentTaskCompleteTrackingSettingsSnapshot(
  state: ReturnType<typeof useAppStore.getState>
): string {
  return `${isAgentTaskCompleteTrackingEnabledFromState(state)}:${isAgentTaskCompleteOsNotificationEnabledFromState(state)}`
}

export function subscribeAgentTaskCompleteTrackingEnabled(listener: () => void): () => void {
  if (agentTaskCompleteTrackingSettingsUnsubscribe === null) {
    agentTaskCompleteTrackingSettingsSnapshot = getAgentTaskCompleteTrackingSettingsSnapshot(
      useAppStore.getState()
    )
    agentTaskCompleteTrackingSettingsUnsubscribe = useAppStore.subscribe((state) => {
      const snapshot = getAgentTaskCompleteTrackingSettingsSnapshot(state)
      if (snapshot === agentTaskCompleteTrackingSettingsSnapshot) {
        return
      }
      agentTaskCompleteTrackingSettingsSnapshot = snapshot
      for (const subscriber of Array.from(agentTaskCompleteTrackingEnabledListeners)) {
        subscriber()
      }
    })
  }

  agentTaskCompleteTrackingEnabledListeners.add(listener)
  return () => {
    agentTaskCompleteTrackingEnabledListeners.delete(listener)
    if (
      agentTaskCompleteTrackingEnabledListeners.size === 0 &&
      agentTaskCompleteTrackingSettingsUnsubscribe !== null
    ) {
      agentTaskCompleteTrackingSettingsUnsubscribe()
      agentTaskCompleteTrackingSettingsUnsubscribe = null
      agentTaskCompleteTrackingSettingsSnapshot = null
    }
  }
}

export function recordPtyConnectDiagnostic(message: string): void {
  if (!e2eConfig.exposeStore) {
    return
  }
  console.log(`[pty-connect] ${message}`)
  const target = globalThis as Record<string, unknown>
  const diag = (target.__ptyConnectDiag ??= [] as string[]) as string[]
  diag.push(message)
  if (diag.length > PTY_CONNECT_DIAG_LIMIT) {
    diag.splice(0, diag.length - PTY_CONNECT_DIAG_LIMIT)
  }
}
