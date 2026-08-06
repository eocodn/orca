import { getClientRuntime } from '../../runtime/client-runtime'
import { blocksCodexPaneInput } from '../codex-restart-notice-state'
import { useAppStore } from '@/store'
import { TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { isDocumentVisibilityProvenStale } from './stale-document-visibility'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import {
  CURSOR_HIDE_SEQUENCE,
  CURSOR_SHOW_SEQUENCE,
  FOREGROUND_BUDGET_WINDOW_MS,
  INACTIVE_FOREGROUND_IMMEDIATE_BUDGET_CHARS,
  REMOTE_PTY_ID_PREFIX,
  SSH_SESSION_EXPIRED_ERROR,
  SYNCHRONIZED_OUTPUT_END_SEQUENCE,
  SYNCHRONIZED_OUTPUT_START_SEQUENCE
} from './pty-connection-runtime-state'

export let codexRestartNoticePresenceSource: Record<
  string,
  { previousAccountLabel: string; nextAccountLabel: string }
> | null = null
export let codexRestartNoticePresence = false
export let inactiveForegroundImmediateBudgetChars = 0
export let inactiveForegroundImmediateBudgetWindowStart = 0

export type SshConnectResult = { connected: true } | { connected: false; error: string }
export type UserInitiatedSshConnectOutcome = 'connected' | 'cancelled' | 'failed'

export const sshConnectPromises = new Map<string, Promise<SshConnectResult>>()

export function isSshSessionExpiredError(err: unknown): boolean {
  return (err instanceof Error ? err.message : String(err)).includes(SSH_SESSION_EXPIRED_ERROR)
}

export function isRemoteRuntimePtyId(ptyId: string | null | undefined): boolean {
  return typeof ptyId === 'string' && ptyId.startsWith(REMOTE_PTY_ID_PREFIX)
}

export function canRestorePairedParkedTerminal(ptyId: string): boolean {
  const environmentId = getRemoteRuntimePtyEnvironmentId(ptyId)
  return (
    environmentId !== null &&
    useAppStore
      .getState()
      .runtimeStatusByEnvironmentId.get(environmentId)
      ?.status?.capabilities?.includes(TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY) === true
  )
}

export function consumeInactiveForegroundImmediateBudget(dataLength: number): boolean {
  const now = performance.now()
  if (now - inactiveForegroundImmediateBudgetWindowStart > FOREGROUND_BUDGET_WINDOW_MS) {
    inactiveForegroundImmediateBudgetChars = 0
    inactiveForegroundImmediateBudgetWindowStart = now
  }
  if (
    inactiveForegroundImmediateBudgetChars + dataLength >
    INACTIVE_FOREGROUND_IMMEDIATE_BUDGET_CHARS
  ) {
    return false
  }
  inactiveForegroundImmediateBudgetChars += dataLength
  return true
}

export function hasCodexRestartNotices(
  noticesByPtyId: Record<string, { previousAccountLabel: string; nextAccountLabel: string }>
): boolean {
  if (codexRestartNoticePresenceSource !== noticesByPtyId) {
    codexRestartNoticePresenceSource = noticesByPtyId
    codexRestartNoticePresence = Object.keys(noticesByPtyId).length > 0
  }
  return codexRestartNoticePresence
}

export function sshPromptConnectOutcomeForStatus(
  status: string | undefined,
  sawNonDisconnected: boolean
): UserInitiatedSshConnectOutcome | null {
  if (status === 'connected') {
    return 'connected'
  }
  if (status === 'auth-failed' || status === 'error' || status === 'reconnection-failed') {
    return 'failed'
  }
  // Why: this only counts after a real connect attempt; the entry-time
  // disconnected state just means the user still needs to initiate auth.
  if (sawNonDisconnected && status === 'disconnected') {
    return 'cancelled'
  }
  return null
}

export async function waitForSshConnection(connectionId: string): Promise<SshConnectResult> {
  const state = useAppStore.getState().sshConnectionStates.get(connectionId)
  if (state?.status === 'connected') {
    return { connected: true }
  }

  const existing = sshConnectPromises.get(connectionId)
  if (existing) {
    return existing
  }

  const promise: Promise<SshConnectResult> = (async (): Promise<SshConnectResult> => {
    try {
      await getClientRuntime().ssh.connect({ targetId: connectionId })
      return { connected: true }
    } catch (err) {
      console.warn(`Deferred SSH reconnect failed for ${connectionId}:`, err)
      return {
        connected: false,
        error: err instanceof Error ? err.message : String(err)
      }
    } finally {
      sshConnectPromises.delete(connectionId)
    }
  })()

  sshConnectPromises.set(connectionId, promise)
  return promise
}

export function isCodexPaneStale(args: {
  tabId: string
  worktreeId: string
  panePtyId: string | null
}): boolean {
  const state = useAppStore.getState()
  const { codexRestartNoticeByPtyId } = state
  if (!hasCodexRestartNotices(codexRestartNoticeByPtyId)) {
    return false
  }
  // Why: a bound pane's own record is the last word — its ptyId is exactly the
  // shell its keystrokes reach. `tab.ptyId` holds one sibling's id, not this
  // pane's, so in a split tab consulting it would kill this pane's keyboard over
  // that sibling's notice, with no prompt on screen once the sibling is answered.
  if (args.panePtyId) {
    return blocksCodexPaneInput(codexRestartNoticeByPtyId[args.panePtyId])
  }

  // Why: only an unbound pane needs the tab's persisted id. Both transports
  // refuse writes while their pty binding is null, so a keystroke here arms
  // recovery — a coarser signal than a bound pane's own record, but the tab's id
  // is the only evidence available of which shell this pane is about to own.
  const tab = (state.tabsByWorktree[args.worktreeId] ?? []).find((entry) => entry.id === args.tabId)
  if (tab?.ptyId && blocksCodexPaneInput(codexRestartNoticeByPtyId[tab.ptyId])) {
    return true
  }

  return false
}

// Why: daemon session IDs use the format `${worktreeId}@@${shortUuid}`.
// This validates that a session ID actually belongs to the given worktree,
// preventing cross-workspace contamination during restore.
export function isSessionOwnedByWorktree(sessionId: string, worktreeId: string): boolean {
  const separatorIdx = sessionId.lastIndexOf('@@')
  if (separatorIdx === -1) {
    return true
  }
  return sessionId.slice(0, separatorIdx) === worktreeId
}

export function shouldWritePtyOutputForeground(isPaneVisible: boolean): boolean {
  if (!isPaneVisible) {
    return false
  }
  if (typeof document === 'undefined') {
    return true
  }
  // Why: Electron can keep visible panes mounted while the whole app is
  // backgrounded. Treat hidden documents like background tabs so Chromium
  // timer throttling cannot pin terminal writes on the renderer foreground path.
  if (document.visibilityState === 'visible') {
    return true
  }
  // Why: macOS occlusion tracking can wedge visibilityState at 'hidden' after
  // display sleep; proven-stale means real user input contradicted it, so the
  // hidden-delivery gate must not keep dropping a watched pane's bytes.
  return isDocumentVisibilityProvenStale()
}

export function containsSynchronizedOutputStart(data: string): boolean {
  return data.includes(SYNCHRONIZED_OUTPUT_START_SEQUENCE)
}

export function containsSynchronizedOutputEnd(data: string): boolean {
  return data.includes(SYNCHRONIZED_OUTPUT_END_SEQUENCE)
}

export function shouldSynchronizedOutputRemainActive(data: string, wasActive: boolean): boolean {
  const lastStartIndex = data.lastIndexOf(SYNCHRONIZED_OUTPUT_START_SEQUENCE)
  const lastEndIndex = data.lastIndexOf(SYNCHRONIZED_OUTPUT_END_SEQUENCE)
  if (lastStartIndex === -1 && lastEndIndex === -1) {
    return wasActive
  }
  return lastStartIndex > lastEndIndex
}

export function containsCursorPositionSequence(data: string): boolean {
  let offset = data.indexOf('\x1b[')
  while (offset !== -1) {
    let index = offset + 2
    while (index < data.length) {
      const char = data[index]
      if (char === 'G' || char === 'H' || char === 'f') {
        return true
      }
      if ((char < '0' || char > '9') && char !== ';') {
        break
      }
      index += 1
    }
    offset = data.indexOf('\x1b[', offset + 2)
  }
  return false
}

export function containsCursorRestore(data: string): boolean {
  const hideIndex = data.indexOf(CURSOR_HIDE_SEQUENCE)
  const showIndex = data.lastIndexOf(CURSOR_SHOW_SEQUENCE)
  return hideIndex !== -1 && showIndex > hideIndex && containsCursorPositionSequence(data)
}
