import { useCallback, useMemo } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { deliverMarkupToClipboard } from './markup/markup-clipboard-delivery'
import { useMarkupMode, type MarkupCaptureContext } from './markup/useMarkupMode'
import { getRemoteBrowserFrameStyle } from './remote-browser-frame-style'
import { resolveRemoteFailureExternalUrl } from '../../../../shared/browser-url'
import { ORCA_BROWSER_BLANK_URL } from '../../../../shared/constants'
import type { BrowserCertificateProceedResult, BrowserPage as BrowserPageState } from '../../../../shared/types'
import type { BrowserTabPageState } from './browser-pane-remote-model'
import { RemoteBrowserPagePaneView } from './browser-pane-remote-surface-renderer'
import { useRemoteBrowserSurfaceBase } from './browser-pane-remote-surface-base'
import { useRemoteBrowserSurfaceInput } from './browser-pane-remote-surface-input'
import { useRemoteBrowserSurfaceNavigation } from './browser-pane-remote-surface-navigation'
import { useRemoteBrowserSurfaceRuntime } from './browser-pane-remote-surface-runtime'

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
  const base = useRemoteBrowserSurfaceBase({ browserTab, runtimeEnvironmentId, worktreeId, isActive, onUpdatePageState, onSetUrl })
  const runtime = useRemoteBrowserSurfaceRuntime(base)
  const navigation = useRemoteBrowserSurfaceNavigation(base, runtime)
  const input = useRemoteBrowserSurfaceInput(base, runtime)
  const remoteFrameStyle = useMemo(() => getRemoteBrowserFrameStyle(base.frameMetadata), [base.frameMetadata])
  const remoteFailureUrl = browserTab.loadError?.validatedUrl ?? browserTab.url
  const remoteFailureExternalUrl = resolveRemoteFailureExternalUrl(remoteFailureUrl)
  const showRemoteFailureOverlay = Boolean(browserTab.loadError) && remoteFailureUrl !== 'about:blank' && remoteFailureUrl !== ORCA_BROWSER_BLANK_URL
  const markup = useMarkupMode({
    getCaptureContext: useCallback((): MarkupCaptureContext | null => {
      const element = base.imageRef.current
      const container = base.remoteViewportRef.current
      if (!element || !container) return null
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      return { source: { kind: 'image', element }, cssWidth: rect.width, cssHeight: rect.height, outputScale: window.devicePixelRatio || 1 }
    }, [base.imageRef, base.remoteViewportRef]),
    onDeliver: deliverMarkupToClipboard
  })
  const onProceedCertificate = useCallback(async (challengeId: string): Promise<BrowserCertificateProceedResult> => {
    const target = base.runtimeTarget()
    const handle = base.remotePageHandle
    if (!target || !handle || handle.environmentId !== target.environmentId || handle.remotePageId !== base.certificateFailure?.browserPageId) return { ok: false, reason: 'missing' }
    return callRuntimeRpc<BrowserCertificateProceedResult>(target, 'browser.certificate.proceed', { worktree: base.runtimeWorktree, page: handle.remotePageId, challengeId }, { timeoutMs: 15_000, suppressFeatureInteraction: true })
  }, [base])

  return (
    <RemoteBrowserPagePaneView context={{
        activeRuntimeEnvironmentId: base.activeRuntimeEnvironmentId,
        addressBarInputRef: base.addressBarInputRef,
        addressBarValue: base.addressBarValue,
        browserTab,
        busy: base.busy,
        certificateChallengeId: base.certificateFailure?.challengeId ?? null,
        certificateFailure: base.certificateFailure,
        contextMenu: base.contextMenu,
        contextMenuRef: base.contextMenuRef,
        createBrowserTab: base.createBrowserTab,
        frameMetadata: base.frameMetadata,
        frameUrl: base.frameUrl,
        handleRemoteContextMenu: input.handleRemoteContextMenu,
        handleRemotePointerDown: input.handleRemotePointerDown,
        handleRemotePointerUp: input.handleRemotePointerUp,
        handleRemoteScreenshotKeyDown: input.handleRemoteScreenshotKeyDown,
        imageRef: base.imageRef,
        isActive,
        markup,
        navigateToUrl: navigation.navigateToUrl,
        onProceedCertificate,
        onSetUrl,
        onUpdatePageState,
        remoteCertificateTrustSupported: base.remoteCertificateTrustSupported,
        remoteError: base.remoteError,
        remoteFailureExternalUrl,
        remoteFailureUrl,
        remoteFrameStyle,
        remotePageHandle: base.remotePageHandle,
        remoteViewportRef: base.remoteViewportRef,
        runRemoteNavigation: navigation.runRemoteNavigation,
        runtimeTarget: base.runtimeTarget,
        runtimeWorktree: base.runtimeWorktree,
        setAddressBarValue: base.setAddressBarValue,
        setContextMenu: base.setContextMenu,
        showRemoteFailureOverlay,
        submitAddressBar: navigation.submitAddressBar,
        worktreeId
      }}
    />
  )
}
