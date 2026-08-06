import type { AppState } from '../store'
import type { keybindingMatchesAction } from '../../../shared/keybindings'
import type { matchesRecentTabSwitcherChord } from '../../../shared/window-shortcut-policy'
import type { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'
import type {
  createFloatingWorkspaceBrowserTab,
  createFloatingWorkspaceMarkdownTab,
  createFloatingWorkspaceTerminalTab,
  handleEmptyFloatingWorkspacePanelCloseShortcut,
  isEventTargetInsideFloatingWorkspacePanel,
  isFloatingWorkspacePanelFocused,
  switchFloatingWorkspaceTab
} from '@/lib/floating-workspace-terminal-actions'
import type {
  handleSwitchRecentTab,
  handleSwitchTab,
  handleSwitchTabAcrossAllTypes,
  handleSwitchTerminalTab
} from '../hooks/ipc-tab-switch'
import type { translate } from '@/i18n/i18n'
import type { toast } from 'sonner'

export type TerminalSurfaceKeyboardContext = Pick<
  AppState,
  'activeWorktreeId' | 'keybindings' | 'terminalShortcutPolicy' | 'closeBrowserTab'
> & {
  handleNewBrowserTab: () => void
  handleNewFile: () => Promise<void>
  handleNewTab: (shellOverride?: string) => void
  handleNewAgentTab: (agent: TuiAgent) => void
  handleCloseTab: (tabId: string) => void
  handleCloseBrowserTab: (tabId: string) => void
  handlePtyExit: (tabId: string, ptyId: string) => void
  handleCloseFile: (fileId: string) => void
  handleCloseAllFiles: () => void
  createFloatingWorkspaceTerminalTab: typeof createFloatingWorkspaceTerminalTab
  createFloatingWorkspaceBrowserTab: typeof createFloatingWorkspaceBrowserTab
  isFloatingWorkspacePanelFocused: typeof isFloatingWorkspacePanelFocused
  switchFloatingWorkspaceTab: typeof switchFloatingWorkspaceTab
  keybindingMatchesAction: typeof keybindingMatchesAction
  showTerminalShortcutCaptureNotification: typeof showTerminalShortcutCaptureNotification
  getKeybindingContext: (target: EventTarget | null) => 'terminal' | 'app'
  handleSwitchRecentTab: typeof handleSwitchRecentTab
  handleSwitchTab: typeof handleSwitchTab
  handleSwitchTabAcrossAllTypes: typeof handleSwitchTabAcrossAllTypes
  handleSwitchTerminalTab: typeof handleSwitchTerminalTab
  createFloatingWorkspaceMarkdownTab: typeof createFloatingWorkspaceMarkdownTab
  handleEmptyFloatingWorkspacePanelCloseShortcut: typeof handleEmptyFloatingWorkspacePanelCloseShortcut
  isEventTargetInsideFloatingWorkspacePanel: typeof isEventTargetInsideFloatingWorkspacePanel
  matchesRecentTabSwitcherChord: typeof matchesRecentTabSwitcherChord
  toast: typeof toast
  translate: typeof translate
}
