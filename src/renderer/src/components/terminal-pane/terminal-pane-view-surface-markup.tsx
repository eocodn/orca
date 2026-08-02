import { createPortal } from 'react-dom'
import { useAppStore } from '../../store'
import { TerminalQuickCommandDialog } from '@/components/terminal-quick-commands/TerminalQuickCommandDialog'
import type { TerminalQuickCommand } from '../../../../shared/types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { WORKSPACE_FILE_PATH_MIME, WORKSPACE_FILE_PATHS_MIME } from '@/lib/workspace-file-drag'
import { shouldShowMobileDriverOverlay } from './mobile-driver-overlay-visibility'
import {
  getDriverForPty,
  getFitOverrideForPty
} from '@/lib/pane-manager/mobile-driver-state'
import { shouldChatTakeOverMobileSurface } from '../native-chat/native-chat-send-eligibility'
import { DaemonActionDialog } from '@/components/shared/useDaemonActions'
import TerminalSearch from '@/components/TerminalSearch'
import CloseTerminalDialog from './CloseTerminalDialog'
import { MobileDriverOverlay } from './MobileDriverOverlay'
import { TerminalErrorToast } from './TerminalErrorToast'
import { TerminalSessionStateSaveFailureDialog } from './TerminalSessionStateSaveFailureDialog'
import TerminalContextMenu from './TerminalContextMenu'
import NativeChatView from '../native-chat/NativeChatView'
import { TerminalAgentSessionForkDialog } from './TerminalAgentSessionForkDialog'
import { AgentSessionContinuationDialog } from '@/components/agent-session-continuation/AgentSessionContinuationDialog'
import { SessionRestoredBannerPortals } from './SessionRestoredBannerPortals'
import TerminalPaneHeaderOverlay from './TerminalPaneHeaderOverlay'
import { TerminalSshReconnectOverlay } from './TerminalSshReconnectOverlay'
import { TerminalRemoteRuntimeReconnectBanner } from './TerminalRemoteRuntimeReconnectBanner'


type TerminalPaneSurfaceMarkupProps = Record<string, any>

