import { forwardRef } from 'react'
import { TerminalPaneSurfaceMarkup } from './terminal-pane-view-surface-markup'
import { useTerminalPaneSurfaceState } from './terminal-pane-view-surface-state'
import { useTerminalPaneSurfaceStore } from './terminal-pane-view-surface-store'
import { useTerminalPaneSurfaceRuntimeState } from './terminal-pane-view-surface-runtime-state'
import { useTerminalPaneSurfaceEffects } from './terminal-pane-view-surface-effects'

type TerminalPaneProps = {
  tabId: string
  worktreeId: string
  cwd?: string
  isActive: boolean
  isVisible?: boolean
  isWorktreeActive?: boolean
  // When set (Activity portal), isolates one split pane as a transient override that doesn't touch expandedPaneId or persist the layout.
  isolatedPaneKey?: string | null
  // Why: ephemeral one-off command terminals don't need the header's prominent split affordance (split shortcuts still work).
  showSplitButton?: boolean
  onPtyExit: (ptyId: string) => void
  onCloseTab: () => void
}

export type TerminalPaneHandle = {
  closeActivePane: () => void
}

function TerminalPane(
  {
    tabId,
    worktreeId,
    cwd,
    isActive,
    isVisible = true,
    isWorktreeActive = isVisible,
    isolatedPaneKey = null,
    showSplitButton = true,
    onPtyExit,
    onCloseTab
  }: TerminalPaneProps,
  ref: React.ForwardedRef<TerminalPaneHandle>
): React.JSX.Element {
  const surfaceState = useTerminalPaneSurfaceState({ isActive, isVisible, isWorktreeActive, worktreeId, tabId })

  const surfaceStore = useTerminalPaneSurfaceStore({ ...surfaceState, tabId, worktreeId })
  const runtimeState = useTerminalPaneSurfaceRuntimeState({
    ...surfaceState,
    ...surfaceStore,
    tabId,
    worktreeId,
    cwd,
    isActive,
    isVisible,
    isWorktreeActive,
    ref,
    onPtyExit
  })

  const surfaceEffects = useTerminalPaneSurfaceEffects({
    ...surfaceState,
    ...surfaceStore,
    ...runtimeState,
    tabId,
    worktreeId,
    cwd,
    isActive,
    isVisible,
    isWorktreeActive,
    ref,
    onCloseTab,
    isolatedPaneKey,
    showSplitButton
  })
  const {
    expectedLayoutLeafIdsAttr,
    setContainerRef,
    titleUsesLightSurface,
    terminalContainerStyle,
    contextMenu,
    handlePrimarySelectionMiddleMouseDown,
    handlePrimarySelectionAuxClick,
    managerRef,
    paneTransportsRef,
    terminalError,
    showSshReconnectOverlay,
    setTerminalError,
    daemonActions,
    sshReconnectTargetId,
    sshReconnectStatus,
    managedPanes,
    sshReconnectTargetLabel,
    sshReconnectTargetRemoved,
    sshReconnectEnvironmentId,
    sessionStateSaveFailureOpen,
    setSessionStateSaveFailureOpen,
    openDiskSpaceAnalyzer,
    activePane,
    searchOpen,
    setSearchOpen,
    searchStateRef,
    sessionRestoredBannerPaneIds,
    effectiveChatViewMode,
    chatPane,
    chatPanePtyId,
    chatPaneLaunchAgent,
    chatPaneResolvedAgent,
    toggleNativeChatForLeaf,
    readNativeChatTerminalScreen,
    expandedPaneId,
    resolveAgentForLeaf,
    keybindings,
    contextMenuCanContinueInNewSession,
    contextMenuIsChatView,
    contextMenuCanToggleChat,
    handleContextMenuToggleNativeChat,
    repoQuickCommands,
    globalQuickCommands,
    quickCommandRepoLabel,
    quickCommandRepoId,
    openQuickCommandEditor,
    menuPaneHasCustomTitle,
    quickCommandEditorOpen,
    quickCommandDraft,
    saveQuickCommand,
    agentSessionFork,
    setAgentSessionFork,
    agentSessionContinuation,
    setAgentSessionContinuation,
    paneCount,
    paneTitles,
    paneTitleOverlayRects,
    renamingPaneId,
    renameValue,
    renameInputRef,
    paneTitleBackground,
    terminalContentVisible,
    hiddenStartupStyle,
    activePaneCanToggleChat,
    activePaneIsChatLeaf,
    handleToggleNativeChat,
    activePaneCanContinueInNewSession,
    handleRenameSubmit,
    handleRenameCancel,
    handleRenameBlur,
    handleRemoveTitle,
    restorePaneTerminalFit,
    restoreAllTerminalFits,
    pendingCloseConfirmation,
    handleCancelClose,
    handleConfirmClose,
    splitTerminalPaneFromHeader,
    beginPaneDragFromHeader,
    activatePaneTitleInteraction,
    handleStartRename,
    handleRequestClosePane,
    setRenameValue,
    ptyRecoveryStatesByPaneId
  } = surfaceEffects
  return (
    <TerminalPaneSurfaceMarkup
      setContainerRef={setContainerRef}
      tabId={tabId}
      expectedLayoutLeafIdsAttr={expectedLayoutLeafIdsAttr}
      titleUsesLightSurface={titleUsesLightSurface}
      terminalContainerStyle={terminalContainerStyle}
      contextMenu={contextMenu}
      handlePrimarySelectionMiddleMouseDown={handlePrimarySelectionMiddleMouseDown}
      handlePrimarySelectionAuxClick={handlePrimarySelectionAuxClick}
      managerRef={managerRef}
      paneTransportsRef={paneTransportsRef}
      worktreeId={worktreeId}
      cwd={cwd}
      terminalError={terminalError}
      isActive={isActive}
      showSshReconnectOverlay={showSshReconnectOverlay}
      setTerminalError={setTerminalError}
      daemonActions={daemonActions}
      sshReconnectTargetId={sshReconnectTargetId}
      sshReconnectStatus={sshReconnectStatus}
      managedPanes={managedPanes}
      sshReconnectTargetLabel={sshReconnectTargetLabel}
      sshReconnectTargetRemoved={sshReconnectTargetRemoved}
      sshReconnectEnvironmentId={sshReconnectEnvironmentId}
      sessionStateSaveFailureOpen={sessionStateSaveFailureOpen}
      setSessionStateSaveFailureOpen={setSessionStateSaveFailureOpen}
      openDiskSpaceAnalyzer={openDiskSpaceAnalyzer}
      activePane={activePane}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchStateRef={searchStateRef}
      sessionRestoredBannerPaneIds={sessionRestoredBannerPaneIds}
      effectiveChatViewMode={effectiveChatViewMode}
      chatPane={chatPane}
      chatPanePtyId={chatPanePtyId}
      chatPaneLaunchAgent={chatPaneLaunchAgent}
      chatPaneResolvedAgent={chatPaneResolvedAgent}
      toggleNativeChatForLeaf={toggleNativeChatForLeaf}
      readNativeChatTerminalScreen={readNativeChatTerminalScreen}
      expandedPaneId={expandedPaneId}
      resolveAgentForLeaf={resolveAgentForLeaf}
      keybindings={keybindings}
      contextMenuCanContinueInNewSession={contextMenuCanContinueInNewSession}
      contextMenuIsChatView={contextMenuIsChatView}
      contextMenuCanToggleChat={contextMenuCanToggleChat}
      handleContextMenuToggleNativeChat={handleContextMenuToggleNativeChat}
      repoQuickCommands={repoQuickCommands}
      globalQuickCommands={globalQuickCommands}
      quickCommandRepoLabel={quickCommandRepoLabel}
      quickCommandRepoId={quickCommandRepoId}
      openQuickCommandEditor={openQuickCommandEditor}
      menuPaneHasCustomTitle={menuPaneHasCustomTitle}
      quickCommandEditorOpen={quickCommandEditorOpen}
      quickCommandDraft={quickCommandDraft}
      saveQuickCommand={saveQuickCommand}
      agentSessionFork={agentSessionFork}
      setAgentSessionFork={setAgentSessionFork}
      agentSessionContinuation={agentSessionContinuation}
      setAgentSessionContinuation={setAgentSessionContinuation}
      paneCount={paneCount}
      paneTitles={paneTitles}
      paneTitleOverlayRects={paneTitleOverlayRects}
      renamingPaneId={renamingPaneId}
      renameValue={renameValue}
      renameInputRef={renameInputRef}
      paneTitleBackground={paneTitleBackground}
      terminalContentVisible={terminalContentVisible}
      hiddenStartupStyle={hiddenStartupStyle}
      activePaneCanToggleChat={activePaneCanToggleChat}
      activePaneIsChatLeaf={activePaneIsChatLeaf}
      handleToggleNativeChat={handleToggleNativeChat}
      activePaneCanContinueInNewSession={activePaneCanContinueInNewSession}
      showSplitButton={showSplitButton}
      splitTerminalPaneFromHeader={splitTerminalPaneFromHeader}
      beginPaneDragFromHeader={beginPaneDragFromHeader}
      activatePaneTitleInteraction={activatePaneTitleInteraction}
      handleStartRename={handleStartRename}
      handleRemoveTitle={handleRemoveTitle}
      handleRequestClosePane={handleRequestClosePane}
      setRenameValue={setRenameValue}
      handleRenameSubmit={handleRenameSubmit}
      handleRenameCancel={handleRenameCancel}
      handleRenameBlur={handleRenameBlur}
      ptyRecoveryStatesByPaneId={ptyRecoveryStatesByPaneId}
      restorePaneTerminalFit={restorePaneTerminalFit}
      restoreAllTerminalFits={restoreAllTerminalFits}
      pendingCloseConfirmation={pendingCloseConfirmation}
      handleCancelClose={handleCancelClose}
      handleConfirmClose={handleConfirmClose}
    />
  )
}

export default forwardRef(TerminalPane)
