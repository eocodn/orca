import type { IDisposable } from '@xterm/xterm'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import type { PaneSpawnHints } from '@/lib/pane-manager/pane-manager-types'
import {
  armTerminalImePendingCandidateKeyRelease,
  clearTerminalImePendingCandidateKeyRelease,
  createTerminalImePendingCandidateKeyReleases,
  shouldApplyTerminalImePendingCandidateKeyRelease
} from './terminal-ime-candidate-key-release-guard'
import {
  DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES,
  getMacNativeTextInputSourceTracker
} from './terminal-ime-input-source'
import { installTerminalImeCompositionTracker } from './terminal-ime-composition-tracker'
import { installTerminalImeLinuxCandidateState } from './terminal-ime-linux-candidate-state'
import { installTerminalImeNativeTextForwarder } from './terminal-ime-native-text-forwarder'
import { resolveTerminalJisYenInput } from './terminal-jis-yen-input'
import {
  shouldBypassXtermKeyboardEvent,
  shouldHandleTerminalInterruptKeyboardEvent,
  shouldPreventDefaultTerminalImeCandidateKey,
  shouldSuppressTerminalImeKeyboardEvent,
  shouldSuppressTerminalInterruptKeyup,
  shouldSuppressTerminalModifierKeyboardEvent,
  TERMINAL_INTERRUPT_INPUT
} from './xterm-bypass-policy'
import { markTerminalPinnedViewport } from '@/lib/pane-manager/terminal-scroll-intent'
import { syncTerminalScrollIntentSoon } from '@/lib/pane-manager/terminal-scroll-intent-settle'
import {
  createFilePathLinkProvider,
  installFilePathLinkClickFallback
} from './terminal-link-handlers'
import { createTerminalHandleLinkProvider } from './terminal-handle-links'
import { installHttpLinkClickFallback } from './terminal-url-link-hit-testing'
import { installTerminalLinkifierClickPriming } from './terminal-linkifier-click-priming'
import { handleOscLink } from './terminal-osc-link-routing'
import { guardParserHandler } from './terminal-parser-handler-guard'
import { parseOsc7 } from './parse-osc7'
import { createOsc52OscHandler } from './osc52-clipboard'
import {
  showOsc52ClipboardBlockedToast,
  showOsc52ClipboardFailedToast
} from './osc52-clipboard-toast'
import { copyTerminalSelection } from './terminal-selection-copy'
import { isPaneReplaying } from './replay-guard'
import { isPrimarySelectionEnabled, setPrimarySelectionText } from '@/lib/primary-selection'
import { installMouseHideWhileTyping } from './mouse-hide-while-typing'
import { seedStartupSessionRestoredBanner } from './session-restored-banner-pane-state'
import { connectPanePty } from './pty-connection'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import type { TerminalPaneLifecycleContext } from './terminal-pane-lifecycle-contracts'
import {
  clearQueuedInitialCwdAfterFirstPane,
  formatTerminalUrlTooltip,
  resolvePaneSeedCwd,
  terminalSelectionExceedsPrimaryLimit
} from './terminal-pane-lifecycle-policies'
import { resetTerminalKeyboardProtocolAfterInterrupt } from './terminal-pane-lifecycle-support'

