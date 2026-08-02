import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { IDisposable } from '@xterm/xterm'
import { useAppStore } from '../../store'
import { isUnifiedTabPinned } from '@/store/pinned-tab-close-guard'
import { useLinkRoutingPreferenceDialog } from '@/components/link-routing-preference-dialog'
import { DaemonActionDialog, useDaemonActions } from '@/components/shared/useDaemonActions'
import { DEFAULT_TERMINAL_DIVIDER_DARK, isTerminalBackgroundLight, normalizeColor, resolveOpaqueTerminalBackground, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import type { ManagedPane, PaneExternalDropTarget, PaneManager } from '@/lib/pane-manager/pane-manager'
import TerminalSearch from '@/components/TerminalSearch'
import type { PtyTransport } from './pty-transport'
import type { PtyTransportRecoveryState } from './pty-transport-types'
import { fitPanes, isWindowsUserAgent } from './pane-helpers'
import { getConnectionId, getConnectionIdFromState } from '@/lib/connection-context'
import { getExplicitRuntimeEnvironmentIdForWorktree, getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { selectRuntimeAwareSshStatus, selectRuntimeAwareSshTargetLabel, selectRuntimeAwareSshTargetRemoved } from '@/store/slices/runtime-environment-ssh'
import { hydrateRuntimeEnvironmentSshState } from '@/runtime/runtime-environment-ssh-state'
import { handleInternalTerminalFileDrop } from './terminal-drop-handler'
import { recordTerminalUserInputForLeaf } from './terminal-input-activity'
import { collectLeafIdsInOrder, EMPTY_LAYOUT, serializeTerminalLayout } from './layout-serialization'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { applyExpandedLayoutTo, cancelPendingPaneSizeRefreshFrames, createExpandCollapseActions, restoreExpandedLayoutFrom } from './expand-collapse'
import { useTerminalKeyboardShortcuts, type SearchState } from './keyboard-handlers'
import type { MacOptionAsAlt } from './terminal-shortcut-policy'
import { useEffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/use-effective-mac-option-as-alt'
import { useTerminalFontZoom } from './useTerminalFontZoom'
import CloseTerminalDialog, { type CloseTerminalDialogCopyKind } from './CloseTerminalDialog'
import { MobileDriverOverlay } from './MobileDriverOverlay'
import { stripSshReconnectOwnedErrorLines, TerminalErrorToast } from './TerminalErrorToast'
import { TerminalSessionStateSaveFailureDialog } from './TerminalSessionStateSaveFailureDialog'
import TerminalContextMenu from './TerminalContextMenu'
import TerminalPaneHeaderOverlay, { type PaneTitleOverlayRect } from './TerminalPaneHeaderOverlay'
import { arePaneTitleOverlayRectsEqual, clearPaneTitleOverlayRects } from './pane-title-overlay-rects'
import NativeChatView from '../native-chat/NativeChatView'
import { splitTerminalPaneWithInheritedCwd } from './terminal-pane-split-with-inherited-cwd'
import { TerminalAgentSessionForkDialog } from './TerminalAgentSessionForkDialog'
import { AgentSessionContinuationDialog } from '@/components/agent-session-continuation/AgentSessionContinuationDialog'
import { SessionRestoredBannerPortals } from './SessionRestoredBannerPortals'
import { useSessionRestoredBannerDismiss } from './useSessionRestoredBannerDismiss'
import { addSessionRestoredBannerPaneId, dismissSessionRestoredBannerPaneIds, pruneSessionRestoredBannerPaneIds, removeSessionRestoredBannerPaneId, syncSessionRestoredBannerTitleSpace, type SessionRestoredBannerDismissEvent, type SessionRestoredBannerReason } from './session-restored-banner-pane-state'
import { useSystemPrefersDark } from './use-system-prefers-dark'
import { useTerminalPaneGlobalEffects } from './use-terminal-pane-global-effects'
import { useTerminalPaneLifecycle } from './use-terminal-pane-lifecycle'
import { useTerminalPaneContextMenu } from './use-terminal-pane-context-menu'
import { detachTerminalPaneToTab, isTerminalTabStripDropTarget, resolveTerminalTabStripDropTarget } from './terminal-pane-tab-detach'
import type { PreparedAgentSessionFork } from './terminal-agent-session-fork'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import { useNotificationDispatch } from './use-notification-dispatch'
import { connectPanePty } from './pty-connection'
import { resolveTerminalLayoutActiveLeafId } from './terminal-layout-leaf-ids'
import { shouldPreserveTerminalScrollbackBuffers } from '../../../../shared/workspace-session-terminal-buffers'
import { getMobileFitOverridePtyIds, getFitOverrideForPty, onOverrideChange } from '@/lib/pane-manager/mobile-fit-overrides'
import { shouldShowMobileDriverOverlay } from './mobile-driver-overlay-visibility'
import { getAllDrivers, getDriverForPty, isPtyLocked, onDriverChange } from '@/lib/pane-manager/mobile-driver-state'
import { shouldChatTakeOverMobileSurface } from '../native-chat/native-chat-send-eligibility'
import { canToggleNativeChat } from '../native-chat/native-chat-availability'
import { nativeChatLaunchAgentForLeaf, resolveNativeChatLeafRoute, type NativeChatLeafRoute } from '../native-chat/native-chat-leaf-routing'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import { resolvePaneKeyForManager } from '@/lib/pane-manager/pane-key-resolution'
import { safeFit, safeFitAndThen } from '@/lib/pane-manager/pane-tree-ops'
import { applyDesktopFitFallbackAfterReplay } from './desktop-fit-fallback'
import { clearTerminalScrollbackAndFollowOutput } from '@/lib/pane-manager/terminal-scrollback-clear'
import { captureTerminalShutdownLayout } from './terminal-shutdown-layout-capture'
import { getOverrideAffectedPanes, getPanesNeedingOverrideFit } from './override-affected-panes'
import { inspectRuntimeTerminalProcess, isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { clearWebRuntimeTerminalBuffer, closeWebRuntimeTerminal, updateWebRuntimePaneLayout } from '@/runtime/web-runtime-session'
import { armPrimarySelectionNativePasteSuppression, isPrimarySelectionEnabled, readPrimarySelectionText } from '@/lib/primary-selection'
import { APP_MENU_PASTE_EVENT } from '@/lib/app-menu-paste'
import { CODEX_ACCOUNT_RESTART_STARTUP } from '@/lib/codex-session-restart'
import { WORKSPACE_FILE_PATH_MIME, WORKSPACE_FILE_PATHS_MIME } from '@/lib/workspace-file-drag'
import { isTerminalSessionStateSaveFailure } from '../../../../shared/terminal-session-state-save-failure'
import { isTerminalZeroDimensionsDiagnostic } from '../../../../shared/terminal-zero-dimensions-diagnostic'
import { isSyntheticSinglePaneTitle, sanitizeTerminalLayoutPaneTitles } from '@/lib/terminal-pane-title-sanitization'
import { isHostAuthoritativeLayout, planTerminalLiveLayoutInsertions } from './terminal-live-layout-reconciliation'
import type { TerminalQuickCommand, TerminalQuickCommandScope } from '../../../../shared/types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree-id'
import { refitAndRefreshAllTerminalPanes } from '@/lib/pane-manager/pane-manager-registry'
import { getTerminalQuickCommandScope, isTerminalQuickCommandComplete, terminalQuickCommandMatchesRepo } from '../../../../shared/terminal-quick-commands'
import { createTerminalQuickCommandDraft, TerminalQuickCommandDialog } from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { pasteTerminalClipboard } from './terminal-clipboard-paste'
import { firesNativePasteEvent, getClipboardEventText, isClipboardEventPasteRequired } from './terminal-clipboard-event-paste'
import { assertClipboardTextWithinLimitWithYield, type ReadClipboardTextOptions } from '../../../../shared/clipboard-text'
import { scheduleImagePasteWebglAtlasRecovery } from './terminal-webgl-atlas-recovery'
import { restoreTerminalFitToDesktop, restoreTerminalFitsToDesktop } from './terminal-fit-restore'
import { useVisibleTerminalTabClaim } from './use-visible-terminal-tab-claim'
import { TerminalSshReconnectOverlay } from './TerminalSshReconnectOverlay'
import { TerminalRemoteRuntimeReconnectBanner } from './TerminalRemoteRuntimeReconnectBanner'
import { selectTerminalTabAgentTypesByLeaf } from './terminal-tab-agent-type-index'
import { canContinueAgentSessionInNewSession } from './terminal-agent-session-continuation'
import { updateTerminalRemoteRuntimeRecoveryUiState, type VisiblePtyRecoveryState } from './terminal-remote-runtime-recovery-ui-state'
import { shutdownBufferCaptures } from './shutdown-buffer-captures'
import { mergeCapturedLeafState } from './merge-captured-leaf-state'
import { pasteTerminalText } from './terminal-bracketed-paste'
import { executeTerminalPastePlan, planTerminalPasteWithYield, type TerminalPasteSource, type TerminalPasteTextOptions } from './terminal-paste-coordinator'
import { formatTerminalPasteExecutionError } from './terminal-paste-errors'
import { resolveTerminalPasteRuntime } from './terminal-paste-runtime'
import { getTerminalPasteSshRemotePlatform } from './terminal-paste-ssh-platform'
import { isTerminalPanePasteFocusCurrent, isTerminalPanePasteTargetCurrent } from './terminal-paste-target-state'
import { writeTerminalPastePtyInput } from './terminal-pty-paste-writer'
import { applyTerminalPaneAttentionToManager, subscribeTerminalPaneAttention } from './terminal-pane-attention-subscriptions'
import { getCachedTerminalTabForWorktree } from './terminal-tab-lookup'
import { getCachedTerminalGroupIdForWorktree, getCachedUnifiedTerminalTabForWorktree } from './terminal-unified-tab-lookup'
import { resolveNativeChatLeafTitleAgent } from './native-chat-leaf-title-agent'
import { useRepoById } from '@/store/selectors'
import { isXtermHelperTextarea, releaseTerminalFocusForOutsidePointerDown, releaseTerminalFocusForWindowBlur, resyncTerminalFocusForWindowFocus, setRegularTerminalInputFocusAttribute } from './regular-terminal-focus-ownership'
import { refreshTerminalImeInputContext } from './terminal-ime-input-context-refresh'

type TerminalPaneSurfaceContext = Record<string, any>

export function useTerminalPaneSurfaceInteractions(context: TerminalPaneSurfaceContext) {
  const {
    tabId,
    managerRef,
    paneTransportsRef,
    paneCwdRef,
    containerRef,
    worktreeId,
    quickCommandGroupId,
    cwd,
    toggleExpandPane,
    handleRequestClosePane,
    clearPaneScrollback,
    handleStartRename,
    handleClearPaneTitleShortcut,
    setTerminalError,
    setAgentSessionFork,
    setAgentSessionContinuation,
    forceBracketedMultilineTextPaste,
    rightClickToPaste,
    effectiveChatViewMode,
    chatLeafId,
    toggleNativeChatForLeaf,
    setOverrideTick,
    settingsRef,
  } = context
  const contextMenu = useTerminalPaneContextMenu({
    tabId,
    managerRef,
    paneTransportsRef,
    paneCwdRef,
    containerRef,
    worktreeId,
    groupId: quickCommandGroupId,
    fallbackCwd: cwd ?? '',
    toggleExpandPane,
    onRequestClosePane: handleRequestClosePane,
    onClearPaneScrollback: clearPaneScrollback,
    onSetTitle: handleStartRename,
    onClearPaneTitle: handleClearPaneTitleShortcut,
    onPasteError: setTerminalError,
    onAgentSessionForkReady: setAgentSessionFork,
    onAgentSessionContinuationReady: setAgentSessionContinuation,
    forceBracketedMultilineTextPaste,
    rightClickToPaste
  })
  const getContextMenuLeafId = useCallback((): string | null => {
    const paneId = contextMenu.menuPaneId
    const manager = managerRef.current
    if (!manager) {
      return null
    }
    if (paneId !== null) {
      return manager.getPanes().find((pane) => pane.id === paneId)?.leafId ?? null
    }
    return manager.getActivePane()?.leafId ?? null
  }, [contextMenu.menuPaneId])
  const contextMenuLeafId = getContextMenuLeafId()
  const contextMenuIsChatView = effectiveChatViewMode && contextMenuLeafId === chatLeafId
  const handleContextMenuToggleNativeChat = useCallback(() => {
    const leafId = getContextMenuLeafId()
    if (!leafId) {
      return
    }
    toggleNativeChatForLeaf(leafId)
  }, [getContextMenuLeafId, toggleNativeChatForLeaf])

  const getMobileOwnedTerminalPtyIds = useCallback((): string[] => {
    const ptyIds = new Set(getMobileFitOverridePtyIds())
    for (const [ptyId, driver] of getAllDrivers()) {
      if (driver.kind === 'mobile') {
        ptyIds.add(ptyId)
      }
    }
    return [...ptyIds]
  }, [])

  const scheduleRestoredTerminalRefit = useCallback((): void => {
    // Why: desktop-fit events can clear runtime state before xterm repaints, so schedule a settled-frame refit that doesn't depend on focus.
    requestAnimationFrame(refitAndRefreshAllTerminalPanes)
    window.setTimeout(refitAndRefreshAllTerminalPanes, 100)
  }, [])

  const restorePaneTerminalFit = useCallback(
    async (pane: ManagedPane, ptyId: string): Promise<void> => {
      // Why: local and remote runtime PTYs use different transports but share one reclaim behavior.
      // Why: the banner was rendered for this PTY; if the slot now holds a different terminal, bail so a stale portal can't reclaim it.
      const currentPtyId = paneTransportsRef.current.get(pane.id)?.getPtyId() ?? null
      if (currentPtyId !== ptyId) {
        setOverrideTick((n) => n + 1)
        return
      }
      const restored = await restoreTerminalFitToDesktop(ptyId, settingsRef.current ?? undefined)
      if (restored) {
        scheduleRestoredTerminalRefit()
        // Why: after the overlay unmounts, refocus the reclaimed terminal instead of the removed button/body.
        pane.terminal.focus()
      }
    },
    [scheduleRestoredTerminalRefit]
  )

  const restoreAllTerminalFits = useCallback(
    async (focusPane: ManagedPane): Promise<void> => {
      // Why: bulk restore follows the same reclaim path as the per-pane button for PTYs held at phone size.
      const restored = await restoreTerminalFitsToDesktop(
        getMobileOwnedTerminalPtyIds(),
        settingsRef.current ?? undefined
      )
      if (restored) {
        scheduleRestoredTerminalRefit()
        focusPane.terminal.focus()
      }
    },
    [getMobileOwnedTerminalPtyIds, scheduleRestoredTerminalRefit]
  )

  const terminalShouldHandleMiddleClick = useCallback(
    (target: EventTarget | null): target is Node => {
      if (!(target instanceof Element)) {
        return false
      }
      if (target.closest('[data-terminal-search-root]')) {
        return false
      }
      const editable = target.closest(
        'input, textarea, [contenteditable=""], [contenteditable="true"]'
      )
      return !editable || editable.classList.contains('xterm-helper-textarea')
    },
    []
  )

  const getPrimarySelectionMiddleClickPane = useCallback(
    (target: EventTarget | null) => {
      if (!terminalShouldHandleMiddleClick(target)) {
        return null
      }
      const manager = managerRef.current
      if (!manager) {
        return null
      }
      const clickedPane =
        manager.getPanes().find((pane) => pane.container.contains(target)) ??
        manager.getActivePane() ??
        manager.getPanes()[0]
      if (!clickedPane || clickedPane.terminal.modes.mouseTrackingMode !== 'none') {
        return null
      }
      return clickedPane
    },
    [terminalShouldHandleMiddleClick]
  )

  const handlePrimarySelectionMiddleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (event.button !== 1 || !isPrimarySelectionEnabled()) {
        return
      }
      const clickedPane = getPrimarySelectionMiddleClickPane(event.target)
      if (!clickedPane) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      // Why: preventDefault on mousedown does not stop Chromium's native
      // middle-click paste follow-up, so arm the shared window to swallow it and
      // avoid inserting text into the PTY twice.
      armPrimarySelectionNativePasteSuppression()
      clickedPane.terminal.focus()
      void readPrimarySelectionText().then(async (text) => {
        if (!text) {
          return
        }
        const transport = paneTransportsRef.current.get(clickedPane.id)
        const ptyId = transport?.getPtyId() ?? null
        const isMac = navigator.userAgent.includes('Mac')
        const shortcutPlatform: NodeJS.Platform = isMac
          ? 'darwin'
          : navigator.userAgent.includes('Windows')
            ? 'win32'
            : 'linux'
        const connectionId = getConnectionId(worktreeId) ?? null
        const targetStillMounted = (): boolean => {
          const manager = managerRef.current
          return Boolean(
            manager
              ?.getPanes()
              .some(
                (livePane) =>
                  livePane.id === clickedPane.id && livePane.leafId === clickedPane.leafId
              ) &&
            transport &&
            paneTransportsRef.current.get(clickedPane.id) === transport &&
            transport.isConnected() &&
            transport.getPtyId() === ptyId
          )
        }
        const plan = await planTerminalPasteWithYield({
          text,
          source: 'middle-click',
          target: {
            kind: 'terminal',
            paneId: clickedPane.id,
            leafId: clickedPane.leafId,
            ptyId,
            runtime: resolveTerminalPasteRuntime({
              platform: shortcutPlatform,
              ptyId,
              connectionId,
              remotePlatform: getTerminalPasteSshRemotePlatform(connectionId),
              transport
            })
          },
          terminalBracketedPasteMode: clickedPane.terminal.modes.bracketedPasteMode
        })
        const execution = await executeTerminalPastePlan(plan, {
          pasteText: (pasteText, pasteOptions) =>
            pasteTerminalText(clickedPane.terminal, pasteText, pasteOptions),
          writePty: (data) => writeTerminalPastePtyInput(transport, data),
          isTargetCurrent: targetStillMounted,
          canContinue: targetStillMounted
        })
        if (execution.status !== 'pasted') {
          setTerminalError(formatTerminalPasteExecutionError(execution.reason))
          return
        }
        recordTerminalUserInputForLeaf(tabId, clickedPane.leafId)
      })
    },
    [getPrimarySelectionMiddleClickPane, tabId, worktreeId]
  )

  const handlePrimarySelectionAuxClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (
        event.button === 1 &&
        isPrimarySelectionEnabled() &&
        getPrimarySelectionMiddleClickPane(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
        // Why: auxclick fires at button release, when Chromium's native paste is
        // imminent; re-arm here so a slow release past the mousedown window still
        // swallows the follow-up paste.
        armPrimarySelectionNativePasteSuppression()
      }
    },
    [getPrimarySelectionMiddleClickPane]
  )

  const activatePaneTitleInteraction = useCallback((paneId: number): void => {
    managerRef.current?.setActivePane(paneId, { focus: false })
  }, [])

  const splitTerminalPaneFromHeader = useCallback(
    (pane: ManagedPane, direction: 'vertical' | 'horizontal') => {
      const manager = managerRef.current
      if (!manager) {
        return
      }
      splitTerminalPaneWithInheritedCwd({
        manager,
        getManager: () => managerRef.current,
        paneTransports: paneTransportsRef.current,
        paneCwdMap: paneCwdRef.current,
        fallbackCwd: cwd ?? '',
        pane,
        direction,
        source: 'context_menu'
      })
    },
    [cwd]
  )

  const beginPaneDragFromHeader = useCallback(
    (paneId: number, handle: HTMLElement, event: PointerEvent) => {
      managerRef.current?.beginPaneDragFromPointerDown(paneId, handle, event)
    },
    []
  )

  return {
    contextMenu,
    getContextMenuLeafId,
    contextMenuLeafId,
    contextMenuIsChatView,
    handleContextMenuToggleNativeChat,
    getMobileOwnedTerminalPtyIds,
    scheduleRestoredTerminalRefit,
    restorePaneTerminalFit,
    restoreAllTerminalFits,
    terminalShouldHandleMiddleClick,
    getPrimarySelectionMiddleClickPane,
    handlePrimarySelectionMiddleMouseDown,
    handlePrimarySelectionAuxClick,
    activatePaneTitleInteraction,
    splitTerminalPaneFromHeader,
    beginPaneDragFromHeader,
  }
}
