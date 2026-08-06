import { containsCsiRendererQuery } from '../../../../shared/terminal-reply-query-extraction'
import type { PtyBufferSnapshot } from './pty-transport'
import type { PtyConnectionDeps } from './pty-connection-types'
import { e2eConfig } from '@/lib/e2e-config'
import { isKnownTuiAgentTerminalStartupCommand } from './terminal-startup-command-classifier'
import type { PtyDataMeta } from './pty-dispatcher'
import type { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import type {
  AgentProviderSessionMetadata,
  ResumableTuiAgent,
  SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'

export type E2eTerminalPtyDataInjectionApi = {
  inject: (paneKey: string, data: string, meta?: PtyDataMeta) => boolean
  keys: () => string[]
}

export type E2eTerminalPtyDataInjectionWindow = Window & {
  __terminalPtyDataInjection?: E2eTerminalPtyDataInjectionApi
  __terminalHiddenSnapshotOverride?: E2eTerminalHiddenSnapshotOverrideApi
}

export const e2eTerminalPtyDataInjectors = new Map<
  string,
  (data: string, meta?: PtyDataMeta) => void
>()

export type E2eTerminalHiddenSnapshotOverrideApi = {
  setPending: (ptyId: string, snapshot: PtyBufferSnapshot) => void
  resolve: (ptyId: string) => void
  clear: (ptyId: string) => void
}

export type E2eTerminalHiddenSnapshotOverride = {
  promise: Promise<PtyBufferSnapshot | null>
  resolve: () => void
}

export const e2eTerminalHiddenSnapshotOverrides = new Map<
  string,
  E2eTerminalHiddenSnapshotOverride
>()

// Why: the per-chunk hidden-skip grammar is deleted (Phase 6) — hidden bytes
// either never reach the renderer (delivery gate) or ride the background
// scheduler queue. Only the mode-2031 fact-reply counter still has a producer.
export type E2eTerminalPtyOutputDebugSnapshot = {
  hiddenRendererSkipCount: number
  hiddenRendererSkippedChars: number
  hiddenRendererMode2031ReplyCount: number
}

export type E2eTerminalPtyOutputDebugApi = {
  reset: () => void
  snapshot: () => E2eTerminalPtyOutputDebugSnapshot
}

export type E2eTerminalPtyOutputDebugWindow = Window & {
  __terminalPtyOutputDebug?: E2eTerminalPtyOutputDebugApi
}

export type PendingStartupCommand = {
  command: string
  env?: Record<string, string>
}

export type FreshSpawnOptions = {
  forceBlankRestoredViewport?: boolean
}

export type ColdRestoreAgentResumeStartup = PendingStartupCommand & {
  agent: ResumableTuiAgent
  resumeProviderSession: AgentProviderSessionMetadata
  launchConfig: NonNullable<ReturnType<typeof buildAgentResumeStartupPlan>>['launchConfig']
  launchToken: string
  useLiveEntry: boolean
  hasSleepingRecord: boolean
  sleepingRecordEntry: { paneKey: string; record: SleepingAgentSessionRecord } | null
}

export const e2eTerminalPtyOutputDebugState: E2eTerminalPtyOutputDebugSnapshot = {
  hiddenRendererSkipCount: 0,
  hiddenRendererSkippedChars: 0,
  hiddenRendererMode2031ReplyCount: 0
}

export function resetE2eTerminalPtyOutputDebug(): void {
  e2eTerminalPtyOutputDebugState.hiddenRendererSkipCount = 0
  e2eTerminalPtyOutputDebugState.hiddenRendererSkippedChars = 0
  e2eTerminalPtyOutputDebugState.hiddenRendererMode2031ReplyCount = 0
}

export function exposeE2eTerminalPtyOutputDebug(): void {
  if (!e2eConfig.exposeStore || typeof window === 'undefined') {
    return
  }
  const target = window as E2eTerminalPtyOutputDebugWindow
  target.__terminalPtyOutputDebug ??= {
    reset: resetE2eTerminalPtyOutputDebug,
    snapshot: () => ({ ...e2eTerminalPtyOutputDebugState })
  }
}

export function recordHiddenRendererSkip(chars: number): void {
  if (!e2eConfig.exposeStore) {
    return
  }
  exposeE2eTerminalPtyOutputDebug()
  e2eTerminalPtyOutputDebugState.hiddenRendererSkipCount += 1
  e2eTerminalPtyOutputDebugState.hiddenRendererSkippedChars += chars
}

export function recordHiddenMode2031Reply(): void {
  if (!e2eConfig.exposeStore) {
    return
  }
  exposeE2eTerminalPtyOutputDebug()
  e2eTerminalPtyOutputDebugState.hiddenRendererMode2031ReplyCount += 1
}

export function exposeE2eTerminalPtyDataInjection(): void {
  if (!e2eConfig.exposeStore || typeof window === 'undefined') {
    return
  }
  // Why: a real PTY can coalesce tiny TUI redraws before E2E sees them. This
  // e2e-only seam lets tests replay the renderer-side data callback exactly.
  const target = window as E2eTerminalPtyDataInjectionWindow
  target.__terminalPtyDataInjection ??= {
    inject: (paneKey, data, meta) => {
      const inject = e2eTerminalPtyDataInjectors.get(paneKey)
      if (!inject) {
        return false
      }
      inject(data, meta)
      return true
    },
    keys: () => [...e2eTerminalPtyDataInjectors.keys()]
  }
  target.__terminalHiddenSnapshotOverride ??= {
    setPending: (ptyId, snapshot) => {
      let resolve = (): void => {}
      const wait = new Promise<void>((nextResolve) => {
        resolve = nextResolve
      })
      e2eTerminalHiddenSnapshotOverrides.set(ptyId, {
        promise: wait.then(() => snapshot),
        resolve
      })
    },
    resolve: (ptyId) => {
      e2eTerminalHiddenSnapshotOverrides.get(ptyId)?.resolve()
    },
    clear: (ptyId) => {
      e2eTerminalHiddenSnapshotOverrides.delete(ptyId)
    }
  }
}

export function registerE2eTerminalPtyDataInjection(
  paneKey: string,
  inject: (data: string, meta?: PtyDataMeta) => void
): () => void {
  if (!e2eConfig.exposeStore) {
    return () => {}
  }
  exposeE2eTerminalPtyDataInjection()
  e2eTerminalPtyDataInjectors.set(paneKey, inject)
  return () => {
    if (e2eTerminalPtyDataInjectors.get(paneKey) === inject) {
      e2eTerminalPtyDataInjectors.delete(paneKey)
    }
  }
}

export function readE2eHiddenSnapshotOverride(
  ptyId: string
): Promise<PtyBufferSnapshot | null> | null {
  if (!e2eConfig.exposeStore) {
    return null
  }
  const override = e2eTerminalHiddenSnapshotOverrides.get(ptyId)
  if (!override) {
    return null
  }
  // Why: visual E2E needs to hold a hidden restore snapshot in flight so a
  // newer live TUI frame can race it deterministically.
  return override.promise.finally(() => {
    if (e2eTerminalHiddenSnapshotOverrides.get(ptyId) === override) {
      e2eTerminalHiddenSnapshotOverrides.delete(ptyId)
    }
  })
}

export function shouldKeepHiddenStartupRendererQueriesLive(
  startup: PtyConnectionDeps['startup']
): boolean {
  return (
    Boolean(startup?.telemetry?.agent_kind && startup.telemetry.agent_kind !== 'other') ||
    isKnownTuiAgentTerminalStartupCommand(startup?.command ?? '')
  )
}

export function containsHiddenStartupRendererQuery(data: string): boolean {
  // Why: hidden Codex startup must not live-render ordinary redraw floods, but
  // query chunks still need xterm's built-in terminal replies to unblock TUIs.
  return containsCsiRendererQuery(data) || data.includes('\x1b]10;?') || data.includes('\x1b]11;?')
}
