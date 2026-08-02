import { useCallback, useEffect, useLayoutEffect } from 'react'
import { useAppStore } from '../../store'
import type { PtyTransport } from './pty-transport'
import { recordTerminalUserInputForLeaf } from './terminal-input-activity'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { APP_MENU_PASTE_EVENT } from '@/lib/app-menu-paste'
import {
  armPrimarySelectionNativePasteSuppression,
  isPrimarySelectionEnabled,
  readPrimarySelectionText
} from '@/lib/primary-selection'
import {
  executeTerminalPastePlan,
  planTerminalPasteWithYield,
  type TerminalPasteSource,
  type TerminalPasteTextOptions
} from './terminal-paste-coordinator'
import { formatTerminalPasteExecutionError } from './terminal-paste-errors'
import { resolveTerminalPasteRuntime } from './terminal-paste-runtime'
import { getTerminalPasteSshRemotePlatform } from './terminal-paste-ssh-platform'
import {
  isTerminalPanePasteFocusCurrent,
  isTerminalPanePasteTargetCurrent
} from './terminal-paste-target-state'
import { writeTerminalPastePtyInput } from './terminal-pty-paste-writer'
import {
  applyTerminalPaneAttentionToManager,
  subscribeTerminalPaneAttention
} from './terminal-pane-attention-subscriptions'
import {
  firesNativePasteEvent,
  getClipboardEventText,
  isClipboardEventPasteRequired
} from './terminal-clipboard-event-paste'
import {
  assertClipboardTextWithinLimitWithYield,
  type ReadClipboardTextOptions
} from '../../../../shared/clipboard-text'
import { pasteTerminalText } from './terminal-bracketed-paste'
import { scheduleImagePasteWebglAtlasRecovery } from './terminal-webgl-atlas-recovery'
import {
  isXtermHelperTextarea,
  releaseTerminalFocusForOutsidePointerDown,
  releaseTerminalFocusForWindowBlur,
  resyncTerminalFocusForWindowFocus,
  setRegularTerminalInputFocusAttribute
} from './regular-terminal-focus-ownership'
import { refreshTerminalImeInputContext } from './terminal-ime-input-context-refresh'

const NATIVE_CHAT_ROOT_SELECTOR = '[data-native-chat-root="true"]'

function isInsideNativeChatRoot(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NATIVE_CHAT_ROOT_SELECTOR) !== null
}

