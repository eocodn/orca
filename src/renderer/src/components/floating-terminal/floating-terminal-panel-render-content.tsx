import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import TerminalPane from '@/components/terminal-pane/TerminalPane'
import { shouldDeferParkedPtyExitTabClose } from '@/components/terminal-pane/terminal-parked-tab-watchers'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { FloatingBrowserSlot } from './FloatingBrowserSlot'
import { FloatingTerminalEmptyState } from './floating-terminal-empty-state'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { FloatingTerminalPanelRenderContext } from './floating-terminal-panel-render-types'

const EditorPanel = lazy(() => import('@/components/editor/EditorPanel'))

export function FloatingTerminalPanelContent({
  context
}: {
  context: FloatingTerminalPanelRenderContext
}) {
  const {
    open,
    cwd,
    tabs,
    parkedTerminalTabIds,
    activeTerminalId,
    terminalPaneRegistry,
    closeFloatingItemConfirmed,
    browserTabs,
    activeBrowserTab,
    activeEditorFile,
    activeEditorUnifiedId,
    hasVisibleFloatingTabs,
    focusPanelForShortcuts,
    createFloatingTerminalTab,
    createFloatingMarkdownTab,
    openFloatingMarkdownTab,
    createFloatingBrowserTab,
    onOpenChange,
    newTerminalShortcut,
    newBrowserShortcut,
    newMarkdownShortcut,
    openMarkdownShortcut,
    closeShortcut
  } = context
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden bg-background"
      data-contextual-tour-target={
        hasVisibleFloatingTabs ? 'floating-workspace-surface' : undefined
      }
    >
      {cwd
        ? tabs
            .filter((tab) => !parkedTerminalTabIds.has(tab.id))
            .map((tab) => {
              const isActive = tab.id === activeTerminalId
              return (
                <div
                  key={`${tab.id}-${tab.generation ?? 0}`}
                  className={isActive ? 'absolute inset-0' : 'absolute inset-0 hidden'}
                  aria-hidden={!isActive}
                >
                  <TerminalPane
                    ref={terminalPaneRegistry.getRefCallback(tab.id)}
                    tabId={tab.id}
                    worktreeId={FLOATING_TERMINAL_WORKTREE_ID}
                    cwd={cwd}
                    isActive={isActive}
                    isVisible={isActive && open}
                    onPtyExit={(ptyId) => {
                      if (!shouldDeferParkedPtyExitTabClose(tab.id, ptyId)) {
                        closeTerminalTab(tab.id, { reason: 'pty-exit', lifecyclePtyId: ptyId })
                      }
                    }}
                    onCloseTab={() => closeFloatingItemConfirmed(tab.id)}
                  />
                </div>
              )
            })
        : null}
      {browserTabs.map((tab) => {
        const isActive = tab.id === activeBrowserTab?.id
        return (
          <div
            key={tab.id}
            className={isActive ? 'absolute inset-0 flex' : 'absolute inset-0 hidden'}
            aria-hidden={!isActive}
          >
            <FloatingBrowserSlot browserTab={tab} isActive={open && isActive} />
          </div>
        )
      })}
      {activeEditorFile ? (
        <div className="absolute inset-0 flex min-h-0 min-w-0">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalPanel.d6b563ae24',
                  'Loading editor...'
                )}
              </div>
            }
          >
            <EditorPanel
              activeFileId={activeEditorFile.id}
              activeViewStateId={activeEditorUnifiedId}
              markdownAnnotationsEnabled={false}
            />
          </Suspense>
        </div>
      ) : null}
      {!hasVisibleFloatingTabs ? (
        <FloatingTerminalEmptyState
          onNewTerminal={createFloatingTerminalTab}
          onNewMarkdown={createFloatingMarkdownTab}
          onOpenMarkdown={openFloatingMarkdownTab}
          onNewBrowser={createFloatingBrowserTab}
          onClose={() => onOpenChange(false)}
          onFocusPanel={focusPanelForShortcuts}
          newTerminalShortcut={newTerminalShortcut}
          newBrowserShortcut={newBrowserShortcut}
          newMarkdownShortcut={newMarkdownShortcut}
          openMarkdownShortcut={openMarkdownShortcut}
          closeShortcut={closeShortcut}
        />
      ) : null}
    </div>
  )
}
