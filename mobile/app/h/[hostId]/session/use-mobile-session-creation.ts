import { useCallback, useEffect } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import type { RpcFailure, RpcSuccess } from '../../../../src/transport/types'
import { triggerSuccess } from '../../../../src/platform/haptics'
import { useMobileTerminalPaste } from '../../../../src/session/use-mobile-terminal-paste'
import { useMobileAttachmentInputLeaseGate } from '../../../../src/session/use-mobile-attachment-input-lease-gate'
import { useMobileSessionImageAttachments } from '../../../../src/session/use-mobile-session-image-attachments'
import {
  buildTerminalSendParams
} from '../../../../src/terminal/terminal-send-request'
import type { MobileQuickCommandLaunch } from '../../../../src/terminal/quick-commands'
import type { MobileNewTabAgentOption } from '../../../../src/session/mobile-new-tab-agent-options'
import type { RuntimeRepoSummary, Terminal, TerminalCreateResult } from './mobile-session-route-types'

type SessionCreationContext = Record<string, any>

export function useMobileSessionCreation(context: SessionCreationContext) {
  const {
    client,
    isFloatingWorkspaceRoute,
    worktreeId,
    getRepoIdFromMobileWorktreeId,
    setCanPaste,
    activeHandle,
    activeHandleRef,
    activeSessionTabTypeRef,
    canSend,
    connState,
    connStateRef,
    clientRef,
    deviceTokenRef,
    flushPendingLiveInputBeforeExternalSend,
    nativeChatInputLeaseReadyRef,
    nativeChatInputLeaseReady,
    nativeChatScopeKey,
    nativeChatController,
    nativeChatSendError,
    ptyModesRef,
    showToast,
    triggerError,
    triggerSelection,
    selectModeActive,
    terminalRefs,
    showCreateTabDrawer,
    pendingDiffNotesDelivery,
    setCreateTabAgentLoadState,
    setCreateTabAgentOptions,
    loadMobileNewTabAgentOptions,
    creatingTerminalRef,
    setCreating,
    setCreateError,
    activeSessionTab,
    activeSessionTabId,
    unsubscribeTerminal,
    initializedHandlesRef,
    pendingActiveSessionTabIdRef,
    setActiveSessionTabId,
    setSessionTabs,
    defaultTerminalHandlesToLiveInput,
    pendingActiveTerminalHandleRef,
    setActiveHandle,
    setTerminals,
    terminalsRef,
    terminalRecordsEqual,
    subscribeToTerminal,
    scheduleDelayedAction,
    fetchSessionTabs,
    creatingMarkdown,
    creatingBrowser,
    browserScreencastSupportedRef,
    normalizeBrowserUrl,
    setCreatingMarkdown,
    setCreatingBrowser,
    fetchPendingBrowserSessionTabs,
    pendingBrowserFocusPageIdRef,
    setTerminalsLoaded,
    fetchTerminals,
    renameTarget,
    setRenameTarget,
    clearTerminalLiveInputDefault,
    terminals,
    sessionTabsRef,
    closedTabTombstonesRef,
    activeSessionTabIdRef
  } = context

  const getActiveWorktreeConnectionId = useCallback(async (): Promise<string | null> => {
    // Why: the floating workspace always runs on the paired host itself, never an SSH repo target.
    if (!client || isFloatingWorkspaceRoute) {
      return null
    }
    const repoId = getRepoIdFromMobileWorktreeId(worktreeId)
    const repoResponse = await client.sendRequest('repo.list')
    if (!repoResponse.ok) {
      throw new Error((repoResponse as RpcFailure).error.message)
    }
    const repos =
      ((repoResponse as RpcSuccess).result as { repos?: RuntimeRepoSummary[] }).repos ?? []
    return repos.find((repo) => repo.id === repoId)?.connectionId?.trim() || null
  }, [client, isFloatingWorkspaceRoute, worktreeId])

  const refreshCanPaste = useCallback(() => {
    void Promise.all([
      Clipboard.hasStringAsync().catch(() => false),
      Clipboard.hasImageAsync().catch(() => false)
    ]).then(([hasString, hasImage]) => {
      setCanPaste(hasString || hasImage)
    })
  }, [])

  const handlePaste = useMobileTerminalPaste({
    client,
    activeHandle,
    activeHandleRef,
    activeSessionTabTypeRef,
    canSend,
    connState,
    connStateRef,
    clientRef,
    deviceTokenRef,
    flushPendingLiveInputBeforeExternalSend,
    getActiveWorktreeConnectionId,
    onError: triggerError,
    onSuccess: triggerSelection,
    ptyModesRef,
    refreshCanPaste,
    showToast
  })

  const flushPendingLiveInputBeforeAttachmentSend = useMobileAttachmentInputLeaseGate({
    flushPendingLiveInputBeforeExternalSend,
    connStateRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    nativeChatInputLeaseReadyRef,
    showToast
  })

  // Terminal input pastes an attached image straight into the visible terminal;
  // native chat instead holds it as a composer chip and rides it along on submit.
  const { attachImage, isAttaching, nativeChatImages } = useMobileSessionImageAttachments({
    client,
    activeHandle,
    activeHandleRef,
    canSend,
    connState,
    deviceTokenRef,
    nativeChatScopeKey,
    nativeChatInputLeaseReady,
    getActiveWorktreeConnectionId,
    beforeTerminalSend: flushPendingLiveInputBeforeAttachmentSend,
    nativeChatBaseSend: nativeChatController.handleNativeChatSendWithOutcome,
    readSeededLaunchDraft: nativeChatController.readSeededLaunchDraft,
    showToast,
    onNativeChatSendError: nativeChatSendError.show,
    onSuccess: triggerSelection,
    onError: triggerError
  })

  // Why: refresh canPaste on mount, AppState active, after paste.
  useEffect(() => {
    let mounted = true
    const refresh = () => {
      void Promise.all([
        Clipboard.hasStringAsync().catch(() => false),
        Clipboard.hasImageAsync().catch(() => false)
      ]).then(([hasString, hasImage]) => {
        if (mounted) {
          setCanPaste(hasString || hasImage)
        }
      })
    }
    refresh()
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        refresh()
      } else if (selectModeActive && activeHandleRef.current) {
        terminalRefs.current.get(activeHandleRef.current)?.cancelSelect()
      }
    })
    return () => {
      mounted = false
      sub.remove()
    }
  }, [selectModeActive])

  useEffect(() => {
    const shouldLoadAgentOptions = showCreateTabDrawer || pendingDiffNotesDelivery !== null
    if (!shouldLoadAgentOptions) {
      setCreateTabAgentLoadState('idle')
      setCreateTabAgentOptions([])
      return
    }
    if (!client || connState !== 'connected') {
      setCreateTabAgentLoadState('idle')
      setCreateTabAgentOptions([])
      return
    }

    let stale = false
    setCreateTabAgentLoadState('loading')
    setCreateTabAgentOptions([])

    void (async () => {
      const options = await loadMobileNewTabAgentOptions({
        client,
        worktreeId
      })
      if (stale) {
        return
      }
      setCreateTabAgentOptions(options)
      setCreateTabAgentLoadState('loaded')
    })().catch(() => {
      if (!stale) {
        setCreateTabAgentOptions([])
        setCreateTabAgentLoadState('error')
      }
    })

    return () => {
      stale = true
    }
  }, [client, connState, pendingDiffNotesDelivery, showCreateTabDrawer, worktreeId])

  async function handleCreateTerminal(
    agent?: MobileNewTabAgentOption['agent'],
    options?: MobileQuickCommandLaunch['options'] & {
      onPromptSent?: () => void
      errorToast?: string
    }
  ) {
    if (!client || creatingTerminalRef.current) {
      return
    }
    creatingTerminalRef.current = true

    setCreating(true)
    setCreateError('')

    // Why: idempotency key so a transport retry (reconnect replay) resolves to the same terminal, not a duplicate; kept compact (no worktree id) for the schema length cap.
    const clientMutationId = `mobile-create:${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`

    try {
      const response = await client.sendRequest('session.tabs.createTerminal', {
        worktree: `id:${worktreeId}`,
        afterTabId: activeSessionTabId ?? undefined,
        clientMutationId,
        ...(options?.startupCommand ? { command: options.startupCommand } : {}),
        ...(options?.startupCommandDelivery
          ? { startupCommandDelivery: options.startupCommandDelivery }
          : {}),
        ...(options?.agentPrompt ? { agentPrompt: options.agentPrompt } : {}),
        ...(agent ? { agent } : {}),
        activate: false,
        select: true,
        navigation: 'caller'
      })
      if (response.ok) {
        const result = (response as RpcSuccess).result as TerminalCreateResult
        const created = result.tab
        // Why: unsubscribe the old terminal so the server restores its desktop dims; otherwise its restore timer is never set.
        const prev = activeHandleRef.current
        if (prev) {
          unsubscribeTerminal(prev)
          initializedHandlesRef.current.delete(prev)
        }
        pendingActiveSessionTabIdRef.current = created.id
        activeSessionTabTypeRef.current = 'terminal'
        setActiveSessionTabId(created.id)
        setSessionTabs((prev) => {
          if (prev.some((tab) => tab.id === created.id)) {
            return prev
          }
          return [...prev, { ...created, isActive: true }]
        })
        if (typeof created.terminal === 'string') {
          const createdHandle = created.terminal
          defaultTerminalHandlesToLiveInput([createdHandle])
          // Why: snapshots lag the create RPC; without this marker applySessionTabs reverts the active handle, blanking the new pane.
          pendingActiveTerminalHandleRef.current = createdHandle
          activeHandleRef.current = createdHandle
          setActiveHandle(createdHandle)
          setTerminals((prev) => {
            const existing = prev.find((terminal) => terminal.handle === createdHandle)
            const createdTerminal: Terminal = {
              handle: createdHandle,
              title: created.title || existing?.title || 'Terminal',
              terminalTheme: created.terminalTheme ?? existing?.terminalTheme,
              isActive: true
            }
            if (existing) {
              const next = prev.map((terminal) =>
                terminal.handle === createdHandle ? { ...terminal, ...createdTerminal } : terminal
              )
              terminalsRef.current = next
              return terminalRecordsEqual(prev, next) ? prev : next
            }
            const next = [...prev, createdTerminal]
            terminalsRef.current = next
            return next
          })
          subscribeToTerminal(createdHandle)
          if (options?.initialPrompt?.trim()) {
            void client
              .sendRequest(
                'terminal.send',
                buildTerminalSendParams({
                  terminal: createdHandle,
                  text: options.initialPrompt,
                  enter: options.enter !== false,
                  deviceToken: deviceTokenRef.current
                })
              )
              .then((sendResponse) => {
                if (!sendResponse.ok) {
                  throw new Error(
                    (sendResponse as RpcFailure).error.message || 'Failed to send notes'
                  )
                }
                const result = (sendResponse as RpcSuccess).result as {
                  send?: { accepted?: boolean }
                }
                if (result.send?.accepted === false) {
                  throw new Error('Terminal input is locked by another client.')
                }
                triggerSuccess()
                showToast(options.successToast ?? 'Notes sent')
                options.onPromptSent?.()
              })
              .catch((err) => {
                triggerError()
                showToast(
                  options.errorToast ??
                    (err instanceof Error ? err.message : "Couldn't send notes"),
                  1800
                )
              })
          } else if (options?.successToast) {
            triggerSuccess()
            showToast(options.successToast)
          }
        } else {
          // Why: a prior pending handle must not outlive a create that returned no terminal; web-ready subscribe gates on this ref.
          pendingActiveTerminalHandleRef.current = null
          activeHandleRef.current = null
          setActiveHandle(null)
        }
        scheduleDelayedAction(() => void fetchSessionTabs(), 500)
      } else {
        const message = options?.errorToast ?? 'Failed to create terminal'
        setCreateError(message)
        if (options?.errorToast) {
          triggerError()
          showToast(message, 1800)
        }
      }
    } catch {
      const message = options?.errorToast ?? 'Failed to create terminal'
      setCreateError(message)
      if (options?.errorToast) {
        triggerError()
        showToast(message, 1800)
      }
    } finally {
      creatingTerminalRef.current = false
      setCreating(false)
    }
  }

  // Quick commands spawn a fresh terminal tab, mirroring desktop's
  // run-quick-command-in-new-tab: agent prompts and runnable terminal commands
  // use the host's shell-ready startup path; insert-only commands stay drafts.

  return {
    getActiveWorktreeConnectionId,
    refreshCanPaste,
    handlePaste,
    flushPendingLiveInputBeforeAttachmentSend,
    attachImage,
    isAttaching,
    nativeChatImages,
    handleCreateTerminal
  }
}
