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

type TerminalPaneSurfaceContext = Record<string, any>

export function useTerminalPaneSurfaceStore(context: TerminalPaneSurfaceContext) {
  const {
    managerRef,
    nativeChatTranscriptIsLocalReadable,
    onAgentExitedRef,
    manager,
    pane,
    paneCount,
    chatLeafId,
    setChatLeafId,
    tabWideAgentHintLeafId,
    setTabWideAgentHintLeafId,
    tabId,
    worktreeId,
  } = context
  const setTabPaneExpanded = useAppStore((store) => store.setTabPaneExpanded)
  const setTabCanExpandPane = useAppStore((store) => store.setTabCanExpandPane)
  const suppressPtyExit = useAppStore((store) => store.suppressPtyExit)
  const pendingCodexPaneRestartIds = useAppStore((store) => store.pendingCodexPaneRestartIds)
  const consumePendingCodexPaneRestart = useAppStore(
    (store) => store.consumePendingCodexPaneRestart
  )
  const clearCodexRestartNotice = useAppStore((store) => store.clearCodexRestartNotice)
  // Why: in chat view the chat surface sits above the mounted terminal, so its mobile-driver overlay must not render over it (U9/R8).
  const unifiedTabId = useAppStore(
    (store) =>
      getCachedUnifiedTerminalTabForWorktree(store.unifiedTabsByWorktree, worktreeId, tabId)?.id
  )
  const isChatViewMode = useAppStore(
    (store) =>
      getCachedUnifiedTerminalTabForWorktree(store.unifiedTabsByWorktree, worktreeId, tabId)
        ?.viewMode === 'chat'
  )
  const nativeChatEnabled = useAppStore((store) => store.settings?.experimentalNativeChat === true)
  const effectiveChatViewMode = nativeChatEnabled && isChatViewMode
  const unifiedTabLabel = useAppStore(
    (store) =>
      getCachedUnifiedTerminalTabForWorktree(store.unifiedTabsByWorktree, worktreeId, tabId)?.label
  )
  const runtimePaneTitlesByPaneId = useAppStore(
    useShallow((store) => store.runtimePaneTitlesByTabId[tabId] ?? {})
  )
  // Carry each leaf's agent identity, not just "an agent exists", so the gate can reject unsupported agents; scoped to this tab's panes.
  const tabAgentTypeByLeaf = useAppStore((store) =>
    selectTerminalTabAgentTypesByLeaf(store.agentStatusByPaneKey, tabId)
  )
  const toggleTabViewMode = useAppStore((store) => store.toggleTabViewMode)
  const setTabViewMode = useAppStore((store) => store.setTabViewMode)
  const savedLayout = useAppStore((store) => store.terminalLayoutsByTabId[tabId] ?? EMPTY_LAYOUT)
  const terminalTab = useAppStore((store) =>
    getCachedTerminalTabForWorktree(store.tabsByWorktree, worktreeId, tabId)
  )
  const restoredLayout = useMemo(
    () => (terminalTab ? sanitizeTerminalLayoutPaneTitles(savedLayout, terminalTab) : savedLayout),
    [savedLayout, terminalTab]
  )
  const expectedLayoutLeafIds = useMemo(
    () => collectLeafIdsInOrder(restoredLayout.root),
    [restoredLayout.root]
  )
  const getNativeChatLeafIds = useCallback((): string[] => {
    const mountedLeafIds = managerRef.current?.getPanes().map((pane) => pane.leafId) ?? []
    // Why: a partially hydrated manager can expose one pane of a restored split; union both sources so tab-wide evidence stays disabled.
    return [...new Set([...expectedLayoutLeafIds, ...mountedLeafIds])]
  }, [expectedLayoutLeafIds])
  const getTabWideAgentHintLeafId = useCallback((): string | null => {
    if (tabWideAgentHintLeafId !== undefined) {
      return tabWideAgentHintLeafId
    }
    const leafIds = getNativeChatLeafIds()
    return leafIds.length === 1 ? leafIds[0] : null
  }, [getNativeChatLeafIds, tabWideAgentHintLeafId])
  useEffect(() => {
    if (tabWideAgentHintLeafId !== undefined) {
      return
    }
    const leafIds = getNativeChatLeafIds()
    if (leafIds.length === 0) {
      return
    }
    // Why: tab-wide launch/title metadata predates leaf ownership; bind it only when the first topology proves the sole leaf it describes.
    setTabWideAgentHintLeafId(leafIds.length === 1 ? leafIds[0] : null)
  }, [getNativeChatLeafIds, paneCount, tabWideAgentHintLeafId])
  const resolveTitleAgentForLeaf = useCallback(
    (leafId: string | null) => {
      const hasSingleKnownLeaf =
        getNativeChatLeafIds().length === 1 && getTabWideAgentHintLeafId() === leafId
      return resolveNativeChatLeafTitleAgent({
        leafId,
        panes: managerRef.current?.getPanes() ?? [],
        runtimePaneTitlesByPaneId,
        tabLabel: hasSingleKnownLeaf ? unifiedTabLabel : null,
        terminalTitle: hasSingleKnownLeaf ? terminalTab?.title : null
      })
    },
    [
      getNativeChatLeafIds,
      getTabWideAgentHintLeafId,
      runtimePaneTitlesByPaneId,
      terminalTab?.title,
      unifiedTabLabel
    ]
  )
  // Per-leaf: a split can mix supported/unsupported agents; the leaf's live agent is authoritative, tab-wide hints only fill in before hooks arrive.
  const isChatEligibleForLeaf = useCallback(
    (leafId: string | null): boolean => {
      const detectedAgent = leafId ? (tabAgentTypeByLeaf[leafId] ?? null) : null
      const launchAgent = nativeChatLaunchAgentForLeaf({
        launchAgent: terminalTab?.launchAgent,
        launchAgentLeafId: getTabWideAgentHintLeafId(),
        leafId,
        leafIds: getNativeChatLeafIds()
      })
      return canToggleNativeChat({
        experimentalNativeChatEnabled: nativeChatEnabled,
        contentType: 'terminal',
        launchAgent: detectedAgent ? null : launchAgent,
        detectedAgent,
        resolvedAgent: detectedAgent ? null : resolveTitleAgentForLeaf(leafId),
        nativeChatTranscriptIsLocalReadable
      })
    },
    [
      tabAgentTypeByLeaf,
      nativeChatEnabled,
      nativeChatTranscriptIsLocalReadable,
      terminalTab?.launchAgent,
      getNativeChatLeafIds,
      getTabWideAgentHintLeafId,
      resolveTitleAgentForLeaf
    ]
  )
  const applyNativeChatLeafRoute = useCallback(
    (route: NativeChatLeafRoute): void => {
      if (route.chatLeafId !== chatLeafId) {
        setChatLeafId(route.chatLeafId)
      }
      if (route.exitChat && unifiedTabId) {
        // Why: event/effect replay must not flip terminal mode back to chat.
        setTabViewMode(unifiedTabId, 'terminal')
      }
    },
    [chatLeafId, setTabViewMode, unifiedTabId]
  )
  const handleConfirmedAgentExit = useCallback(
    (leafId: string): void => {
      if (leafId !== chatLeafId) {
        return
      }
      const panes = managerRef.current?.getPanes() ?? []
      const activeLeafId = managerRef.current?.getActivePane()?.leafId ?? null
      applyNativeChatLeafRoute(
        resolveNativeChatLeafRoute({
          isChatViewMode,
          chatLeafId,
          activeLeafId,
          chatLeafStillMounted: panes.some((pane) => pane.leafId === chatLeafId),
          activeLeafIsEligible: isChatEligibleForLeaf(activeLeafId),
          chatLeafHasConfirmedAgentExit: true
        })
      )
    },
    [applyNativeChatLeafRoute, chatLeafId, isChatEligibleForLeaf, isChatViewMode]
  )
  useEffect(() => {
    // Why: transport callbacks must observe only committed chat ownership; render work can be replayed/discarded under concurrent React.
    onAgentExitedRef.current = handleConfirmedAgentExit
  }, [handleConfirmedAgentExit])
  const canToggleChatForLeaf = useCallback(
    (leafId: string | null): boolean => {
      // Scope the "always allow toggling back" rule to the leaf showing chat; must not make an unsupported sibling look eligible.
      const isChatViewForLeaf = effectiveChatViewMode && leafId !== null && chatLeafId === leafId
      return (nativeChatEnabled && isChatViewForLeaf) || isChatEligibleForLeaf(leafId)
    },
    [chatLeafId, effectiveChatViewMode, isChatEligibleForLeaf, nativeChatEnabled]
  )
  const toggleNativeChatForLeaf = useCallback(
    (leafId: string) => {
      if (!unifiedTabId) {
        return
      }
      if (effectiveChatViewMode && chatLeafId === leafId) {
        setChatLeafId(null)
        toggleTabViewMode(unifiedTabId)
        return
      }
      setChatLeafId(leafId)
      if (!effectiveChatViewMode) {
        toggleTabViewMode(unifiedTabId)
      }
    },
    [unifiedTabId, effectiveChatViewMode, chatLeafId, toggleTabViewMode]
  )
  const handleToggleNativeChat = useCallback(() => {
    const activeLeafId = managerRef.current?.getActivePane()?.leafId ?? null
    if (!activeLeafId) {
      return
    }
    toggleNativeChatForLeaf(activeLeafId)
  }, [toggleNativeChatForLeaf])
  const readNativeChatTerminalScreen = useCallback((): string | null => {
    if (!chatLeafId) {
      return null
    }
    const pane = managerRef.current?.getPanes().find((candidate) => candidate.leafId === chatLeafId)
    return pane?.serializeAddon.serialize({ scrollback: 0 }) ?? null
  }, [chatLeafId])
  return {
    setTabPaneExpanded,
    setTabCanExpandPane,
    suppressPtyExit,
    pendingCodexPaneRestartIds,
    consumePendingCodexPaneRestart,
    clearCodexRestartNotice,
    unifiedTabId,
    isChatViewMode,
    nativeChatEnabled,
    effectiveChatViewMode,
    unifiedTabLabel,
    runtimePaneTitlesByPaneId,
    tabAgentTypeByLeaf,
    toggleTabViewMode,
    setTabViewMode,
    savedLayout,
    terminalTab,
    restoredLayout,
    expectedLayoutLeafIds,
    getNativeChatLeafIds,
    mountedLeafIds,
    getTabWideAgentHintLeafId,
    leafIds,
    resolveTitleAgentForLeaf,
    hasSingleKnownLeaf,
    isChatEligibleForLeaf,
    detectedAgent,
    launchAgent,
    applyNativeChatLeafRoute,
    handleConfirmedAgentExit,
    panes,
    activeLeafId,
    canToggleChatForLeaf,
    isChatViewForLeaf,
    toggleNativeChatForLeaf,
    handleToggleNativeChat,
    readNativeChatTerminalScreen,
    pane,
  }
}
