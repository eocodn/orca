import type { KeybindingDefinition } from "./keybinding-contract"
import { platformBindings } from "./keybinding-definition-shared"

export const KEYBINDING_DEFINITION_GROUP_ONE: readonly KeybindingDefinition[] = [
  {
    id: 'worktree.quickOpen',
    title: 'Go to File',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'file', 'quick open'],
    defaultBindings: platformBindings(['Mod+P'])
  },
  {
    id: 'app.settings',
    title: 'Open Settings',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'settings', 'preferences'],
    defaultBindings: platformBindings(['Mod+Comma']),
    conflictGroup: 'menu'
  },
  {
    id: 'app.forceReload',
    title: 'Force Reload',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'reload', 'refresh', 'force'],
    defaultBindings: platformBindings(['Mod+Shift+R']),
    conflictGroup: 'menu'
  },
  {
    id: 'worktree.palette',
    title: 'Switch worktree',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'worktree', 'switch', 'jump'],
    defaultBindings: {
      darwin: ['Mod+J'],
      linux: ['Mod+Shift+J'],
      win32: ['Mod+Shift+J']
    }
  },
  {
    id: 'worktree.navigateUp',
    title: 'Previous worktree',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'worktree', 'previous', 'up'],
    defaultBindings: platformBindings(['Mod+Shift+ArrowUp'])
  },
  {
    id: 'worktree.navigateDown',
    title: 'Next worktree',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'worktree', 'next', 'down'],
    defaultBindings: platformBindings(['Mod+Shift+ArrowDown'])
  },
  {
    id: 'workspace.create',
    title: 'Create worktree',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'worktree', 'create', 'new workspace'],
    defaultBindings: platformBindings(['Mod+N', 'Mod+Shift+N'])
  },
  {
    id: 'workspace.rename',
    title: 'Rename worktree',
    group: 'Global',
    scope: 'global',
    conflictGroup: 'workspace-shell',
    searchKeywords: ['shortcut', 'global', 'worktree', 'rename', 'workspace', 'title'],
    // Why: macOS only — Windows/Linux Ctrl+Alt+R has no safe default (Ctrl+R reverse-search, Ctrl+Shift+R reload are taken).
    defaultBindings: {
      darwin: ['Mod+Alt+R'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'workspace.delete',
    title: 'Delete Workspace',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'global',
      'workspace',
      'current workspace',
      'worktree',
      'delete',
      'remove',
      'trash'
    ],
    // Why: ship now without a default chord; user overrides still win when a future default is assigned.
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  },
  {
    id: 'workspace.openBoard',
    title: 'Open Workspace Board',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'global', 'workspace', 'board', 'kanban', 'worktree'],
    // Why: configurable but unbound by default, to not take a global chord from terminal/browser/editor users.
    defaultBindings: platformBindings([]),
    allowInTerminal: true
  },
  {
    id: 'workspace.selectByIndex',
    title: 'Select Workspace 1–9',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'global',
      'workspace',
      'worktree',
      'select',
      'switch',
      'number',
      'digit',
      '1-9',
      'index'
    ],
    // Why: one remappable row covers the whole 1-9 range (stored chord is a representative; any of 1-9 fires it).
    defaultBindings: platformBindings(['Mod+1'])
  },
  {
    id: 'view.tasks',
    title: 'Open Tasks',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'tasks', 'github issues', 'linear'],
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.left.toggle',
    title: 'Toggle Sidebar',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'left'],
    defaultBindings: platformBindings(['Mod+B'])
  },
  {
    id: 'sidebar.right.toggle',
    title: 'Toggle Right Sidebar',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'right'],
    defaultBindings: platformBindings(['Mod+L'])
  },
  {
    id: 'sidebar.explorer.toggle',
    title: 'Show Explorer',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'explorer', 'files'],
    defaultBindings: platformBindings(['Mod+Shift+E'])
  },
  {
    id: 'sidebar.search.toggle',
    title: 'Show Search',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'search'],
    defaultBindings: platformBindings(['Mod+Shift+F'])
  },
  {
    id: 'sidebar.sourceControl.toggle',
    title: 'Show Source Control',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'source control', 'git'],
    defaultBindings: platformBindings(['Mod+Shift+G'])
  },
  {
    id: 'sidebar.checks.toggle',
    title: 'Show Checks',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'checks', 'ci'],
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.ports.toggle',
    title: 'Show Ports',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'ports'],
    defaultBindings: {
      darwin: ['Mod+Shift+I'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'sidebar.sleepingWorkspaces.toggle',
    title: 'Toggle Sleeping Workspaces',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'sidebar',
      'sleeping',
      'asleep',
      'workspaces',
      'worktree',
      'filter',
      'show',
      'hide'
    ],
    // Why: ship unbound (issue #5209 asks users to assign it), avoiding a claimed cross-platform chord.
    defaultBindings: platformBindings([])
  },
  {
    id: 'sidebar.focusWorktreeList',
    title: 'Focus worktree list',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'sidebar', 'worktree', 'focus'],
    // Why: keep zoom.reset on the browser-standard Mod+0; this chord was unreachable while it shared that default (#8584).
    defaultBindings: platformBindings(['Mod+Shift+0'])
  },
  {
    id: 'floatingTerminal.toggle',
    title: 'Toggle Floating Terminal',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'floating terminal', 'terminal'],
    defaultBindings: platformBindings(['Mod+Alt+A']),
    allowInTerminal: true
  },
  {
    id: 'floatingWorkspace.maximize',
    title: 'Maximize Floating Workspace Panel',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'floating',
      'workspace',
      'panel',
      'floating workspace',
      'workspace panel',
      'maximize',
      'expand'
    ],
    // Why: pairs with floatingTerminal.toggle (Cmd+Opt+A) so maximize stays one-handed; macOS-only, Linux/Windows unbound.
    defaultBindings: {
      darwin: ['Mod+Alt+Shift+A'],
      linux: [],
      win32: []
    },
    allowInTerminal: true
  },
  {
    id: 'floatingWorkspace.minimize',
    title: 'Minimize Floating Workspace Panel',
    group: 'Global',
    scope: 'global',
    searchKeywords: [
      'shortcut',
      'floating',
      'workspace',
      'panel',
      'floating workspace',
      'workspace panel',
      'minimize',
      'hide'
    ],
    // Why: unbound everywhere since floatingTerminal.toggle owns show/hide; this exists only for an explicit user-bound "hide panel" shortcut.
    defaultBindings: {
      darwin: [],
      linux: [],
      win32: []
    },
    allowInTerminal: true
  },
  {
    id: 'zoom.in',
    title: 'Zoom In',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'zoom', 'in', 'scale'],
    defaultBindings: platformBindings(['Mod+Equal', 'Mod+Shift+Plus', 'Mod+NumpadAdd'])
  },
  {
    id: 'zoom.out',
    title: 'Zoom Out',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'zoom', 'out', 'scale'],
    defaultBindings: platformBindings(['Mod+Minus', 'Mod+NumpadSubtract'])
  },
  {
    id: 'zoom.reset',
    title: 'Reset Size',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'zoom', 'reset', 'size', 'actual'],
    defaultBindings: platformBindings(['Mod+0'])
  },
  {
    id: 'worktree.history.back',
    title: 'Worktree History Back',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'worktree', 'history', 'back'],
    defaultBindings: platformBindings(['Mod+Alt+ArrowLeft']),
    allowInTerminal: true
  },
  {
    id: 'worktree.history.forward',
    title: 'Worktree History Forward',
    group: 'Global',
    scope: 'global',
    searchKeywords: ['shortcut', 'worktree', 'history', 'forward'],
    defaultBindings: platformBindings(['Mod+Alt+ArrowRight']),
    allowInTerminal: true
  },
  {
    id: 'tab.newTerminal',
    title: 'New terminal tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'terminal', 'new'],
    defaultBindings: platformBindings(['Mod+T'])
  },
  {
    id: 'tab.newAgent',
    title: 'New agent tab (default agent)',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'agent', 'new', 'default', 'launch'],
    // Why: macOS only — Windows Ctrl+Alt is AltGr and Linux Ctrl+Alt+T is the desktop "open terminal", so no safe default there.
    defaultBindings: {
      darwin: ['Mod+Alt+T'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'tab.newBrowser',
    title: 'New browser tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'browser', 'new'],
    defaultBindings: platformBindings(['Mod+Shift+B'])
  },
  {
    id: 'tab.newMarkdown',
    title: 'New markdown tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'markdown', 'file', 'new'],
    defaultBindings: platformBindings(['Mod+Shift+M'])
  },
  {
    id: 'tab.openMarkdown',
    title: 'Open markdown tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'markdown', 'file', 'open'],
    defaultBindings: platformBindings(['Mod+Shift+O'])
  },
  {
    id: 'tab.close',
    title: 'Close active tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'close', 'tab', 'pane'],
    defaultBindings: platformBindings(['Mod+W'])
  },
  {
    id: 'tab.closeAll',
    title: 'Close all editor tabs',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'close', 'all', 'tabs', 'files', 'editors'],
    defaultBindings: platformBindings(['Mod+Alt+W'])
  },
  {
    id: 'tab.rename',
    title: 'Rename active tab',
    group: 'Tabs',
    scope: 'tabs',
    conflictGroup: 'workspace-shell',
    searchKeywords: ['shortcut', 'tab', 'rename', 'title', 'label'],
    // Why: macOS only — Cmd+R is free in app/terminal focus; on Windows/Linux Ctrl+R is shell reverse-search, so left unbound.
    defaultBindings: {
      darwin: ['Mod+R'],
      linux: [],
      win32: []
    }
  },
  {
    id: 'tab.reopenClosed',
    title: 'Reopen closed tab',
    group: 'Tabs',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'reopen', 'restore', 'closed'],
    defaultBindings: platformBindings(['Mod+Shift+T'])
  },
  {
    id: 'tab.nextSameType',
    title: 'Next tab (same type)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'next', 'switch', 'cycle'],
    // Why: the widespread "switch tab" chord (Mod+Shift+Bracket) now drives all-types cycling; same-type moved to Mod+Alt for new installs.
    defaultBindings: platformBindings(['Mod+Alt+BracketRight'])
  },
  {
    id: 'tab.previousSameType',
    title: 'Previous tab (same type)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'previous', 'switch', 'cycle'],
    defaultBindings: platformBindings(['Mod+Alt+BracketLeft'])
  },
  {
    id: 'tab.nextAllTypes',
    title: 'Next tab (all types)',
    group: 'Tab Navigation',
    scope: 'tabs',
    searchKeywords: ['shortcut', 'tab', 'next', 'switch', 'cycle', 'all', 'any'],
    defaultBindings: platformBindings(['Mod+Shift+BracketRight'])
  },
]
