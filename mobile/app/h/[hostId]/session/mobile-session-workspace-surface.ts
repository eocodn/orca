import { useCallback } from 'react'
import { createBulkCloseSheetActions, createCloseWithBulkActions } from '../../../../src/session/mobile-bulk-close-sheet-actions'
import { classifyConnection } from '../../../../src/transport/connection-health'
import { shouldShowSessionHeaderChecksAction, resolvePanelAction } from '../../../../src/session/session-panel-host'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'

type WorkspaceContext = Record<string, any>

export function useMobileSessionWorkspaceSurface(context: WorkspaceContext) {
  const { sessionTabs, activeSessionTab, activeSessionTabId, handleCloseSessionTab, markdownDocs,
    fileDocs, terminals, activeHandle, terminalKeyboardMetrics, keyboardHeight, terminalModes,
    terminalTextScale, connState, terminalsLoaded, isFloatingWorkspaceRoute, isFolderWorkspaceRoute,
    creating, creatingBrowser, creatingMarkdown, createError, setSessionContentRowWidth,
    setActivePanel, activePanel, canDockPanel, insets, toastMessage, showToast, showNativeChat,
    nativeChatController, nativeChatTranscriptIsLocalReadable, toggleTabChatView, handleClearTerminal,
    handleCloseTerminal, handleRenameTerminal, setActionTarget, actionTarget, setRenameTarget,
    bulkCloseActions: existingBulkCloseActions, worktreeName, reconnectAttempts, lastConnectedAt,
    forceReconnectHost, hostId, getDirtyMarkdownDrafts, setLeaveDrafts, router, agentSessionHistorySupported,
    prIsGithubRepo, prRepoContextLoaded, quickCommandsSupported, setShowHeaderMoreActions,
    handlePanelTap, activeMarkdownTab, activeFileTab, activeBrowserTab, activePendingTerminalTab,
    pendingDiffNotesDelivery, setPendingDiffNotesDelivery, sendDiffNotesAgentActions, createTabAgentActions,
    setShowCreateTabDrawer, showCreateTabDrawer, browserScreencastSupported, setShowCreateBrowserModal,
    showCreateBrowserModal, setShowQuickCommands, showQuickCommands, setShowCustomKeyModal,
    showCustomKeyModal, customKeys, setCustomKeys, showDictationSetup, setShowDictationSetup,
    deleteKeyTarget, setDeleteKeyTarget, handleDeleteCustomKey, handleManageShortcuts, leaveSession,
    discardMarkdownTarget, confirmDiscardMarkdown, markdownActionTarget, setMarkdownActionTarget,
    fileActionTarget, setFileActionTarget, browserActionTarget, setBrowserActionTarget, leaveDrafts,
    renameTarget, handleCreateBrowser, createWarning, setCreateWarningState, dismissMobileSessionCreateWarningState,
    createTabBusy,
    launchQuickCommand, handleCreateTerminal, handleCreateMarkdownNote, handleBrowserNavigationCommand,
    handleFileOpenStart, handleOpenedFileDiff, getRepoIdFromMobileWorktreeId, handleTerminalWebReady,
    handleSelectionMode, handleSelectionCopy, handleSelectionEvicted, handleModesChanged,
    handleKeyboardAvoidanceMetrics, handleHaptic, handleTerminalInput, handleTerminalQueryReply,
    handleTerminalTap, handleFileTap, handleTerminalOpenUrl, handleDictationToggle, handleDictationPressIn,
    handleDictationPressOut, dictation, dictationMode, isAttaching,
    keyboardLift, toastOpacityRef } = context

  const bulkCloseActions = existingBulkCloseActions ?? createBulkCloseSheetActions({
    sessionTabsRef: context.sessionTabsRef, markdownDocs, activeSessionTabIdRef: context.activeSessionTabIdRef,
    switchSessionTab: context.switchSessionTab, closeSessionTab: handleCloseSessionTab
  })
  const closeWithBulkActions = createCloseWithBulkActions(handleCloseSessionTab, bulkCloseActions)
  const visibleTabs: MobileSessionTab[] = sessionTabs
    .filter((tab: MobileSessionTab) => tab.type !== 'terminal' || terminals.some((terminal: Terminal) => terminal.handle === tab.terminal))
  const activeMarkdown = activeSessionTab?.type === 'markdown' ? activeSessionTab : null
  const activeFile = activeSessionTab?.type === 'file' ? activeSessionTab : null
  const activeBrowser = activeSessionTab?.type === 'browser' ? activeSessionTab : null
  const activePendingTerminal = activeSessionTab?.type === 'terminal' && !terminals.some((terminal: Terminal) => terminal.handle === activeSessionTab.terminal) ? activeSessionTab : null
  const showLoadingState = connState === 'connected' && !terminalsLoaded && visibleTabs.length === 0
  const showEmptyState = !showLoadingState && visibleTabs.length === 0
  const connectionVerdict = classifyConnection({ connState, reconnectAttempts, lastConnectedAt })
  const showConnectionRetry = connectionVerdict.kind === 'offline' || connectionVerdict.kind === 'degraded'
  const terminalSummary = terminals.length === 0 ? connectionVerdict.label : `${terminals.length} terminal${terminals.length === 1 ? '' : 's'}`
  const activeTerminalKeyboardLift = activeHandle ? terminalKeyboardMetrics.get(activeHandle)?.keyboardLift ?? 0 : 0
  const toastAnimatedStyle = { opacity: toastOpacityRef.current }
  const showAgentSessionHistoryAction = agentSessionHistorySupported === true
  const showChecksAction = shouldShowSessionHeaderChecksAction({
    isGithubRepo: prIsGithubRepo, repoLoaded: prRepoContextLoaded
  })
  const showHeaderMoreButton = showAgentSessionHistoryAction || showChecksAction
  const handleSessionContentRowLayout = useCallback((event: any) => {
    setSessionContentRowWidth(event.nativeEvent.layout.width)
  }, [])
  const handlePanelTapLocal = useCallback((tapped: any) => {
    const action = resolvePanelAction({ panel: tapped, isWideLayout: context.isWideLayout, canDock: canDockPanel })
    if (action.kind === 'dock') setActivePanel(tapped)
    else if (action.path) router.push(action.path as never)
  }, [canDockPanel, router, setActivePanel])
  const openAgentSessionHistory = useCallback(() => router.push(`/h/${hostId}/agent-history` as never), [router, hostId])
  return { ...context, bulkCloseActions, closeWithBulkActions, visibleTabs,
    activeMarkdownTab: activeMarkdown, activeFileTab: activeFile, activeBrowserTab: activeBrowser,
    activePendingTerminalTab: activePendingTerminal, showLoadingState, showEmptyState, connectionVerdict,
    showConnectionRetry, terminalSummary, activeTerminalKeyboardLift, toastAnimatedStyle,
    showAgentSessionHistoryAction, showChecksAction, showHeaderMoreButton,
    handleSessionContentRowLayout, handlePanelTap: handlePanelTapLocal, openAgentSessionHistory,
    createTabBusy }
}
