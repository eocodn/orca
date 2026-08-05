import { useCallback, useRef } from 'react'
import { Keyboard, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import {
  triggerEdgeBump,
  triggerError,
  triggerSelection,
  triggerSuccess
} from '../../../../src/platform/haptics'
import { sendMobileTerminalQueryReply } from '../../../../src/terminal/mobile-terminal-query-reply'
import { countTerminalGestureInputSequences } from '../../../../src/terminal/terminal-gesture-input'
import { isGestureMouseTrackingMode } from '../../../../src/session/mobile-session-route-helpers'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../../../../src/terminal/terminal-send-request'
import { createTerminalLiveAccessoryInput } from '../../../../src/terminal/terminal-live-accessory-input'
import {
  clearTerminalLiveInputFocusTimer,
  scheduleTerminalLiveInputFocus
} from '../../../../src/terminal/terminal-live-input'
import type {
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes
} from '../../../../src/terminal/terminal-webview-contract'
import type { Terminal, TerminalGestureInputQueue } from './mobile-session-route-types'

type SessionTerminalInputContext = Record<string, any>

export function useMobileSessionTerminalInput(context: SessionTerminalInputContext) {
  const {
    activeHandle,
    toggleTerminalLiveInput,
    clearPendingLiveInputCommit,
    scheduleTerminalLiveInputFocus,
    liveInputFocusTimerRef,
    clearTerminalLiveInputFocusTimer,
    liveInputRef,
    terminalGestureInputBucketsRef,
    TERMINAL_GESTURE_INPUT_BUCKET_CAPACITY,
    TERMINAL_GESTURE_INPUT_REFILL_PER_SECOND,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    clientRef,
    connStateRef,
    buildTerminalSendParams,
    deviceTokenRef,
    TERMINAL_INPUT_SEND_OPTIONS,
    TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS,
    TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES,
    TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
    client,
    connState,
    ptyModesRef,
    isGestureMouseTrackingMode,
    countTerminalGestureInputSequences,
    sendMobileTerminalQueryReply,
    hostQueryReplyInputSupportedRef,
    terminalUnsubsRef,
    getTerminalRef,
    showToast,
    handleAccessoryKey,
    toastSeqRef,
    clearTerminalCache,
    clearToastHideTimer,
    clearDelayedActionTimers,
    sessionTabActionSheetRequestSeqRef,
    clearSessionTabActionSheetKeyboardListener,
    setSelectModeActive,
    terminalRefs,
    setTerminalKeyboardMetrics,
    initialModesSeenRef,
    triggerSelection,
    triggerSuccess,
    triggerError,
    triggerEdgeBump
  } = context

  const toggleLiveInput = useCallback(() => {
    if (!activeHandle) {
      return
    }
    const nextEnabled = toggleTerminalLiveInput(activeHandle)
    clearPendingLiveInputCommit()
    if (nextEnabled) {
      scheduleTerminalLiveInputFocus(liveInputFocusTimerRef, () => liveInputRef.current?.focus())
    } else {
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      liveInputRef.current?.blur()
    }
  }, [activeHandle, clearPendingLiveInputCommit, toggleTerminalLiveInput])

  const allowTerminalGestureInput = useCallback(
    (handle: string, sequenceCount: number): boolean => {
      const now = Date.now()
      const current = terminalGestureInputBucketsRef.current.get(handle) ?? {
        tokens: TERMINAL_GESTURE_INPUT_BUCKET_CAPACITY,
        lastRefillMs: now
      }
      const elapsedSeconds = Math.max(0, now - current.lastRefillMs) / 1000
      const tokens = Math.min(
        TERMINAL_GESTURE_INPUT_BUCKET_CAPACITY,
        current.tokens + elapsedSeconds * TERMINAL_GESTURE_INPUT_REFILL_PER_SECOND
      )

      // Why: tokens count terminal control sequences, not WebView messages; one gesture may batch up to 32 wheel/key reports.
      if (tokens < sequenceCount) {
        terminalGestureInputBucketsRef.current.set(handle, { tokens, lastRefillMs: now })
        return false
      }

      terminalGestureInputBucketsRef.current.set(handle, {
        tokens: tokens - sequenceCount,
        lastRefillMs: now
      })
      return true
    },
    []
  )

  const flushTerminalGestureInput = useCallback(async (handle: string) => {
    const queued = terminalGestureInputQueuesRef.current.get(handle)
    if (!queued) {
      return
    }
    if (queued.timer) {
      clearTimeout(queued.timer)
      queued.timer = null
    }
    if (terminalGestureInputInFlightRef.current.has(handle)) {
      return
    }

    terminalGestureInputQueuesRef.current.delete(handle)
    const isActive =
      handle === activeHandleRef.current && activeSessionTabTypeRef.current === 'terminal'
    const isFresh = Date.now() - queued.lastUpdatedMs <= TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS
    const rpc = clientRef.current
    if (!rpc || connStateRef.current !== 'connected' || !isActive || !isFresh) {
      return
    }

    terminalGestureInputInFlightRef.current.add(handle)
    try {
      // Why: gesture arrows parked across a reconnect would move a TUI long after the swipe.
      await rpc.sendRequest(
        'terminal.send',
        buildTerminalSendParams({
          terminal: handle,
          text: queued.bytes,
          enter: false,
          deviceToken: deviceTokenRef.current
        }),
        TERMINAL_INPUT_SEND_OPTIONS
      )
    } catch {
      // Transient failure
    } finally {
      terminalGestureInputInFlightRef.current.delete(handle)
      const next = terminalGestureInputQueuesRef.current.get(handle)
      if (next) {
        if (Date.now() - next.lastUpdatedMs > TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS) {
          if (next.timer) {
            clearTimeout(next.timer)
          }
          terminalGestureInputQueuesRef.current.delete(handle)
        } else {
          void flushTerminalGestureInput(handle)
        }
      }
    }
  }, [])

  const enqueueTerminalGestureInput = useCallback(
    (handle: string, bytes: string, sequenceCount: number) => {
      const now = Date.now()
      const current = terminalGestureInputQueuesRef.current.get(handle)
      if (
        current &&
        current.sequenceCount + sequenceCount <= TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES
      ) {
        current.bytes += bytes
        current.sequenceCount += sequenceCount
        current.lastUpdatedMs = now
        return
      }

      if (current) {
        if (current.timer) {
          clearTimeout(current.timer)
        }
        if (!terminalGestureInputInFlightRef.current.has(handle)) {
          void flushTerminalGestureInput(handle)
        } else {
          // Why: cap is a soft guideline — append instead of dropping queued bytes; the in-flight flush picks up the merged queue.
          current.bytes += bytes
          current.sequenceCount += sequenceCount
          current.lastUpdatedMs = now
          current.timer = setTimeout(() => {
            current.timer = null
            void flushTerminalGestureInput(handle)
          }, TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS)
          return
        }
      }

      const queued: TerminalGestureInputQueue = {
        bytes,
        sequenceCount,
        timer: null,
        lastUpdatedMs: now
      }
      queued.timer = setTimeout(() => {
        queued.timer = null
        void flushTerminalGestureInput(handle)
      }, TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS)
      terminalGestureInputQueuesRef.current.set(handle, queued)
    },
    [flushTerminalGestureInput]
  )

  const handleTerminalInput = useCallback(
    async (handle: string, bytes: string) => {
      if (!client || connState !== 'connected' || bytes.length === 0) {
        return
      }
      if (handle !== activeHandleRef.current || activeSessionTabTypeRef.current !== 'terminal') {
        return
      }
      const modes = ptyModesRef.current.get(handle)
      // Why: WebView gesture bytes can become PTY input, so gate mouse reports behind validation and SSH-safe rate limiting.
      if (!modes?.altScreen && !isGestureMouseTrackingMode(modes?.mouseTrackingMode)) {
        return
      }
      const sequenceCount = countTerminalGestureInputSequences(bytes)
      if (sequenceCount == null) {
        return
      }
      if (!allowTerminalGestureInput(handle, sequenceCount)) {
        return
      }
      enqueueTerminalGestureInput(handle, bytes, sequenceCount)
    },
    [allowTerminalGestureInput, client, connState, enqueueTerminalGestureInput]
  )

  const handleTerminalQueryReply = useCallback((handle: string, bytes: string) => {
    void sendMobileTerminalQueryReply({
      bytes,
      client: clientRef.current,
      clientId: deviceTokenRef.current,
      connected: connStateRef.current === 'connected',
      handle,
      hostSupportsQueryReplyInput: hostQueryReplyInputSupportedRef.current,
      subscribedTerminals: terminalUnsubsRef.current
    })
  }, [])

  async function handleClearTerminal(target: Terminal) {
    if (!client) {
      return
    }
    getTerminalRef(target.handle)?.clear()
    try {
      await client.sendRequest('terminal.clearBuffer', {
        terminal: target.handle
      })
      showToast('Terminal cleared')
    } catch {
      showToast("Couldn't clear terminal", 1500)
    }
  }

  // Why: hold-to-repeat uses a 400ms delay then 45ms cadence; non-repeatable keys fire once.
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Why: ref keeps repeat firing the current callback; else a mid-hold tab switch/reconnect routes bytes to a stale terminal.
  const handleAccessoryKeyRef = useRef(handleAccessoryKey)
  handleAccessoryKeyRef.current = handleAccessoryKey
  const stopAccessoryRepeat = useCallback(() => {
    if (repeatTimeoutRef.current) {
      clearTimeout(repeatTimeoutRef.current)
      repeatTimeoutRef.current = null
    }
    if (repeatIntervalRef.current) {
      clearInterval(repeatIntervalRef.current)
      repeatIntervalRef.current = null
    }
  }, [])
  const startAccessoryRepeat = useCallback(
    (input: ReturnType<typeof createTerminalLiveAccessoryInput>) => {
      stopAccessoryRepeat()
      repeatTimeoutRef.current = setTimeout(() => {
        repeatIntervalRef.current = setInterval(() => {
          void handleAccessoryKeyRef.current(input)
        }, 45)
      }, 400)
    },
    [stopAccessoryRepeat]
  )
  const setMobileSessionRootRef = useCallback(
    (node: View | null): void => {
      if (node !== null) {
        return
      }
      // Why: clear only on real route detach; client churn during mount would wipe xterm state mid-subscribe.
      toastSeqRef.current += 1
      clearTerminalCache()
      clearToastHideTimer()
      clearDelayedActionTimers()
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      clearPendingLiveInputCommit()
      sessionTabActionSheetRequestSeqRef.current += 1
      clearSessionTabActionSheetKeyboardListener()
      stopAccessoryRepeat()
    },
    [
      clearPendingLiveInputCommit,
      clearDelayedActionTimers,
      clearSessionTabActionSheetKeyboardListener,
      clearTerminalCache,
      clearToastHideTimer,
      stopAccessoryRepeat
    ]
  )

  const handleSelectionMode = useCallback((handle: string, active: boolean) => {
    if (handle !== activeHandleRef.current) {
      return
    }
    setSelectModeActive(active)
    if (active) {
      Keyboard.dismiss()
    }
  }, [])

  const handleSelectionCopy = useCallback(
    async (handle: string, text: string) => {
      if (handle !== activeHandleRef.current) {
        return
      }
      if (!text || text.length === 0) {
        terminalRefs.current.get(handle)?.cancelSelect()
        return
      }
      try {
        await Clipboard.setStringAsync(text)
        triggerSuccess()
        terminalRefs.current.get(handle)?.cancelSelect()
      } catch (e) {
        triggerError()
        const err = e as { name?: string; message?: string }
        // eslint-disable-next-line no-console
        console.warn('[mobile-clip] setString failed', {
          name: err.name,
          message: err.message
        })
        showToast("Couldn't copy", 1500)
      }
    },
    [showToast]
  )

  const handleSelectionEvicted = useCallback(
    (handle: string) => {
      if (handle !== activeHandleRef.current) {
        return
      }
      // eslint-disable-next-line no-console
      console.warn('[mobile-clip] selection evicted')
      showToast('Selection cleared (scrolled out of buffer)', 1500)
      setSelectModeActive(false)
    },
    [showToast]
  )

  const handleModesChanged = useCallback((handle: string, modes: TerminalModes) => {
    ptyModesRef.current.set(handle, modes)
    initialModesSeenRef.current.add(handle)
  }, [])

  const handleKeyboardAvoidanceMetrics = useCallback(
    (handle: string, metrics: TerminalKeyboardAvoidanceMetrics) => {
      setTerminalKeyboardMetrics((prev) => {
        const current = prev.get(handle)
        if (
          current &&
          current.cursorY === metrics.cursorY &&
          current.rows === metrics.rows &&
          current.altScreen === metrics.altScreen
        ) {
          return prev
        }
        return new Map(prev).set(handle, metrics)
      })
    },
    []
  )

  const handleHaptic = useCallback((kind: 'selection' | 'success' | 'error' | 'edge-bump') => {
    if (kind === 'selection') {
      triggerSelection()
    } else if (kind === 'success') {
      triggerSuccess()
    } else if (kind === 'error') {
      triggerError()
    } else if (kind === 'edge-bump') {
      triggerEdgeBump()
    }
  }, [])

  return {
    toggleLiveInput,
    allowTerminalGestureInput,
    flushTerminalGestureInput,
    enqueueTerminalGestureInput,
    handleTerminalInput,
    handleTerminalQueryReply,
    handleClearTerminal,
    handleAccessoryKeyRef,
    stopAccessoryRepeat,
    startAccessoryRepeat,
    setMobileSessionRootRef,
    handleSelectionMode,
    handleSelectionCopy,
    handleSelectionEvicted,
    handleModesChanged,
    handleKeyboardAvoidanceMetrics,
    handleHaptic
  }
}
