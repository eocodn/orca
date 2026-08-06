import React from 'react'
import { FilePlus, FileText, Globe, Plus, TerminalSquare } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useShortcutLabel, useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { ShellIcon } from './shell-icons'
import TabBarCreateEntry from './TabBarCreateEntry'
import { QuickLaunchAgentMenuItems } from './QuickLaunchButton'
import type { TabBarControllerModel, TabBarProps } from './tab-bar-controller'
import { resolveWindowsShellLaunchTarget } from './windows-shell-launch'

type TabBarMenuProps = Pick<
  TabBarProps,
  | 'worktreeId'
  | 'onNewTerminalTab'
  | 'onNewTerminalWithShell'
  | 'onNewBrowserTab'
  | 'onOpenEntry'
  | 'onNewFileTab'
  | 'onOpenFileTab'
  | 'terminalOnly'
  | 'showAgentLaunchItems'
  | 'newTabMenuOrder'
> & { controller: TabBarControllerModel }

export function TabBarMenu({ controller, ...props }: TabBarMenuProps): React.JSX.Element {
  const {
    worktreeId,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onOpenEntry,
    onNewFileTab,
    onOpenFileTab,
    terminalOnly = false,
    showAgentLaunchItems = true,
    newTabMenuOrder = 'default'
  } = props
  const newTerminalShortcut = useShortcutLabel('tab.newTerminal')
  const newBrowserShortcut = useShortcutLabel('tab.newBrowser')
  const newFileShortcut = useShortcutLabel('tab.newMarkdown')
  const openMarkdownShortcut = useOptionalShortcutLabel('tab.openMarkdown')
  const {
    resolvedGroupId,
    newTabMenuOpen,
    setNewTabMenuOpen,
    createMenuOptions,
    agentLaunchOptions,
    windowsShellEntries,
    defaultWindowsPowerShellImplementation,
    windowsTerminalCapabilities,
    queueNewActiveTerminalFocusAfterNewTabMenuClose,
    queueTerminalTabFocusAfterNewTabMenuClose,
    handleSelectCreateMenuOption,
    launchAgentFromNewTabEntry,
    runPendingNewTabMenuFocusAfterClose,
    setCreateMenuQuery,
    showStaticCreateMenuItems
  } = controller
  const defaultTerminalMenuItems =
    windowsShellEntries && onNewTerminalWithShell ? (
      windowsShellEntries.map((entry, index) => (
        <DropdownMenuItem
          key={entry.shell}
          onSelect={() => {
            queueNewActiveTerminalFocusAfterNewTabMenuClose()
            onNewTerminalWithShell(
              resolveWindowsShellLaunchTarget(
                entry.shell,
                defaultWindowsPowerShellImplementation,
                windowsTerminalCapabilities.pwshAvailable
              )
            )
          }}
          className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
        >
          <ShellIcon shell={entry.shell} size={14} />
          <span className="flex-1">
            {translate('auto.components.tab.bar.TabBar.7c1313d237', 'New Terminal:')} {entry.label}
          </span>
          {index === 0 ? <DropdownMenuShortcut>{newTerminalShortcut}</DropdownMenuShortcut> : null}
        </DropdownMenuItem>
      ))
    ) : (
      <DropdownMenuItem
        onSelect={() => {
          queueNewActiveTerminalFocusAfterNewTabMenuClose()
          onNewTerminalTab()
        }}
        className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
      >
        <TerminalSquare className="size-4 text-muted-foreground" />
        {translate('auto.components.tab.bar.TabBar.d364f3c8d4', 'New Terminal')}
        <DropdownMenuShortcut>{newTerminalShortcut}</DropdownMenuShortcut>
      </DropdownMenuItem>
    )
  const newBrowserMenuItem = !terminalOnly ? (
    <DropdownMenuItem
      onSelect={onNewBrowserTab}
      className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
    >
      <Globe className="size-4 text-muted-foreground" />
      {translate('auto.components.tab.bar.TabBar.4833fb2cbe', 'New Browser Tab')}
      <DropdownMenuShortcut>{newBrowserShortcut}</DropdownMenuShortcut>
    </DropdownMenuItem>
  ) : null
  const newMarkdownMenuItem =
    !terminalOnly && onNewFileTab ? (
      <DropdownMenuItem
        onSelect={onNewFileTab}
        className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
      >
        <FilePlus className="size-4 text-muted-foreground" />
        {translate('auto.components.tab.bar.TabBar.3d5d6c960d', 'New Markdown')}
        <DropdownMenuShortcut>{newFileShortcut}</DropdownMenuShortcut>
      </DropdownMenuItem>
    ) : null
  const openMarkdownMenuItem =
    !terminalOnly && onOpenFileTab ? (
      <DropdownMenuItem
        onSelect={onOpenFileTab}
        className="gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 font-medium"
      >
        <FileText className="size-4 text-muted-foreground" />
        {translate('auto.components.tab.bar.TabBar.4f327c8b3d', 'Open Markdown...')}
        {openMarkdownShortcut ? (
          <DropdownMenuShortcut>{openMarkdownShortcut}</DropdownMenuShortcut>
        ) : null}
      </DropdownMenuItem>
    ) : null
  const standardCreateMenuItems =
    newTabMenuOrder === 'markdown-first' ? (
      <>
        {newMarkdownMenuItem}
        {openMarkdownMenuItem}
        {defaultTerminalMenuItems}
        {newBrowserMenuItem}
      </>
    ) : (
      <>
        {defaultTerminalMenuItems}
        {newBrowserMenuItem}
        {newMarkdownMenuItem}
        {openMarkdownMenuItem}
      </>
    )
  return (
    <DropdownMenu open={newTabMenuOpen} onOpenChange={setNewTabMenuOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="ml-2 my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={translate('auto.components.tab.bar.TabBar.b1a132357f', 'New tab')}
          aria-label={translate('auto.components.tab.bar.TabBar.b1a132357f', 'New tab')}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-1rem)] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          runPendingNewTabMenuFocusAfterClose()
        }}
      >
        {!terminalOnly && onOpenEntry ? (
          <>
            <TabBarCreateEntry
              worktreeId={worktreeId}
              groupId={resolvedGroupId}
              menuOpen={newTabMenuOpen}
              menuOptions={createMenuOptions}
              agentOptions={agentLaunchOptions}
              onLaunchAgent={launchAgentFromNewTabEntry}
              onOpenDefaultTerminal={() => {
                queueNewActiveTerminalFocusAfterNewTabMenuClose()
                onNewTerminalTab()
              }}
              onOpenEntry={onOpenEntry}
              onQueryChange={setCreateMenuQuery}
              onSelectMenuOption={handleSelectCreateMenuOption}
              onDidOpenEntry={() => setNewTabMenuOpen(false)}
            />
            {showStaticCreateMenuItems ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {showStaticCreateMenuItems ? standardCreateMenuItems : null}
        {showStaticCreateMenuItems && showAgentLaunchItems ? (
          <>
            <DropdownMenuSeparator />
            <QuickLaunchAgentMenuItems
              worktreeId={worktreeId}
              groupId={resolvedGroupId}
              onFocusTerminal={queueTerminalTabFocusAfterNewTabMenuClose}
            />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
