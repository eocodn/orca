import { useCallback, useRef } from 'react'
import { subscribeMobileTerminalSafely } from '../../../../src/session/mobile-terminal-stream-subscribe'
import { isTerminalOscLinkRanges } from '../../../../src/terminal/terminal-osc-link-ranges'
import { updateTerminalCwdFromStreamEvent } from '../../../../src/session/mobile-session-route-helpers'
import { mergeTerminalListWithKnownRecords, terminalRecordsEqual } from '../../../../src/session/mobile-terminal-records'
import { createTerminalPrunePredicate, pruneTerminalKeyboardMetrics, resolveRetainedTerminalHandles } from '../../../../src/session/mobile-terminal-prune-decision'
import type { RpcSuccess } from '../../../../src/transport/types'
import type { MobileDisplayMode, Terminal } from './mobile-session-route-types'

type WorkspaceContext = Record<string, any>

export function useMobileSessionWorkspaceTerminal(context: WorkspaceContext) {
  const { terminalRefs, terminalUnsubsRef, subscribingHandlesRef, terminalDiagnosticsRef, subscribeSeqRef,
    layoutSeqRef, activeHandleRef, initializedHandlesRef, webReadyHandlesRef,
    setTerminalKeyboardMetrics, client, deviceTokenRef, viewportRef, viewportMeasuredRef,
    scheduleDelayedAction, terminalFrameHeightRef, activeHandle,
    terminalModes, setTerminalModes, setTerminals,
    terminalsRef, sessionTabsRef, worktreeId, clearTerminalLiveInputDefault, defaultTerminalHandlesToLiveInput,
    pruneTerminalHandlesFromLiveInput, terminalCwdRef } = context
  const getTerminalRef = useCallback((handle: string | null) => {
    return handle ? terminalRefs.current.get(handle) : undefined
  }, [])

  const unsubscribeTerminal = useCallback(
    (handle: string) => {
      terminalUnsubsRef.current.get(handle)?.()
      terminalUnsubsRef.current.delete(handle)
      subscribingHandlesRef.current.delete(handle)
      terminalDiagnosticsRef.current.terminalUnsubscribed(handle)
      subscribeSeqRef.current.set(handle, (subscribeSeqRef.current.get(handle) ?? 0) + 1)
      // Why: reset the high-water mark so a fresh subscription's first scrollback isn't dropped as stale.
      layoutSeqRef.current.delete(handle)
    },
    []
  )
  const unsubscribeTerminalRef = useRef(unsubscribeTerminal)
  unsubscribeTerminalRef.current = unsubscribeTerminal

  const clearTerminalCache = useCallback(() => {
    terminalUnsubsRef.current.forEach((unsub) => unsub())
    terminalUnsubsRef.current.clear()
    subscribingHandlesRef.current.clear()
    initializedHandlesRef.current.clear()
    terminalDiagnosticsRef.current.clearTerminalCache()
    webReadyHandlesRef.current.clear()
    subscribeSeqRef.current.clear()
    layoutSeqRef.current.clear()
    terminalCwdRef.current.clear()
    setTerminalKeyboardMetrics(new Map())
    for (const term of terminalRefs.current.values()) {
      term.clear()
    }
  }, [])

  // Why: measure the phone viewport once from the first TerminalWebView; dims ride every subscribe so the server auto-fits without a separate RPC.
  const measureViewportOnce = useCallback(
    async (handle: string) => {
      if (viewportMeasuredRef.current) {
        return
      }
      const dims = await getTerminalRef(handle)?.measureFitDimensions(
        terminalFrameHeightRef.current || undefined
      )
      terminalDiagnosticsRef.current.viewportMeasured(handle, dims, terminalFrameHeightRef.current)
      if (dims) {
        viewportRef.current = dims
        viewportMeasuredRef.current = true
      }
    },
    [getTerminalRef]
  )

  const subscribeToTerminal = useCallback(
    (handle: string) => {
      const diagnostics = terminalDiagnosticsRef.current
      const logSkippedGate = (reason: string) =>
        diagnostics.streamSkipped(handle, reason, handle === activeHandleRef.current)
      if (!client) {
        logSkippedGate('no-client')
        return
      }
      if (terminalUnsubsRef.current.has(handle)) {
        logSkippedGate('already-subscribed')
        return
      }
      if (subscribingHandlesRef.current.has(handle)) {
        logSkippedGate('subscribe-in-flight')
        return
      }
      if (!getTerminalRef(handle)) {
        logSkippedGate('no-webview-ref')
        return
      }
      if (!webReadyHandlesRef.current.has(handle)) {
        logSkippedGate('webview-not-ready')
        return
      }

      subscribingHandlesRef.current.add(handle)
      const seq = (subscribeSeqRef.current.get(handle) ?? 0) + 1
      subscribeSeqRef.current.set(handle, seq)
      diagnostics.streamArmed(handle, seq, viewportRef.current)

      // Why: viewport is embedded in the subscribe params so the server auto-fits before serializing scrollback (no focus→safeFit race).
      const unsub = subscribeMobileTerminalSafely(
        client,
        {
          terminal: handle,
          client: { id: deviceTokenRef.current!, type: 'mobile' as const },
          ...(viewportRef.current ? { viewport: viewportRef.current } : {})
        },
        (result) => {
          if (subscribeSeqRef.current.get(handle) !== seq) {
            return
          }
          const data = result as Record<string, unknown>
          diagnostics.firstStreamEvent(handle, seq, data.type)
          if (data.type === 'end' || data.type === 'error') {
            unsubscribeTerminalRef.current(handle)
            return
          }
          if (data.type === 'subscribed') {
            return
          }
          // Why: drop `resized` events older than the seen seq (superseded layout); scrollback always resets the mark, else reconnect blanks the terminal.
          const eventSeq = typeof data.seq === 'number' ? data.seq : null
          if (eventSeq != null && data.type === 'resized') {
            const last = layoutSeqRef.current.get(handle)
            if (last != null && eventSeq < last && last - eventSeq <= 20) {
              console.log('[fit][session] DROP-stale-seq', {
                handle: handle.slice(-8),
                type: data.type,
                eventSeq,
                lastSeq: last,
                cols: data.cols,
                rows: data.rows,
                displayMode: data.displayMode
              })
              return
            }
            layoutSeqRef.current.set(handle, eventSeq)
          } else if (eventSeq != null && data.type === 'scrollback') {
            layoutSeqRef.current.set(handle, eventSeq)
          }
          if (data.type === 'scrollback') {
            diagnostics.streamScrollback(handle, seq, eventSeq, data)
            if (initializedHandlesRef.current.has(handle)) {
              return
            }
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
            const cols = (data.cols as number) || 80
            const rows = (data.rows as number) || 24
            const scrollbackCols = cols
            const scrollbackRows = rows
            const initialData =
              typeof data.serialized === 'string' && data.serialized.length > 0
                ? data.serialized
                : ''
            const oscLinks = isTerminalOscLinkRanges(data.oscLinks) ? data.oscLinks : undefined
            const ref = getTerminalRef(handle)
            // Why: only mark initialized once init() reaches the WebView, else later scrollback is dropped and the terminal stays blank.
            if (!ref) {
              console.log('[fit][session] scrollback DROPPED — no terminal ref', {
                handle: handle.slice(-8),
                cols,
                rows
              })
              return
            }
            ref.init(cols, rows, initialData, false, oscLinks)
            initializedHandlesRef.current.add(handle)
            if (data.displayMode) {
              setTerminalModes((prev) =>
                new Map(prev).set(handle, data.displayMode as MobileDisplayMode)
              )
            }
            // Why: cold-start refit — init()'s fit can run against a transient scrollWidth, so re-fire against a settled DOM.
            scheduleDelayedAction(() => getTerminalRef(handle)?.resetZoom(), 200)
            // Why: first subscribe has no viewport (xterm not loaded yet), so measure after init and resubscribe so the server can phone-fit.
            const needsResubscribe =
              !viewportMeasuredRef.current ||
              (viewportRef.current != null &&
                (scrollbackCols !== viewportRef.current.cols ||
                  scrollbackRows !== viewportRef.current.rows))
            if (needsResubscribe) {
              void (async () => {
                // Why: wait for init()'s rAF chain before measuring, else the measure races ahead and returns null (log dump 2026-05-06).
                await getTerminalRef(handle)?.awaitReady()
                if (subscribeSeqRef.current.get(handle) !== seq) {
                  return
                }
                const dims = await getTerminalRef(handle)?.measureFitDimensions(
                  terminalFrameHeightRef.current || undefined
                )
                // Why: re-check seq — the awaits may have let a newer subscribe cycle arm; tearing it down would resubscribe a stale generation.
                if (subscribeSeqRef.current.get(handle) !== seq) {
                  return
                }
                if (!getTerminalRef(handle)) {
                  return
                }
                // Why: scrollback came back at cols=80 (server's null-viewport fallback), so this subscriber record has no viewport — resubscribe so the server stores it.
                if (dims) {
                  diagnostics.streamResubscribing(handle, seq, dims)
                  viewportRef.current = dims
                  viewportMeasuredRef.current = true
                  unsubscribeTerminal(handle)
                  initializedHandlesRef.current.delete(handle)
                  subscribeToTerminal(handle)
                }
              })()
            }
          } else if (data.type === 'metadata') {
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
          } else if (data.type === 'data') {
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
            // Why: missing ref is the likely cause of "blank but input works" — writes dropped after mid-flight unmount or scrollback never landed.
            const dataRef = getTerminalRef(handle)
            if (!dataRef) {
              console.log('[fit][session] data DROPPED — no terminal ref', {
                handle: handle.slice(-8),
                chunkLen: typeof data.chunk === 'string' ? data.chunk.length : 0,
                initialized: initializedHandlesRef.current.has(handle)
              })
              return
            }
            if (!initializedHandlesRef.current.has(handle)) {
              console.log('[fit][session] data RECEIVED before scrollback', {
                handle: handle.slice(-8),
                chunkLen: typeof data.chunk === 'string' ? data.chunk.length : 0
              })
            }
            dataRef.write(data.chunk as string)
          } else if (data.type === 'resized') {
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
            // Server resize: reinit xterm on a full-buffer snapshot (width reflow rewraps scrollback), else just resize geometry.
            const cols = (data.cols as number) || 80
            const rows = (data.rows as number) || 24
            const serialized = typeof data.serialized === 'string' ? data.serialized : null
            diagnostics.streamResized(handle, seq, eventSeq, data, getTerminalRef(handle) != null)
            const oscLinks = isTerminalOscLinkRanges(data.oscLinks) ? data.oscLinks : undefined
            if (serialized != null) {
              getTerminalRef(handle)?.init(cols, rows, serialized, true, oscLinks)
            } else {
              getTerminalRef(handle)?.resize(cols, rows)
            }
            if (data.displayMode) {
              setTerminalModes((prev) =>
                new Map(prev).set(handle, data.displayMode as MobileDisplayMode)
              )
            }
            scheduleDelayedAction(() => getTerminalRef(handle)?.resetZoom(), 200)
          }
        },
        () => unsubscribeTerminalRef.current(handle)
      )

      if (subscribeSeqRef.current.get(handle) === seq) {
        terminalUnsubsRef.current.set(handle, unsub)
      } else {
        unsub()
      }
      subscribingHandlesRef.current.delete(handle)
    },
    [client, getTerminalRef, scheduleDelayedAction]
  )

  // Why: server does the resize and emits 'resized' on the existing subscription — no client-side state tracking needed.
  const toggleInFlightRef = useRef<Set<string>>(new Set())
  const toggleDisplayMode = useCallback(
    async (handle: string) => {
      if (!client) {
        return
      }
      if (toggleInFlightRef.current.has(handle)) {
        return
      }
      const current = terminalModes.get(handle) ?? 'auto'
      // Why: 'phone' is an observed state, not a setting; the toggle only requests 'auto' or 'desktop'.
      const next: 'auto' | 'desktop' =
        current === 'auto' || current === 'phone' ? 'desktop' : 'auto'
      toggleInFlightRef.current.add(handle)
      try {
        await client.sendRequest('terminal.setDisplayMode', {
          terminal: handle,
          mode: next,
          // Why: presence-lock take-floor — requesting 'auto' is the explicit "drive at phone dims" gesture.
          ...(deviceTokenRef.current
            ? { client: { id: deviceTokenRef.current, type: 'mobile' as const } }
            : {}),
          // Why: late-bind viewport for terminals subscribed before measurement, or auto toggles no-op on a null stored viewport.
          ...(viewportRef.current && next === 'auto' ? { viewport: viewportRef.current } : {})
        })
      } catch {
        // Mode change failed — server state unchanged, UI stays in sync.
      } finally {
        toggleInFlightRef.current.delete(handle)
      }
    },
    [client, terminalModes]
  )

  const lastKnownTerminalCountRef = useRef(0)
  const fetchTerminalsInFlightRef = useRef(false)

  const fetchTerminals = useCallback(
    async (opts: { allowEmptyLoaded?: boolean } = {}) => {
      if (!client) {
        return
      }
      if (fetchTerminalsInFlightRef.current) {
        return
      }
      fetchTerminalsInFlightRef.current = true
      const allowEmptyLoaded = opts.allowEmptyLoaded ?? true

      try {
        const response = await client.sendRequest('terminal.list', {
          worktree: `id:${worktreeId}`
        })
        if (response.ok) {
          const result = (response as RpcSuccess).result as { terminals: Terminal[] }
          if (result.terminals.length === 0 && !allowEmptyLoaded) {
            return
          }
          // Why: require two consecutive empties before trusting 0, so transient empty responses don't flash the UI empty.
          if (result.terminals.length === 0 && lastKnownTerminalCountRef.current > 0) {
            lastKnownTerminalCountRef.current = 0
            return
          }

          const liveHandles = new Set<string>(
            result.terminals.map((terminal) => String(terminal.handle))
          )
          const pruneContext = { liveHandles }
          // Why: terminal.list is the lifetime signal; lagging tab snapshots must not erase a user's buffered-mode opt-out.
          pruneTerminalHandlesFromLiveInput(resolveRetainedTerminalHandles(pruneContext))
          defaultTerminalHandlesToLiveInput([...liveHandles])
          const shouldPrune = createTerminalPrunePredicate(pruneContext)
          for (const handle of Array.from(terminalUnsubsRef.current.keys()) as string[]) {
            if (!shouldPrune(handle)) {
              continue
            }
            unsubscribeTerminal(handle)
            terminalRefs.current.delete(handle)
            initializedHandlesRef.current.delete(handle)
            clearTerminalLiveInputDefault(handle)
          }
          setTerminalKeyboardMetrics((prev) => pruneTerminalKeyboardMetrics(prev, shouldPrune))
          lastKnownTerminalCountRef.current = result.terminals.length
          // Why: dedupe duplicate handles (rename/split race) to avoid a React duplicate-key throw; keep first for tab-strip order.
          const seen = new Set<string>()
          const deduped = result.terminals.filter((t) => {
            if (seen.has(t.handle)) {
              return false
            }
            seen.add(t.handle)
            return true
          })

          const mergedTerminals = mergeTerminalListWithKnownRecords(
            deduped,
            terminalsRef.current,
            sessionTabsRef.current
          )
          setTerminals((prev) =>
            terminalRecordsEqual(prev, mergedTerminals) ? prev : mergedTerminals
          )
          terminalsRef.current = mergedTerminals

          // Session tabs are the UI authority; terminal.list only refreshes per-handle metadata for existing terminal surfaces.
        }
      } catch {
        // Failed to list terminals
      } finally {
        fetchTerminalsInFlightRef.current = false
      }
    },
    [
      client,
      worktreeId,
      clearTerminalLiveInputDefault,
      defaultTerminalHandlesToLiveInput,
      pruneTerminalHandlesFromLiveInput,
      subscribeToTerminal,
      unsubscribeTerminal
    ]
  )

  return { getTerminalRef, unsubscribeTerminal, unsubscribeTerminalRef, clearTerminalCache, measureViewportOnce,
    subscribeToTerminal, toggleDisplayMode, fetchTerminals, toggleInFlightRef,
    lastKnownTerminalCountRef, fetchTerminalsInFlightRef }
}