function TerminalQuickCommandEditorDialog({
  command,
  onOpenChange,
  onSave
}: {
  command: TerminalQuickCommand
  onOpenChange: (open: boolean) => void
  onSave: (command: TerminalQuickCommand) => void
}): React.JSX.Element {
  const repos = useAppStore((store) => store.repos)
  return (
    <TerminalQuickCommandDialog
      open
      mode="add"
      command={command}
      repos={repos}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  )
}
export function TerminalPaneSurfaceMarkup(props: TerminalPaneSurfaceMarkupProps): React.JSX.Element {
  const {
  setContainerRef,
  tabId,
  expectedLayoutLeafIdsAttr,
  titleUsesLightSurface,
  terminalContainerStyle,
  contextMenu,
  handlePrimarySelectionMiddleMouseDown,
  handlePrimarySelectionAuxClick,
  managerRef,
  paneTransportsRef,
  worktreeId,
  cwd,
  terminalError,
  isActive,
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
  showSplitButton,
  splitTerminalPaneFromHeader,
  beginPaneDragFromHeader,
  activatePaneTitleInteraction,
  handleStartRename,
  handleRemoveTitle,
  handleRequestClosePane,
  setRenameValue,
  handleRenameSubmit,
  handleRenameCancel,
  handleRenameBlur,
  ptyRecoveryStatesByPaneId,
  restorePaneTerminalFit,
  restoreAllTerminalFits,
  pendingCloseConfirmation,
  handleCancelClose,
  handleConfirmClose
  } = props
  return (
    <>
      <div
        ref={setContainerRef}
        className="absolute inset-0 min-h-0 min-w-0"
        data-native-file-drop-target="terminal"
        data-terminal-tab-id={tabId}
        data-terminal-layout-leaf-ids={expectedLayoutLeafIdsAttr}
        data-pane-title-surface={titleUsesLightSurface ? 'light' : 'dark'}
        style={terminalContainerStyle}
        onContextMenuCapture={contextMenu.onContextMenuCapture}
        onMouseDownCapture={handlePrimarySelectionMiddleMouseDown}
        onAuxClickCapture={handlePrimarySelectionAuxClick}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME) ||
            e.dataTransfer.types.includes(WORKSPACE_FILE_PATHS_MIME)
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          if (
            !e.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME) &&
            !e.dataTransfer.types.includes(WORKSPACE_FILE_PATHS_MIME)
          ) {
            return
          }
          e.preventDefault()
          e.stopPropagation()
          const manager = managerRef.current
          if (!manager) {
            return
          }
          void handleInternalTerminalFileDrop({
            manager,
            paneTransports: paneTransportsRef.current,
            worktreeId,
            tabId,
            cwd,
            dataTransfer: e.dataTransfer,
            dropTarget: e.target
          })
        }}
      />
      {/* Why: the reconnect banner already owns SSH recovery UX; the z-50 error
          toast was painting over it (same bottom strip) with the raw ssh:connect failure. */}
      {terminalError && isActive && !showSshReconnectOverlay ? (
        <TerminalErrorToast
          error={terminalError}
          onDismiss={() => setTerminalError(null)}
          onRestartDaemon={() => daemonActions.setPending('restart')}
        />
      ) : null}
      {/* Why: portal into the pane so the banner stacks above the xterm canvas (sibling mount painted under WebGL). */}
      {showSshReconnectOverlay && sshReconnectTargetId && sshReconnectStatus
        ? managedPanes.map((pane) =>
            createPortal(
              <TerminalSshReconnectOverlay
                targetId={sshReconnectTargetId}
                targetLabel={sshReconnectTargetLabel}
                status={sshReconnectStatus}
                targetRemoved={sshReconnectTargetRemoved}
                worktreeId={worktreeId}
                sshOwnerEnvironmentId={sshReconnectEnvironmentId}
              />,
              pane.container,
              `ssh-reconnect-${pane.id}`
            )
          )
        : null}
      <DaemonActionDialog api={daemonActions} />
      {isActive && (
        <TerminalSessionStateSaveFailureDialog
          open={sessionStateSaveFailureOpen}
          onDismiss={() => setSessionStateSaveFailureOpen(false)}
          onOpenSpaceAnalyzer={openDiskSpaceAnalyzer}
        />
      )}
      {activePane?.container &&
        createPortal(
          <TerminalSearch
            isOpen={searchOpen}
            onClose={() => setSearchOpen(false)}
            searchAddon={activePane.searchAddon ?? null}
            searchStateRef={searchStateRef}
          />,
          activePane.container
        )}
      <SessionRestoredBannerPortals
        panes={managerRef.current?.getPanes() ?? []}
        paneIds={sessionRestoredBannerPaneIds}
      />
      {effectiveChatViewMode && chatPane?.container
        ? createPortal(
            <div className="absolute inset-0 z-10 flex min-h-0 min-w-0 bg-background">
              <NativeChatView
                terminalTabId={tabId}
                paneKey={makePaneKey(tabId, chatPane.leafId)}
                targetPtyId={chatPanePtyId}
                launchAgent={chatPaneLaunchAgent}
                resolvedAgent={chatPaneResolvedAgent}
                onSwitchToTerminal={() => toggleNativeChatForLeaf(chatPane.leafId)}
                readTerminalScreen={readNativeChatTerminalScreen}
                contextMenuActions={{
                  onSplitRight: () => contextMenu.runForPane(chatPane.id, contextMenu.onSplitRight),
                  onSplitDown: () => contextMenu.runForPane(chatPane.id, contextMenu.onSplitDown),
                  canEqualizePaneSizes: managedPanes.length > 1 && expandedPaneId === null,
                  onEqualizePaneSizes: () =>
                    contextMenu.runForPane(chatPane.id, contextMenu.onEqualizePaneSizes),
                  canExpandPane: managedPanes.length > 1,
                  isPaneExpanded: expandedPaneId === chatPane.id,
                  onToggleExpand: () =>
                    contextMenu.runForPane(chatPane.id, contextMenu.onToggleExpand),
                  canContinueAgentSessionInNewSession: canContinueAgentSessionInNewSession(
                    resolveAgentForLeaf(chatPane.leafId)
                  ),
                  onContinueAgentSessionInNewSession: () =>
                    contextMenu.runForPane(
                      chatPane.id,
                      contextMenu.onContinueAgentSessionInNewSession
                    ),
                  onForkAgentSession: () =>
                    void contextMenu.runForPane(chatPane.id, contextMenu.onForkAgentSession),
                  onSetTitle: () => contextMenu.runForPane(chatPane.id, contextMenu.onSetTitle),
                  onCopyTerminalId: () =>
                    void contextMenu.runForPane(chatPane.id, contextMenu.onCopyTerminalId),
                  onCopyPaneId: () =>
                    void contextMenu.runForPane(chatPane.id, contextMenu.onCopyPaneId),
                  canClosePane: managedPanes.length > 1,
                  onClosePane: () => contextMenu.runForPane(chatPane.id, contextMenu.onClosePane)
                }}
              />
            </div>,
            chatPane.container,
            `native-chat-${tabId}-${chatPane.leafId}`
          )
        : null}
      <TerminalContextMenu
        open={contextMenu.open}
        onOpenChange={contextMenu.setOpen}
        menuPoint={contextMenu.point}
        menuOpenedAtRef={contextMenu.menuOpenedAtRef}
        canClosePane={contextMenu.paneCount > 1}
        canExpandPane={contextMenu.paneCount > 1}
        canEqualizePaneSizes={contextMenu.paneCount > 1 && expandedPaneId === null}
        menuPaneIsExpanded={
          contextMenu.menuPaneId !== null && contextMenu.menuPaneId === expandedPaneId
        }
        onCopy={() => void contextMenu.onCopy()}
        onPaste={() => void contextMenu.onPaste()}
        onSplitRight={contextMenu.onSplitRight}
        onSplitDown={contextMenu.onSplitDown}
        keybindings={keybindings}
        onEqualizePaneSizes={contextMenu.onEqualizePaneSizes}
        onClosePane={contextMenu.onClosePane}
        onClearScreen={contextMenu.onClearScreen}
        canContinueAgentSessionInNewSession={contextMenuCanContinueInNewSession}
        onContinueAgentSessionInNewSession={contextMenu.onContinueAgentSessionInNewSession}
        onForkAgentSession={() => void contextMenu.onForkAgentSession()}
        canToggleNativeChat={contextMenuCanToggleChat}
        isNativeChatView={contextMenuIsChatView}
        onToggleNativeChat={handleContextMenuToggleNativeChat}
        onCopyAgentSessionContext={() => void contextMenu.onCopyAgentSessionContext()}
        repoQuickCommands={repoQuickCommands}
        globalQuickCommands={globalQuickCommands}
        quickCommandRepoLabel={quickCommandRepoLabel}
        onQuickCommand={contextMenu.onQuickCommand}
        onAddQuickCommand={
          quickCommandRepoId
            ? () => openQuickCommandEditor({ type: 'repo', repoId: quickCommandRepoId })
            : () => openQuickCommandEditor({ type: 'global' })
        }
        onToggleExpand={contextMenu.onToggleExpand}
        onSetTitle={contextMenu.onSetTitle}
        onClearPaneTitle={contextMenu.onClearPaneTitle}
        canClearPaneTitle={menuPaneHasCustomTitle}
        onCopyTerminalId={() => void contextMenu.onCopyTerminalId()}
        onCopyPaneId={contextMenu.onCopyPaneId}
      />
      {/* Why: repos is a broad store slice; only subscribe while the editor is visible. */}
      {quickCommandEditorOpen ? (
        <TerminalQuickCommandEditorDialog
          command={quickCommandDraft}
          onOpenChange={setQuickCommandEditorOpen}
          onSave={saveQuickCommand}
        />
      ) : null}
      <TerminalAgentSessionForkDialog
        open={agentSessionFork !== null}
        fork={agentSessionFork}
        onOpenChange={(open) => {
          if (!open) {
            setAgentSessionFork(null)
          }
        }}
      />
      {agentSessionContinuation ? (
        <AgentSessionContinuationDialog
          open
          request={agentSessionContinuation}
          onOpenChange={(open) => {
            if (!open) {
              setAgentSessionContinuation(null)
            }
          }}
        />
      ) : null}
      <TerminalPaneHeaderOverlay
        tabId={tabId}
        worktreeId={worktreeId}
        cwd={cwd ?? ''}
        showAlwaysOnHeaders={isActive && terminalContentVisible}
        showSplitButton={showSplitButton}
        paneCount={paneCount}
        activePaneId={activePane?.id}
        panes={managedPanes}
        paneTitles={paneTitles}
        paneTitleOverlayRects={paneTitleOverlayRects}
        renamingPaneId={renamingPaneId}
        renameValue={renameValue}
        renameInputRef={renameInputRef}
        titleUsesLightSurface={titleUsesLightSurface}
        paneTitleBackground={paneTitleBackground}
        terminalContentVisible={terminalContentVisible}
        hiddenStartupStyle={hiddenStartupStyle}
        managerRef={managerRef}
        paneTransportsRef={paneTransportsRef}
        canToggleNativeChat={activePaneCanToggleChat}
        isChatViewMode={activePaneIsChatLeaf}
        onToggleNativeChat={handleToggleNativeChat}
        canContinueAgentSessionInNewSession={activePaneCanContinueInNewSession}
        onContinueAgentSessionInNewSession={(pane) =>
          contextMenu.runForPane(pane.id, contextMenu.onContinueAgentSessionInNewSession)
        }
        onSplitPane={splitTerminalPaneFromHeader}
        onBeginPaneDrag={beginPaneDragFromHeader}
        onActivatePaneTitleInteraction={activatePaneTitleInteraction}
        onPaneTitleContextMenu={contextMenu.onPaneTitleContextMenu}
        onStartRename={handleStartRename}
        onRemoveTitle={handleRemoveTitle}
        onClosePane={handleRequestClosePane}
        onRenameValueChange={setRenameValue}
        onRenameSubmit={handleRenameSubmit}
        onRenameCancel={handleRenameCancel}
        onRenameBlur={handleRenameBlur}
      />
      {!showSshReconnectOverlay
        ? managedPanes.map((pane) => {
            const recoveryState = ptyRecoveryStatesByPaneId[pane.id]
            if (!recoveryState) {
              return null
            }
            return createPortal(
              <TerminalRemoteRuntimeReconnectBanner
                key={`remote-runtime-reconnect-${pane.id}-${recoveryState.epoch}`}
                phase={recoveryState.phase}
                onReconnect={() => {
                  paneTransportsRef.current.get(pane.id)?.retryRecovery?.()
                }}
              />,
              pane.container,
              `remote-runtime-reconnect-${pane.id}`
            )
          })
        : null}
      {managedPanes.map((pane) => {
        // Why: pane IDs collide across tabs, so key overlays by the transport's actual ptyId to avoid wrong-pane banners.
        const ptyId = paneTransportsRef.current.get(pane.id)?.getPtyId()
        if (!ptyId) {
          return null
        }
        // Why: two-state lock — mobile driver → presence-lock (docs/mobile-presence-lock.md); phone-fit override → indefinite hold (docs/mobile-fit-hold.md).
        const driver = getDriverForPty(ptyId)
        const fitMode = getFitOverrideForPty(ptyId)?.mode ?? null
        const hasFitOverride = fitMode === 'mobile-fit'
        if (!shouldShowMobileDriverOverlay(driver.kind, fitMode)) {
          return null
        }
        // Why: only the chat-replaced pane hides presence-lock/phone-fit chrome; sibling splits stay normal terminals.
        const paneSurface =
          effectiveChatViewMode && pane.leafId === chatLeafId ? 'chat' : 'terminal'
        if (shouldChatTakeOverMobileSurface(paneSurface)) {
          return null
        }
        return createPortal(
          <MobileDriverOverlay
            key={`mobile-driver-${pane.id}-${ptyId}`}
            driver={driver}
            hasFitOverride={hasFitOverride}
            rootClassName="mobile-driver-banner"
            onAction={() => restorePaneTerminalFit(pane, ptyId)}
            onAllAction={() => restoreAllTerminalFits(pane)}
          />,
          pane.container,
          `mobile-driver-banner-${pane.id}`
        )
      })}
      <CloseTerminalDialog
        open={pendingCloseConfirmation !== null}
        copyKind={pendingCloseConfirmation?.copyKind}
        onCancel={handleCancelClose}
        onConfirm={handleConfirmClose}
      />
    </>
  )
}
