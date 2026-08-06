import { useEffect } from 'react'
export function useTerminalSurfaceKeyboard(context: Record<string, any>): void {
  const {
    activeWorktreeId,
    keybindings,
    terminalShortcutPolicy,
    handleNewBrowserTab,
    handleNewFile,
    handleNewTab,
    handleNewAgentTab,
    handleCloseTab,
    handleCloseBrowserTab,
    closeBrowserTab,
    handleCloseFile,
    handleCloseAllFiles,
    createFloatingWorkspaceTerminalTab,
    createFloatingWorkspaceBrowserTab,
    isFloatingWorkspacePanelFocused,
    switchFloatingWorkspaceTab,
    keybindingMatchesAction,
    showTerminalShortcutCaptureNotification,
    getKeybindingContext,
    handleSwitchRecentTab,
    handleSwitchTab,
    handleSwitchTabAcrossAllTypes,
    handleSwitchTerminalTab,
    createFloatingWorkspaceMarkdownTab,
    handleEmptyFloatingWorkspacePanelCloseShortcut,
    isEventTargetInsideFloatingWorkspacePanel,
    matchesRecentTabSwitcherChord,
    toast,
    translate
  } = context
  useEffect(() => {
    if (!activeWorktreeId) {
      return
    }
    const isMac = navigator.userAgent.includes('Mac')
    const shortcutPlatform: NodeJS.Platform = isMac
      ? 'darwin'
      : navigator.userAgent.includes('Windows')
        ? 'win32'
        : 'linux'
    const onKeyDown = (e: KeyboardEvent): void => {
      const context = getKeybindingContext(e.target)
      const floatingWorkspaceFocused = isFloatingWorkspacePanelFocused()
      const matchShortcut = (actionId: KeybindingActionId): boolean =>
        keybindingMatchesAction(actionId, e, shortcutPlatform, keybindings, {
          context,
          terminalShortcutPolicy
        })
      const notifyTerminalCapture = (actionId: KeybindingActionId): void => {
        if (context !== 'terminal' || terminalShortcutPolicy !== 'orca-first') {
          return
        }
        showTerminalShortcutCaptureNotification({
          actionId,
          platform: shortcutPlatform,
          keybindings
        })
      }
      if (!e.repeat && matchShortcut('tab.newTerminal')) {
        e.preventDefault()
        notifyTerminalCapture('tab.newTerminal')
        if (floatingWorkspaceFocused) {
          void createFloatingWorkspaceTerminalTab(useAppStore.getState())
          return
        }
        handleNewTab()
        return
      }
      if (!e.repeat) {
        const state = useAppStore.getState()
        let agentActionId: KeybindingActionId | null = null
        let agentToLaunch: TuiAgent | null = null
        if (matchShortcut('tab.newAgent')) {
          const connectionId = getConnectionId(activeWorktreeId)
          agentActionId = 'tab.newAgent'
          agentToLaunch = resolveDefaultAgentForNewTab({
            defaultTuiAgent: state.settings?.defaultTuiAgent,
            detectedAgentIds:
              typeof connectionId === 'string'
                ? state.remoteDetectedAgentIds[connectionId]
                : state.detectedAgentIds,
            disabledTuiAgents: state.settings?.disabledTuiAgents
          })
        } else {
          for (const bound of listBoundAgentTabActions(
            keybindings,
            state.settings?.disabledTuiAgents
          )) {
            if (matchShortcut(bound.actionId)) {
              agentActionId = bound.actionId
              agentToLaunch = bound.agent
              break
            }
          }
        }
        if (agentActionId) {
          e.preventDefault()
          notifyTerminalCapture(agentActionId)
          if (agentToLaunch) {
            handleNewAgentTab(agentToLaunch)
          } else {
            toast.message(
              translate(
                'auto.components.Terminal.5b2c1a9e44',
                'No agent CLI detected — install one or pick a default agent in Settings.'
              )
            )
          }
          return
        }
      }
      if (!e.repeat && matchShortcut('tab.reopenClosed')) {
        e.preventDefault()
        notifyTerminalCapture('tab.reopenClosed')
        useAppStore.getState().reopenClosedTab(activeWorktreeId)
        return
      }
      if (!e.repeat && matchShortcut('tab.newBrowser')) {
        e.preventDefault()
        notifyTerminalCapture('tab.newBrowser')
        if (floatingWorkspaceFocused) {
          void createFloatingWorkspaceBrowserTab(useAppStore.getState())
          return
        }
        handleNewBrowserTab()
        return
      }
      if (!e.repeat && matchShortcut('editor.save')) {
        const target = e.target as HTMLElement | null
        const inEditor =
          target?.closest('.monaco-editor, [contenteditable]') !== null ||
          target?.closest('textarea:not(.xterm-helper-textarea), input') !== null
        if (!inEditor) {
          const state = useAppStore.getState()
          if (state.activeTabType === 'editor' && state.activeFileId) {
            e.preventDefault()
            notifyTerminalCapture('editor.save')
            window.dispatchEvent(new Event(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT))
            return
          }
        }
      }
      if (!e.repeat && matchShortcut('editor.toggleWordWrap')) {
        const state = useAppStore.getState()
        if (state.activeTabType === 'editor' && state.activeFileId) {
          e.preventDefault()
          notifyTerminalCapture('editor.toggleWordWrap')
          const activeFile = state.openFiles.find((file) => file.id === state.activeFileId)
          if (activeFile?.mode === 'diff') {
            const wrapOn = state.settings?.diffWordWrap === true
            void state.updateSettings({ diffWordWrap: !wrapOn })
          } else {
            const wrapOn = state.settings?.editorWordWrap !== false
            void state.updateSettings({ editorWordWrap: !wrapOn })
          }
          return
        }
      }
      if (!e.repeat && matchShortcut('tab.newMarkdown')) {
        e.preventDefault()
        notifyTerminalCapture('tab.newMarkdown')
        if (floatingWorkspaceFocused) {
          void createFloatingWorkspaceMarkdownTab(useAppStore.getState()).catch((err) => {
            toast.error(
              err instanceof Error
                ? err.message
                : translate(
                    'auto.components.Terminal.f0600556b3',
                    'Failed to create untitled markdown file.'
                  )
            )
          })
          return
        }
        void handleNewFile()
        return
      }
      if (handleEmptyFloatingWorkspacePanelCloseShortcut(e, shortcutPlatform, keybindings)) {
        return
      }
      if (!e.repeat && matchShortcut('tab.close')) {
        const floatingPanelOwnsEvent =
          isEventTargetInsideFloatingWorkspacePanel(e.target) || floatingWorkspaceFocused
        if (floatingPanelOwnsEvent) {
          return
        }
        const state = useAppStore.getState()
        if (state.activeTabType === 'terminal' && context === 'terminal') {
          return
        }
        e.preventDefault()
        notifyTerminalCapture('tab.close')
        if (state.activeTabType === 'editor' && state.activeFileId) {
          handleCloseFile(state.activeFileId)
        } else if (state.activeTabType === 'browser' && state.activeBrowserTabId) {
          handleCloseBrowserTab(state.activeBrowserTabId)
        }
        return
      }
      if (!e.repeat && matchShortcut('tab.closeAll')) {
        e.preventDefault()
        notifyTerminalCapture('tab.closeAll')
        handleCloseAllFiles()
        return
      }
      if (
        matchesRecentTabSwitcherChord(e, shortcutPlatform, keybindings, {
          context,
          terminalShortcutPolicy
        })
      ) {
        return
      }
      if (!e.repeat && matchShortcut('tab.previousRecent')) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        handleSwitchRecentTab()
        return
      }
      const switchSameTypeDirection = matchShortcut('tab.nextSameType')
        ? 1
        : matchShortcut('tab.previousSameType')
          ? -1
          : null
      const switchAllTypesDirection = matchShortcut('tab.nextAllTypes')
        ? 1
        : matchShortcut('tab.previousAllTypes')
          ? -1
          : null
      if (!e.repeat && (switchSameTypeDirection !== null || switchAllTypesDirection !== null)) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        notifyTerminalCapture(
          switchAllTypesDirection !== null
            ? switchAllTypesDirection === 1
              ? 'tab.nextAllTypes'
              : 'tab.previousAllTypes'
            : switchSameTypeDirection === 1
              ? 'tab.nextSameType'
              : 'tab.previousSameType'
        )
        if (floatingWorkspaceFocused) {
          switchFloatingWorkspaceTab(
            useAppStore.getState(),
            switchAllTypesDirection ?? switchSameTypeDirection ?? 1,
            switchAllTypesDirection !== null ? 'all-types' : 'same-type'
          )
        } else if (switchAllTypesDirection !== null) {
          handleSwitchTabAcrossAllTypes(switchAllTypesDirection)
        } else {
          handleSwitchTab(switchSameTypeDirection ?? 1)
        }
      }
      const terminalTabDirection = matchShortcut('tab.nextTerminal')
        ? 1
        : matchShortcut('tab.previousTerminal')
          ? -1
          : null
      if (!e.repeat && terminalTabDirection !== null) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (floatingWorkspaceFocused) {
          switchFloatingWorkspaceTab(useAppStore.getState(), terminalTabDirection, 'terminal')
        } else {
          handleSwitchTerminalTab(terminalTabDirection)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [
    activeWorktreeId,
    handleNewBrowserTab,
    handleNewFile,
    handleNewTab,
    handleNewAgentTab,
    handleCloseTab,
    handleCloseBrowserTab,
    closeBrowserTab,
    handleCloseFile,
    handleCloseAllFiles,
    keybindings,
    terminalShortcutPolicy
  ])
}