function formatClipboardImagePasteError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Image paste failed: ${detail}`
}

type TerminalPaneSurfaceContext = Record<string, any>

export function useTerminalPaneSurfaceInputEffects(context: TerminalPaneSurfaceContext): void {
  const {
    isVisible,
    isActive,
    managerRef,
    paneTransportsRef,
    containerRef,
    worktreeId,
    forceBracketedMultilineTextPaste,
    setTerminalError,
    tabId,
    keybindings,
    clearTerminalTabUnread,
    clearWorktreeUnread,
    clearTerminalPaneUnread,
    paneCount,
  } = context
  useEffect(() => {
    if (
      !(globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ ||
      !isVisible ||
      !isActive
    ) {
      return
    }

    const cleanupCallbacks: (() => void)[] = []
    const fitAndForward = (): void => {
      const manager = managerRef.current
      if (!manager) {
        return
      }
      for (const pane of manager.getPanes()) {
        safeFitAndThen(pane, 'web-client-pty-resize', () => {
          const transport = paneTransportsRef.current.get(pane.id)
          if (!transport?.isConnected()) {
            return
          }
          const ptyId = transport.getPtyId()
          if (!ptyId) {
            return
          }
          // Why: match pty-connection resize guards so web refits don't forward SIGWINCH during mobile-lock or phone-fit overrides.
          if (getFitOverrideForPty(ptyId) || isPtyLocked(ptyId)) {
            return
          }
          // Why: skip forwarding a stale near-zero fit to the host PTY while the overlay is still settling after a worktree switch.
          if (pane.terminal.cols < 8 || pane.terminal.rows < 4) {
            return
          }
          transport.resize(pane.terminal.cols, pane.terminal.rows)
        })
      }
    }
    const scheduleFrame = (): void => {
      const frameId = requestAnimationFrame(fitAndForward)
      cleanupCallbacks.push(() => cancelAnimationFrame(frameId))
    }
    const scheduleTimer = (delayMs: number): void => {
      const timerId = window.setTimeout(fitAndForward, delayMs)
      cleanupCallbacks.push(() => window.clearTimeout(timerId))
    }

    // Why: web-restored terminals can fit before the remote PTY transport is ready (xterm no-op), so forward the settled cols explicitly.
    scheduleFrame()
    scheduleTimer(50)
    scheduleTimer(150)
    scheduleTimer(400)
    scheduleTimer(900)

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup()
      }
    }
  }, [isActive, isVisible])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let ownsRegularTerminalFocus = false
    let releasedHelperOnWindowBlur: HTMLElement | null = null
    // Why: the IME refresh's blur emits a focusout that would clear terminalInputFocused mid-handoff; latch it so Terminal-first shortcut routing survives until refocus.
    let refreshingImeInputContext = false
    const syncFocused = (focused: boolean): void => {
      ownsRegularTerminalFocus = focused
      if (focused) {
        releasedHelperOnWindowBlur = null
      }
      setRegularTerminalInputFocusAttribute(focused)
      window.api.ui.setTerminalInputFocused?.(focused)
    }
    const onFocusIn = (event: FocusEvent): void => {
      if (!isXtermHelperTextarea(event.target)) {
        return
      }
      syncFocused(true)
      // Why: helper→helper handoffs skip window blur and can leave a stale macOS NSTextInputContext; the refocus's non-helper relatedTarget prevents recursion.
      if (isXtermHelperTextarea(event.relatedTarget) && event.relatedTarget !== event.target) {
        refreshingImeInputContext = true
        try {
          refreshTerminalImeInputContext(event.target, {})
        } finally {
          refreshingImeInputContext = false
        }
      }
    }
    const onFocusOut = (event: FocusEvent): void => {
      if (!isXtermHelperTextarea(event.target)) {
        return
      }
      if (isXtermHelperTextarea(event.relatedTarget)) {
        return
      }
      if (refreshingImeInputContext) {
        return
      }
      syncFocused(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      releaseTerminalFocusForOutsidePointerDown({
        container,
        activeElement: document.activeElement,
        pointerTarget: event.target,
        syncFocused
      })
    }
    const onWindowBlur = (): void => {
      // Why: webview/browser handoff keeps the helper textarea focused, so clear only the main-process mirror and let guest focus proceed.
      releasedHelperOnWindowBlur = releaseTerminalFocusForWindowBlur({
        container,
        activeElement: document.activeElement,
        syncFocused
      })
    }
    const onWindowFocus = (): void => {
      // Why: app reactivation may keep DOM focus on xterm after blur cleared the shortcut mirror, or move focus to body/null.
      if (
        resyncTerminalFocusForWindowFocus({
          container,
          activeElement: document.activeElement,
          syncFocused,
          releasedHelper: releasedHelperOnWindowBlur
        })
      ) {
        releasedHelperOnWindowBlur = null
      }
    }

    if (
      isXtermHelperTextarea(document.activeElement) &&
      container.contains(document.activeElement)
    ) {
      syncFocused(true)
    }
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', onFocusOut)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)
    return () => {
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      // Why: the helper textarea may be gone before cleanup reads document.activeElement, so clear by this pane's mirrored ownership.
      if (ownsRegularTerminalFocus) {
        syncFocused(false)
      }
    }
  }, [])

  // Intercept paste at keydown: Chromium fires no paste event for image-only clipboard on a textarea (xterm's focus target), so image pastes would be lost.
  // Paste-event handler is a fallback for non-keyboard triggers; it also bypasses Chromium's clipboard pipeline that intermittently fails concurrent CLI reads.
  useEffect(() => {
    if (!isActive) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }

    const isMac = navigator.userAgent.includes('Mac')
    const shortcutPlatform: NodeJS.Platform = isMac
      ? 'darwin'
      : navigator.userAgent.includes('Windows')
        ? 'win32'
        : 'linux'

    const isPanePasteTargetMounted = (
      pane: ManagedPane,
      transport: PtyTransport | undefined,
      ptyId: string | null
    ): boolean => {
      return isTerminalPanePasteTargetCurrent({
        manager: managerRef.current,
        paneTransports: paneTransportsRef.current,
        paneId: pane.id,
        leafId: pane.leafId,
        transport,
        ptyId
      })
    }

    const executePanePasteText = async (
      pane: ManagedPane,
      source: TerminalPasteSource,
      activeElementAtDispatch: Element | null,
      text: string,
      options?: TerminalPasteTextOptions
    ): Promise<void> => {
      const connectionId = getConnectionId(worktreeId) ?? null
      const transport = paneTransportsRef.current.get(pane.id)
      const ptyId = transport?.getPtyId() ?? null
      const keyboardOwnedPaste =
        source === 'keyboard' || source === 'paste-event' || source === 'app-menu'
      const plan = await planTerminalPasteWithYield({
        text,
        source,
        target: {
          kind: 'terminal',
          paneId: pane.id,
          leafId: pane.leafId,
          ptyId,
          runtime: resolveTerminalPasteRuntime({
            platform: shortcutPlatform,
            ptyId,
            connectionId,
            remotePlatform: getTerminalPasteSshRemotePlatform(connectionId),
            transport,
            isWindowsConpty: forceBracketedMultilineTextPaste
          })
        },
        forceBracketedPaste: options?.forceBracketedPaste,
        forceBracketedPasteForMultiline: options?.forceBracketedPasteForMultiline,
        terminalBracketedPasteMode: pane.terminal.modes.bracketedPasteMode
      })
      const execution = await executeTerminalPastePlan(plan, {
        pasteText: (pasteText, pasteOptions) =>
          pasteTerminalText(pane.terminal, pasteText, pasteOptions),
        writePty: (data) => writeTerminalPastePtyInput(transport, data),
        isTargetCurrent: () => {
          if (!isPanePasteTargetMounted(pane, transport, ptyId)) {
            return false
          }
          return isTerminalPanePasteFocusCurrent({
            requireSameFocusedElement: keyboardOwnedPaste,
            activeElementAtDispatch,
            paneContainer: pane.container
          })
        },
        canContinue: () => isPanePasteTargetMounted(pane, transport, ptyId)
      })
      if (execution.status !== 'pasted') {
        setTerminalError(formatTerminalPasteExecutionError(execution.reason))
        return
      }
      if (text) {
        recordTerminalUserInputForLeaf(tabId, pane.leafId)
      }
      if (options?.recoverImagePasteWebglAtlas) {
        scheduleImagePasteWebglAtlasRecovery()
      }
    }

    const pasteFromClipboard = (
      pane: ManagedPane,
      source: Extract<TerminalPasteSource, 'keyboard' | 'paste-event'>,
      readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string> = window.api.ui
        .readClipboardText
    ): void => {
      const connectionId = getConnectionId(worktreeId) ?? null
      const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(
        useAppStore.getState(),
        worktreeId
      )
      const activeElementAtDispatch = document.activeElement
      void pasteTerminalClipboard({
        readClipboardText,
        saveClipboardImageAsTempFile: window.api.ui.saveClipboardImageAsTempFile,
        connectionId,
        runtimeEnvironmentId,
        forceBracketedMultilineTextPaste,
        pasteText: (text, options) =>
          executePanePasteText(pane, source, activeElementAtDispatch, text, options),
        onTextPasteError: () =>
          setTerminalError('Paste failed: clipboard text is too large for a safe terminal paste.'),
        onImagePasteError: (error) => setTerminalError(formatClipboardImagePasteError(error))
      }).catch(() => {
        setTerminalError('Paste failed.')
      })
    }

    let suppressNextNativePaste = false
    let pasteSuppressionTimerId: number | null = null
    const shouldSuppressNativePaste = (e: KeyboardEvent): boolean => {
      const key = e.key.toLowerCase()
      return (
        (isMac && key === 'v' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) ||
        (!isMac && key === 'v' && e.ctrlKey && !e.metaKey && !e.altKey) ||
        (!isMac && e.key === 'Insert' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey)
      )
    }
    const onKeyPaste = (e: KeyboardEvent): void => {
      const target = e.target
      if (
        (target instanceof Element && target.closest('[data-terminal-search-root]')) ||
        isInsideNativeChatRoot(target)
      ) {
        return
      }
      const matchesPaste = keybindingMatchesAction(
        'terminal.paste',
        e,
        shortcutPlatform,
        keybindings,
        { context: 'terminal' }
      )
      if (!matchesPaste) {
        if (shouldSuppressNativePaste(e)) {
          // Why: bare Ctrl+V is readline's quote-insert on Windows/Linux; suppress the native paste Chromium may add while letting xterm keep the keydown.
          suppressNextNativePaste = true
          if (pasteSuppressionTimerId !== null) {
            window.clearTimeout(pasteSuppressionTimerId)
          }
          pasteSuppressionTimerId = window.setTimeout(() => {
            pasteSuppressionTimerId = null
            suppressNextNativePaste = false
          }, 0)
        }
        return
      }
      if (isClipboardEventPasteRequired() && firesNativePasteEvent(e, isMac)) {
        // Why: without navigator.clipboard the chord's native paste event is the
        // only clipboard access — let its default fire and handle it in onPaste.
        // A remapped chord (e.g. Ctrl+Y) fires no paste event, so keep consuming it
        // below instead of letting xterm encode it to the PTY as a raw control char.
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const pane = manager.getActivePane() ?? manager.getPanes()[0]
      if (!pane) {
        return
      }
      suppressNextNativePaste = true
      if (pasteSuppressionTimerId !== null) {
        window.clearTimeout(pasteSuppressionTimerId)
      }
      pasteSuppressionTimerId = window.setTimeout(() => {
        pasteSuppressionTimerId = null
        suppressNextNativePaste = false
      }, 0)
      pasteFromClipboard(pane, 'keyboard')
    }

    // Fallback: paste events from non-keyboard sources (Edit > Paste menu, programmatic paste, etc.).
    const onPaste = (e: ClipboardEvent): void => {
      const target = e.target
      if (
        (target instanceof Element && target.closest('[data-terminal-search-root]')) ||
        isInsideNativeChatRoot(target)
      ) {
        return
      }
      if (suppressNextNativePaste) {
        suppressNextNativePaste = false
        if (pasteSuppressionTimerId !== null) {
          window.clearTimeout(pasteSuppressionTimerId)
          pasteSuppressionTimerId = null
        }
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const pane = manager.getActivePane() ?? manager.getPanes()[0]
      if (!pane) {
        return
      }
      if (isClipboardEventPasteRequired()) {
        const eventText = getClipboardEventText(e)
        pasteFromClipboard(pane, 'paste-event', (options) =>
          assertClipboardTextWithinLimitWithYield(eventText, options)
        )
        return
      }
      pasteFromClipboard(pane, 'paste-event')
    }

    const onAppMenuPaste = (event: Event): void => {
      const activeElementAtDispatch = document.activeElement
      if (
        !(activeElementAtDispatch instanceof Element) ||
        !container.contains(activeElementAtDispatch) ||
        activeElementAtDispatch.closest('[data-terminal-search-root]') ||
        isInsideNativeChatRoot(activeElementAtDispatch)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const manager = managerRef.current
      if (!manager) {
        return
      }
      const pane = manager.getActivePane() ?? manager.getPanes()[0]
      if (!pane) {
        return
      }
      const connectionId = getConnectionId(worktreeId) ?? null
      const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(
        useAppStore.getState(),
        worktreeId
      )
      void pasteTerminalClipboard({
        readClipboardText: window.api.ui.readClipboardText,
        saveClipboardImageAsTempFile: window.api.ui.saveClipboardImageAsTempFile,
        connectionId,
        runtimeEnvironmentId,
        forceBracketedMultilineTextPaste,
        pasteText: (text, options) =>
          executePanePasteText(pane, 'app-menu', activeElementAtDispatch, text, options),
        onTextPasteError: () =>
          setTerminalError('Paste failed: clipboard text is too large for a safe terminal paste.'),
        onImagePasteError: (error) => setTerminalError(formatClipboardImagePasteError(error))
      }).catch(() => {
        setTerminalError('Paste failed.')
      })
    }

    container.addEventListener('keydown', onKeyPaste, { capture: true })
    container.addEventListener('paste', onPaste, { capture: true })
    window.addEventListener(APP_MENU_PASTE_EVENT, onAppMenuPaste)
    return () => {
      if (pasteSuppressionTimerId !== null) {
        window.clearTimeout(pasteSuppressionTimerId)
      }
      container.removeEventListener('keydown', onKeyPaste, { capture: true })
      container.removeEventListener('paste', onPaste, { capture: true })
      window.removeEventListener(APP_MENU_PASTE_EVENT, onAppMenuPaste)
    }
  }, [isActive, worktreeId, keybindings, forceBracketedMultilineTextPaste, tabId])

  // Dismiss the pane's attention indicator on click (ghostty "show until interact"); pointerdown covers the mouse path onData doesn't.
  // NOT gated on isActive: clicking a visible-but-inactive split pane must clear the worktree dot before focusGroup re-renders it active.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => {
      clearTerminalTabUnread(tabId)
      clearWorktreeUnread(worktreeId)
      const paneElement =
        event.target instanceof Element ? event.target.closest('.pane[data-leaf-id]') : null
      const leafId = paneElement?.getAttribute('data-leaf-id')
      if (leafId) {
        clearTerminalPaneUnread(makePaneKey(tabId, leafId))
      }
    }
    container.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
    }
  }, [tabId, worktreeId, clearTerminalTabUnread, clearTerminalPaneUnread, clearWorktreeUnread])

  const applyTerminalPaneAttention = useCallback(() => {
    const manager = managerRef.current
    if (!manager) {
      return
    }
    applyTerminalPaneAttentionToManager(manager, tabId)
  }, [tabId])

  useLayoutEffect(() => {
    applyTerminalPaneAttention()
    return subscribeTerminalPaneAttention(tabId, applyTerminalPaneAttention)
  }, [tabId, paneCount, applyTerminalPaneAttention])

}
