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

export function useTerminalPaneSurfaceRenderState(context: TerminalPaneSurfaceContext) {
  const {
    settings,
    systemPrefersDark,
    isVisible,
    shouldMeasureHiddenStartup,
    isActive,
    managerRef,
    sshReconnectTargetId,
    sshReconnectStatus,
    terminalError,
    setTerminalError,
    contextMenu,
    contextMenuLeafId,
    canToggleChatForLeaf,
    paneTitles,
    chatLeafId,
    isChatViewMode,
    isChatEligibleForLeaf,
    applyNativeChatLeafRoute,
    paneTransportsRef,
    resolveTitleAgentForLeaf,
    terminalTab,
    getTabWideAgentHintLeafId,
    getNativeChatLeafIds,
    tabAgentTypeByLeaf,
  } = context
  const effectiveAppearance = settings
    ? resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    : null
  const terminalBackground =
    settings?.terminalColorOverrides?.background ?? effectiveAppearance?.theme?.background
  // Why: app light/dark can diverge from the terminal theme, so pane-title contrast follows the effective terminal surface.
  const titleUsesLightSurface = isTerminalBackgroundLight(terminalBackground, {
    appSurface: effectiveAppearance?.mode,
    backgroundOpacity: settings?.terminalBackgroundOpacity
  })
  const paneTitleBackground =
    resolveOpaqueTerminalBackground(terminalBackground, {
      appSurface: effectiveAppearance?.mode,
      backgroundOpacity: settings?.terminalBackgroundOpacity
    }) ?? (titleUsesLightSurface ? '#ffffff' : '#000000')

  const terminalContentVisible = isVisible || shouldMeasureHiddenStartup
  const hiddenStartupStyle: CSSProperties = shouldMeasureHiddenStartup
    ? { opacity: 0, pointerEvents: 'none' }
    : {}
  const terminalContainerStyle: CSSProperties = {
    // Why: unfocused split groups keep a terminal visible; gating on isActive blanked the prior pane and exposed the white group body.
    display: terminalContentVisible ? 'flex' : 'none',
    // Why: split dividers overdraw into the pane, so overflow:hidden clips that pseudo-element paint at the terminal body.
    overflow: 'hidden',
    ...hiddenStartupStyle,
    ['--orca-terminal-divider-color' as string]:
      effectiveAppearance?.dividerColor ?? DEFAULT_TERMINAL_DIVIDER_DARK,
    ['--orca-terminal-divider-color-strong' as string]: normalizeColor(
      effectiveAppearance?.dividerColor,
      DEFAULT_TERMINAL_DIVIDER_DARK
    )
  }

  const activePane = managerRef.current?.getActivePane()
  const managedPanes = managerRef.current?.getPanes() ?? []
  const showSshReconnectOverlay = Boolean(
    isActive &&
    isVisible &&
    sshReconnectTargetId &&
    sshReconnectStatus &&
    sshReconnectStatus !== 'connected'
  )
  // Why: while the reconnect banner owns recovery, strip only the SSH-owned lines from the
  // (possibly aggregated) error, so a later successful connect can't flash the raw ssh:connect
  // failure and any unrelated error still surfaces after reconnect.
  useEffect(() => {
    if (!showSshReconnectOverlay || terminalError == null) {
      return
    }
    const kept = stripSshReconnectOwnedErrorLines(terminalError)
    if (kept !== terminalError) {
      setTerminalError(kept)
    }
  }, [showSshReconnectOverlay, terminalError])
  const menuPaneHasCustomTitle =
    contextMenu.menuPaneId !== null && Boolean(paneTitles[contextMenu.menuPaneId])
  const chatLeafStillMounted = chatLeafId
    ? managedPanes.some((pane) => pane.leafId === chatLeafId)
    : false
  useEffect(() => {
    const activeLeafId = activePane?.leafId ?? null
    const route = resolveNativeChatLeafRoute({
      isChatViewMode,
      chatLeafId,
      activeLeafId,
      chatLeafStillMounted,
      activeLeafIsEligible: isChatEligibleForLeaf(activeLeafId)
    })
    applyNativeChatLeafRoute(route)
  }, [
    isChatViewMode,
    chatLeafId,
    activePane?.leafId,
    chatLeafStillMounted,
    applyNativeChatLeafRoute,
    isChatEligibleForLeaf
  ])
  const chatPane =
    isChatViewMode && chatLeafId
      ? (managedPanes.find((pane) => pane.leafId === chatLeafId) ?? null)
      : null
  const chatPanePtyId = chatPane
    ? (paneTransportsRef.current.get(chatPane.id)?.getPtyId() ?? null)
    : null
  const chatPaneResolvedAgent = chatPane ? resolveTitleAgentForLeaf(chatPane.leafId) : null
  const chatPaneLaunchAgent = nativeChatLaunchAgentForLeaf({
    launchAgent: terminalTab?.launchAgent,
    launchAgentLeafId: getTabWideAgentHintLeafId(),
    leafId: chatPane?.leafId ?? null,
    leafIds: getNativeChatLeafIds()
  })
  const activePaneIsChatLeaf = Boolean(
    isChatViewMode && activePane?.leafId && activePane.leafId === chatLeafId
  )
  // A split can host different agents, so continuation resolves the specific leaf before using tab-wide hints.
  const resolveAgentForLeaf = (leafId: string | null): string | null => {
    const detectedAgent = leafId ? (tabAgentTypeByLeaf[leafId] ?? null) : null
    if (detectedAgent) {
      return detectedAgent
    }
    return (
      nativeChatLaunchAgentForLeaf({
        launchAgent: terminalTab?.launchAgent,
        launchAgentLeafId: getTabWideAgentHintLeafId(),
        leafId,
        leafIds: getNativeChatLeafIds()
      }) ?? resolveTitleAgentForLeaf(leafId)
    )
  }
  const activePaneCanContinueInNewSession = canContinueAgentSessionInNewSession(
    resolveAgentForLeaf(activePane?.leafId ?? null)
  )
  const contextMenuCanContinueInNewSession = canContinueAgentSessionInNewSession(
    resolveAgentForLeaf(contextMenuLeafId)
  )
  const activePaneCanToggleChat = canToggleChatForLeaf(activePane?.leafId ?? null)
  const contextMenuCanToggleChat = canToggleChatForLeaf(contextMenuLeafId)
  return {
    effectiveAppearance,
    terminalBackground,
    titleUsesLightSurface,
    paneTitleBackground,
    terminalContentVisible,
    hiddenStartupStyle,
    terminalContainerStyle,
    activePane,
    managedPanes,
    showSshReconnectOverlay,
    menuPaneHasCustomTitle,
    chatLeafStillMounted,
    chatPane,
    chatPanePtyId,
    chatPaneResolvedAgent,
    chatPaneLaunchAgent,
    activePaneIsChatLeaf,
    resolveAgentForLeaf,
    activePaneCanContinueInNewSession,
    contextMenuCanContinueInNewSession,
    activePaneCanToggleChat,
    contextMenuCanToggleChat,
  }
}