export function createPaneCreatedHandler(
  context: TerminalPaneLifecycleContext
): (pane: ManagedPane, spawnHints?: PaneSpawnHints) => void {
  const { deps: d, refs } = context
  return (pane, spawnHints) => {
    const osc52Disposable = pane.terminal.parser.registerOscHandler(
      52,
      guardParserHandler(
        'osc-52-clipboard',
        createOsc52OscHandler({
          getSettingEnabled: () => d.settingsRef.current?.terminalAllowOsc52Clipboard,
          getReplaying: () => isPaneReplaying(d.replayingPanesRef, pane.id),
          writeClipboardText: (text) => window.api.ui.writeTerminalClipboardText(text),
          showBlockedWriteToast: showOsc52ClipboardBlockedToast,
          showWriteFailedToast: showOsc52ClipboardFailedToast
        })
      )
    )
    refs.osc52DisposablesRef.current.set(pane.id, osc52Disposable)

    if (!d.paneCwdRef.current.has(pane.id)) {
      d.paneCwdRef.current.set(pane.id, {
        cwd: resolvePaneSeedCwd(spawnHints?.cwd, context.ptyDeps.cwd ?? context.startupCwd),
        confirmed: false
      })
    }
    const osc7Disposable = pane.terminal.parser.registerOscHandler(
      7,
      guardParserHandler('osc-7-cwd', (data) => {
        const parsedCwd = parseOsc7(data, { uncHost: context.osc7UncHost })
        if (parsedCwd) {
          const confirmed = !isPaneReplaying(d.replayingPanesRef, pane.id)
          d.paneCwdRef.current.set(pane.id, { cwd: parsedCwd, confirmed })
        }
        return true
      })
    )
    refs.osc7DisposablesRef.current.set(pane.id, osc7Disposable)

    installKeyboardHandler(context, pane)

    const linkProviderDisposable = pane.terminal.registerLinkProvider(
      createFilePathLinkProvider(pane.id, context.linkDeps, pane.linkTooltip, context.fileOpenLinkHint)
    )
    refs.linkProviderDisposablesRef.current.set(pane.id, linkProviderDisposable)
    const terminalHandleLinkDisposable = pane.terminal.registerLinkProvider(
      createTerminalHandleLinkProvider({
        getTerminal: () =>
          d.managerRef.current?.getPanes().find((candidate) => candidate.id === pane.id)?.terminal ??
          null,
        getRuntimeEnvironmentId: () => context.linkDeps.getRuntimeEnvironmentIdForPane?.(pane.id) ?? null,
        linkTooltip: pane.linkTooltip
      })
    )
    refs.terminalHandleLinkDisposablesRef.current.set(pane.id, terminalHandleLinkDisposable)
    refs.linkifierClickPrimingDisposablesRef.current.set(
      pane.id,
      installTerminalLinkifierClickPriming(pane.terminal)
    )
    refs.fileLinkClickFallbackDisposablesRef.current.set(
      pane.id,
      installFilePathLinkClickFallback(pane.id, pane.terminal, context.linkDeps)
    )
    refs.httpLinkClickFallbackDisposablesRef.current.set(
      pane.id,
      installHttpLinkClickFallback(pane.terminal, {
        ...context.linkDeps,
        requestOpenLinksInAppPreference: d.requestOpenLinksInAppPreference
      })
    )
    seedStartupSessionRestoredBanner(
      context.ptyDeps.startup,
      pane.id,
      d.onShowSessionRestoredBanner
    )

    const selectionDisposable = pane.terminal.onSelectionChange(() => {
      const shouldWritePrimarySelection = isPrimarySelectionEnabled()
      const shouldWriteClipboard = d.settingsRef.current?.terminalClipboardOnSelect === true
      if (!shouldWritePrimarySelection && !shouldWriteClipboard) {
        return
      }
      if (!pane.terminal.hasSelection()) {
        return
      }
      if (
        shouldWritePrimarySelection &&
        !shouldWriteClipboard &&
        terminalSelectionExceedsPrimaryLimit(pane.terminal)
      ) {
        return
      }
      if (shouldWritePrimarySelection) {
        const existingTimer = refs.selectionCaptureTimersRef.current.get(pane.id)
        if (existingTimer !== undefined) {
          window.clearTimeout(existingTimer)
        }
        const timer = window.setTimeout(() => {
          refs.selectionCaptureTimersRef.current.delete(pane.id)
          if (!isPrimarySelectionEnabled() || !pane.terminal.hasSelection()) {
            return
          }
          if (terminalSelectionExceedsPrimaryLimit(pane.terminal)) {
            return
          }
          const selection = pane.terminal.getSelection()
          if (selection) {
            setPrimarySelectionText(selection)
          }
        }, 100)
        refs.selectionCaptureTimersRef.current.set(pane.id, timer)
      }
      if (!shouldWriteClipboard) {
        return
      }
      void copyTerminalSelection({
        terminal: pane.terminal,
        writeClipboardText: window.api.ui.writeTerminalClipboardText
      }).catch(() => {
        /* Clipboard failures do not affect terminal lifecycle. */
      })
    })
    refs.selectionDisposablesRef.current.set(pane.id, selectionDisposable)
    if (d.settingsRef.current?.terminalMouseHideWhileTyping) {
      refs.mouseHideDisposablesRef.current.set(
        pane.id,
        installMouseHideWhileTyping(pane.terminal, pane.container)
      )
    }

    let oscTooltipHoverToken = 0
    pane.terminal.options.linkHandler = {
      allowNonHttpProtocols: true,
      activate: (event, text) => {
        const handled = handleOscLink(text, event as MouseEvent | undefined, {
          ...context.linkDeps,
          startupCwd: context.getPaneLinkCwd(pane.id),
          runtimeEnvironmentId: context.linkDeps.getRuntimeEnvironmentIdForPane?.(pane.id) ?? null,
          requestOpenLinksInAppPreference: d.requestOpenLinksInAppPreference
        })
        if (handled) {
          pane.terminal.clearSelection()
        }
      },
      hover: (_event, text) => {
        oscTooltipHoverToken += 1
        const hoverToken = oscTooltipHoverToken
        pane.linkTooltip.textContent = `${text} (${context.getUrlOpenLinkHint()})`
        pane.linkTooltip.style.display = ''
        void formatTerminalUrlTooltip(text, context.getUrlOpenLinkHint()).then((nextText) => {
          if (hoverToken === oscTooltipHoverToken && nextText) {
            pane.linkTooltip.textContent = nextText
          }
        })
      },
      leave: () => {
        oscTooltipHoverToken += 1
        pane.linkTooltip.style.display = 'none'
      }
    }

    const currentManager = d.managerRef.current
    if (!currentManager) {
      throw new Error('PaneManager must be mounted before creating a terminal pane')
    }
    context.applyAppearance(currentManager)
    const panePtyBinding = connectPanePty(pane, currentManager, {
      ...context.ptyDeps,
      ...(spawnHints?.cwd ? { cwd: spawnHints.cwd } : {}),
      restoredPtyIdByLeafId: spawnHints?.ptyId
        ? { ...context.ptyDeps.restoredPtyIdByLeafId, [pane.leafId]: spawnHints.ptyId }
        : context.ptyDeps.restoredPtyIdByLeafId,
      restoredLeafId: pane.leafId
    })
    context.ptyDeps.startup = null
    const nextInitialCwdState = clearQueuedInitialCwdAfterFirstPane(
      refs.queuedInitialCwdRef.current,
      context.defaultTabCwd,
      context.ptyDeps.cwd ?? context.startupCwd
    )
    refs.queuedInitialCwdRef.current = nextInitialCwdState.queuedInitialCwd
    context.ptyDeps.cwd = nextInitialCwdState.ptyCwd
    d.panePtyBindingsRef.current.set(pane.id, panePtyBinding)
    context.syncPaneCount()
    scheduleRuntimeGraphSync()
    context.queueResizeAll(true)
  }
}

