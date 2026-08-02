import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDisposable } from '@xterm/xterm'
import { useAppStore } from '../../store'
import { getConnectionIdFromState } from '@/lib/connection-context'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  selectRuntimeAwareSshStatus,
  selectRuntimeAwareSshTargetLabel,
  selectRuntimeAwareSshTargetRemoved
} from '@/store/slices/runtime-environment-ssh'
import { hydrateRuntimeEnvironmentSshState } from '@/runtime/runtime-environment-ssh-state'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import type { PtyTransportRecoveryState } from './pty-transport-types'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import { isTerminalSessionStateSaveFailure } from '../../../../shared/terminal-session-state-save-failure'
import { isTerminalZeroDimensionsDiagnostic } from '../../../../shared/terminal-zero-dimensions-diagnostic'
import { getOverrideAffectedPanes, getPanesNeedingOverrideFit } from './override-affected-panes'
import { safeFit } from '@/lib/pane-manager/pane-tree-ops'
import { applyDesktopFitFallbackAfterReplay } from './desktop-fit-fallback'
import { onOverrideChange } from '@/lib/pane-manager/mobile-fit-overrides'
import { onDriverChange } from '@/lib/pane-manager/mobile-driver-state'
import { createTerminalQuickCommandDraft } from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import { useVisibleTerminalTabClaim } from './use-visible-terminal-tab-claim'
import type { SearchState } from './keyboard-handlers'
import type { CloseTerminalDialogCopyKind } from './CloseTerminalDialog'
import type { PaneTitleOverlayRect } from './TerminalPaneHeaderOverlay'
import type { PreparedAgentSessionFork } from './terminal-agent-session-fork'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import { updateTerminalRemoteRuntimeRecoveryUiState, type VisiblePtyRecoveryState } from './terminal-remote-runtime-recovery-ui-state'

