import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { IDisposable } from '@xterm/xterm'
import { useAppStore } from '../../store'
import { isUnifiedTabPinned } from '@/store/pinned-tab-close-guard'
import { useLinkRoutingPreferenceDialog } from '@/components/link-routing-preference-dialog'
import { DaemonActionDialog, useDaemonActions } from '@/components/shared/useDaemonActions'
import {
  DEFAULT_TERMINAL_DIVIDER_DARK,
  isTerminalBackgroundLight,
  normalizeColor,
  resolveOpaqueTerminalBackground,
  resolveEffectiveTerminalAppearance
} from '@/lib/terminal-theme'
import type {
  ManagedPane,
  PaneExternalDropTarget,
  PaneManager
} from '@/lib/pane-manager/pane-manager'
import TerminalSearch from '@/components/TerminalSearch'
import type { PtyTransport } from './pty-transport'
import type { PtyTransportRecoveryState } from './pty-transport-types'
import { fitPanes, isWindowsUserAgent } from './pane-helpers'
import { getConnectionId, getConnectionIdFromState } from '@/lib/connection-context'
import {
  getExplicitRuntimeEnvironmentIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import {
  selectRuntimeAwareSshStatus,
  selectRuntimeAwareSshTargetLabel,
  selectRuntimeAwareSshTargetRemoved
} from '@/store/slices/runtime-environment-ssh'
import { hydrateRuntimeEnvironmentSshState } from '@/runtime/runtime-environment-ssh-state'
import { handleInternalTerminalFileDrop } from './terminal-drop-handler'
import { recordTerminalUserInputForLeaf } from './terminal-input-activity'
import {
  collectLeafIdsInOrder,
  EMPTY_LAYOUT,
  serializeTerminalLayout
} from './layout-serialization'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import {
  applyExpandedLayoutTo,
  cancelPendingPaneSizeRefreshFrames,
  createExpandCollapseActions,
  restoreExpandedLayoutFrom
} from './expand-collapse'
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
import {
  arePaneTitleOverlayRectsEqual,
  clearPaneTitleOverlayRects
} from './pane-title-overlay-rects'
import NativeChatView from '../native-chat/NativeChatView'
import { splitTerminalPaneWithInheritedCwd } from './terminal-pane-split-with-inherited-cwd'
import { TerminalAgentSessionForkDialog } from './TerminalAgentSessionForkDialog'
import { AgentSessionContinuationDialog } from '@/components/agent-session-continuation/AgentSessionContinuationDialog'
import { SessionRestoredBannerPortals } from './SessionRestoredBannerPortals'
import { useSessionRestoredBannerDismiss } from './useSessionRestoredBannerDismiss'
import {
  addSessionRestoredBannerPaneId,
  dismissSessionRestoredBannerPaneIds,
  pruneSessionRestoredBannerPaneIds,
  removeSessionRestoredBannerPaneId,
  syncSessionRestoredBannerTitleSpace,
  type SessionRestoredBannerDismissEvent,
  type SessionRestoredBannerReason
} from './session-restored-banner-pane-state'
import { useSystemPrefersDark } from './use-system-prefers-dark'
import { useTerminalPaneGlobalEffects } from './use-terminal-pane-global-effects'
import { useTerminalPaneLifecycle } from './use-terminal-pane-lifecycle'
import { useTerminalPaneContextMenu } from './use-terminal-pane-context-menu'
import {
  detachTerminalPaneToTab,
  isTerminalTabStripDropTarget,
  resolveTerminalTabStripDropTarget
} from './terminal-pane-tab-detach'
import type { PreparedAgentSessionFork } from './terminal-agent-session-fork'
import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import { useNotificationDispatch } from './use-notification-dispatch'
import { connectPanePty } from './pty-connection'
import { resolveTerminalLayoutActiveLeafId } from './terminal-layout-leaf-ids'
import { shouldPreserveTerminalScrollbackBuffers } from '../../../../shared/workspace-session-terminal-buffers'
import {
  getMobileFitOverridePtyIds,
  getFitOverrideForPty,
  onOverrideChange
} from '@/lib/pane-manager/mobile-fit-overrides'
import { shouldShowMobileDriverOverlay } from './mobile-driver-overlay-visibility'
import {
  getAllDrivers,
  getDriverForPty,
  isPtyLocked,
  onDriverChange
} from '@/lib/pane-manager/mobile-driver-state'
import { shouldChatTakeOverMobileSurface } from '../native-chat/native-chat-send-eligibility'
import { canToggleNativeChat } from '../native-chat/native-chat-availability'
import {
  nativeChatLaunchAgentForLeaf,
  resolveNativeChatLeafRoute,
  type NativeChatLeafRoute
} from '../native-chat/native-chat-leaf-routing'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import { resolvePaneKeyForManager } from '@/lib/pane-manager/pane-key-resolution'
import { safeFit, safeFitAndThen } from '@/lib/pane-manager/pane-tree-ops'
import { applyDesktopFitFallbackAfterReplay } from './desktop-fit-fallback'
import { clearTerminalScrollbackAndFollowOutput } from '@/lib/pane-manager/terminal-scrollback-clear'
import { captureTerminalShutdownLayout } from './terminal-shutdown-layout-capture'
import { getOverrideAffectedPanes, getPanesNeedingOverrideFit } from './override-affected-panes'
import {
  inspectRuntimeTerminalProcess,
  isRemoteRuntimePtyId
} from '@/runtime/runtime-terminal-inspection'
import {
  clearWebRuntimeTerminalBuffer,
  closeWebRuntimeTerminal,
  updateWebRuntimePaneLayout
} from '@/runtime/web-runtime-session'
import {
  armPrimarySelectionNativePasteSuppression,
  isPrimarySelectionEnabled,
  readPrimarySelectionText
} from '@/lib/primary-selection'
import { APP_MENU_PASTE_EVENT } from '@/lib/app-menu-paste'
import { CODEX_ACCOUNT_RESTART_STARTUP } from '@/lib/codex-session-restart'
import { WORKSPACE_FILE_PATH_MIME, WORKSPACE_FILE_PATHS_MIME } from '@/lib/workspace-file-drag'
import { isTerminalSessionStateSaveFailure } from '../../../../shared/terminal-session-state-save-failure'
import { isTerminalZeroDimensionsDiagnostic } from '../../../../shared/terminal-zero-dimensions-diagnostic'
import {
  isSyntheticSinglePaneTitle,
  sanitizeTerminalLayoutPaneTitles
} from '@/lib/terminal-pane-title-sanitization'
import {
  isHostAuthoritativeLayout,
  planTerminalLiveLayoutInsertions
} from './terminal-live-layout-reconciliation'
import type { TerminalQuickCommand, TerminalQuickCommandScope } from '../../../../shared/types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree-id'
import { refitAndRefreshAllTerminalPanes } from '@/lib/pane-manager/pane-manager-registry'
import {
  getTerminalQuickCommandScope,
  isTerminalQuickCommandComplete,
  terminalQuickCommandMatchesRepo
} from '../../../../shared/terminal-quick-commands'
import { createTerminalQuickCommandDraft } from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { pasteTerminalClipboard } from './terminal-clipboard-paste'
import {
  firesNativePasteEvent,
  getClipboardEventText,
  isClipboardEventPasteRequired
} from './terminal-clipboard-event-paste'
import {
  assertClipboardTextWithinLimitWithYield,
  type ReadClipboardTextOptions
} from '../../../../shared/clipboard-text'
import { scheduleImagePasteWebglAtlasRecovery } from './terminal-webgl-atlas-recovery'
import { restoreTerminalFitToDesktop, restoreTerminalFitsToDesktop } from './terminal-fit-restore'
import { useVisibleTerminalTabClaim } from './use-visible-terminal-tab-claim'
import { TerminalSshReconnectOverlay } from './TerminalSshReconnectOverlay'
import { TerminalRemoteRuntimeReconnectBanner } from './TerminalRemoteRuntimeReconnectBanner'
import { selectTerminalTabAgentTypesByLeaf } from './terminal-tab-agent-type-index'
import { canContinueAgentSessionInNewSession } from './terminal-agent-session-continuation'
import {
  updateTerminalRemoteRuntimeRecoveryUiState,
  type VisiblePtyRecoveryState
} from './terminal-remote-runtime-recovery-ui-state'

// Why: registry lives in a leaf module to break the slice → TerminalPane → store → slice import cycle that leaves createTerminalSlice undefined at init.
import { shutdownBufferCaptures } from './shutdown-buffer-captures'
import { mergeCapturedLeafState } from './merge-captured-leaf-state'
import { pasteTerminalText } from './terminal-bracketed-paste'
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
import { getCachedTerminalTabForWorktree } from './terminal-tab-lookup'
import {
  getCachedTerminalGroupIdForWorktree,
  getCachedUnifiedTerminalTabForWorktree
} from './terminal-unified-tab-lookup'
import { resolveNativeChatLeafTitleAgent } from './native-chat-leaf-title-agent'
import { useRepoById } from '@/store/selectors'
import {
  isXtermHelperTextarea,
  releaseTerminalFocusForOutsidePointerDown,
  releaseTerminalFocusForWindowBlur,
  resyncTerminalFocusForWindowFocus,
  setRegularTerminalInputFocusAttribute
} from './regular-terminal-focus-ownership'
import { refreshTerminalImeInputContext } from './terminal-ime-input-context-refresh'
import { TerminalPaneSurfaceMarkup } from './terminal-pane-view-surface-markup'

type TerminalPaneSurfaceContext = Record<string, any>

export function useTerminalPaneSurfaceCodexRestart(context: TerminalPaneSurfaceContext) {
  const {
    managerRef,
    paneTransportsRef,
    panePtyBindingsRef,
    suppressPtyExit,
    clearCodexRestartNotice,
    tabId,
    clearTabPtyId,
    syncPanePtyLayoutBinding,
    setCacheTimerStartedAt,
    setTerminalError,
    worktreeId,
    cwd,
    paneMode2031Ref,
    paneKittyKeyboardModesRef,
    paneLastThemeModeRef,
    replayingPanesRef,
    isActiveRef,
    isVisibleRef,
    onPtyExitRef,
    onAgentExitedRef,
    onPtyErrorRef,
    onPtyRecoveryStateRef,
    updateTabTitle,
    setRuntimePaneTitle,
    clearRuntimePaneTitle,
    updateTabPtyId,
    markWorktreeUnread,
    markTerminalTabUnread,
    markTerminalPaneUnread,
    clearWorktreeUnread,
    clearTerminalTabUnread,
    clearTerminalPaneUnread,
    showRestoredSessionBanner,
    dispatchNotification,
    clearExitedPanePtyLayoutBinding
  } = context
  const handleRestartCodexPane = useCallback(
    (paneId: number) => {
      const manager = managerRef.current
      const pane = manager?.getPanes().find((candidate) => candidate.id === paneId)
      if (!manager || !pane) {
        return
      }

      const transport = paneTransportsRef.current.get(paneId)
      const panePtyBinding = panePtyBindingsRef.current.get(paneId)
      const existingPtyId = transport?.getPtyId()

      if (existingPtyId) {
        suppressPtyExit(existingPtyId)
        clearCodexRestartNotice(existingPtyId)
        // Why: keep the pane mounted (clear binding, consume the suppressed exit) so a fresh PTY reconnects in place under the newly selected Codex account.
        clearTabPtyId(tabId, existingPtyId)
      }

      panePtyBinding?.dispose()
      panePtyBindingsRef.current.delete(paneId)
      syncPanePtyLayoutBinding(paneId, null)
      transport?.destroy?.()
      paneTransportsRef.current.delete(paneId)
      setCacheTimerStartedAt(makePaneKey(tabId, pane.leafId), null)
      setTerminalError(null)

      const newPaneBinding = connectPanePty(pane, manager, {
        tabId,
        worktreeId,
        cwd,
        startup: CODEX_ACCOUNT_RESTART_STARTUP,
        paneTransportsRef,
        paneMode2031Ref,
        paneKittyKeyboardModesRef,
        paneLastThemeModeRef,
        replayingPanesRef,
        isActiveRef,
        isVisibleRef,
        onPtyExitRef,
        onAgentExitedRef,
        onPtyErrorRef,
        onPtyRecoveryStateRef,
        clearTabPtyId,
        consumeSuppressedPtyExit: useAppStore.getState().consumeSuppressedPtyExit,
        isPtyShutdownPending: useAppStore.getState().isPtyShutdownPending,
        updateTabTitle,
        setRuntimePaneTitle,
        clearRuntimePaneTitle,
        updateTabPtyId,
        markWorktreeUnread,
        markTerminalTabUnread,
        markTerminalPaneUnread,
        clearWorktreeUnread,
        clearTerminalTabUnread,
        clearTerminalPaneUnread,
        onShowSessionRestoredBanner: showRestoredSessionBanner,
        dispatchNotification,
        setCacheTimerStartedAt,
        syncPanePtyLayoutBinding,
        clearExitedPanePtyLayoutBinding
      })
      panePtyBindingsRef.current.set(paneId, newPaneBinding)
      manager.setActivePane(paneId, { focus: true })
    },
    [
      clearCodexRestartNotice,
      clearExitedPanePtyLayoutBinding,
      clearRuntimePaneTitle,
      clearTabPtyId,
      cwd,
      dispatchNotification,
      markWorktreeUnread,
      markTerminalTabUnread,
      markTerminalPaneUnread,
      clearWorktreeUnread,
      clearTerminalTabUnread,
      clearTerminalPaneUnread,
      showRestoredSessionBanner,
      onAgentExitedRef,
      onPtyExitRef,
      setCacheTimerStartedAt,
      setRuntimePaneTitle,
      suppressPtyExit,
      syncPanePtyLayoutBinding,
      tabId,
      updateTabPtyId,
      updateTabTitle,
      worktreeId
    ]
  )
  return handleRestartCodexPane
}
