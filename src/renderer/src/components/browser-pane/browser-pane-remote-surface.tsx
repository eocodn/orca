/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: BrowserPane synchronizes Electron webviews, remote browser drivers, streams, downloads, and annotation overlays; those external lifecycles cannot be derived during render. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getConnectionId } from '@/lib/connection-context'
import { detectLanguage } from '@/lib/language-detect'
import { isPathInsideWorktree, toWorktreeRelativePath } from '@/lib/terminal-links'
import { getWorkspaceFileBrowserOpenTarget } from '@/lib/file-preview'
import {
  getWorkspaceFileDragRejectionMessage,
  readWorkspaceFileDragPaths,
  WORKSPACE_FILE_PATH_MIME
} from '@/lib/workspace-file-drag'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Copy,
  CornerDownLeft,
  Crosshair,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  Image,
  Loader2,
  MessageCircleQuestionMark,
  MessageSquarePlus,
  OctagonX,
  PencilLine,
  RefreshCw,
  Send,
  SquareCode,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { BrowserAnnotationSendMenuContent } from './BrowserAnnotationSendMenuContent'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { ORCA_BROWSER_BLANK_URL, ORCA_BROWSER_PARTITION } from '../../../../shared/constants'
import { BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { getOrcaProfileBrowserDefaultPartition } from '../../../../shared/orca-profiles'
import type {
  BrowserCertificateProceedResult,
  BrowserLoadError,
  BrowserPage as BrowserPageState,
  BrowserWorkspace as BrowserWorkspaceState
} from '../../../../shared/types'
import {
  normalizeBrowserNavigationUrl,
  normalizeExternalBrowserUrl,
  redactKagiSessionToken,
  resolveRemoteFailureExternalUrl,
  toHttpsRecoveryUrl
} from '../../../../shared/browser-url'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { getScreenSubmitModifierLabel, isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import {
  browserViewportPresetToOverride,
  getBrowserViewportPreset
} from '../../../../shared/browser-viewport-presets'
import { rememberLiveBrowserUrl } from './browser-runtime'
import { ensureBrowserPageWebview } from './browser-page-webview'
import {
  destroyPersistentWebview,
  moveFocusToRendererBeforeWebviewDetach,
  registeredWebContentsIds
} from './webview-registry'
import {
  applyBrowserPageViewportLayout,
  ensureBrowserPageViewport,
  getBrowserOverlaySlotViewport,
  parkBrowserPageViewport,
  subscribeBrowserOverlaySlotViewport,
  syncBrowserPageChromeInset
} from './browser-page-viewport'
import { useBrowserAutomationVisiblePageIds } from './browser-automation-visibility'
import type {
  BrowserDownloadRequestedEvent,
  BrowserDownloadProgressEvent,
  BrowserDownloadFinishedEvent
} from '../../../../shared/browser-guest-events'
import {
  GRAB_BUDGET,
  type BrowserAnnotationIntent,
  type BrowserAnnotationPayload,
  type BrowserAnnotationPriority,
  type BrowserGrabPayload,
  type BrowserGrabRect,
  type BrowserGrabScreenshot,
  type BrowserPageAnnotation
} from '../../../../shared/browser-grab-types'
import { BROWSER_ANNOTATION_VIEWPORT_MESSAGE_PREFIX } from '../../../../shared/browser-annotation-viewport-bridge'
import { useGrabMode } from './useGrabMode'
import { formatGrabPayloadAsText } from './GrabConfirmationSheet'
import { formatBrowserAnnotationsAsMarkdown } from './browser-annotation-output'
import { isEditableKeyboardTarget } from './browser-keyboard'
import { getBrowserPagesForWorkspace } from './browser-pane-page-selection'
import BrowserAddressBar from './BrowserAddressBar'
import { BrowserImportHintButton } from './BrowserImportHintButton'
import { BrowserToolbarMenu } from './BrowserToolbarMenu'
import BrowserFind from './BrowserFind'
import { BrowserMobileDriverOverlay } from './BrowserMobileDriverOverlay'
import { getShortcutPlatform, useShortcutLabel } from '@/hooks/useShortcutLabel'
import { getRemoteBrowserFrameStyle } from './remote-browser-frame-style'
import {
  getRemoteBrowserKeyboardShortcut,
  getRemoteBrowserKeypressKey
} from './remote-browser-keyboard'
import {
  consumeBrowserFocusRequest,
  ORCA_BROWSER_FOCUS_REQUEST_EVENT,
  type BrowserFocusRequestDetail
} from './browser-focus'
import {
  addBrowserPageZoomEventListener,
  applyBrowserPageZoom,
  browserPageZoomLevelToPercent,
  DEFAULT_BROWSER_PAGE_ZOOM_LEVEL,
  getBrowserPageZoomIndicatorState,
  getExplicitBrowserPageZoomLevel,
  normalizeBrowserPageZoomLevel,
  rememberExplicitBrowserPageZoomLevel,
  setBrowserPageZoomLevel,
  type BrowserPageZoomDirection
} from './browser-page-zoom'
import {
  isRemoteRuntimeFileOperation,
  statRuntimePath,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'
import {
  callRuntimeRpc,
  runtimeEnvironmentSupportsCapability,
  RuntimeRpcCallError,
  type RuntimeClientTarget
} from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import type {
  BrowserBackResult,
  BrowserGotoResult,
  BrowserReloadResult,
  BrowserScreencastResult,
  BrowserTabInfo,
  RuntimeStatus
} from '../../../../shared/runtime-types'
import {
  decodeBrowserScreencastFrame,
  type BrowserScreencastFrameMetadata
} from '../../../../shared/browser-screencast-protocol'
import { withBrowserPaneUiRuntimeRpcSource } from '../../../../shared/runtime-rpc-feature-interaction-source'
import { formatByteCount, formatPermissionNotice, formatPopupNotice } from './browser-notices'
import {
  getDriverForBrowserPage,
  onBrowserDriverChange,
  useBrowserMobileDrivenPageIds,
  type BrowserDriverState
} from '@/lib/pane-manager/browser-mobile-driver-state'
import { shouldPollChromiumErrorPage } from './chromium-error-page-polling'
import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
import { translate } from '@/i18n/i18n'
import { isBrowserPagePanePaintable } from './browser-page-paintability'
import { useMarkupMode, type MarkupCaptureContext } from './markup/useMarkupMode'
import { MarkupOverlay } from './markup/MarkupOverlay'
import { MarkupDrawButton } from './markup/MarkupDrawButton'
import { deliverMarkupToClipboard } from './markup/markup-clipboard-delivery'
import { BrowserLoadFailureOverlay } from './browser-load-failure-overlay'

import {
  BROWSER_ANNOTATION_INTENT_OPTIONS,
  DEFAULT_BROWSER_ANNOTATION_PRIORITY,
  type BrowserTabPageState,
  type RemoteBrowserContextMenu,
  type RemoteBrowserOperationToken,
  type RemoteBrowserStreamSubscription,
  type RemoteBrowserStreamToken,
  type RemoteBrowserViewportSize,
  type PendingRemoteBrowserWheel,
  getBrowserPageRuntimeEnvironmentId,
  isRemoteBrowserPageMissingError,
  isRemoteBrowserPageMissingCode,
  getRemoteBrowserMouseButton,
  buildRemoteContextMenuExpression,
  readRemoteContextMenuResult,
  readRemoteCssViewportSize,
  areRemoteViewportSizesNear,
  getRemoteBrowserDeviceScaleFactor,
  getOpenableExternalUrl,
  getCurrentBrowserUrl,
  retryBrowserTabLoad,
  toDisplayUrl,
  getBrowserDisplayTitle,
  getNotebookPathFromBrowserUrl,
  isChromiumErrorPage,
  buildLoadError,
  decodeRemoteBrowserFrameUrl,
  browserPageExists,
  getBrowserOverlayAnchor,
  createBrowserAnnotationId,
  createBrowserAnnotationPayload,
  PendingBrowserAnnotationCard
} from './browser-pane-remote-model'

export function RemoteBrowserPagePane({
  browserTab,
  runtimeEnvironmentId,
  worktreeId,
  isActive,
  onUpdatePageState,
  onSetUrl
}: {
  browserTab: BrowserPageState
  runtimeEnvironmentId: string
  worktreeId: string
  isActive: boolean
  onUpdatePageState: (tabId: string, updates: BrowserTabPageState) => void
  onSetUrl: (tabId: string, url: string) => void
}): React.JSX.Element {
  const activeRuntimeEnvironmentId = runtimeEnvironmentId
  const addressBarInputRef = useRef<HTMLInputElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const remoteViewportRef = useRef<HTMLDivElement | null>(null)
  const [addressBarValue, setAddressBarValue] = useState(toDisplayUrl(browserTab.url))
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [frameMetadata, setFrameMetadata] = useState<BrowserScreencastFrameMetadata | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<RemoteBrowserContextMenu | null>(null)
  const [busy, setBusy] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
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
  const runtimeWorktree = useMemo(() => toRuntimeWorktreeSelector(worktreeId), [worktreeId])
  const activeRuntimeEnvironmentIdRef = useRef<string | null>(activeRuntimeEnvironmentId)
  const startRemoteStreamRef = useRef<
    (pageId: string) => Promise<RemoteBrowserStreamSubscription | null>
  >(async () => null)
  const restartRemoteStreamForViewportRef = useRef<(pageId: string) => void>(() => {})
  const fetchRemoteTabInfoRef = useRef<
    (token: RemoteBrowserOperationToken) => Promise<BrowserTabInfo | null>
  >(async () => null)
  const setRemoteBrowserPageHandle = useAppStore((s) => s.setRemoteBrowserPageHandle)
  const certificateFailure = useAppStore(
    (s) => s.browserCertificateFailuresByPageId[browserTab.id] ?? null
  )
  const remotePageHandle = useAppStore(
    (s) => s.remoteBrowserPageHandlesByPageId[browserTab.id] ?? null
  )
  const createBrowserTab = useAppStore((s) => s.createBrowserTab)
  const closeBrowserPage = useAppStore((s) => s.closeBrowserPage)
  const closeBrowserTab = useAppStore((s) => s.closeBrowserTab)
  const keybindings = useAppStore((state) => state.keybindings)

  // Why: runtimes predating browser.certificate-trust.v1 can't honor a proceed request, so hide "Proceed Anyway" until support is advertised.
  const [remoteCertificateTrustSupported, setRemoteCertificateTrustSupported] = useState(false)
  const remoteCertificateEnvironmentId = remotePageHandle?.environmentId ?? null
  const certificateChallengeId = certificateFailure?.challengeId ?? null
  useEffect(() => {
    if (!remoteCertificateEnvironmentId || !certificateChallengeId) {
      setRemoteCertificateTrustSupported(false)
      return
    }
    let cancelled = false
    void runtimeEnvironmentSupportsCapability(
      remoteCertificateEnvironmentId,
      BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY
    )
      .then((supported) => {
        if (!cancelled) {
          setRemoteCertificateTrustSupported(supported)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteCertificateTrustSupported(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [remoteCertificateEnvironmentId, certificateChallengeId])

  currentBrowserTabIdRef.current = browserTab.id
  currentBrowserTabUrlRef.current = browserTab.url
  activeRuntimeEnvironmentIdRef.current = activeRuntimeEnvironmentId
  isActiveRef.current = isActive

  const runtimeTarget = useCallback(() => {
    return activeRuntimeEnvironmentId
      ? ({
          kind: 'environment',
          environmentId: activeRuntimeEnvironmentId
        } satisfies RuntimeClientTarget)
      : null
  }, [activeRuntimeEnvironmentId])

  const clearStreamFrame = useCallback((): void => {
    pendingFrameDecodeRef.current += 1
    const prevUrl = streamFrameUrlRef.current
    streamFrameUrlRef.current = null
    remoteCssViewportSizeRef.current = null
    remoteStreamViewportSizeRef.current = null
    setFrameMetadata(null)
    setFrameUrl(null)
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl)
    }
  }, [])

  const clearPendingRemoteWheel = useCallback((): void => {
    pendingRemoteWheelRef.current = null
    remoteWheelInFlightRef.current = false
    if (remoteWheelFrameRef.current !== null) {
      window.cancelAnimationFrame(remoteWheelFrameRef.current)
      remoteWheelFrameRef.current = null
    }
  }, [])

  const closeMissingRemotePage = useCallback(
    (remotePageId: string | null = remotePageIdRef.current): void => {
      const state = useAppStore.getState()
      if (remotePageId) {
        state.removeRemoteBrowserPageHandle(browserTab.id, remotePageId)
      }
      remotePageIdRef.current = null
      remoteOperationGenerationRef.current += 1
      streamGenerationRef.current += 1
      activeStreamTokenRef.current = null
      streamSubscriptionRef.current?.unsubscribe()
      streamSubscriptionRef.current = null
      if (streamRestartTimerRef.current !== null) {
        window.clearTimeout(streamRestartTimerRef.current)
        streamRestartTimerRef.current = null
      }
      if (remoteViewportTimerRef.current !== null) {
        window.clearTimeout(remoteViewportTimerRef.current)
        remoteViewportTimerRef.current = null
      }
      if (remoteTabRefreshTimerRef.current !== null) {
        window.clearTimeout(remoteTabRefreshTimerRef.current)
        remoteTabRefreshTimerRef.current = null
      }
      remoteInputQueueRef.current = Promise.resolve()
      clearStreamFrame()
      setRemoteError(null)
      setBusy(false)
      // Why: a runtime-side tab close mirrors closing the visible tab; don't leave a dead pane behind.
      const workspacePageCount = state.browserPagesByWorkspace[browserTab.workspaceId]?.length ?? 0
      if (workspacePageCount <= 1) {
        closeBrowserTab(browserTab.workspaceId)
        return
      }
      closeBrowserPage(browserTab.id)
    },
    [browserTab.id, browserTab.workspaceId, clearStreamFrame, closeBrowserPage, closeBrowserTab]
  )

  const rememberRemoteViewportSize = useCallback(
    (next: RemoteBrowserViewportSize): RemoteBrowserViewportSize => {
      const prev = remoteViewportSizeRef.current
      if (
        !prev ||
        Math.abs(prev.width - next.width) > 3 ||
        Math.abs(prev.height - next.height) > 3
      ) {
        remoteViewportSizeRef.current = next
        return next
      }
      return prev
    },
    []
  )

  const readCurrentRemoteViewportSize = useCallback((): RemoteBrowserViewportSize | null => {
    const element = remoteViewportRef.current
    if (!element) {
      return null
    }
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return null
    }
    return {
      width: Math.max(320, Math.round(rect.width)),
      height: Math.max(240, Math.round(rect.height))
    }
  }, [])

  const readRemoteViewportSize = useCallback((): RemoteBrowserViewportSize | null => {
    const next = readCurrentRemoteViewportSize()
    return next ? rememberRemoteViewportSize(next) : remoteViewportSizeRef.current
  }, [readCurrentRemoteViewportSize, rememberRemoteViewportSize])

  const waitForRemoteViewportSize =
    useCallback(async (): Promise<RemoteBrowserViewportSize | null> => {
      for (let i = 0; i < 3; i += 1) {
        const next = readCurrentRemoteViewportSize()
        if (next) {
          return rememberRemoteViewportSize(next)
        }
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        })
      }
      return readRemoteViewportSize()
    }, [readCurrentRemoteViewportSize, readRemoteViewportSize, rememberRemoteViewportSize])

  const syncRemoteViewport = useCallback(
    async (pageId: string): Promise<void> => {
      const target = runtimeTarget()
      const size = readRemoteViewportSize()
      if (!target || !size) {
        return
      }
      await callRuntimeRpc(
        target,
        'browser.viewport',
        {
          worktree: runtimeWorktree,
          page: pageId,
          width: size.width,
          height: size.height,
          deviceScaleFactor: getRemoteBrowserDeviceScaleFactor(),
          mobile: false
        },
        { timeoutMs: 15_000, suppressFeatureInteraction: true }
      )
      try {
        // Why: the streamed bitmap can include the host compositor surface, but CDP input wants the guest page's CSS viewport coords.
        const viewport = await callRuntimeRpc(
          target,
          'browser.eval',
          {
            worktree: runtimeWorktree,
            page: pageId,
            expression: 'JSON.stringify({ width: window.innerWidth, height: window.innerHeight })'
          },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
        remoteCssViewportSizeRef.current = readRemoteCssViewportSize(viewport) ?? size
      } catch {
        remoteCssViewportSizeRef.current = size
      }
    },
    [readRemoteViewportSize, runtimeTarget, runtimeWorktree]
  )

  const enqueueRemoteInput = useCallback((operation: () => Promise<void>): Promise<void> => {
    const next = remoteInputQueueRef.current.catch(() => {}).then(operation)
    remoteInputQueueRef.current = next.catch(() => {})
    return next
  }, [])

  const createRemoteOperationToken = useCallback(
    (remotePageId: string | null = null): RemoteBrowserOperationToken | null => {
      const target = runtimeTarget()
      if (!target) {
        return null
      }
      return {
        tabId: browserTab.id,
        environmentId: target.environmentId,
        remotePageId,
        generation: remoteOperationGenerationRef.current
      }
    },
    [browserTab.id, runtimeTarget]
  )

  const isCurrentRemoteOperationToken = useCallback(
    (token: RemoteBrowserOperationToken): boolean =>
      mountedRef.current &&
      isActiveRef.current &&
      browserPageExists(token.tabId) &&
      currentBrowserTabIdRef.current === token.tabId &&
      activeRuntimeEnvironmentIdRef.current === token.environmentId &&
      remoteOperationGenerationRef.current === token.generation &&
      (token.remotePageId === null || remotePageIdRef.current === token.remotePageId),
    []
  )

  const isCurrentRemoteStreamOperation = useCallback(
    (token: RemoteBrowserStreamToken): boolean =>
      isCurrentRemoteOperationToken({
        tabId: token.tabId,
        environmentId: token.environmentId,
        remotePageId: token.remotePageId,
        generation: token.operationGeneration
      }),
    [isCurrentRemoteOperationToken]
  )

  const isCurrentRemoteStreamToken = useCallback(
    (token: RemoteBrowserStreamToken): boolean => {
      const activeToken = activeStreamTokenRef.current
      return (
        activeToken?.generation === token.generation &&
        activeToken.operationGeneration === token.operationGeneration &&
        activeToken.tabId === token.tabId &&
        activeToken.environmentId === token.environmentId &&
        activeToken.remotePageId === token.remotePageId &&
        isCurrentRemoteStreamOperation(token)
      )
    },
    [isCurrentRemoteStreamOperation]
  )

  useEffect(() => {
    // Why: StrictMode's mount→cleanup→mount leaves mountedRef false; re-arm or operation tokens read stale and the pane wedges.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      remoteOperationGenerationRef.current += 1
      streamGenerationRef.current += 1
      pendingFrameDecodeRef.current += 1
      activeStreamTokenRef.current = null
      remoteStreamViewportSizeRef.current = null
      if (streamRestartTimerRef.current !== null) {
        window.clearTimeout(streamRestartTimerRef.current)
        streamRestartTimerRef.current = null
      }
      if (remoteViewportTimerRef.current !== null) {
        window.clearTimeout(remoteViewportTimerRef.current)
        remoteViewportTimerRef.current = null
      }
      if (remoteTabRefreshTimerRef.current !== null) {
        window.clearTimeout(remoteTabRefreshTimerRef.current)
        remoteTabRefreshTimerRef.current = null
      }
      clearPendingRemoteWheel()
      restartRemoteStreamForViewportRef.current = () => {}
      if (streamFrameUrlRef.current) {
        URL.revokeObjectURL(streamFrameUrlRef.current)
        streamFrameUrlRef.current = null
      }
    }
  }, [clearPendingRemoteWheel])

  useEffect(() => {
    // Why: only reset frame/wheel on identity change; bumping the stream/operation generations here races the streaming effect and wedges the pane.
    remoteStreamViewportSizeRef.current = null
    clearPendingRemoteWheel()
    clearStreamFrame()
  }, [activeRuntimeEnvironmentId, browserTab.id, clearPendingRemoteWheel, clearStreamFrame])

  useEffect(() => {
    if (!isActive) {
      return
    }
    const element = remoteViewportRef.current
    if (!element) {
      return
    }
    const scheduleSync = (): void => {
      readRemoteViewportSize()
      if (remoteViewportTimerRef.current !== null) {
        window.clearTimeout(remoteViewportTimerRef.current)
      }
      remoteViewportTimerRef.current = window.setTimeout(() => {
        remoteViewportTimerRef.current = null
        const pageId = remotePageIdRef.current
        if (!pageId || !isActiveRef.current) {
          return
        }
        void syncRemoteViewport(pageId)
          .then(() => restartRemoteStreamForViewportRef.current(pageId))
          .catch(() => {})
      }, 150)
    }
    scheduleSync()
    const observer = new ResizeObserver(scheduleSync)
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (remoteViewportTimerRef.current !== null) {
        window.clearTimeout(remoteViewportTimerRef.current)
        remoteViewportTimerRef.current = null
      }
    }
  }, [isActive, readRemoteViewportSize, syncRemoteViewport])

  useEffect(() => {
    if (document.activeElement === addressBarInputRef.current) {
      return
    }
    setAddressBarValue(toDisplayUrl(browserTab.url))
  }, [browserTab.url])

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [contextMenu])

  useLayoutEffect(() => {
    const el = contextMenuRef.current
    if (!el || !contextMenu) {
      return
    }
    el.style.left = `${contextMenu.x}px`
    el.style.top = `${contextMenu.y}px`
    const rect = el.getBoundingClientRect()
    const offsetX = contextMenu.x - rect.left
    const offsetY = contextMenu.y - rect.top
    let renderX = contextMenu.x
    let renderY = contextMenu.y
    if (rect.right > window.innerWidth) {
      renderX = contextMenu.x - rect.width
    }
    if (rect.bottom > window.innerHeight) {
      renderY = contextMenu.y - rect.height
    }
    el.style.left = `${Math.max(0, renderX) + offsetX}px`
    el.style.top = `${Math.max(0, renderY) + offsetY}px`
  }, [contextMenu])

  useEffect(() => {
    if (!activeRuntimeEnvironmentId) {
      return
    }
    return () => {
      const remotePageId = remotePageIdRef.current
      if (!remotePageId) {
        return
      }
      const state = useAppStore.getState()
      const currentEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
      const pageStillExists = browserPageExists(browserTab.id)
      if (currentEnvironmentId === activeRuntimeEnvironmentId && pageStillExists) {
        return
      }
      const removedHandle = state.removeRemoteBrowserPageHandle(browserTab.id, remotePageId)
      remotePageIdRef.current = null
      if (!removedHandle) {
        return
      }
      // Why: remote tabs outlive React components on the daemon; close only when the local page or its runtime environment is gone.
      void callRuntimeRpc(
        { kind: 'environment', environmentId: removedHandle.environmentId },
        'browser.tabClose',
        { worktree: runtimeWorktree, page: removedHandle.remotePageId },
        { timeoutMs: 15_000, suppressFeatureInteraction: true }
      ).catch(() => {})
    }
  }, [activeRuntimeEnvironmentId, browserTab.id, runtimeWorktree, worktreeId])

  const applyRemoteTabInfo = useCallback(
    (tab: Pick<BrowserTabInfo, 'url' | 'title'>): void => {
      const safeUrl = redactKagiSessionToken(tab.url || 'about:blank')
      onSetUrl(browserTab.id, safeUrl)
      onUpdatePageState(browserTab.id, {
        title: getBrowserDisplayTitle(tab.title, safeUrl),
        loading: false,
        loadError: null
      })
      if (document.activeElement !== addressBarInputRef.current) {
        setAddressBarValue(toDisplayUrl(safeUrl))
      }
    },
    [browserTab.id, onSetUrl, onUpdatePageState]
  )

  const updateStreamFrame = useCallback(
    (token: RemoteBrowserStreamToken, bytes: Uint8Array<ArrayBufferLike>): void => {
      if (!isCurrentRemoteStreamToken(token)) {
        return
      }
      const frame = decodeBrowserScreencastFrame(bytes)
      if (!frame) {
        return
      }
      const imageBuffer = frame.image.buffer.slice(
        frame.image.byteOffset,
        frame.image.byteOffset + frame.image.byteLength
      ) as ArrayBuffer
      const nextUrl = URL.createObjectURL(
        new Blob([imageBuffer], { type: `image/${frame.format}` })
      )
      const decodeGeneration = pendingFrameDecodeRef.current + 1
      pendingFrameDecodeRef.current = decodeGeneration
      void decodeRemoteBrowserFrameUrl(nextUrl)
        .then(() => {
          if (
            pendingFrameDecodeRef.current !== decodeGeneration ||
            !isCurrentRemoteStreamToken(token)
          ) {
            URL.revokeObjectURL(nextUrl)
            return
          }
          const prevUrl = streamFrameUrlRef.current
          streamFrameUrlRef.current = nextUrl
          setFrameMetadata(frame.metadata)
          setFrameUrl(nextUrl)
          setBusy(false)
          if (prevUrl) {
            URL.revokeObjectURL(prevUrl)
          }
        })
        .catch(() => {
          URL.revokeObjectURL(nextUrl)
        })
    },
    [isCurrentRemoteStreamToken]
  )

  const getRemoteImagePoint = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
      const image = imageRef.current
      const viewport = remoteViewportRef.current
      if (!image || !viewport) {
        return null
      }
      const rect = viewport.getBoundingClientRect()
      const viewportWidth =
        getPositiveFiniteNumber(remoteCssViewportSizeRef.current?.width) ??
        getPositiveFiniteNumber(remoteViewportSizeRef.current?.width) ??
        getPositiveFiniteNumber(frameMetadata?.deviceWidth) ??
        image.naturalWidth
      const viewportHeight =
        getPositiveFiniteNumber(remoteCssViewportSizeRef.current?.height) ??
        getPositiveFiniteNumber(remoteViewportSizeRef.current?.height) ??
        getPositiveFiniteNumber(frameMetadata?.deviceHeight) ??
        image.naturalHeight
      if (rect.width <= 0 || rect.height <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return null
      }
      return {
        x: Math.round(((event.clientX - rect.left) / rect.width) * viewportWidth),
        y: Math.round(((event.clientY - rect.top) / rect.height) * viewportHeight)
      }
    },
    [frameMetadata]
  )

  const ensureRemotePage = useCallback(
    async (token: RemoteBrowserOperationToken): Promise<string | null> => {
      if (!isCurrentRemoteOperationToken(token)) {
        return null
      }
      const target = { kind: 'environment' as const, environmentId: token.environmentId }
      const createRemotePage = async (): Promise<string | null> => {
        const currentUrl = currentBrowserTabUrlRef.current
        const initialUrl =
          currentUrl === ORCA_BROWSER_BLANK_URL ? 'about:blank' : currentUrl || 'about:blank'
        const created = await callRuntimeRpc<{ browserPageId: string }>(
          target,
          'browser.tabCreate',
          { worktree: runtimeWorktree, url: initialUrl },
          { timeoutMs: 30_000, suppressFeatureInteraction: true }
        )
        if (!isCurrentRemoteOperationToken(token)) {
          void callRuntimeRpc(
            target,
            'browser.tabClose',
            { worktree: runtimeWorktree, page: created.browserPageId },
            { timeoutMs: 15_000, suppressFeatureInteraction: true }
          ).catch(() => {})
          return null
        }
        remotePageIdRef.current = created.browserPageId
        setRemoteBrowserPageHandle(browserTab.id, {
          environmentId: target.environmentId,
          remotePageId: created.browserPageId
        })
        return created.browserPageId
      }

      const existingHandle = useAppStore.getState().remoteBrowserPageHandlesByPageId[browserTab.id]
      if (existingHandle?.environmentId === target.environmentId) {
        const cachedToken = { ...token, remotePageId: existingHandle.remotePageId }
        remotePageIdRef.current = existingHandle.remotePageId
        try {
          const cachedTab = await fetchRemoteTabInfoRef.current(cachedToken)
          if (!cachedTab) {
            return null
          }
          return existingHandle.remotePageId
        } catch (error) {
          if (!isRemoteBrowserPageMissingError(error)) {
            throw error
          }
          useAppStore
            .getState()
            .removeRemoteBrowserPageHandle(browserTab.id, existingHandle.remotePageId)
          if (remotePageIdRef.current === existingHandle.remotePageId) {
            remotePageIdRef.current = null
          }
          if (!isCurrentRemoteOperationToken(token)) {
            return null
          }
          closeMissingRemotePage(existingHandle.remotePageId)
          return null
        }
      }
      return createRemotePage()
    },
    [
      browserTab.id,
      closeMissingRemotePage,
      isCurrentRemoteOperationToken,
      setRemoteBrowserPageHandle,
      runtimeWorktree
    ]
  )

  const fetchRemoteTabInfo = useCallback(
    async (token: RemoteBrowserOperationToken): Promise<BrowserTabInfo | null> => {
      if (!isCurrentRemoteOperationToken(token) || !token.remotePageId) {
        return null
      }
      const shown = await callRuntimeRpc<{ tab: BrowserTabInfo }>(
        { kind: 'environment', environmentId: token.environmentId },
        'browser.tabShow',
        { worktree: runtimeWorktree, page: token.remotePageId },
        { timeoutMs: 15_000, suppressFeatureInteraction: true }
      )
      return shown.tab
    },
    [isCurrentRemoteOperationToken, runtimeWorktree]
  )
  fetchRemoteTabInfoRef.current = fetchRemoteTabInfo

  const scheduleRemoteTabInfoRefresh = useCallback(
    (token: RemoteBrowserOperationToken, delayMs = 250): void => {
      if (!isCurrentRemoteOperationToken(token)) {
        return
      }
      if (remoteTabRefreshTimerRef.current !== null) {
        window.clearTimeout(remoteTabRefreshTimerRef.current)
      }
      remoteTabRefreshTimerRef.current = window.setTimeout(() => {
        remoteTabRefreshTimerRef.current = null
        if (!isCurrentRemoteOperationToken(token)) {
          return
        }
        void fetchRemoteTabInfo(token)
          .then((tab) => {
            if (tab && isCurrentRemoteOperationToken(token)) {
              applyRemoteTabInfo(tab)
            }
          })
          .catch((error: unknown) => {
            if (isCurrentRemoteOperationToken(token) && isRemoteBrowserPageMissingError(error)) {
              closeMissingRemotePage(token.remotePageId)
            }
          })
      }, delayMs)
    },
    [applyRemoteTabInfo, closeMissingRemotePage, fetchRemoteTabInfo, isCurrentRemoteOperationToken]
  )

  const scheduleRemoteStreamRestart = useCallback(
    (token: RemoteBrowserStreamToken): void => {
      if (!isCurrentRemoteStreamOperation(token) || streamRestartTimerRef.current !== null) {
        return
      }
      streamRestartTimerRef.current = window.setTimeout(() => {
        streamRestartTimerRef.current = null
        if (!isCurrentRemoteStreamOperation(token)) {
          return
        }
        setBusy(true)
        const operationToken: RemoteBrowserOperationToken = {
          tabId: token.tabId,
          environmentId: token.environmentId,
          remotePageId: token.remotePageId,
          generation: token.operationGeneration
        }
        void fetchRemoteTabInfo(operationToken)
          .then((tab) => {
            if (!tab || !isCurrentRemoteStreamOperation(token)) {
              return
            }
            applyRemoteTabInfo(tab)
          })
          .catch(() => {})
          .then(() => {
            if (!isCurrentRemoteStreamOperation(token)) {
              return null
            }
            return startRemoteStreamRef.current(token.remotePageId)
          })
          .then((subscription) => {
            if (!subscription) {
              return
            }
            if (!isCurrentRemoteStreamToken(subscription.token)) {
              subscription?.unsubscribe()
              return
            }
            streamSubscriptionRef.current = subscription
          })
          .catch((error: unknown) => {
            if (!isCurrentRemoteStreamOperation(token)) {
              return
            }
            if (isRemoteBrowserPageMissingError(error)) {
              closeMissingRemotePage(token.remotePageId)
              return
            }
            setRemoteError(
              error instanceof Error ? error.message : 'Failed to restart remote browser stream.'
            )
            setBusy(false)
          })
      }, 500)
    },
    [
      applyRemoteTabInfo,
      closeMissingRemotePage,
      fetchRemoteTabInfo,
      isCurrentRemoteStreamOperation,
      isCurrentRemoteStreamToken
    ]
  )

  const handleRemoteStreamClosed = useCallback(
    (token: RemoteBrowserStreamToken, restart: boolean): void => {
      if (!isCurrentRemoteStreamToken(token)) {
        return
      }
      setBusy(restart)
      const current = streamSubscriptionRef.current
      streamSubscriptionRef.current = null
      activeStreamTokenRef.current = null
      remoteStreamViewportSizeRef.current = null
      // Why: navigation recreates the screencast stream; keep the last frame during restart so panes don't flash the loading placeholder.
      if (!restart) {
        clearStreamFrame()
      }
      current?.unsubscribe()
      if (restart) {
        scheduleRemoteStreamRestart(token)
      }
    },
    [clearStreamFrame, isCurrentRemoteStreamToken, scheduleRemoteStreamRestart]
  )

  const startRemoteStream = useCallback(
    async (pageId: string): Promise<RemoteBrowserStreamSubscription | null> => {
      const target = runtimeTarget()
      if (!target) {
        return null
      }
      const operationToken = createRemoteOperationToken(pageId)
      if (!operationToken || !isCurrentRemoteOperationToken(operationToken)) {
        return null
      }
      const status = await callRuntimeRpc<RuntimeStatus>(target, 'status.get', undefined, {
        timeoutMs: 15_000
      })
      if (!status.capabilities?.includes('browser.screencast.v1')) {
        throw new Error('The selected runtime does not support remote browser streaming.')
      }
      if (!isCurrentRemoteOperationToken(operationToken)) {
        return null
      }
      const viewportSize = await waitForRemoteViewportSize()
      remoteStreamViewportSizeRef.current = viewportSize
      const token: RemoteBrowserStreamToken = {
        tabId: browserTab.id,
        environmentId: target.environmentId,
        remotePageId: pageId,
        generation: streamGenerationRef.current + 1,
        operationGeneration: operationToken.generation
      }
      streamGenerationRef.current = token.generation
      activeStreamTokenRef.current = token
      try {
        const subscription = await window.api.runtimeEnvironments.subscribe(
          {
            selector: target.environmentId,
            method: 'browser.screencast',
            params: withBrowserPaneUiRuntimeRpcSource({
              worktree: runtimeWorktree,
              page: pageId,
              format: 'jpeg',
              quality: 70,
              maxWidth: 3840,
              maxHeight: 2160,
              viewportWidth: viewportSize?.width,
              viewportHeight: viewportSize?.height,
              deviceScaleFactor: getRemoteBrowserDeviceScaleFactor(),
              everyNthFrame: 2
            }),
            timeoutMs: 15_000
          },
          {
            onResponse: (response) => {
              if (!isCurrentRemoteStreamToken(token)) {
                return
              }
              if (response.ok === false) {
                if (isRemoteBrowserPageMissingCode(response.error.code)) {
                  closeMissingRemotePage(pageId)
                  return
                }
                setRemoteError(response.error.message)
                handleRemoteStreamClosed(token, false)
                return
              }
              const event = response.result as BrowserScreencastResult
              if (event.type === 'ready') {
                applyRemoteTabInfo(event.tab)
                void syncRemoteViewport(event.browserPageId).catch(() => {})
                setBusy(false)
              } else if (event.type === 'end') {
                handleRemoteStreamClosed(token, true)
              } else if (event.type === 'error') {
                setRemoteError(event.message)
                handleRemoteStreamClosed(token, false)
              }
            },
            onBinary: (bytes) => updateStreamFrame(token, bytes),
            onError: (error) => {
              if (!isCurrentRemoteStreamToken(token)) {
                return
              }
              if (isRemoteBrowserPageMissingError(error)) {
                closeMissingRemotePage(pageId)
                return
              }
              setRemoteError(error.message)
              setBusy(false)
            },
            onClose: () => {
              handleRemoteStreamClosed(token, true)
            }
          }
        )
        return { token, unsubscribe: subscription.unsubscribe }
      } catch (error) {
        if (isCurrentRemoteStreamToken(token)) {
          activeStreamTokenRef.current = null
        }
        throw error
      }
    },
    [
      applyRemoteTabInfo,
      browserTab.id,
      closeMissingRemotePage,
      createRemoteOperationToken,
      handleRemoteStreamClosed,
      isCurrentRemoteOperationToken,
      isCurrentRemoteStreamToken,
      runtimeTarget,
      syncRemoteViewport,
      updateStreamFrame,
      waitForRemoteViewportSize,
      runtimeWorktree
    ]
  )

  const restartRemoteStreamForViewport = useCallback(
    (pageId: string): void => {
      const current = streamSubscriptionRef.current
      const nextViewportSize = remoteViewportSizeRef.current
      if (
        !current ||
        current.token.remotePageId !== pageId ||
        !nextViewportSize ||
        areRemoteViewportSizesNear(remoteStreamViewportSizeRef.current, nextViewportSize) ||
        !isCurrentRemoteStreamToken(current.token)
      ) {
        return
      }

      // Why: the runtime stream validates frames against its start viewport, so restart media after resize or new-size frames get rejected.
      streamGenerationRef.current += 1
      activeStreamTokenRef.current = null
      streamSubscriptionRef.current = null
      remoteStreamViewportSizeRef.current = null
      if (streamRestartTimerRef.current !== null) {
        window.clearTimeout(streamRestartTimerRef.current)
        streamRestartTimerRef.current = null
      }
      setBusy(true)
      current.unsubscribe()
      void startRemoteStreamRef
        .current(pageId)
        .then((subscription) => {
          if (!subscription) {
            if (mountedRef.current && isActiveRef.current && remotePageIdRef.current === pageId) {
              setBusy(false)
            }
            return
          }
          if (!isCurrentRemoteStreamToken(subscription.token)) {
            subscription.unsubscribe()
            return
          }
          streamSubscriptionRef.current = subscription
        })
        .catch((error: unknown) => {
          if (!mountedRef.current || !isActiveRef.current || remotePageIdRef.current !== pageId) {
            return
          }
          if (isRemoteBrowserPageMissingError(error)) {
            closeMissingRemotePage(pageId)
            return
          }
          setRemoteError(
            error instanceof Error ? error.message : 'Failed to resize remote browser stream.'
          )
          setBusy(false)
        })
    },
    [closeMissingRemotePage, isCurrentRemoteStreamToken]
  )

  useEffect(() => {
    startRemoteStreamRef.current = startRemoteStream
    restartRemoteStreamForViewportRef.current = restartRemoteStreamForViewport
  }, [restartRemoteStreamForViewport, startRemoteStream])

  useEffect(() => {
    if (!isActive) {
      return
    }
    let cancelled = false
    setBusy(true)
    setRemoteError(null)
    remoteOperationGenerationRef.current += 1
    streamGenerationRef.current += 1
    activeStreamTokenRef.current = null
    streamSubscriptionRef.current?.unsubscribe()
    streamSubscriptionRef.current = null
    if (streamRestartTimerRef.current !== null) {
      window.clearTimeout(streamRestartTimerRef.current)
      streamRestartTimerRef.current = null
    }
    const operationToken = createRemoteOperationToken()
    if (!operationToken) {
      setBusy(false)
      return
    }
    void ensureRemotePage(operationToken)
      .then(async (pageId) => {
        if (!pageId || cancelled || !isCurrentRemoteOperationToken(operationToken)) {
          return
        }
        const pageToken = { ...operationToken, remotePageId: pageId }
        const tab = await fetchRemoteTabInfo(pageToken)
        if (tab && !cancelled && isCurrentRemoteOperationToken(pageToken)) {
          applyRemoteTabInfo(tab)
        }
        if (cancelled || !isCurrentRemoteOperationToken(pageToken)) {
          return
        }
        const subscription = await startRemoteStream(pageId)
        if (cancelled || !subscription) {
          subscription?.unsubscribe()
          return
        }
        if (!isCurrentRemoteStreamToken(subscription.token)) {
          subscription.unsubscribe()
          return
        }
        streamSubscriptionRef.current = subscription
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          if (isRemoteBrowserPageMissingError(error)) {
            closeMissingRemotePage()
            return
          }
          setRemoteError(error instanceof Error ? error.message : 'Failed to open remote browser.')
          setBusy(false)
        }
      })
    return () => {
      cancelled = true
      remoteOperationGenerationRef.current += 1
      streamGenerationRef.current += 1
      activeStreamTokenRef.current = null
      clearPendingRemoteWheel()
      streamSubscriptionRef.current?.unsubscribe()
      streamSubscriptionRef.current = null
      if (streamRestartTimerRef.current !== null) {
        window.clearTimeout(streamRestartTimerRef.current)
        streamRestartTimerRef.current = null
      }
    }
  }, [
    clearPendingRemoteWheel,
    createRemoteOperationToken,
    ensureRemotePage,
    fetchRemoteTabInfo,
    isActive,
    closeMissingRemotePage,
    isCurrentRemoteOperationToken,
    isCurrentRemoteStreamToken,
    applyRemoteTabInfo,
    startRemoteStream
  ])

  useEffect(() => {
    if (!isActive) {
      return
    }
    return window.api.ui.onFocusBrowserAddressBar(() => {
      addressBarInputRef.current?.focus()
      addressBarInputRef.current?.select()
    })
  }, [isActive])

  useEffect(() => {
    if (!isActive) {
      return
    }
    const handleBrowserFocusRequest = (event: Event): void => {
      const detail = (event as CustomEvent<BrowserFocusRequestDetail>).detail
      if (!detail || detail.pageId !== browserTab.id) {
        return
      }
      const focusTarget = consumeBrowserFocusRequest(browserTab.id)
      if (!focusTarget) {
        return
      }
      if (focusTarget === 'address-bar') {
        addressBarInputRef.current?.focus()
        addressBarInputRef.current?.select()
        return
      }
      const target = imageRef.current ?? remoteViewportRef.current
      target?.focus()
    }
    window.addEventListener(ORCA_BROWSER_FOCUS_REQUEST_EVENT, handleBrowserFocusRequest)
    return () =>
      window.removeEventListener(ORCA_BROWSER_FOCUS_REQUEST_EVENT, handleBrowserFocusRequest)
  }, [browserTab.id, isActive])

  const runRemoteNavigation = useCallback(
    async (
      method: 'browser.goto' | 'browser.back' | 'browser.forward' | 'browser.reload',
      url?: string
    ) => {
      const target = runtimeTarget()
      if (!target) {
        return
      }
      const operationToken = createRemoteOperationToken()
      if (!operationToken) {
        return
      }
      const pageId = await ensureRemotePage(operationToken)
      if (!pageId) {
        return
      }
      const pageToken = { ...operationToken, remotePageId: pageId }
      if (!isCurrentRemoteOperationToken(pageToken)) {
        return
      }
      setBusy(true)
      setRemoteError(null)
      onUpdatePageState(browserTab.id, { loading: true, loadError: null })
      try {
        const params =
          method === 'browser.goto'
            ? { worktree: runtimeWorktree, page: pageId, url: url ?? 'about:blank' }
            : { worktree: runtimeWorktree, page: pageId }
        const result = await callRuntimeRpc<
          BrowserGotoResult | BrowserBackResult | BrowserReloadResult
        >(target, method, params, { timeoutMs: 30_000, suppressFeatureInteraction: true })
        if (isCurrentRemoteOperationToken(pageToken)) {
          applyRemoteTabInfo(result)
        }
      } catch (error) {
        if (!isCurrentRemoteOperationToken(pageToken)) {
          return
        }
        if (isRemoteBrowserPageMissingError(error)) {
          closeMissingRemotePage(pageId)
          return
        }
        const message = error instanceof Error ? error.message : 'Remote browser command failed.'
        setRemoteError(message)
        onUpdatePageState(browserTab.id, {
          loading: false,
          // Why: validatedUrl is persisted, so redact the Kagi session token like the main-process failure path does.
          loadError: {
            code: 0,
            description: message,
            validatedUrl: redactKagiSessionToken(url ?? browserTab.url)
          }
        })
      } finally {
        if (isCurrentRemoteOperationToken(pageToken)) {
          setBusy(false)
        }
      }
    },
    [
      applyRemoteTabInfo,
      browserTab.id,
      browserTab.url,
      createRemoteOperationToken,
      ensureRemotePage,
      closeMissingRemotePage,
      isCurrentRemoteOperationToken,
      onUpdatePageState,
      runtimeTarget,
      runtimeWorktree
    ]
  )

  const navigateToUrl = useCallback(
    (url: string): void => {
      void runRemoteNavigation('browser.goto', url)
    },
    [runRemoteNavigation]
  )

  // Browser history shortcuts for SSH/runtime browsers.
  // Why: remote panes have no local webview ref, so route history through runtime RPC instead of WebContents.
  useEffect(() => {
    if (!isActive) {
      return
    }
    const shortcutPlatform = getShortcutPlatform()
    const handleKeyDown = (e: KeyboardEvent): void => {
      const method = keybindingMatchesAction('browser.back', e, shortcutPlatform, keybindings)
        ? 'browser.back'
        : keybindingMatchesAction('browser.forward', e, shortcutPlatform, keybindings)
          ? 'browser.forward'
          : null
      if (method === null) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      void runRemoteNavigation(method)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isActive, keybindings, runRemoteNavigation])

  const submitAddressBar = (): void => {
    const searchEngine = useAppStore.getState().browserDefaultSearchEngine
    const kagiSessionLink = useAppStore.getState().browserKagiSessionLink
    const nextUrl = normalizeBrowserNavigationUrl(addressBarValue, searchEngine, {
      kagiSessionLink
    })
    if (!nextUrl) {
      const message = 'Enter a valid http(s) or localhost URL.'
      setRemoteError(message)
      onUpdatePageState(browserTab.id, {
        loadError: {
          code: 0,
          description: message,
          validatedUrl: redactKagiSessionToken(addressBarValue.trim()) || 'about:blank'
        }
      })
      return
    }
    navigateToUrl(nextUrl)
  }

  const handleRemotePointerDown = (event: React.PointerEvent<HTMLImageElement>): void => {
    if (busy) {
      return
    }
    const target = runtimeTarget()
    const pageId = remotePageIdRef.current
    const image = imageRef.current
    const operationToken = pageId ? createRemoteOperationToken(pageId) : null
    const point = getRemoteImagePoint(event)
    const button = getRemoteBrowserMouseButton(event.button)
    if (button === 'right') {
      return
    }
    if (!target || !pageId || !image || !operationToken || !point || !button) {
      return
    }
    event.preventDefault()
    image.focus()
    setContextMenu(null)
    setRemoteError(null)
    enqueueRemoteInput(async () => {
      if (!isCurrentRemoteOperationToken(operationToken)) {
        return
      }
      try {
        const params = { worktree: runtimeWorktree, page: pageId }
        await callRuntimeRpc(
          target,
          'browser.mouseMove',
          { ...params, x: point.x, y: point.y },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
        await callRuntimeRpc(
          target,
          'browser.mouseDown',
          { ...params, button },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
      } catch (error) {
        if (isCurrentRemoteOperationToken(operationToken)) {
          if (isRemoteBrowserPageMissingError(error)) {
            closeMissingRemotePage(pageId)
            return
          }
          setRemoteError(error instanceof Error ? error.message : 'Remote mouse input failed.')
        }
      }
    })
  }

  const handleRemotePointerUp = (event: React.PointerEvent<HTMLImageElement>): void => {
    if (busy) {
      return
    }
    const target = runtimeTarget()
    const pageId = remotePageIdRef.current
    const operationToken = pageId ? createRemoteOperationToken(pageId) : null
    const point = getRemoteImagePoint(event)
    const button = getRemoteBrowserMouseButton(event.button)
    if (button === 'right') {
      return
    }
    if (!target || !pageId || !operationToken || !point || !button) {
      return
    }
    event.preventDefault()
    setRemoteError(null)
    enqueueRemoteInput(async () => {
      if (!isCurrentRemoteOperationToken(operationToken)) {
        return
      }
      try {
        const params = { worktree: runtimeWorktree, page: pageId }
        await callRuntimeRpc(
          target,
          'browser.mouseMove',
          { ...params, x: point.x, y: point.y },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
        await callRuntimeRpc(
          target,
          'browser.mouseUp',
          { ...params, button },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
        scheduleRemoteTabInfoRefresh(operationToken, 250)
      } catch (error) {
        if (isCurrentRemoteOperationToken(operationToken)) {
          if (isRemoteBrowserPageMissingError(error)) {
            closeMissingRemotePage(pageId)
            return
          }
          setRemoteError(error instanceof Error ? error.message : 'Remote mouse input failed.')
        }
      }
    })
  }

  const handleRemoteContextMenu = (event: React.MouseEvent<HTMLImageElement>): void => {
    if (busy) {
      return
    }
    const target = runtimeTarget()
    const pageId = remotePageIdRef.current
    const point = getRemoteImagePoint(event)
    if (!target || !pageId || !point) {
      return
    }
    event.preventDefault()
    imageRef.current?.focus()
    setRemoteError(null)
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      linkUrl: null,
      pageUrl: browserTab.url || 'about:blank',
      // Why: filled in below once the async eval reads the guest selection.
      selectionText: ''
    })
    enqueueRemoteInput(async () => {
      const operationToken = createRemoteOperationToken(pageId)
      if (!operationToken || !isCurrentRemoteOperationToken(operationToken)) {
        return
      }
      try {
        const result = await callRuntimeRpc(
          target,
          'browser.eval',
          {
            worktree: runtimeWorktree,
            page: pageId,
            expression: buildRemoteContextMenuExpression(point.x, point.y)
          },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
        const parsed = readRemoteContextMenuResult(result)
        if (parsed && mountedRef.current && isCurrentRemoteOperationToken(operationToken)) {
          setContextMenu((current) =>
            current
              ? {
                  ...current,
                  linkUrl: parsed.linkUrl,
                  pageUrl: redactKagiSessionToken(parsed.pageUrl),
                  selectionText: parsed.selectionText
                }
              : current
          )
        }
      } catch (error) {
        if (
          isCurrentRemoteOperationToken(operationToken) &&
          isRemoteBrowserPageMissingError(error)
        ) {
          closeMissingRemotePage(pageId)
        }
        // Keep the basic menu open even if element inspection is unavailable.
      }
    })
  }

  const handleRemoteScreenshotKeyDown = (event: React.KeyboardEvent<HTMLImageElement>): void => {
    if (isEditableKeyboardTarget(event.target)) {
      return
    }
    const target = runtimeTarget()
    const pageId = remotePageIdRef.current
    const operationToken = pageId ? createRemoteOperationToken(pageId) : null
    if (!target || !pageId || !operationToken) {
      return
    }
    const params = { worktree: runtimeWorktree, page: pageId }
    const key = getRemoteBrowserKeyboardShortcut(event) ?? getRemoteBrowserKeypressKey(event)
    if (!key) {
      return
    }
    event.preventDefault()
    setRemoteError(null)
    enqueueRemoteInput(async () => {
      if (!isCurrentRemoteOperationToken(operationToken)) {
        return
      }
      try {
        await callRuntimeRpc(
          target,
          'browser.keypress',
          { ...params, key },
          { timeoutMs: 15_000, suppressFeatureInteraction: true }
        )
        if (
          key === 'Enter' ||
          key === 'Meta+r' ||
          key === 'Meta+Shift+r' ||
          key === 'Control+r' ||
          key === 'Control+Shift+r'
        ) {
          scheduleRemoteTabInfoRefresh(operationToken, 400)
        }
      } catch (error) {
        if (isCurrentRemoteOperationToken(operationToken)) {
          if (isRemoteBrowserPageMissingError(error)) {
            closeMissingRemotePage(pageId)
            return
          }
          setRemoteError(error instanceof Error ? error.message : 'Remote keyboard input failed.')
        }
      }
    })
  }

  const schedulePendingRemoteWheel = useCallback((): void => {
    if (remoteWheelFrameRef.current !== null || remoteWheelInFlightRef.current) {
      return
    }
    remoteWheelFrameRef.current = window.requestAnimationFrame(() => {
      remoteWheelFrameRef.current = null
      const pending = pendingRemoteWheelRef.current
      if (!pending || remoteWheelInFlightRef.current) {
        return
      }
      pendingRemoteWheelRef.current = null
      remoteWheelInFlightRef.current = true
      const { target, pageId, operationToken, point, dx, dy } = pending
      const params = { worktree: runtimeWorktree, page: pageId }
      void enqueueRemoteInput(async () => {
        if (!isCurrentRemoteOperationToken(operationToken)) {
          return
        }
        try {
          await callRuntimeRpc(
            target,
            'browser.mouseMove',
            { ...params, x: point.x, y: point.y },
            { timeoutMs: 15_000, suppressFeatureInteraction: true }
          )
          await callRuntimeRpc(
            target,
            'browser.mouseWheel',
            {
              ...params,
              dx,
              dy
            },
            { timeoutMs: 15_000, suppressFeatureInteraction: true }
          )
          scheduleRemoteTabInfoRefresh(operationToken, 400)
        } catch (error) {
          if (isCurrentRemoteOperationToken(operationToken)) {
            if (isRemoteBrowserPageMissingError(error)) {
              closeMissingRemotePage(pageId)
              return
            }
            setRemoteError(error instanceof Error ? error.message : 'Remote scroll failed.')
          }
        }
      }).finally(() => {
        remoteWheelInFlightRef.current = false
        if (pendingRemoteWheelRef.current) {
          schedulePendingRemoteWheel()
        }
      })
    })
  }, [
    closeMissingRemotePage,
    enqueueRemoteInput,
    isCurrentRemoteOperationToken,
    scheduleRemoteTabInfoRefresh,
    runtimeWorktree
  ])

  const handleRemoteScreenshotWheel = useCallback(
    (event: WheelEvent): void => {
      if (busy) {
        event.preventDefault()
        return
      }
      const target = runtimeTarget()
      const pageId = remotePageIdRef.current
      const operationToken = pageId ? createRemoteOperationToken(pageId) : null
      const point = getRemoteImagePoint(event)
      if (!target || !pageId || !operationToken || !point) {
        return
      }
      event.preventDefault()
      setRemoteError(null)
      const deltaMultiplier =
        event.deltaMode === WHEEL_DELTA_LINE
          ? 16
          : event.deltaMode === WHEEL_DELTA_PAGE
            ? (remoteViewportRef.current?.clientHeight ?? 800)
            : 1
      const dx = Math.round(event.deltaX * deltaMultiplier)
      const dy = Math.round(event.deltaY * deltaMultiplier)
      if (dx === 0 && dy === 0) {
        return
      }
      const current = pendingRemoteWheelRef.current
      const sameTarget =
        current?.target.environmentId === target.environmentId &&
        current.pageId === pageId &&
        current.operationToken.generation === operationToken.generation
      pendingRemoteWheelRef.current = sameTarget
        ? {
            ...current,
            point,
            dx: current.dx + dx,
            dy: current.dy + dy
          }
        : {
            target,
            pageId,
            operationToken,
            point,
            dx,
            dy
          }
      schedulePendingRemoteWheel()
    },
    [
      busy,
      createRemoteOperationToken,
      getRemoteImagePoint,
      runtimeTarget,
      schedulePendingRemoteWheel
    ]
  )

  useEffect(() => {
    const image = imageRef.current
    if (!image || !frameUrl) {
      return
    }
    // Why: React binds wheel listeners passively in Chromium, so bind natively non-passive to preventDefault scroll.
    image.addEventListener('wheel', handleRemoteScreenshotWheel, { passive: false })
    return () => image.removeEventListener('wheel', handleRemoteScreenshotWheel)
  }, [frameUrl, handleRemoteScreenshotWheel])

  const remoteFrameStyle = useMemo(() => getRemoteBrowserFrameStyle(frameMetadata), [frameMetadata])
  const remoteFailureUrl = browserTab.loadError?.validatedUrl ?? browserTab.url
  const remoteFailureExternalUrl = resolveRemoteFailureExternalUrl(remoteFailureUrl)
  const showRemoteFailureOverlay =
    Boolean(browserTab.loadError) &&
    remoteFailureUrl !== 'about:blank' &&
    remoteFailureUrl !== ORCA_BROWSER_BLANK_URL

  // Why: markup snapshots the displayed screencast <img> (no injection), so it works on remote panes even though element-grab doesn't.
  const markup = useMarkupMode({
    getCaptureContext: useCallback((): MarkupCaptureContext | null => {
      const element = imageRef.current
      const container = remoteViewportRef.current
      if (!element || !container) {
        return null
      }
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        return null
      }
      return {
        source: { kind: 'image', element },
        cssWidth: rect.width,
        cssHeight: rect.height,
        outputScale: window.devicePixelRatio || 1
      }
    }, []),
    onDeliver: deliverMarkupToClipboard
  })

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background">
      {contextMenu
        ? createPortal(
            <>
              <div className="fixed inset-0 z-50" onPointerDown={() => setContextMenu(null)} />
              <div
                ref={contextMenuRef}
                role="menu"
                data-testid="remote-browser-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                className="fixed z-50 min-w-[13rem] overflow-hidden rounded-[11px] border border-black/14 bg-[rgba(255,255,255,0.82)] p-1 text-black shadow-[0_16px_36px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl dark:border-white/14 dark:bg-[rgba(0,0,0,0.72)] dark:text-white dark:shadow-[0_20px_44px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.04)]"
              >
                {contextMenu.linkUrl ? (
                  <>
                    <button
                      role="menuitem"
                      className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                      onClick={() => {
                        createBrowserTab(worktreeId, contextMenu.linkUrl!, {
                          title: contextMenu.linkUrl!
                        })
                        setContextMenu(null)
                      }}
                    >
                      {translate(
                        'auto.components.browser.pane.BrowserPane.b5b87d6cbb',
                        'Open Link In Orca Browser'
                      )}
                    </button>
                    <button
                      role="menuitem"
                      className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                      onClick={() => {
                        const targetUrl = normalizeExternalBrowserUrl(contextMenu.linkUrl!)
                        if (targetUrl) {
                          void window.api.shell.openUrl(targetUrl)
                        }
                        setContextMenu(null)
                      }}
                    >
                      {translate(
                        'auto.components.browser.pane.BrowserPane.8ce4f6b12e',
                        'Open Link In Default Browser'
                      )}
                    </button>
                    <button
                      role="menuitem"
                      className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                      onClick={() => {
                        void window.api.ui.writeClipboardText(contextMenu.linkUrl ?? '')
                        setContextMenu(null)
                      }}
                    >
                      {translate(
                        'auto.components.browser.pane.BrowserPane.efb0e8f7f3',
                        'Copy Link Address'
                      )}
                    </button>
                    <div className="my-1 h-px bg-border/70" />
                  </>
                ) : null}
                {contextMenu.selectionText.trim() ? (
                  <>
                    <button
                      role="menuitem"
                      className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                      onClick={() => {
                        void window.api.ui.writeClipboardText(contextMenu.selectionText)
                        setContextMenu(null)
                      }}
                    >
                      {translate('auto.components.browser.pane.BrowserPane.2a4c4b8e1f', 'Copy')}
                    </button>
                    <div className="my-1 h-px bg-border/70" />
                  </>
                ) : null}
                <button
                  role="menuitem"
                  className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                  onClick={() => {
                    void runRemoteNavigation('browser.back')
                    setContextMenu(null)
                  }}
                >
                  {translate('auto.components.browser.pane.BrowserPane.40edfa75cb', 'Back')}
                </button>
                <button
                  role="menuitem"
                  className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                  onClick={() => {
                    void runRemoteNavigation('browser.forward')
                    setContextMenu(null)
                  }}
                >
                  {translate('auto.components.browser.pane.BrowserPane.250a9b3e42', 'Forward')}
                </button>
                <button
                  role="menuitem"
                  className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                  onClick={() => {
                    void runRemoteNavigation('browser.reload')
                    setContextMenu(null)
                  }}
                >
                  {translate('auto.components.browser.pane.BrowserPane.0e080d820e', 'Reload')}
                </button>
                <div className="my-1 h-px bg-border/70" />
                <button
                  role="menuitem"
                  className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                  onClick={() => {
                    const targetUrl = normalizeExternalBrowserUrl(contextMenu.pageUrl)
                    if (targetUrl) {
                      void window.api.shell.openUrl(targetUrl)
                    }
                    setContextMenu(null)
                  }}
                >
                  {translate(
                    'auto.components.browser.pane.BrowserPane.f7ab83f7ed',
                    'Open Page In Default Browser'
                  )}
                </button>
                <button
                  role="menuitem"
                  className="relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 dark:hover:bg-white/14"
                  onClick={() => {
                    void window.api.ui.writeClipboardText(contextMenu.pageUrl)
                    setContextMenu(null)
                  }}
                >
                  {translate(
                    'auto.components.browser.pane.BrowserPane.1b179ab561',
                    'Copy Page URL'
                  )}
                </button>
              </div>
            </>,
            document.body
          )
        : null}
      <div
        className="relative z-10 flex items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-1.5"
        data-contextual-tour-target="browser-toolbar"
      >
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => void runRemoteNavigation('browser.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => void runRemoteNavigation('browser.forward')}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => void runRemoteNavigation('browser.reload')}
        >
          {busy || browserTab.loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </Button>
        <BrowserAddressBar
          value={addressBarValue}
          onChange={setAddressBarValue}
          onSubmit={submitAddressBar}
          onNavigate={navigateToUrl}
          inputRef={addressBarInputRef}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 opacity-50"
              aria-disabled="true"
              aria-label={translate(
                'auto.components.browser.pane.BrowserPane.deb5293610',
                'Browser annotations unavailable in remote runtime'
              )}
              onClick={(event) => {
                event.preventDefault()
              }}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {translate(
              'auto.components.browser.pane.BrowserPane.8b7e6d1f5a',
              'Browser annotations are only available in local browser tabs.'
            )}
          </TooltipContent>
        </Tooltip>
        <MarkupDrawButton
          onClick={() => (markup.isActive ? markup.cancel() : void markup.start())}
          disabled={!frameUrl}
          active={markup.isActive}
          surfaceActive={isActive}
          className="h-7 w-7"
        />
      </div>
      <div
        ref={remoteViewportRef}
        tabIndex={-1}
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
      >
        {markup.isActive && markup.baseImage ? (
          <MarkupOverlay
            baseImage={markup.baseImage}
            busy={markup.state === 'composing'}
            onComplete={(input) => void markup.complete(input)}
            onCancel={markup.cancel}
          />
        ) : null}
        {frameUrl ? (
          <img
            ref={imageRef}
            src={frameUrl}
            alt=""
            tabIndex={0}
            style={remoteFrameStyle}
            className="absolute top-0 left-0 max-w-none cursor-default bg-white outline-none"
            onPointerDown={handleRemotePointerDown}
            onPointerUp={handleRemotePointerUp}
            onContextMenu={handleRemoteContextMenu}
            onKeyDown={handleRemoteScreenshotKeyDown}
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="flex max-w-sm flex-col items-center gap-2">
              {busy ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              ) : (
                <Globe className="size-5 text-muted-foreground" />
              )}
              <div className="text-sm font-medium text-foreground">
                {busy
                  ? translate(
                      'auto.components.browser.pane.BrowserPane.b313a7275b',
                      'Opening remote browser'
                    )
                  : translate(
                      'auto.components.browser.pane.BrowserPane.572046436a',
                      'Remote browser'
                    )}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {translate(
                  'auto.components.browser.pane.BrowserPane.bbe8f15e83',
                  'This pane is rendered from the active runtime server.'
                )}
              </div>
            </div>
          </div>
        )}
        {showRemoteFailureOverlay && browserTab.loadError ? (
          <BrowserLoadFailureOverlay
            loadError={browserTab.loadError}
            externalUrl={remoteFailureExternalUrl}
            currentUrl={toDisplayUrl(remoteFailureUrl)}
            httpsRecoveryUrl={toHttpsRecoveryUrl(remoteFailureUrl)}
            onRetry={() => void runRemoteNavigation('browser.reload')}
            onTryHttps={(url) => void runRemoteNavigation('browser.goto', url)}
            onCopy={(url) => void window.api.ui.writeClipboardText(url)}
            onOpenExternal={(url) => void window.api.shell.openUrl(url)}
            certificateFailure={remoteCertificateTrustSupported ? certificateFailure : null}
            expectedBrowserPageId={
              remotePageHandle?.environmentId === activeRuntimeEnvironmentId
                ? remotePageHandle.remotePageId
                : null
            }
            onProceedCertificate={async (challengeId) => {
              const target = runtimeTarget()
              if (
                !target ||
                remotePageHandle?.environmentId !== target.environmentId ||
                remotePageHandle.remotePageId !== certificateFailure?.browserPageId
              ) {
                return { ok: false, reason: 'missing' }
              }
              return callRuntimeRpc<BrowserCertificateProceedResult>(
                target,
                'browser.certificate.proceed',
                {
                  worktree: runtimeWorktree,
                  page: remotePageHandle.remotePageId,
                  challengeId
                },
                { timeoutMs: 15_000, suppressFeatureInteraction: true }
              )
            }}
          />
        ) : null}
        {remoteError ? (
          <div className="absolute bottom-4 left-1/2 max-w-md -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
            {remoteError}
          </div>
        ) : null}
      </div>
    </div>
  )
}
