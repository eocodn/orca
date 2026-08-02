import TabBar from '@/components/tab-bar/TabBar'
import { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import { FloatingTerminalWindowControls } from './FloatingTerminalWindowControls'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { FloatingTerminalPanelRenderContext } from './floating-terminal-panel-render-types'

export function FloatingTerminalPanelTitlebar({ context }: { context: FloatingTerminalPanelRenderContext }) {
  const {
    terminalItems, activeTerminalId, expandedPaneByTabId, activateFloatingItem,
    closeFloatingItemConfirmed, closeOthers, closeToRight, closeToLeft,
    createFloatingTerminalTab, createFloatingBrowserTab, createFloatingMarkdownTab,
    openFloatingMarkdownTab, setTabCustomTitle, setTabColor, setTabPaneExpanded,
    editorItems, browserItems, activeEditorUnifiedId, activeBrowserId, activeTab,
    activeTabType, browserTabs, createBrowserTab, activeGroup, closeAllFiles,
    makePreviewFilePermanent, pinFile, tabBarOrder, maximized, toggleMaximized,
    onOpenChange, handleDragStart, handleDragMove, handleDragEnd, handleTitlebarDoubleClick
  } = context
  return (
    <div
      className="flex h-9 shrink-0 cursor-grab items-center border-b border-border bg-[var(--bg-titlebar,var(--card))] active:cursor-grabbing"
      data-floating-terminal-shortcut-surface
      onPointerDown={handleDragStart}
      onPointerMove={handleDragMove}
      onPointerUp={handleDragEnd}
      onPointerCancel={handleDragEnd}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="flex h-full min-w-0 flex-1">
        <TabBar
          tabs={terminalItems}
          activeTabId={activeTerminalId}
          worktreeId={FLOATING_TERMINAL_WORKTREE_ID}
          expandedPaneByTabId={expandedPaneByTabId}
          onActivate={activateFloatingItem}
          onClose={closeFloatingItemConfirmed}
          onCloseOthers={closeOthers}
          onCloseToRight={closeToRight}
          onCloseToLeft={closeToLeft}
          onNewTerminalTab={() => createFloatingTerminalTab()}
          onNewTerminalWithShell={createFloatingTerminalTab}
          onNewBrowserTab={createFloatingBrowserTab}
          onNewFileTab={createFloatingMarkdownTab}
          onOpenFileTab={openFloatingMarkdownTab}
          newTabMenuOrder="markdown-first"
          onSetCustomTitle={setTabCustomTitle}
          onSetTabColor={setTabColor}
          onTogglePaneExpand={(tabId) => setTabPaneExpanded(tabId, expandedPaneByTabId[tabId] !== true)}
          editorFiles={editorItems}
          browserTabs={browserItems}
          activeFileId={activeEditorUnifiedId}
          activeBrowserTabId={activeBrowserId}
          activeSimulatorTabId={activeTab?.contentType === 'simulator' ? activeTab.id : null}
          activeTabType={activeTabType}
          onActivateFile={activateFloatingItem}
          onCloseFile={closeFloatingItemConfirmed}
          onActivateBrowserTab={activateFloatingItem}
          onCloseBrowserTab={closeFloatingItemConfirmed}
          onDuplicateBrowserTab={(browserTabId) => {
            const source = browserTabs.find((tab) => tab.id === browserTabId)
            if (!source) return
            createBrowserTab(FLOATING_TERMINAL_WORKTREE_ID, source.url, {
              ...buildDuplicatedBrowserTabOptions(source),
              targetGroupId: activeGroup?.id,
              browserRuntimeEnvironmentId: null
            })
          }}
          onCloseAllFiles={closeAllFiles}
          onMakePreviewFilePermanent={makePreviewFilePermanent}
          onPinFile={pinFile}
          tabBarOrder={tabBarOrder}
          tabStripChrome="floating-panel"
        />
      </div>
      <FloatingTerminalWindowControls maximized={maximized} onToggleMaximized={toggleMaximized} onMinimize={() => onOpenChange(false)} />
    </div>
  )
}
