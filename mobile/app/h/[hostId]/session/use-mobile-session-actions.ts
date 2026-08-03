import type { RpcFailure, RpcSuccess } from '../../../../src/transport/types'
import { triggerError, triggerSelection, triggerSuccess } from '../../../../src/platform/haptics'
import { buildMobileQuickCommandLaunch, type MobileQuickCommandLaunch } from '../../../../src/terminal/quick-commands'
import { captureMobileFileMutationOwnership } from '../../../../src/files/mobile-file-mutation-ownership'
import { isFileExistsErrorMessage } from '../../../../src/session/mobile-session-route-helpers'
import { normalizeBrowserUrl } from '../../../../src/browser/browser-url'
import type { MobileNewTabAgentOption } from '../../../../src/session/mobile-new-tab-agent-options'
import type { TerminalQuickCommand } from '../../../../../src/shared/types'
import type { MobileSessionTab, Terminal, TerminalCreateResult } from './mobile-session-route-types'

type SessionActionContext = Record<string, any>

export function useMobileSessionActions(context: SessionActionContext) {
  const {
    client,
    connState,
    creatingTerminalRef,
    creatingBrowser,
    creatingMarkdown,
    buildMobileQuickCommandLaunch,
    triggerError,
    showToast,
    handleCreateTerminal,
    setCreatingMarkdown,
    setCreateError,
    worktreeId,
    captureMobileFileMutationOwnership,
    isFileExistsErrorMessage,
    scheduleDelayedAction,
    fetchSessionTabs,
    setCreatingBrowser,
    browserScreencastSupportedRef,
    normalizeBrowserUrl,
    pendingBrowserFocusPageIdRef,
    fetchPendingBrowserSessionTabs,
    handleCreateBrowserRef,
    renameTarget,
    setRenameTarget,
    setTerminals,
    terminalsRef,
    fetchTerminals,
    unsubscribeTerminal,
    terminalRefs,
    initializedHandlesRef,
    clearTerminalLiveInputDefault,
    terminals,
    activeHandleRef,
    pendingActiveTerminalHandleRef,
    setActiveHandle,
    subscribeToTerminal,
    sessionTabsRef,
    setSessionTabs,
    closedTabTombstonesRef,
    activeSessionTabIdRef,
    activeSessionTabTypeRef,
    setActiveSessionTabId,
    defaultTerminalHandlesToLiveInput,
    pendingActiveSessionTabIdRef
  } = context

  function launchQuickCommand(command: TerminalQuickCommand): boolean {
    if (
      !client ||
      connState !== 'connected' ||
      creatingTerminalRef.current ||
      creatingBrowser ||
      creatingMarkdown
    ) {
      return false
    }
    const launch = buildMobileQuickCommandLaunch(command)
    if (!launch) {
      triggerError()
      showToast('Edit this quick command before running it', 1800)
      return false
    }
    const label = command.label.trim() || 'Quick command'
    void handleCreateTerminal(launch.agent, {
      ...launch.options,
      errorToast: `Couldn't run ${label}`
    })
    return true
  }

  async function handleCreateMarkdownNote() {
    if (!client || creatingMarkdown) {
      return
    }

    setCreatingMarkdown(true)
    setCreateError('')

    try {
      const worktree = `id:${worktreeId}`
      const mutationOwnership = await captureMobileFileMutationOwnership(client, worktree)
      for (let attempt = 1; attempt <= 100; attempt += 1) {
        const relativePath = attempt === 1 ? 'untitled.md' : `untitled-${attempt}.md`
        const createResponse = await client.sendRequest(
          'files.createFile',
          { worktree, relativePath, ...mutationOwnership },
          { timeoutMs: 15_000 }
        )
        if (!createResponse.ok) {
          const message = (createResponse as RpcFailure).error.message
          if (isFileExistsErrorMessage(message) && attempt < 100) {
            continue
          }
          throw new Error(message || 'Failed to create markdown note')
        }

        const openResponse = await client.sendRequest(
          'files.open',
          { worktree, relativePath },
          { timeoutMs: 15_000 }
        )
        if (!openResponse.ok) {
          throw new Error((openResponse as RpcFailure).error.message)
        }
        scheduleDelayedAction(() => void fetchSessionTabs(), 300)
        return
      }
      throw new Error('Unable to create untitled markdown note')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create markdown note'
      setCreateError(message)
      showToast(message, 1800)
    } finally {
      setCreatingMarkdown(false)
    }
  }

  async function handleCreateBrowser(rawUrl = 'about:blank'): Promise<boolean> {
    if (!client || creatingBrowser) {
      return false
    }
    // Why: read via ref so a tap before the capability probe resolves (or a stale callback) still sees the live value.
    if (browserScreencastSupportedRef.current !== true) {
      showToast('Desktop update required for mobile browser streaming', 1600)
      return false
    }
    const url = normalizeBrowserUrl(rawUrl)
    if (!url) {
      const message = 'Enter a valid URL'
      setCreateError(message)
      showToast(message, 1400)
      return false
    }

    setCreatingBrowser(true)
    setCreateError('')
    try {
      const response = await client.sendRequest(
        'browser.tabCreate',
        {
          worktree: `id:${worktreeId}`,
          url,
          // The user opened this tab (tapped HTML / address bar) → focus it.
          activate: true
        },
        { timeoutMs: 30_000 }
      )
      if (!response.ok) {
        throw new Error((response as RpcFailure).error.message)
      }
      // Focus the new browser tab once it syncs; refresh a few times since the desktop registers the tab asynchronously.
      const created = (response as RpcSuccess).result as { browserPageId?: string }
      if (created.browserPageId) {
        pendingBrowserFocusPageIdRef.current = created.browserPageId
      }
      void fetchSessionTabs()
      scheduleDelayedAction(() => void fetchPendingBrowserSessionTabs(), 400)
      scheduleDelayedAction(() => void fetchPendingBrowserSessionTabs(), 1200)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create browser'
      setCreateError(message)
      showToast(message, 1800)
      return false
    } finally {
      setCreatingBrowser(false)
    }
  }
  // Keep the ref at the latest handleCreateBrowser so a terminal URL tap always runs the current closure.
  handleCreateBrowserRef.current = handleCreateBrowser

  async function handleBrowserNavigationCommand(
    tab: Extract<MobileSessionTab, { type: 'browser' }>,
    method: 'browser.back' | 'browser.forward' | 'browser.reload'
  ) {
    if (!client || !tab.browserPageId) {
      showToast('Browser page is not available yet.', 1500)
      return
    }
    try {
      const response = await client.sendRequest(
        method,
        {
          worktree: `id:${worktreeId}`,
          page: tab.browserPageId
        },
        { timeoutMs: 15_000 }
      )
      if (!response.ok) {
        throw new Error((response as RpcFailure).error.message)
      }
      scheduleDelayedAction(() => void fetchSessionTabs(), 250)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Browser command failed'
      showToast(message, 1600)
    }
  }

  async function handleRenameTerminal(value: string) {
    if (!client || !renameTarget) {
      return
    }
    const target = renameTarget
    setRenameTarget(null)

    try {
      const title = value.trim()
      const response = await client.sendRequest('terminal.rename', {
        terminal: target.handle,
        title
      })
      if (response.ok) {
        setTerminals((prev) => {
          const next = prev.map((terminal) =>
            terminal.handle === target.handle
              ? { ...terminal, title: title || 'Terminal' }
              : terminal
          )
          terminalsRef.current = next
          return next
        })
        scheduleDelayedAction(() => void fetchTerminals(), 300)
      }
    } catch {
      // Rename failed — refresh will restore the server title.
    }
  }

  async function handleCloseTerminal(target: Terminal) {
    if (!client) {
      return
    }

    try {
      const response = await client.sendRequest('terminal.close', {
        terminal: target.handle
      })
      if (response.ok) {
        unsubscribeTerminal(target.handle)
        terminalRefs.current.delete(target.handle)
        initializedHandlesRef.current.delete(target.handle)
        clearTerminalLiveInputDefault(target.handle)
        const next = terminals.filter((terminal) => terminal.handle !== target.handle)
        setTerminals(next)
        terminalsRef.current = next
        if (activeHandleRef.current === target.handle) {
          const replacement = next[0] ?? null
          activeHandleRef.current = replacement?.handle ?? null
          pendingActiveTerminalHandleRef.current = replacement?.handle ?? null
          setActiveHandle(replacement?.handle ?? null)
          if (replacement) {
            subscribeToTerminal(replacement.handle)
          }
        }
      }
    } catch {
      // Close failed — keep the local tab list unchanged.
    }
  }

  async function handleCloseSessionTab(tab: MobileSessionTab) {
    if (!client) {
      return
    }
    try {
      const response = await client.sendRequest('session.tabs.close', {
        worktree: `id:${worktreeId}`,
        tabId: tab.id,
        // Why: a tapped tab close is explicit user intent; older hosts strip
        // the unknown field and keep their legacy behavior.
        reason: 'user'
      })
      if (response.ok) {
        const remainingTabs = sessionTabsRef.current.filter((candidate) => candidate.id !== tab.id)
        if (tab.type === 'browser' && tab.browserPageId === pendingBrowserFocusPageIdRef.current) {
          pendingBrowserFocusPageIdRef.current = null
        }
        if (tab.type === 'terminal' && typeof tab.terminal === 'string') {
          const terminalHandle = tab.terminal
          unsubscribeTerminal(terminalHandle)
          terminalRefs.current.delete(terminalHandle)
          initializedHandlesRef.current.delete(terminalHandle)
          clearTerminalLiveInputDefault(terminalHandle)
        }
        sessionTabsRef.current = remainingTabs
        setSessionTabs(remainingTabs)
        // Why: tombstone the closed tab and rely on the snapshot, not a blind refetch that often re-added the not-yet-closed tab.
        closedTabTombstonesRef.current.set(tab.id, Date.now() + 10_000)
        // Why: bulk close re-activates the anchor before awaiting each close;
        // the render-synced ref sees that switch while this closure would not,
        // so comparing against the ref keeps the anchor from being nulled out.
        if (activeSessionTabIdRef.current === tab.id || remainingTabs.length === 0) {
          activeSessionTabTypeRef.current = null
          activeSessionTabIdRef.current = null
          setActiveSessionTabId(null)
          activeHandleRef.current = null
          setActiveHandle(null)
        }
      }
    } catch {
      // Close failed — keep the authoritative session snapshot visible.
    }
  }


  return {
    launchQuickCommand,
    handleCreateMarkdownNote,
    handleCreateBrowser,
    handleBrowserNavigationCommand,
    handleRenameTerminal,
    handleCloseTerminal,
    handleCloseSessionTab
  }
}
