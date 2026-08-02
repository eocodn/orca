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


export function RemoteBrowserPagePaneView({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    activeRuntimeEnvironmentId,
    activeRuntimeEnvironmentIdRef,
    activeStreamTokenRef,
    activeToken,
    addressBarInputRef,
    addressBarValue,
    applyRemoteTabInfo,
    browserTab,
    busy,
    button,
    cachedTab,
    cachedToken,
    certificateChallengeId,
    certificateFailure,
    clearPendingRemoteWheel,
    clearStreamFrame,
    closeBrowserPage,
    closeBrowserTab,
    closeMissingRemotePage,
    container,
    contextMenu,
    contextMenuRef,
    createBrowserTab,
    createRemoteOperationToken,
    createRemotePage,
    created,
    current,
    currentBrowserTabIdRef,
    currentBrowserTabUrlRef,
    currentEnvironmentId,
    currentUrl,
    decodeGeneration,
    deltaMultiplier,
    detail,
    dx,
    dy,
    el,
    element,
    enqueueRemoteInput,
    ensureRemotePage,
    event,
    existingHandle,
    fetchRemoteTabInfo,
    fetchRemoteTabInfoRef,
    focusTarget,
    frame,
    frameMetadata,
    frameUrl,
    getRemoteImagePoint,
    handleBrowserFocusRequest,
    handleKeyDown,
    handleRemoteContextMenu,
    handleRemotePointerDown,
    handleRemotePointerUp,
    handleRemoteScreenshotKeyDown,
    handleRemoteScreenshotWheel,
    handleRemoteStreamClosed,
    image,
    imageBuffer,
    imageRef,
    initialUrl,
    isActive,
    isActiveRef,
    isCurrentRemoteOperationToken,
    isCurrentRemoteStreamOperation,
    isCurrentRemoteStreamToken,
    kagiSessionLink,
    key,
    keybindings,
    markup,
    message,
    method,
    mountedRef,
    navigateToUrl,
    next,
    nextUrl,
    nextViewportSize,
    observer,
    offsetX,
    offsetY,
    onSetUrl,
    onUpdatePageState,
    operationToken,
    pageId,
    pageStillExists,
    pageToken,
    params,
    parsed,
    pending,
    pendingFrameDecodeRef,
    pendingRemoteWheelRef,
    point,
    prev,
    prevUrl,
    readCurrentRemoteViewportSize,
    readRemoteViewportSize,
    rect,
    rememberRemoteViewportSize,
    remoteCertificateEnvironmentId,
    remoteCertificateTrustSupported,
    remoteCssViewportSizeRef,
    remoteError,
    remoteFailureExternalUrl,
    remoteFailureUrl,
    remoteFrameStyle,
    remoteInputQueueRef,
    remoteOperationGenerationRef,
    remotePageHandle,
    remotePageId,
    remotePageIdRef,
    remoteStreamViewportSizeRef,
    remoteTabRefreshTimerRef,
    remoteViewportRef,
    remoteViewportSizeRef,
    remoteViewportTimerRef,
    remoteWheelFrameRef,
    remoteWheelInFlightRef,
    removedHandle,
    restartRemoteStreamForViewport,
    restartRemoteStreamForViewportRef,
    result,
    runRemoteNavigation,
    runtimeEnvironmentId,
    runtimeTarget,
    runtimeWorktree,
    safeUrl,
    sameTarget,
    schedulePendingRemoteWheel,
    scheduleRemoteStreamRestart,
    scheduleRemoteTabInfoRefresh,
    scheduleSync,
    searchEngine,
    setAddressBarValue,
    setBusy,
    setContextMenu,
    setFrameMetadata,
    setFrameUrl,
    setRemoteBrowserPageHandle,
    setRemoteCertificateTrustSupported,
    setRemoteError,
    shortcutPlatform,
    showRemoteFailureOverlay,
    shown,
    size,
    startRemoteStream,
    startRemoteStreamRef,
    state,
    status,
    streamFrameUrlRef,
    streamGenerationRef,
    streamRestartTimerRef,
    streamSubscriptionRef,
    submitAddressBar,
    subscription,
    syncRemoteViewport,
    tab,
    target,
    token,
    updateStreamFrame,
    viewport,
    viewportHeight,
    viewportSize,
    viewportWidth,
    waitForRemoteViewportSize,
    workspacePageCount,
    worktreeId,
  } = context

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
