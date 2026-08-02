import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { withBrowserPaneUiRuntimeRpcSource } from '../../../../shared/runtime-rpc-feature-interaction-source'
import { ORCA_BROWSER_BLANK_URL } from '../../../../shared/constants'
import type {
  BrowserScreencastResult,
  BrowserTabInfo,
  RuntimeStatus
} from '../../../../shared/runtime-types'
import { areRemoteViewportSizesNear, getRemoteBrowserDeviceScaleFactor } from './browser-pane-remote-model'
import {
  isRemoteBrowserPageMissingCode,
  isRemoteBrowserPageMissingError,
  type RemoteBrowserOperationToken,
  type RemoteBrowserStreamSubscription,
  type RemoteBrowserStreamToken
} from './browser-pane-remote-model'
import type { RemoteSurfaceBase } from './browser-pane-remote-surface-base'

export function useRemoteBrowserSurfaceRuntime(base: RemoteSurfaceBase) {
  const {
    activeStreamTokenRef,
    browserTab,
    closeMissingRemotePage,
    createRemoteOperationToken,
    fetchRemoteTabInfoRef,
    isActive,
    isCurrentRemoteOperationToken,
    isCurrentRemoteStreamOperation,
    isCurrentRemoteStreamToken,
    mountedRef,
    remotePageIdRef,
    remoteStreamViewportSizeRef,
    remoteTabRefreshTimerRef,
    remoteViewportSizeRef,
    restartRemoteStreamForViewportRef,
    runtimeTarget,
    runtimeWorktree,
    setBusy,
    setRemoteError,
    startRemoteStreamRef,
    streamGenerationRef,
    streamRestartTimerRef,
    streamSubscriptionRef,
    syncRemoteViewport,
    updateStreamFrame,
    waitForRemoteViewportSize
  } = base

  const applyRemoteTabInfo = base.applyRemoteTabInfo

  const ensureRemotePage = useCallback(async (token: RemoteBrowserOperationToken): Promise<string | null> => {
    if (!isCurrentRemoteOperationToken(token)) return null
    const target = { kind: 'environment' as const, environmentId: token.environmentId }
    const createRemotePage = async (): Promise<string | null> => {
      const initialUrl = base.currentBrowserTabUrlRef.current === ORCA_BROWSER_BLANK_URL ? 'about:blank' : base.currentBrowserTabUrlRef.current || 'about:blank'
      const created = await callRuntimeRpc<{ browserPageId: string }>(target, 'browser.tabCreate', { worktree: runtimeWorktree, url: initialUrl }, { timeoutMs: 30_000, suppressFeatureInteraction: true })
      if (!isCurrentRemoteOperationToken(token)) {
        void callRuntimeRpc(target, 'browser.tabClose', { worktree: runtimeWorktree, page: created.browserPageId }, { timeoutMs: 15_000, suppressFeatureInteraction: true }).catch(() => {})
        return null
      }
      remotePageIdRef.current = created.browserPageId
      base.setRemoteBrowserPageHandle(browserTab.id, { environmentId: target.environmentId, remotePageId: created.browserPageId })
      return created.browserPageId
    }
    const existingHandle = useAppStore.getState().remoteBrowserPageHandlesByPageId[browserTab.id]
    if (!existingHandle || existingHandle.environmentId !== target.environmentId) return createRemotePage()
    const cachedToken = { ...token, remotePageId: existingHandle.remotePageId }
    remotePageIdRef.current = existingHandle.remotePageId
    try {
      const cachedTab = await fetchRemoteTabInfoRef.current(cachedToken)
      return cachedTab ? existingHandle.remotePageId : null
    } catch (error) {
      if (!isRemoteBrowserPageMissingError(error)) throw error
      useAppStore.getState().removeRemoteBrowserPageHandle(browserTab.id, existingHandle.remotePageId)
      if (remotePageIdRef.current === existingHandle.remotePageId) remotePageIdRef.current = null
      if (!isCurrentRemoteOperationToken(token)) return null
      closeMissingRemotePage(existingHandle.remotePageId)
      return null
    }
  }, [browserTab.id, closeMissingRemotePage, fetchRemoteTabInfoRef, isCurrentRemoteOperationToken, remotePageIdRef, runtimeWorktree])

  const fetchRemoteTabInfo = useCallback(async (token: RemoteBrowserOperationToken): Promise<BrowserTabInfo | null> => {
    if (!isCurrentRemoteOperationToken(token) || !token.remotePageId) return null
    const shown = await callRuntimeRpc<{ tab: BrowserTabInfo }>({ kind: 'environment', environmentId: token.environmentId }, 'browser.tabShow', { worktree: runtimeWorktree, page: token.remotePageId }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
    return shown.tab
  }, [isCurrentRemoteOperationToken, runtimeWorktree])
  fetchRemoteTabInfoRef.current = fetchRemoteTabInfo

  const scheduleRemoteTabInfoRefresh = useCallback((token: RemoteBrowserOperationToken, delayMs = 250): void => {
    if (!isCurrentRemoteOperationToken(token)) return
    if (remoteTabRefreshTimerRef.current !== null) window.clearTimeout(remoteTabRefreshTimerRef.current)
    remoteTabRefreshTimerRef.current = window.setTimeout(() => {
      remoteTabRefreshTimerRef.current = null
      if (!isCurrentRemoteOperationToken(token)) return
      void fetchRemoteTabInfo(token).then((tab) => {
        if (tab && isCurrentRemoteOperationToken(token)) applyRemoteTabInfo(tab)
      }).catch((error: unknown) => {
        if (isCurrentRemoteOperationToken(token) && isRemoteBrowserPageMissingError(error)) closeMissingRemotePage(token.remotePageId)
      })
    }, delayMs)
  }, [applyRemoteTabInfo, closeMissingRemotePage, fetchRemoteTabInfo, isCurrentRemoteOperationToken, remoteTabRefreshTimerRef])

  const scheduleRemoteStreamRestart = useCallback((token: RemoteBrowserStreamToken): void => {
    if (!isCurrentRemoteStreamOperation(token) || streamRestartTimerRef.current !== null) return
    streamRestartTimerRef.current = window.setTimeout(() => {
      streamRestartTimerRef.current = null
      if (!isCurrentRemoteStreamOperation(token)) return
      setBusy(true)
      const operationToken = { tabId: token.tabId, environmentId: token.environmentId, remotePageId: token.remotePageId, generation: token.operationGeneration }
      void fetchRemoteTabInfo(operationToken).then((tab) => {
        if (tab && isCurrentRemoteStreamOperation(token)) applyRemoteTabInfo(tab)
      }).catch(() => {}).then(() => {
        if (!isCurrentRemoteStreamOperation(token)) return null
        return startRemoteStreamRef.current(token.remotePageId)
      }).then((subscription) => {
        if (!subscription) return
        if (!isCurrentRemoteStreamToken(subscription.token)) { subscription.unsubscribe(); return }
        streamSubscriptionRef.current = subscription
      }).catch((error: unknown) => {
        if (!isCurrentRemoteStreamOperation(token)) return
        if (isRemoteBrowserPageMissingError(error)) { closeMissingRemotePage(token.remotePageId); return }
        setRemoteError(error instanceof Error ? error.message : 'Failed to restart remote browser stream.')
        setBusy(false)
      })
    }, 500)
  }, [applyRemoteTabInfo, closeMissingRemotePage, fetchRemoteTabInfo, isCurrentRemoteStreamOperation, isCurrentRemoteStreamToken, setBusy, setRemoteError, startRemoteStreamRef, streamRestartTimerRef, streamSubscriptionRef])

  const handleRemoteStreamClosed = useCallback((token: RemoteBrowserStreamToken, restart: boolean): void => {
    if (!isCurrentRemoteStreamToken(token)) return
    setBusy(restart)
    const current = streamSubscriptionRef.current
    streamSubscriptionRef.current = null
    activeStreamTokenRef.current = null
    remoteStreamViewportSizeRef.current = null
    if (!restart) base.clearStreamFrame()
    current?.unsubscribe()
    if (restart) scheduleRemoteStreamRestart(token)
  }, [activeStreamTokenRef, isCurrentRemoteStreamToken, remoteStreamViewportSizeRef, scheduleRemoteStreamRestart, setBusy, streamSubscriptionRef])

  const startRemoteStream = useCallback(async (pageId: string): Promise<RemoteBrowserStreamSubscription | null> => {
    const target = runtimeTarget()
    if (!target) return null
    const operationToken = createRemoteOperationToken(pageId)
    if (!operationToken || !isCurrentRemoteOperationToken(operationToken)) return null
    const status = await callRuntimeRpc<RuntimeStatus>(target, 'status.get', undefined, { timeoutMs: 15_000 })
    if (!status.capabilities?.includes('browser.screencast.v1')) throw new Error('The selected runtime does not support remote browser streaming.')
    if (!isCurrentRemoteOperationToken(operationToken)) return null
    const viewportSize = await waitForRemoteViewportSize()
    remoteStreamViewportSizeRef.current = viewportSize
    const token: RemoteBrowserStreamToken = { tabId: browserTab.id, environmentId: target.environmentId, remotePageId: pageId, generation: streamGenerationRef.current + 1, operationGeneration: operationToken.generation }
    streamGenerationRef.current = token.generation
    activeStreamTokenRef.current = token
    try {
      const subscription = await window.api.runtimeEnvironments.subscribe({ selector: target.environmentId, method: 'browser.screencast', params: withBrowserPaneUiRuntimeRpcSource({ worktree: runtimeWorktree, page: pageId, format: 'jpeg', quality: 70, maxWidth: 3840, maxHeight: 2160, viewportWidth: viewportSize?.width, viewportHeight: viewportSize?.height, deviceScaleFactor: getRemoteBrowserDeviceScaleFactor(), everyNthFrame: 2 }), timeoutMs: 15_000 }, {
        onResponse: (response) => {
          if (!isCurrentRemoteStreamToken(token)) return
          if (response.ok === false) {
            if (isRemoteBrowserPageMissingCode(response.error.code)) { closeMissingRemotePage(pageId); return }
            setRemoteError(response.error.message)
            handleRemoteStreamClosed(token, false)
            return
          }
          const event = response.result as BrowserScreencastResult
          if (event.type === 'ready') { applyRemoteTabInfo(event.tab); void syncRemoteViewport(event.browserPageId).catch(() => {}); setBusy(false) }
          else if (event.type === 'end') handleRemoteStreamClosed(token, true)
          else if (event.type === 'error') { setRemoteError(event.message); handleRemoteStreamClosed(token, false) }
        },
        onBinary: (bytes) => updateStreamFrame(token, bytes),
        onError: (error) => {
          if (!isCurrentRemoteStreamToken(token)) return
          if (isRemoteBrowserPageMissingError(error)) { closeMissingRemotePage(pageId); return }
          setRemoteError(error.message)
          setBusy(false)
        },
        onClose: () => handleRemoteStreamClosed(token, true)
      })
      return { token, unsubscribe: subscription.unsubscribe }
    } catch (error) {
      if (isCurrentRemoteStreamToken(token)) activeStreamTokenRef.current = null
      throw error
    }
  }, [applyRemoteTabInfo, browserTab.id, closeMissingRemotePage, createRemoteOperationToken, handleRemoteStreamClosed, isCurrentRemoteOperationToken, isCurrentRemoteStreamToken, remoteStreamViewportSizeRef, runtimeTarget, runtimeWorktree, setBusy, setRemoteError, startRemoteStreamRef, streamGenerationRef, syncRemoteViewport, updateStreamFrame, waitForRemoteViewportSize])

  const restartRemoteStreamForViewport = useCallback((pageId: string): void => {
    const current = streamSubscriptionRef.current
    const nextViewportSize = remoteViewportSizeRef.current
    if (!current || current.token.remotePageId !== pageId || !nextViewportSize || areRemoteViewportSizesNear(remoteStreamViewportSizeRef.current, nextViewportSize) || !isCurrentRemoteStreamToken(current.token)) return
    streamGenerationRef.current += 1
    activeStreamTokenRef.current = null
    streamSubscriptionRef.current = null
    remoteStreamViewportSizeRef.current = null
    if (streamRestartTimerRef.current !== null) { window.clearTimeout(streamRestartTimerRef.current); streamRestartTimerRef.current = null }
    setBusy(true)
    current.unsubscribe()
    void startRemoteStreamRef.current(pageId).then((subscription) => {
      if (!subscription) { if (mountedRef.current && base.isActiveRef.current && remotePageIdRef.current === pageId) setBusy(false); return }
      if (!isCurrentRemoteStreamToken(subscription.token)) { subscription.unsubscribe(); return }
      streamSubscriptionRef.current = subscription
    }).catch((error: unknown) => {
      if (!mountedRef.current || !base.isActiveRef.current || remotePageIdRef.current !== pageId) return
      if (isRemoteBrowserPageMissingError(error)) { closeMissingRemotePage(pageId); return }
      setRemoteError(error instanceof Error ? error.message : 'Failed to resize remote browser stream.')
      setBusy(false)
    })
  }, [activeStreamTokenRef, closeMissingRemotePage, isCurrentRemoteStreamToken, mountedRef, remotePageIdRef, remoteStreamViewportSizeRef, remoteViewportSizeRef, setBusy, setRemoteError, startRemoteStreamRef, streamGenerationRef, streamRestartTimerRef, streamSubscriptionRef])

  useEffect(() => {
    startRemoteStreamRef.current = startRemoteStream
    restartRemoteStreamForViewportRef.current = restartRemoteStreamForViewport
  }, [restartRemoteStreamForViewport, startRemoteStream])
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    setBusy(true)
    setRemoteError(null)
    base.remoteOperationGenerationRef.current += 1
    streamGenerationRef.current += 1
    activeStreamTokenRef.current = null
    streamSubscriptionRef.current?.unsubscribe()
    streamSubscriptionRef.current = null
    if (streamRestartTimerRef.current !== null) { window.clearTimeout(streamRestartTimerRef.current); streamRestartTimerRef.current = null }
    const operationToken = createRemoteOperationToken()
    if (!operationToken) { setBusy(false); return }
    void ensureRemotePage(operationToken).then(async (pageId) => {
      if (!pageId || cancelled || !isCurrentRemoteOperationToken(operationToken)) return
      const pageToken = { ...operationToken, remotePageId: pageId }
      const tab = await fetchRemoteTabInfo(pageToken)
      if (tab && !cancelled && isCurrentRemoteOperationToken(pageToken)) applyRemoteTabInfo(tab)
      if (cancelled || !isCurrentRemoteOperationToken(pageToken)) return
      const subscription = await startRemoteStream(pageId)
      if (cancelled || !subscription) { subscription?.unsubscribe(); return }
      if (!isCurrentRemoteStreamToken(subscription.token)) { subscription.unsubscribe(); return }
      streamSubscriptionRef.current = subscription
    }).catch((error: unknown) => {
      if (cancelled) return
      if (isRemoteBrowserPageMissingError(error)) { closeMissingRemotePage(); return }
      setRemoteError(error instanceof Error ? error.message : 'Failed to open remote browser.')
      setBusy(false)
    })
    return () => {
      cancelled = true
      base.remoteOperationGenerationRef.current += 1
      streamGenerationRef.current += 1
      activeStreamTokenRef.current = null
      base.clearPendingRemoteWheel()
      streamSubscriptionRef.current?.unsubscribe()
      streamSubscriptionRef.current = null
      if (streamRestartTimerRef.current !== null) { window.clearTimeout(streamRestartTimerRef.current); streamRestartTimerRef.current = null }
    }
  }, [activeStreamTokenRef, applyRemoteTabInfo, closeMissingRemotePage, createRemoteOperationToken, ensureRemotePage, fetchRemoteTabInfo, isActive, isCurrentRemoteOperationToken, isCurrentRemoteStreamToken, setBusy, setRemoteError, startRemoteStream, streamGenerationRef, streamRestartTimerRef, streamSubscriptionRef])
  useEffect(() => {
    if (!isActive) return
    return window.api.ui.onFocusBrowserAddressBar(() => { base.addressBarInputRef.current?.focus(); base.addressBarInputRef.current?.select() })
  }, [base.addressBarInputRef, isActive])

  return { applyRemoteTabInfo, ensureRemotePage, fetchRemoteTabInfo, fetchRemoteTabInfoRef, handleRemoteStreamClosed, navigateToUrl: undefined, restartRemoteStreamForViewport, restartRemoteStreamForViewportRef, runRemoteNavigation: undefined, scheduleRemoteStreamRestart, scheduleRemoteTabInfoRefresh, startRemoteStream, startRemoteStreamRef }
}

export type RemoteSurfaceRuntime = ReturnType<typeof useRemoteBrowserSurfaceRuntime>
