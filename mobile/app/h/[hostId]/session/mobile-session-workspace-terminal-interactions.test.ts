import { describe, expect, it, vi } from 'vitest'

const { useMobileSessionTabInteractions } = vi.hoisted(() => ({
  useMobileSessionTabInteractions: vi.fn((args: Record<string, unknown>) => args)
}))

vi.mock('./use-mobile-session-tab-interactions', () => ({ useMobileSessionTabInteractions }))

import { useMobileSessionWorkspaceTerminalInteractions } from './mobile-session-workspace-terminal-interactions'

describe('mobile session workspace terminal interactions', () => {
  it('forwards workspace and document dependencies to the tab interaction hook', () => {
    const context = {
      sessionTabs: ['tab'],
      activeSessionTab: 'active-tab',
      terminalDiagnosticsRef: { current: null },
      pendingActiveSessionTabIdRef: { current: null },
      pendingActiveTerminalHandleRef: { current: null },
      activeSessionTabTypeRef: { current: 'terminal' },
      defaultTerminalHandlesToLiveInput: vi.fn(),
      setActiveSessionTabId: vi.fn(),
      activeHandleRef: { current: null },
      setActiveHandle: vi.fn(),
      unsubscribeTerminal: vi.fn(),
      initializedHandlesRef: { current: new Set() },
      terminalUnsubsRef: { current: new Map() },
      subscribeToTerminal: vi.fn(),
      client: {},
      switchSessionTabRef: { current: null },
      terminalRefs: { current: new Map() },
      terminalGestureInputBucketsRef: { current: new Map() },
      terminalGestureInputQueuesRef: { current: new Map() },
      terminalGestureInputInFlightRef: { current: new Set() },
      webReadyHandlesRef: { current: new Set() },
      measureViewportOnce: vi.fn(),
      fileDocs: {},
      sendingRef: { current: false },
      canSend: true,
      input: '',
      setInput: vi.fn(),
      deviceTokenRef: { current: null },
      handleLiveInputAccessoryBytes: vi.fn(),
      clientRef: { current: {} },
      connStateRef: { current: 'connected' },
      liveInputEnabled: true,
      focusTerminalLiveInputTarget: vi.fn(),
      keyboardHeight: 0,
      liveInputRef: { current: null },
      liveInputFocusTimerRef: { current: null },
      sessionTabActionSheetKeyboardHideSubRef: { current: null },
      setActionTarget: vi.fn(),
      setMarkdownActionTarget: vi.fn(),
      setFileActionTarget: vi.fn(),
      setBrowserActionTarget: vi.fn(),
      scheduleDelayedAction: vi.fn(),
      commandInputRef: { current: null },
      handleCreateBrowserRef: { current: vi.fn() },
      hostId: 'host',
      routeWorktreeName: 'worktree',
      router: { push: vi.fn() },
      terminalCwdRef: { current: new Map() },
      fetchSessionTabs: vi.fn(),
      sessionTabsRef: { current: [] },
      activeSessionTabIdRef: { current: null },
      terminalLinkOpenMode: 'orca-browser',
      isFloatingWorkspaceRoute: false
    }
    const documentActions = {
      readFileTab: vi.fn(),
      readMarkdownTab: vi.fn()
    }

    useMobileSessionWorkspaceTerminalInteractions(context, documentActions)

    expect(useMobileSessionTabInteractions).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionTabs: context.sessionTabs,
        readFileTab: documentActions.readFileTab,
        readMarkdownTab: documentActions.readMarkdownTab,
        hostId: context.hostId,
        routeWorktreeName: context.routeWorktreeName
      })
    )
  })
})
