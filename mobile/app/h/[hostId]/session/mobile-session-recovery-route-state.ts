import { useCallback, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from 'expo-router'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalLinkOpenMode,
  loadTerminalTextScale
} from '../../../../src/storage/preferences'
import { loadHosts } from '../../../../src/transport/host-store'
import { loadCustomKeys, saveCustomKeys, type CustomKey } from '../../../../src/components/CustomKeyModal'
import { headlessActivationNeedsHostRenderer } from '../../../../src/worktree/worktree-activation-result'
import type { RpcSuccess } from '../../../../src/transport/types'
import { createInitialSessionAutoCreateState } from '../../../../src/session/use-initial-session-terminal-autocreate'

type SessionRecoveryContext = Record<string, any>

export function useMobileSessionRecoveryRouteState(context: SessionRecoveryContext) {
  const {
    hostId,
    setHostEndpoint,
    deviceTokenRef,
    setCustomKeys,
    loadTerminalAccessoryLayout,
    setVisibleBuiltInIds,
    customKeys,
    router,
    setShowCustomKeyModal,
    worktreeId,
    client,
    connState,
    ensureSessionTabs,
    fetchTerminals,
    initializedHandlesRef,
    setTerminalsLoaded,
    activeHandleRef,
    showToast,
    isFloatingWorkspaceRoute,
    created,
    activeSessionTabTypeRef,
    pendingActiveSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    pendingBrowserFocusPageIdRef,
    pendingTerminalActivationAttemptRef,
    initialSessionAutoCreateRef,
    terminalDiagnosticsRef,
    appliedSnapshotMarkerRef,
    closedTabTombstonesRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    setActiveHandle,
    setTerminals,
    terminalsRef,
    setSessionTabs,
    setActiveSessionTabId,
    clearPendingLiveInputCommit,
    clearDelayedActionTimers,
    setMarkdownDocs,
    setFileDocs,
    sessionTabActionSheetRequestSeqRef,
    sessionTabActionSheetKeyboardHideSubRef,
    clearTerminalCache,
    loadHosts: readHosts = loadHosts,
    loadCustomKeys: readCustomKeys = loadCustomKeys,
    saveCustomKeys: writeCustomKeys = saveCustomKeys,
    AsyncStorage: storage = AsyncStorage,
    setTerminalTextScale,
    setAutocompleteEnabled,
    setTerminalLinkOpenMode
  } = context

  useEffect(() => {
    if (!hostId) return
    let stale = false
    void readHosts().then((hosts: any[]) => {
      if (stale) return
      const host = hosts.find((candidate) => candidate.id === hostId)
      if (host) {
        deviceTokenRef.current = host.deviceToken
        setHostEndpoint(host.endpoint)
      }
    })
    return () => {
      stale = true
    }
  }, [hostId])

  useEffect(() => {
    void readCustomKeys().then(setCustomKeys)
  }, [])

  useFocusEffect(
    useCallback(() => {
      let stale = false
      void loadTerminalAccessoryLayout().then((layout: { visibleBuiltInIds: string[] }) => {
        if (!stale) setVisibleBuiltInIds(layout.visibleBuiltInIds)
      })
      return () => {
        stale = true
      }
    }, [])
  )

  useEffect(() => {
    if (!client || connState !== 'connected') return
    if (initializedHandlesRef.current.size === 0) setTerminalsLoaded(false)
    initializedHandlesRef.current.clear()
    let disposed = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const addTimer = (fn: () => void, ms: number) => {
      if (!disposed) timers.push(setTimeout(fn, ms))
    }
    void (async () => {
      const reportActivationOutcome = (response: RpcSuccess | null) => {
        if (!disposed && response && headlessActivationNeedsHostRenderer(response.result)) {
          showToast('Open Orca on the host to wake sleeping agents.', 3000)
        }
      }
      if (created !== '1' && !isFloatingWorkspaceRoute) {
        void client
          .sendRequest('worktree.activate', {
            worktree: `id:${worktreeId}`, notifyClients: false, navigation: 'caller'
          })
          .then((response) => reportActivationOutcome(response.ok ? response : null))
          .catch(() => null)
      }
      await ensureSessionTabs().catch(() => null)
      if (disposed) return
      await fetchTerminals({ allowEmptyLoaded: false })
      if (disposed) return
      addTimer(() => void fetchTerminals({ allowEmptyLoaded: false }), 750)
      addTimer(() => void fetchTerminals({ allowEmptyLoaded: true }), 1500)
      if (created === '1' && !isFloatingWorkspaceRoute) {
        addTimer(() => {
          if (activeHandleRef.current) return
          void client
            .sendRequest('worktree.activate', {
              worktree: `id:${worktreeId}`, notifyClients: false, navigation: 'caller'
            })
            .then((response) => reportActivationOutcome(response.ok ? response : null))
            .catch(() => null)
          addTimer(() => void fetchTerminals({ allowEmptyLoaded: true }), 750)
        }, 1800)
      }
    })()
    return () => {
      disposed = true
      for (const timer of timers) clearTimeout(timer)
    }
  }, [client, connState, created, ensureSessionTabs, fetchTerminals, isFloatingWorkspaceRoute, worktreeId])

  useFocusEffect(
    useCallback(() => {
      let active = true
      void loadTerminalTextScale().then((scale) => active && setTerminalTextScale(scale))
      void loadTerminalAutocompleteEnabled().then((enabled) => active && setAutocompleteEnabled(enabled))
      void loadTerminalLinkOpenMode().then((mode) => active && setTerminalLinkOpenMode(mode))
      return () => {
        active = false
      }
    }, [])
  )

  useEffect(() => {
    if (hostId && worktreeId) {
      void storage.setItem('orca:last-visited-worktree', JSON.stringify({ hostId, worktreeId }))
    }
  }, [hostId, worktreeId])

  useEffect(() => {
    sessionTabActionSheetRequestSeqRef.current += 1
    sessionTabActionSheetKeyboardHideSubRef.current?.remove()
    sessionTabActionSheetKeyboardHideSubRef.current = null
    clearTerminalCache()
    activeHandleRef.current = null
    activeSessionTabTypeRef.current = null
    pendingActiveSessionTabIdRef.current = null
    pendingActiveTerminalHandleRef.current = null
    pendingBrowserFocusPageIdRef.current = null
    pendingTerminalActivationAttemptRef.current = null
    initialSessionAutoCreateRef.current = createInitialSessionAutoCreateState()
    terminalDiagnosticsRef.current.resetRoute()
    appliedSnapshotMarkerRef.current = { epoch: null, version: -1 }
    closedTabTombstonesRef.current.clear()
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) clearTimeout(queued.timer)
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
    setActiveHandle(null)
    setTerminals([])
    terminalsRef.current = []
    setSessionTabs([])
    setActiveSessionTabId(null)
    clearPendingLiveInputCommit()
    setMarkdownDocs(new Map())
    setFileDocs(new Map())
    clearDelayedActionTimers()
    return () => {
      sessionTabActionSheetRequestSeqRef.current += 1
      sessionTabActionSheetKeyboardHideSubRef.current?.remove()
      clearPendingLiveInputCommit()
      clearDelayedActionTimers()
    }
  }, [clearDelayedActionTimers, clearPendingLiveInputCommit, clearTerminalCache, hostId, worktreeId])

  const handleDeleteCustomKey = useCallback(async (key: CustomKey) => {
    const updated = customKeys.filter((current: CustomKey) => current.id !== key.id)
    setCustomKeys(updated)
    await writeCustomKeys(updated)
  }, [customKeys])
  const handleManageShortcuts = useCallback(() => {
    setShowCustomKeyModal(false)
    router.push('/terminal-settings')
  }, [router])

  return { handleDeleteCustomKey, handleManageShortcuts }
}