function installKeyboardHandler(
  context: TerminalPaneLifecycleContext,
  pane: ManagedPane
): void {
  const { deps: d, refs } = context
  let pendingTerminalInterruptKeyup = false
  const pendingCandidateReleases = createTerminalImePendingCandidateKeyReleases()
  const isMac = navigator.userAgent.includes('Mac')
  const isLinux = !isMac && navigator.userAgent.includes('Linux') && !/Android|CrOS/.test(navigator.userAgent)
  const linuxCandidateState = isLinux ? installTerminalImeLinuxCandidateState(pane.terminal.element) : null
  const sourceTracker = isMac ? getMacNativeTextInputSourceTracker() : null
  const compositionTracker = installTerminalImeCompositionTracker(pane.terminal.element)
  refs.imeCompositionDisposablesRef.current.set(pane.id, {
    dispose: () => {
      compositionTracker.dispose()
      linuxCandidateState?.dispose()
    }
  })
  const nativeForwarder = isMac
    ? installTerminalImeNativeTextForwarder({
        terminalElement: pane.terminal.element,
        isComposing: () => compositionTracker.isActive(),
        sendInput: (data) => pane.terminal.input(data),
        getInputSourceFeatures: () =>
          sourceTracker?.getFeatures() ?? DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES
      })
    : { claimKeyEvent: () => false, dispose: () => undefined }
  refs.imeNativeTextForwarderDisposablesRef.current.set(pane.id, nativeForwarder)

  pane.terminal.attachCustomKeyEventHandler((event) => {
    const classification = linuxCandidateState?.classifyKeyboardEvent(event) ?? {
      candidateDigitGuardActive: false
    }
    const observe = (): void => linuxCandidateState?.observeKeyboardEvent(event, classification)
    const now = Date.now()
    const pendingReleaseActive = shouldApplyTerminalImePendingCandidateKeyRelease(
      event,
      pendingCandidateReleases,
      now
    )
    const imeOptions = {
      compositionActive: compositionTracker.isActive(),
      candidateKeyGuardActive:
        compositionTracker.isCandidateKeyGuardActive() || pendingReleaseActive,
      pendingCandidateKeyReleaseActive: pendingReleaseActive,
      linuxOrphanCandidateDigitGuardActive: classification.candidateDigitGuardActive,
      isMac,
      isLinux
    }
    if (shouldSuppressTerminalImeKeyboardEvent(event, imeOptions)) {
      clearTerminalImePendingCandidateKeyRelease(pendingCandidateReleases, event)
      if (shouldPreventDefaultTerminalImeCandidateKey(event, imeOptions)) {
        event.preventDefault()
        armTerminalImePendingCandidateKeyRelease(pendingCandidateReleases, event, now)
      }
      observe()
      return false
    }
    clearTerminalImePendingCandidateKeyRelease(pendingCandidateReleases, event)
    if (pendingTerminalInterruptKeyup && shouldSuppressTerminalInterruptKeyup(event)) {
      pendingTerminalInterruptKeyup = false
      observe()
      return false
    }
    if (
      shouldHandleTerminalInterruptKeyboardEvent(event, {
        isMac,
        hasSelection: pane.terminal.hasSelection()
      })
    ) {
      if (event.type === 'keydown') {
        pendingTerminalInterruptKeyup = true
        pane.terminal.input(TERMINAL_INTERRUPT_INPUT)
        resetTerminalKeyboardProtocolAfterInterrupt(pane.terminal)
      } else {
        pendingTerminalInterruptKeyup = false
      }
      observe()
      return false
    }
    if (shouldSuppressTerminalModifierKeyboardEvent(event)) {
      observe()
      return false
    }
    const jisYenInput = resolveTerminalJisYenInput(event, {
      enabled: d.settingsRef.current?.terminalJISYenToBackslash === true,
      isMac
    })
    if (jisYenInput) {
      if (jisYenInput.type === 'input') {
        pane.terminal.input(jisYenInput.data)
      }
      observe()
      return false
    }
    if (event.type === 'keydown') {
      const shouldSync = (): boolean =>
        d.managerRef.current?.getPanes().some((candidate) => candidate.terminal === pane.terminal) === true
      if (event.key === 'PageUp' || event.key === 'Home') {
        markTerminalPinnedViewport(pane.terminal)
        syncTerminalScrollIntentSoon(pane.terminal, {
          preservePinnedAtBottom: true,
          shouldSync
        })
      } else if (event.key === 'PageDown' || event.key === 'End') {
        syncTerminalScrollIntentSoon(pane.terminal, { shouldSync })
      }
    }
    if (nativeForwarder.claimKeyEvent(event)) {
      observe()
      return false
    }
    const shouldBypass = shouldBypassXtermKeyboardEvent(event, {
      isMac,
      hasSelection: pane.terminal.hasSelection()
    })
    observe()
    return !shouldBypass
  })
}
