import { createPortal } from 'react-dom'
import { normalizeExternalBrowserUrl } from '../../../../shared/browser-url'
import { translate } from '@/i18n/i18n'
import type { RemoteBrowserSurfaceRenderContext } from './browser-pane-remote-surface-render-types'

export function RemoteBrowserContextMenu({
  contextMenu,
  contextMenuRef,
  createBrowserTab,
  runRemoteNavigation,
  setContextMenu,
  worktreeId
}: Pick<RemoteBrowserSurfaceRenderContext, 'contextMenu' | 'contextMenuRef' | 'createBrowserTab' | 'runRemoteNavigation' | 'setContextMenu'> & {
  worktreeId: string
}): React.JSX.Element | null {
  if (!contextMenu) {
    return null
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onPointerDown={() => setContextMenu(null)} />
      <div
        ref={contextMenuRef}
        role="menu"
        data-testid="remote-browser-context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        className="fixed z-50 min-w-[13rem] overflow-hidden rounded-[11px] border border-black/14 bg-[rgba(255,255,255,0.82)] p-1 text-black shadow-[0_16px_36px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl dark:border-white/14 dark:bg-[rgba(0,0,0,0.72)] dark:text-white dark:shadow-[0_20px_44px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        {contextMenu.linkUrl ? (
          <>
            <ContextMenuItem
              onClick={() => {
                createBrowserTab(worktreeId, contextMenu.linkUrl!, { title: contextMenu.linkUrl! })
                setContextMenu(null)
              }}
            >
              {translate('auto.components.browser.pane.BrowserPane.b5b87d6cbb', 'Open Link In Orca Browser')}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                const url = normalizeExternalBrowserUrl(contextMenu.linkUrl!)
                if (url) void window.api.shell.openUrl(url)
                setContextMenu(null)
              }}
            >
              {translate('auto.components.browser.pane.BrowserPane.8ce4f6b12e', 'Open Link In Default Browser')}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => {
                void window.api.ui.writeClipboardText(contextMenu.linkUrl ?? '')
                setContextMenu(null)
              }}
            >
              {translate('auto.components.browser.pane.BrowserPane.efb0e8f7f3', 'Copy Link Address')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        {contextMenu.selectionText.trim() ? (
          <>
            <ContextMenuItem
              onClick={() => {
                void window.api.ui.writeClipboardText(contextMenu.selectionText)
                setContextMenu(null)
              }}
            >
              {translate('auto.components.browser.pane.BrowserPane.2a4c4b8e1f', 'Copy')}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem onClick={() => { void runRemoteNavigation('browser.back'); setContextMenu(null) }}>
          {translate('auto.components.browser.pane.BrowserPane.40edfa75cb', 'Back')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => { void runRemoteNavigation('browser.forward'); setContextMenu(null) }}>
          {translate('auto.components.browser.pane.BrowserPane.250a9b3e42', 'Forward')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => { void runRemoteNavigation('browser.reload'); setContextMenu(null) }}>
          {translate('auto.components.browser.pane.BrowserPane.0e080d820e', 'Reload')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => {
            const url = normalizeExternalBrowserUrl(contextMenu.pageUrl)
            if (url) void window.api.shell.openUrl(url)
            setContextMenu(null)
          }}
        >
          {translate('auto.components.browser.pane.BrowserPane.f7ab83f7ed', 'Open Page In Default Browser')}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            void window.api.ui.writeClipboardText(contextMenu.pageUrl)
            setContextMenu(null)
          }}
        >
          {translate('auto.components.browser.pane.BrowserPane.1b179ab561', 'Copy Page URL')}
        </ContextMenuItem>
      </div>
    </>,
    document.body
  )
}

function ContextMenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border/70" />
}
