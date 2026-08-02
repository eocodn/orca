import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import {
  callRuntimeRpc,
  runtimeEnvironmentSupportsCapability,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import { redactKagiSessionToken } from '../../../../shared/browser-url'
import { BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { ORCA_BROWSER_BLANK_URL } from '../../../../shared/constants'
import type {
  BrowserCertificateFailure,
  BrowserPage as BrowserPageState
} from '../../../../shared/types'
import type {
  BrowserScreencastFrameMetadata
} from '../../../../shared/browser-screencast-protocol'
import type {
  BrowserTabPageState,
  RemoteBrowserContextMenu,
  RemoteBrowserOperationToken,
  RemoteBrowserStreamSubscription,
  RemoteBrowserStreamToken,
  RemoteBrowserViewportSize,
  PendingRemoteBrowserWheel
} from './browser-pane-remote-model'
import {
  browserPageExists,
  decodeRemoteBrowserFrameUrl,
  getBrowserDisplayTitle,
  readRemoteCssViewportSize,
  toDisplayUrl
} from './browser-pane-remote-model'
import { getRemoteBrowserDeviceScaleFactor } from './browser-pane-remote-model'
import { decodeBrowserScreencastFrame } from '../../../../shared/browser-screencast-protocol'

type RemoteSurfaceBaseProps = {
  browserTab: BrowserPageState
  runtimeEnvironmentId: string
  worktreeId: string
  isActive: boolean
  onUpdatePageState: (tabId: string, updates: BrowserTabPageState) => void
  onSetUrl: (tabId: string, url: string) => void
}

export function useRemoteBrowserSurfaceBase({
  browserTab,
  runtimeEnvironmentId,
  worktreeId,
  isActive,
  onUpdatePageState,
  onSetUrl
}: RemoteSurfaceBaseProps) {
  const addressBarInputRef = useRef<HTMLInputElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const remoteViewportRef = useRef<HTMLDivElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const remotePageIdRef = useRef<string | null>(null)
  const remoteViewportSizeRef = useRef<RemoteBrowserViewportSize | null>(null)
  const remoteCssViewportSizeRef = useRef<RemoteBrowserViewportSize | null>(null)
  const remoteStreamViewportSizeRef = useRef<RemoteBrowserViewportSize | null>(null)
  const remoteViewportTimerRef = useRef<number | null>(null)
  const streamFrameUrlRef = useRef<string | null>(null)
  const streamSubscriptionRef = useRef<RemoteBrowserStreamSubscription | null>(null)
  const streamRestartTimerRef = useRef<number | null>(null)
  const remoteTabRefreshTimerRef = useRef<number | null>(null)
  const remoteInputQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const pendingRemoteWheelRef = useRef<PendingRemoteBrowserWheel | null>(null)
  const remoteWheelFrameRef = useRef<number | null>(null)
  const remoteWheelInFlightRef = useRef(false)
  const pendingFrameDecodeRef = useRef(0)
  const streamGenerationRef = useRef(0)
  const remoteOperationGenerationRef = useRef(0)
  const activeStreamTokenRef = useRef<RemoteBrowserStreamToken | null>(null)
  const mountedRef = useRef(true)
  const isActiveRef = useRef(isActive)
  const currentBrowserTabIdRef = useRef(browserTab.id)
  const currentBrowserTabUrlRef = useRef(browserTab.url)
  const activeRuntimeEnvironmentIdRef = useRef<string | null>(runtimeEnvironmentId)
  const startRemoteStreamRef = useRef<(pageId: string) => Promise<RemoteBrowserStreamSubscription | null>>(async () => null)
  const restartRemoteStreamForViewportRef = useRef<(pageId: string) => void>(() => {})
  const fetchRemoteTabInfoRef = useRef<(token: RemoteBrowserOperationToken) => Promise<import('../../../../shared/runtime-types').BrowserTabInfo | null>>(async () => null)
  const [addressBarValue, setAddressBarValue] = useState(toDisplayUrl(browserTab.url))
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [frameMetadata, setFrameMetadata] = useState<BrowserScreencastFrameMetadata | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<RemoteBrowserContextMenu | null>(null)
  const [busy, setBusy] = useState(false)
  const [remoteCertificateTrustSupported, setRemoteCertificateTrustSupported] = useState(false)
  const setRemoteBrowserPageHandle = useAppStore((state) => state.setRemoteBrowserPageHandle)
  const certificateFailure = useAppStore((state) => state.browserCertificateFailuresByPageId[browserTab.id] ?? null)
  const remotePageHandle = useAppStore((state) => state.remoteBrowserPageHandlesByPageId[browserTab.id] ?? null)
  const createBrowserTab = useAppStore((state) => state.createBrowserTab)
  const closeBrowserPage = useAppStore((state) => state.closeBrowserPage)
  const closeBrowserTab = useAppStore((state) => state.closeBrowserTab)
  const keybindings = useAppStore((state) => state.keybindings)
  const runtimeWorktree = useMemo(() => toRuntimeWorktreeSelector(worktreeId), [worktreeId])
  const runtimeTarget = useCallback((): RuntimeClientTarget | null => runtimeEnvironmentId ? { kind: 'environment', environmentId: runtimeEnvironmentId } : null, [runtimeEnvironmentId])

  currentBrowserTabIdRef.current = browserTab.id
  currentBrowserTabUrlRef.current = browserTab.url
  activeRuntimeEnvironmentIdRef.current = runtimeEnvironmentId
  isActiveRef.current = isActive

  const clearStreamFrame = useCallback((): void => {
    pendingFrameDecodeRef.current += 1
    const previousUrl = streamFrameUrlRef.current
    streamFrameUrlRef.current = null
    remoteCssViewportSizeRef.current = null
    remoteStreamViewportSizeRef.current = null
    setFrameMetadata(null)
    setFrameUrl(null)
    if (previousUrl) URL.revokeObjectURL(previousUrl)
  }, [])

  const clearPendingRemoteWheel = useCallback((): void => {
    pendingRemoteWheelRef.current = null
    remoteWheelInFlightRef.current = false
    if (remoteWheelFrameRef.current !== null) {
      window.cancelAnimationFrame(remoteWheelFrameRef.current)
      remoteWheelFrameRef.current = null
    }
  }, [])

  const closeMissingRemotePage = useCallback((remotePageId: string | null = remotePageIdRef.current): void => {
    const state = useAppStore.getState()
    if (remotePageId) state.removeRemoteBrowserPageHandle(browserTab.id, remotePageId)
    remotePageIdRef.current = null
    remoteOperationGenerationRef.current += 1
    streamGenerationRef.current += 1
    activeStreamTokenRef.current = null
    streamSubscriptionRef.current?.unsubscribe()
    streamSubscriptionRef.current = null
    for (const timerRef of [streamRestartTimerRef, remoteViewportTimerRef, remoteTabRefreshTimerRef]) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    remoteInputQueueRef.current = Promise.resolve()
    clearStreamFrame()
    setRemoteError(null)
    setBusy(false)
    const workspacePageCount = state.browserPagesByWorkspace[browserTab.workspaceId]?.length ?? 0
    if (workspacePageCount <= 1) closeBrowserTab(browserTab.workspaceId)
    else closeBrowserPage(browserTab.id)
  }, [browserTab.id, browserTab.workspaceId, clearStreamFrame, closeBrowserPage, closeBrowserTab])

  const rememberRemoteViewportSize = useCallback((next: RemoteBrowserViewportSize): RemoteBrowserViewportSize => {
    const previous = remoteViewportSizeRef.current
    if (!previous || Math.abs(previous.width - next.width) > 3 || Math.abs(previous.height - next.height) > 3) {
      remoteViewportSizeRef.current = next
      return next
    }
    return previous
  }, [])

  const readCurrentRemoteViewportSize = useCallback((): RemoteBrowserViewportSize | null => {
    const element = remoteViewportRef.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return { width: Math.max(320, Math.round(rect.width)), height: Math.max(240, Math.round(rect.height)) }
  }, [])
  const readRemoteViewportSize = useCallback(() => {
    const next = readCurrentRemoteViewportSize()
    return next ? rememberRemoteViewportSize(next) : remoteViewportSizeRef.current
  }, [readCurrentRemoteViewportSize, rememberRemoteViewportSize])
  const waitForRemoteViewportSize = useCallback(async (): Promise<RemoteBrowserViewportSize | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = readCurrentRemoteViewportSize()
      if (next) return rememberRemoteViewportSize(next)
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    }
    return readRemoteViewportSize()
  }, [readCurrentRemoteViewportSize, readRemoteViewportSize, rememberRemoteViewportSize])
  const syncRemoteViewport = useCallback(async (pageId: string): Promise<void> => {
    const target = runtimeTarget()
    const size = readRemoteViewportSize()
    if (!target || !size) return
    await callRuntimeRpc(target, 'browser.viewport', { worktree: runtimeWorktree, page: pageId, width: size.width, height: size.height, deviceScaleFactor: getRemoteBrowserDeviceScaleFactor(), mobile: false }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
    try {
      const viewport = await callRuntimeRpc(target, 'browser.eval', { worktree: runtimeWorktree, page: pageId, expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight })' }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
      remoteCssViewportSizeRef.current = readRemoteCssViewportSize(viewport) ?? size
    } catch {
      remoteCssViewportSizeRef.current = size
    }
  }, [readRemoteViewportSize, runtimeTarget, runtimeWorktree])
  const enqueueRemoteInput = useCallback((operation: () => Promise<void>): Promise<void> => {
    const next = remoteInputQueueRef.current.catch(() => {}).then(operation)
    remoteInputQueueRef.current = next.catch(() => {})
    return next
  }, [])
  const createRemoteOperationToken = useCallback((remotePageId: string | null = null): RemoteBrowserOperationToken | null => {
    const target = runtimeTarget()
    return target ? { tabId: browserTab.id, environmentId: target.environmentId, remotePageId, generation: remoteOperationGenerationRef.current } : null
  }, [browserTab.id, runtimeTarget])
  const isCurrentRemoteOperationToken = useCallback((token: RemoteBrowserOperationToken): boolean => mountedRef.current && isActiveRef.current && browserPageExists(token.tabId) && currentBrowserTabIdRef.current === token.tabId && activeRuntimeEnvironmentIdRef.current === token.environmentId && remoteOperationGenerationRef.current === token.generation && (token.remotePageId === null || remotePageIdRef.current === token.remotePageId), [])
  const isCurrentRemoteStreamOperation = useCallback((token: RemoteBrowserStreamToken): boolean => isCurrentRemoteOperationToken({ tabId: token.tabId, environmentId: token.environmentId, remotePageId: token.remotePageId, generation: token.operationGeneration }), [isCurrentRemoteOperationToken])
  const isCurrentRemoteStreamToken = useCallback((token: RemoteBrowserStreamToken): boolean => {
    const activeToken = activeStreamTokenRef.current
    return activeToken?.generation === token.generation && activeToken.operationGeneration === token.operationGeneration && activeToken.tabId === token.tabId && activeToken.environmentId === token.environmentId && activeToken.remotePageId === token.remotePageId && isCurrentRemoteStreamOperation(token)
  }, [isCurrentRemoteStreamOperation])

  useEffect(() => {
    const environmentId = remotePageHandle?.environmentId
    const challengeId = certificateFailure?.challengeId
    if (!environmentId || !challengeId) {
      setRemoteCertificateTrustSupported(false)
      return
    }
    let cancelled = false
    void runtimeEnvironmentSupportsCapability(environmentId, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY).then((supported) => {
      if (!cancelled) setRemoteCertificateTrustSupported(supported)
    }).catch(() => {
      if (!cancelled) setRemoteCertificateTrustSupported(false)
    })
    return () => { cancelled = true }
  }, [certificateFailure?.challengeId, remotePageHandle?.environmentId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      remoteOperationGenerationRef.current += 1
      streamGenerationRef.current += 1
      pendingFrameDecodeRef.current += 1
      activeStreamTokenRef.current = null
      clearPendingRemoteWheel()
      restartRemoteStreamForViewportRef.current = () => {}
      for (const timerRef of [streamRestartTimerRef, remoteViewportTimerRef, remoteTabRefreshTimerRef]) {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      }
      if (streamFrameUrlRef.current) {
        URL.revokeObjectURL(streamFrameUrlRef.current)
        streamFrameUrlRef.current = null
      }
    }
  }, [clearPendingRemoteWheel])
  useEffect(() => {
    remoteStreamViewportSizeRef.current = null
    clearPendingRemoteWheel()
    clearStreamFrame()
  }, [browserTab.id, clearPendingRemoteWheel, clearStreamFrame, runtimeEnvironmentId])
  useEffect(() => {
    if (!isActive || !remoteViewportRef.current) return
    const scheduleSync = (): void => {
      readRemoteViewportSize()
      if (remoteViewportTimerRef.current !== null) window.clearTimeout(remoteViewportTimerRef.current)
      remoteViewportTimerRef.current = window.setTimeout(() => {
        remoteViewportTimerRef.current = null
        const pageId = remotePageIdRef.current
        if (!pageId || !isActiveRef.current) return
        void syncRemoteViewport(pageId).then(() => restartRemoteStreamForViewportRef.current(pageId)).catch(() => {})
      }, 150)
    }
    scheduleSync()
    const observer = new ResizeObserver(scheduleSync)
    observer.observe(remoteViewportRef.current)
    return () => {
      observer.disconnect()
      if (remoteViewportTimerRef.current !== null) window.clearTimeout(remoteViewportTimerRef.current)
    }
  }, [isActive, readRemoteViewportSize, syncRemoteViewport])
  useEffect(() => {
    if (document.activeElement !== addressBarInputRef.current) setAddressBarValue(toDisplayUrl(browserTab.url))
  }, [browserTab.url])
  useEffect(() => {
    if (!contextMenu) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setContextMenu(null) }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [contextMenu])
  useLayoutEffect(() => {
    const element = contextMenuRef.current
    if (!element || !contextMenu) return
    element.style.left = `${contextMenu.x}px`
    element.style.top = `${contextMenu.y}px`
    const rect = element.getBoundingClientRect()
    const offsetX = contextMenu.x - rect.left
    const offsetY = contextMenu.y - rect.top
    const renderX = rect.right > window.innerWidth ? contextMenu.x - rect.width : contextMenu.x
    const renderY = rect.bottom > window.innerHeight ? contextMenu.y - rect.height : contextMenu.y
    element.style.left = `${Math.max(0, renderX) + offsetX}px`
    element.style.top = `${Math.max(0, renderY) + offsetY}px`
  }, [contextMenu])
  useEffect(() => {
    if (!runtimeEnvironmentId) return
    return () => {
      const remotePageId = remotePageIdRef.current
      if (!remotePageId) return
      const state = useAppStore.getState()
      const currentEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
      if (currentEnvironmentId === runtimeEnvironmentId && browserPageExists(browserTab.id)) return
      const removedHandle = state.removeRemoteBrowserPageHandle(browserTab.id, remotePageId)
      remotePageIdRef.current = null
      if (!removedHandle) return
      void callRuntimeRpc({ kind: 'environment', environmentId: removedHandle.environmentId }, 'browser.tabClose', { worktree: runtimeWorktree, page: removedHandle.remotePageId }, { timeoutMs: 15_000, suppressFeatureInteraction: true }).catch(() => {})
    }
  }, [browserTab.id, runtimeEnvironmentId, runtimeWorktree, worktreeId])

  const applyRemoteTabInfo = useCallback((tab: { url: string; title?: string | null }): void => {
    const safeUrl = redactKagiSessionToken(tab.url || ORCA_BROWSER_BLANK_URL)
    onSetUrl(browserTab.id, safeUrl)
    onUpdatePageState(browserTab.id, { title: getBrowserDisplayTitle(tab.title, safeUrl), loading: false, loadError: null })
    if (document.activeElement !== addressBarInputRef.current) setAddressBarValue(toDisplayUrl(safeUrl))
  }, [browserTab.id, onSetUrl, onUpdatePageState])
  const updateStreamFrame = useCallback((token: RemoteBrowserStreamToken, bytes: Uint8Array<ArrayBufferLike>): void => {
    if (!isCurrentRemoteStreamToken(token)) return
    const frame = decodeBrowserScreencastFrame(bytes)
    if (!frame) return
    const imageBuffer = frame.image.buffer.slice(frame.image.byteOffset, frame.image.byteOffset + frame.image.byteLength) as ArrayBuffer
    const nextUrl = URL.createObjectURL(new Blob([imageBuffer], { type: `image/${frame.format}` }))
    const decodeGeneration = pendingFrameDecodeRef.current + 1
    pendingFrameDecodeRef.current = decodeGeneration
    void decodeRemoteBrowserFrameUrl(nextUrl).then(() => {
      if (pendingFrameDecodeRef.current !== decodeGeneration || !isCurrentRemoteStreamToken(token)) { URL.revokeObjectURL(nextUrl); return }
      const previousUrl = streamFrameUrlRef.current
      streamFrameUrlRef.current = nextUrl
      setFrameMetadata(frame.metadata)
      setFrameUrl(nextUrl)
      setBusy(false)
      if (previousUrl) URL.revokeObjectURL(previousUrl)
    }).catch(() => URL.revokeObjectURL(nextUrl))
  }, [isCurrentRemoteStreamToken])
  const getRemoteImagePoint = useCallback((event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const image = imageRef.current
    const viewport = remoteViewportRef.current
    if (!image || !viewport || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null
    const rect = viewport.getBoundingClientRect()
    const viewportWidth = remoteCssViewportSizeRef.current?.width ?? remoteViewportSizeRef.current?.width ?? rect.width
    const viewportHeight = remoteCssViewportSizeRef.current?.height ?? remoteViewportSizeRef.current?.height ?? rect.height
    return { x: Math.max(0, Math.min(viewportWidth, (event.clientX - rect.left) * (viewportWidth / image.clientWidth))), y: Math.max(0, Math.min(viewportHeight, (event.clientY - rect.top) * (viewportHeight / image.clientHeight))) }
  }, [])

  return { addressBarInputRef, addressBarValue, activeRuntimeEnvironmentId: runtimeEnvironmentId, activeRuntimeEnvironmentIdRef, activeStreamTokenRef, applyRemoteTabInfo, browserTab, busy, certificateFailure: certificateFailure as BrowserCertificateFailure | null, clearPendingRemoteWheel, clearStreamFrame, closeBrowserPage, closeBrowserTab, closeMissingRemotePage, contextMenu, contextMenuRef, createBrowserTab, createRemoteOperationToken, currentBrowserTabIdRef, currentBrowserTabUrlRef, enqueueRemoteInput, fetchRemoteTabInfoRef, frameMetadata, frameUrl, getRemoteImagePoint, imageRef, isActive, isActiveRef, isCurrentRemoteOperationToken, isCurrentRemoteStreamOperation, isCurrentRemoteStreamToken, keybindings, mountedRef, onSetUrl, onUpdatePageState, pendingFrameDecodeRef, pendingRemoteWheelRef, readCurrentRemoteViewportSize, readRemoteViewportSize, remoteCertificateTrustSupported, remoteCssViewportSizeRef, remoteError, remoteInputQueueRef, remoteOperationGenerationRef, remotePageHandle, remotePageIdRef, remoteStreamViewportSizeRef, remoteTabRefreshTimerRef, remoteViewportRef, remoteViewportSizeRef, remoteViewportTimerRef, remoteWheelFrameRef, remoteWheelInFlightRef, rememberRemoteViewportSize, restartRemoteStreamForViewportRef, runtimeTarget, runtimeWorktree, setAddressBarValue, setBusy, setContextMenu, setFrameMetadata, setFrameUrl, setRemoteBrowserPageHandle, setRemoteCertificateTrustSupported, setRemoteError, startRemoteStreamRef, streamFrameUrlRef, streamGenerationRef, streamRestartTimerRef, streamSubscriptionRef, syncRemoteViewport, updateStreamFrame, waitForRemoteViewportSize }
}

export type RemoteSurfaceBase = ReturnType<typeof useRemoteBrowserSurfaceBase>
