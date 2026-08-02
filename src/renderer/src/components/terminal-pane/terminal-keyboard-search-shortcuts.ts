import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { isFindQueryTooLarge } from '@/lib/find-query-bounds'
import { normalizeSelectedTextForFileSearch } from '@/lib/file-search-selection'
import { safeFind } from '../terminal-search-safe-find'
import {
  keybindingMatchesAction,
  type KeybindingOverrides,
  type KeybindingPlatform,
  type TerminalShortcutPolicy
} from '../../../../shared/keybindings'

export type SearchState = {
  query: string
  caseSensitive: boolean
  regex: boolean
}

export type SearchNavigationDirection = 'next' | 'previous'

/** Pure decision function for Cmd/Ctrl+G search navigation. */
export function matchSearchNavigate(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  isMac: boolean,
  searchOpen: boolean,
  searchState: SearchState
): SearchNavigationDirection | null {
  if (e.altKey) {
    return null
  }
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod || e.key.toLowerCase() !== 'g' || !searchOpen || !searchState.query) {
    return null
  }
  if (isFindQueryTooLarge(searchState.query)) {
    return null
  }
  return e.shiftKey ? 'previous' : 'next'
}

export function runTerminalSearchNavigation(
  pane: Pick<ManagedPane, 'searchAddon'>,
  direction: SearchNavigationDirection,
  searchState: SearchState
): boolean {
  const { query, caseSensitive, regex } = searchState
  const options = { caseSensitive, regex }

  // Cmd/Ctrl+G uses the same guarded xterm decoration path as the search panel.
  return direction === 'next'
    ? safeFind((term, findOptions) => pane.searchAddon.findNext(term, findOptions), query, options)
    : safeFind(
        (term, findOptions) => pane.searchAddon.findPrevious(term, findOptions),
        query,
        options
      )
}

export function matchFileSearchShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>,
  platform: KeybindingPlatform,
  keybindings?: KeybindingOverrides,
  terminalShortcutPolicy: TerminalShortcutPolicy = 'orca-first'
): boolean {
  if (e.repeat) {
    return false
  }
  return keybindingMatchesAction('sidebar.search.toggle', e, platform, keybindings, {
    context: 'terminal',
    terminalShortcutPolicy
  })
}

export function getSelectedTerminalFileSearchText(pane: ManagedPane | undefined): string {
  return normalizeSelectedTextForFileSearch(pane?.terminal.getSelection())
}