type TerminalPaneSurfaceContext = Record<string, any>
export function useTerminalPaneSurfaceState(context: TerminalPaneSurfaceContext) {
  const {
    cwd,
    isActive,
    isVisible,
    isWorktreeActive,
    worktreeId,
    tabId,
  } = context
  const containerRef = useRef<HTMLDivElement>(null)
  const managerRef = useRef<PaneManager | null>(null)
  const paneFontSizesRef = useRef<Map<number, number>>(new Map())
  const expandedPaneIdRef = useRef<number | null>(null)
  const expandedStyleSnapshotRef = useRef<Map<HTMLElement, { display: string; flex: string }>>(
    new Map()
  )
  const pendingPaneSizeRefreshFrameIdsRef = useRef<number[]>([])
  // Separate from expandedStyleSnapshotRef so Activity's transient isolation override doesn't collide with the user's expanded-pane state or layout snapshot.
  const activityIsolationSnapshotRef = useRef<Map<HTMLElement, { display: string; flex: string }>>(
    new Map()
  )
  const paneTransportsRef = useRef<Map<number, PtyTransport>>(new Map())
  // Why: per-pane live cwd via OSC 7 for split-pane cwd inheritance; split actions read it at dispatch. See docs/ssh-split-pane-inherit-cwd.md.
  const paneCwdRef = useRef<Map<number, { cwd: string; confirmed: boolean }>>(new Map())
  const paneMode2031Ref = useRef<Map<number, boolean>>(new Map())
  // Why: per-pane mirror of kitty keyboard flags; the keyboard policy reads it to encode Option chords as kitty CSI-u for opted-in TUIs.
  const paneKittyKeyboardModesRef = useRef<Map<number, TerminalKittyKeyboardModeTracker>>(new Map())
  const paneLastThemeModeRef = useRef<Map<number, 'dark' | 'light'>>(new Map())
  const panePtyBindingsRef = useRef<Map<number, IDisposable>>(new Map())
  // Why: panes replaying recorded PTY bytes; while non-zero, pty-connection drops xterm onData so auto-replies don't leak to the shell. See replay-guard.ts.
  const replayingPanesRef = useRef<Map<number, number>>(new Map())
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const isRendererVisible = isVisible && isWorktreeActive
  const isVisibleRef = useRef(isRendererVisible)
  isVisibleRef.current = isRendererVisible
  const sshReconnectTargetId = useAppStore((store) => {
    const connectionId = getConnectionIdFromState(store, worktreeId)
    // Why: runtime-owned SSH targets are internal plumbing users can't connect to, so a reconnect prompt would mislead.
    if (!connectionId || isRuntimeOwnedSshTargetId(connectionId)) {
      return null
    }
    return connectionId
  })
  const nativeChatTranscriptIsLocalReadable = useAppStore((store) =>
    isNativeChatTranscriptLocalReadable(getConnectionIdFromState(store, worktreeId))
  )
  // Which machine's SSH store this target belongs to: a remote server's per-environment bucket, or null for this machine's local SSH maps.
  const sshReconnectEnvironmentId = useAppStore((store) =>
    sshReconnectTargetId ? getExplicitRuntimeEnvironmentIdForWorktree(store, worktreeId) : null
  )
  const sshReconnectStatus = useAppStore((store) =>
    sshReconnectTargetId
      ? selectRuntimeAwareSshStatus(store, sshReconnectEnvironmentId, sshReconnectTargetId)
      : null
  )
  const sshReconnectTargetLabel = useAppStore((store) =>
    sshReconnectTargetId
      ? selectRuntimeAwareSshTargetLabel(store, sshReconnectEnvironmentId, sshReconnectTargetId)
      : ''
  )
  // Why: a ghost target (removed from its host) can only fail reconnect, so the overlay offers Remove instead of Connect.
  const sshReconnectTargetRemoved = useAppStore((store) =>
    sshReconnectTargetId
      ? selectRuntimeAwareSshTargetRemoved(store, sshReconnectEnvironmentId, sshReconnectTargetId)
      : false
  )
  useEffect(() => {
    if (!sshReconnectEnvironmentId) {
      return
    }
    // Why: an SSH workspace can mirror before its environment bucket hydrated; overlay state must come from fetched evidence, not an empty default.
    void hydrateRuntimeEnvironmentSshState(sshReconnectEnvironmentId).catch(() => {})
  }, [sshReconnectEnvironmentId])

  useVisibleTerminalTabClaim({ isVisible, tabId })

  const [expandedPaneId, setExpandedPaneId] = useState<number | null>(null)
  // Why: React state (not the imperative managerRef) so the render re-runs on split/close; managerRef alone doesn't trigger React deps.
  const [paneCount, setPaneCount] = useState<number>(0)
  // Why: pane reorders can move panes without changing count or size, so overlay rects need an explicit layout-change render trigger.
  const [paneLayoutRevision, setPaneLayoutRevision] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen
  const searchStateRef = useRef<SearchState>({ query: '', caseSensitive: false, regex: false })
  const [pendingCloseConfirmation, setPendingCloseConfirmation] = useState<{
    paneId: number
    copyKind: CloseTerminalDialogCopyKind
  } | null>(null)
  const [quickCommandEditorOpen, setQuickCommandEditorOpen] = useState(false)
  const [chatLeafId, setChatLeafId] = useState<string | null>(null)
  const onAgentExitedRef = useRef<(leafId: string) => void>(() => {})
  const [tabWideAgentHintLeafId, setTabWideAgentHintLeafId] = useState<string | null | undefined>(
    undefined
  )
  // Why: each Add action starts with a fresh draft so the terminal menu doesn't reuse cancelled quick-command text.
  const [quickCommandDraft, setQuickCommandDraft] = useState(createTerminalQuickCommandDraft)
  const [agentSessionFork, setAgentSessionFork] = useState<PreparedAgentSessionFork | null>(null)
  const [agentSessionContinuation, setAgentSessionContinuation] =
    useState<AgentSessionContinuationRequest | null>(null)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [ptyRecoveryStatesByPaneId, setPtyRecoveryStatesByPaneId] = useState<
    Record<number, VisiblePtyRecoveryState>
  >({})
  const [sessionStateSaveFailureOpen, setSessionStateSaveFailureOpen] = useState(false)
  const daemonActions = useDaemonActions()
  // Why: override state lives in a Map for perf; this counter forces a re-render on override change so the mobile-fit banner toggles.
  const [, setOverrideTick] = useState(0)
  useEffect(() => {
    const pendingFitFrames = new Set<number>()
    const pendingFallbackTimers = new Set<number>()

    const scheduleFitFrame = (callback: () => void): void => {
      const frameId = window.requestAnimationFrame(() => {
        pendingFitFrames.delete(frameId)
        callback()
      })
      pendingFitFrames.add(frameId)
    }

    const scheduleFallbackTimer = (callback: () => void): void => {
      const timerId = window.setTimeout(() => {
        pendingFallbackTimers.delete(timerId)
        callback()
      }, 100)
      pendingFallbackTimers.add(timerId)
    }

    const unsubscribe = onOverrideChange((event) => {
      setOverrideTick((n) => n + 1)
      const manager = managerRef.current
      if (!manager) {
        return
      }
      // Why: pane IDs are per-tab, so resolve the affected PTY through this tab's live transport bindings, not global pane IDs.
      const getAffectedPanes = (): ReturnType<typeof manager.getPanes> =>
        getOverrideAffectedPanes(
          manager.getPanes(),
          (paneId) => paneTransportsRef.current.get(paneId)?.getPtyId(),
          event.ptyId
        )
      if (event.mode === 'mobile-fit' || event.mode === 'remote-desktop-fit') {
        // Why: when mobile drives, xterm must shrink to phone dims or the wide desktop grid garbles the phone-wrapped stream.
        // Why: override events fan out to every terminal tab; skip the rAF unless this tab has a mis-parked pane.
        const panesNeedingFit = getPanesNeedingOverrideFit(
          getAffectedPanes(),
          event.cols,
          event.rows
        )
        if (panesNeedingFit.length === 0) {
          return
        }
        scheduleFitFrame(() => {
          for (const pane of getPanesNeedingOverrideFit(
            getAffectedPanes(),
            event.cols,
            event.rows
          )) {
            safeFit(pane)
          }
        })
        return
      }
      if (event.mode === 'desktop-fit') {
        // Why: fitAddon.fit() measures the DOM, so run under rAF after layout settles; the timeout is a safety net if fit silently threw.
        const fitAffectedPanes = (): void => {
          for (const pane of getAffectedPanes()) {
            safeFit(pane)
          }
        }
        scheduleFitFrame(fitAffectedPanes)
        // Why: direct-resize fallback if safeFit no-op'd, only while xterm is still at the prior mobile-fit dims; else event.cols/rows is a stale baseline that clobbers the fit.
        scheduleFallbackTimer(() => {
          for (const pane of getAffectedPanes()) {
            // Why: skip 0×0 hidden panes; forcing desktop dims with no DOM geometry leaves a mismatched grid (fallback is only for the visible pane that failed to refit).
            const rect = pane.container.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) {
              continue
            }
            applyDesktopFitFallbackAfterReplay(pane, {
              ...event,
              // Why: the timeout/replay queue can outlive this pane binding; never apply old server dims to a replacement PTY.
              shouldApply: () => getAffectedPanes().includes(pane)
            })
          }
        })
      }
    })

    return () => {
      unsubscribe()
      for (const frameId of pendingFitFrames) {
        window.cancelAnimationFrame(frameId)
      }
      pendingFitFrames.clear()
      for (const timerId of pendingFallbackTimers) {
        window.clearTimeout(timerId)
      }
      pendingFallbackTimers.clear()
    }
  }, [])

  // Why: driver state lives in a Map for perf; this counter re-renders on driver flips so the lock banner toggles. See docs/mobile-presence-lock.md.
  const [, setDriverTick] = useState(0)
  useEffect(
    () =>
      onDriverChange(() => {
        setDriverTick((n) => n + 1)
      }),
    []
  )

  // Pane title state keyed by ephemeral paneId, persisted via titlesByLeafId; ref keeps persistLayoutSnapshot closures fresh.
  const [paneTitles, setPaneTitles] = useState<Record<number, string>>({})
  const paneTitlesRef = useRef<Record<number, string>>({})
  paneTitlesRef.current = paneTitles
  const removedTitleLeafIdsRef = useRef<Set<string>>(new Set())
  const clearedScrollbackLeafIdsRef = useRef<Set<string>>(new Set())
  const [paneTitleOverlayRects, setPaneTitleOverlayRects] = useState<
    Record<number, PaneTitleOverlayRect>
  >({})
  const [renamingPaneId, setRenamingPaneId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Guard against double-submit: Enter/Escape act first, then the input's onBlur re-fires handleRenameSubmit, re-saving a discarded title.
  const renameSubmittedRef = useRef(false)
  const renameSessionIdRef = useRef(0)
  const renameBlurCommitEnabledRef = useRef(true)
  // Why: delayed xterm/Radix focus handoffs look like blur but aren't user intent; only outside pointer/Tab nav should commit.
  const renameUserRequestedBlurCommitRef = useRef(false)
  const renameFocusFrameRef = useRef<number | null>(null)
  const renameEnableBlurFrameRef = useRef<number | null>(null)
  const renameRefocusFrameRef = useRef<number | null>(null)
  /** Cancels deferred focus/blur frames from inline title editing (xterm and Radix can both move focus after the menu closes). */
  const cancelPendingRenameFrames = useCallback(() => {
    const frameRefs = [renameFocusFrameRef, renameEnableBlurFrameRef, renameRefocusFrameRef]
    for (const frameRef of frameRefs) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [])

  /** Invalidates the active inline title edit session (bumping the session ID) so stale animation-frame callbacks can't commit old titles. */
  const closeRenameSession = useCallback(() => {
    renameSessionIdRef.current += 1
    renameBlurCommitEnabledRef.current = true
    renameUserRequestedBlurCommitRef.current = false
    cancelPendingRenameFrames()
  }, [cancelPendingRenameFrames])

  /** Owns the terminal container ref; closes rename work when the owner detaches so delayed focus callbacks don't target stale DOM. */
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null): void => {
      containerRef.current = node
      if (node !== null) {
        return
      }
      // Why: rename focus/blur frames are owned by the terminal container; invalidate them when that DOM owner detaches.
      closeRenameSession()
    },
    [closeRenameSession]
  )

  /** Starts inline title editing (menu or keyboard), resetting stale blur-submit state from prior sessions. */
  const handleStartRename = useCallback(
    (paneId: number) => {
      cancelPendingRenameFrames()
      renameSessionIdRef.current += 1
      renameBlurCommitEnabledRef.current = false
      renameUserRequestedBlurCommitRef.current = false
      renameSubmittedRef.current = false
      setRenameValue(paneTitlesRef.current[paneId] ?? '')
      setRenamingPaneId(paneId)
    },
    [cancelPendingRenameFrames]
  )
  const onPtyErrorRef = useRef((_paneId: number, message: string) => {
    if (isTerminalSessionStateSaveFailure(message)) {
      setTerminalError(null)
      setSessionStateSaveFailureOpen(true)
      return
    }
    setTerminalError((prev) => (prev ? `${prev}\n${message}` : message))
  })
  const onPtyRecoveryStateRef = useRef(
    (paneId: number, state: PtyTransportRecoveryState | null) => {
      setPtyRecoveryStatesByPaneId((previous) =>
        updateTerminalRemoteRuntimeRecoveryUiState(previous, paneId, state)
      )
    }
  )

  return {
    containerRef,
    managerRef,
    paneFontSizesRef,
    expandedPaneIdRef,
    expandedStyleSnapshotRef,
    pendingPaneSizeRefreshFrameIdsRef,
    activityIsolationSnapshotRef,
    paneTransportsRef,
    paneCwdRef,
    paneMode2031Ref,
    paneKittyKeyboardModesRef,
    paneLastThemeModeRef,
    panePtyBindingsRef,
    replayingPanesRef,
    isActiveRef,
    isRendererVisible,
    isVisibleRef,
    sshReconnectTargetId,
    nativeChatTranscriptIsLocalReadable,
    sshReconnectEnvironmentId,
    sshReconnectStatus,
    sshReconnectTargetLabel,
    sshReconnectTargetRemoved,
    expandedPaneId,
    setExpandedPaneId,
    paneCount,
    setPaneCount,
    paneLayoutRevision,
    setPaneLayoutRevision,
    searchOpen,
    setSearchOpen,
    searchOpenRef,
    searchStateRef,
    pendingCloseConfirmation,
    setPendingCloseConfirmation,
    quickCommandEditorOpen,
    setQuickCommandEditorOpen,
    chatLeafId,
    setChatLeafId,
    onAgentExitedRef,
    tabWideAgentHintLeafId,
    setTabWideAgentHintLeafId,
    quickCommandDraft,
    setQuickCommandDraft,
    agentSessionFork,
    setAgentSessionFork,
    agentSessionContinuation,
    setAgentSessionContinuation,
    terminalError,
    setTerminalError,
    ptyRecoveryStatesByPaneId,
    setPtyRecoveryStatesByPaneId,
    sessionStateSaveFailureOpen,
    setSessionStateSaveFailureOpen,
    daemonActions,
    setOverrideTick,
    setDriverTick,
    paneTitles,
    setPaneTitles,
    paneTitlesRef,
    removedTitleLeafIdsRef,
    clearedScrollbackLeafIdsRef,
    paneTitleOverlayRects,
    setPaneTitleOverlayRects,
    renamingPaneId,
    setRenamingPaneId,
    renameValue,
    setRenameValue,
    renameInputRef,
    renameSubmittedRef,
    renameSessionIdRef,
    renameBlurCommitEnabledRef,
    renameUserRequestedBlurCommitRef,
    renameFocusFrameRef,
    renameEnableBlurFrameRef,
    renameRefocusFrameRef,
    cancelPendingRenameFrames,
    closeRenameSession,
    setContainerRef,
    handleStartRename,
    onPtyErrorRef,
    onPtyRecoveryStateRef,
  }
}
