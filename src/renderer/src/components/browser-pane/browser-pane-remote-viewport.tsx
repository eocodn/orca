import { Globe, Loader2 } from 'lucide-react'
import { MarkupOverlay } from './markup/MarkupOverlay'
import { BrowserLoadFailureOverlay } from './browser-load-failure-overlay'
import { toDisplayUrl } from './browser-pane-remote-model'
import { toHttpsRecoveryUrl } from '../../../../shared/browser-url'
import { translate } from '@/i18n/i18n'
import type { RemoteBrowserSurfaceRenderContext } from './browser-pane-remote-surface-render-types'

export function RemoteBrowserViewport({
  browserTab,
  busy,
  certificateFailure,
  frameUrl,
  handleRemoteContextMenu,
  handleRemotePointerDown,
  handleRemotePointerUp,
  handleRemoteScreenshotKeyDown,
  imageRef,
  markup,
  onProceedCertificate,
  remoteCertificateTrustSupported,
  remoteError,
  remoteFailureExternalUrl,
  remoteFailureUrl,
  remoteFrameStyle,
  remotePageHandle,
  remoteViewportRef,
  runRemoteNavigation,
  runtimeTarget,
  runtimeWorktree,
  showRemoteFailureOverlay
}: Pick<RemoteBrowserSurfaceRenderContext, 'browserTab' | 'busy' | 'certificateFailure' | 'frameUrl' | 'handleRemoteContextMenu' | 'handleRemotePointerDown' | 'handleRemotePointerUp' | 'handleRemoteScreenshotKeyDown' | 'imageRef' | 'markup' | 'onProceedCertificate' | 'remoteCertificateTrustSupported' | 'remoteError' | 'remoteFailureExternalUrl' | 'remoteFailureUrl' | 'remoteFrameStyle' | 'remotePageHandle' | 'remoteViewportRef' | 'runRemoteNavigation' | 'runtimeTarget' | 'runtimeWorktree' | 'showRemoteFailureOverlay'>): React.JSX.Element {
  return (
    <div ref={remoteViewportRef} tabIndex={-1} className="relative min-h-0 flex-1 overflow-hidden bg-background">
      {markup.isActive && markup.baseImage ? <MarkupOverlay baseImage={markup.baseImage} busy={markup.state === 'composing'} onComplete={(input) => void markup.complete(input)} onCancel={markup.cancel} /> : null}
      {frameUrl ? <img ref={imageRef} src={frameUrl} alt="" tabIndex={0} style={remoteFrameStyle} className="absolute top-0 left-0 max-w-none cursor-default bg-white outline-none" onPointerDown={handleRemotePointerDown} onPointerUp={handleRemotePointerUp} onContextMenu={handleRemoteContextMenu} onKeyDown={handleRemoteScreenshotKeyDown} draggable={false} /> : <RemoteBrowserEmptyState busy={busy} />}
      {showRemoteFailureOverlay && browserTab.loadError ? <BrowserLoadFailureOverlay loadError={browserTab.loadError} externalUrl={remoteFailureExternalUrl} currentUrl={toDisplayUrl(remoteFailureUrl)} httpsRecoveryUrl={toHttpsRecoveryUrl(remoteFailureUrl)} onRetry={() => void runRemoteNavigation('browser.reload')} onTryHttps={(url) => void runRemoteNavigation('browser.goto', url)} onCopy={(url) => void window.api.ui.writeClipboardText(url)} onOpenExternal={(url) => void window.api.shell.openUrl(url)} certificateFailure={remoteCertificateTrustSupported ? certificateFailure : null} expectedBrowserPageId={remotePageHandle?.environmentId === runtimeTarget()?.environmentId ? remotePageHandle.remotePageId : null} onProceedCertificate={onProceedCertificate} /> : null}
      {remoteError ? <div className="absolute bottom-4 left-1/2 max-w-md -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">{remoteError}</div> : null}
    </div>
  )
}

function RemoteBrowserEmptyState({ busy }: { busy: boolean }): React.JSX.Element {
  return <div className="absolute inset-0 flex items-center justify-center px-6 text-center"><div className="flex max-w-sm flex-col items-center gap-2">{busy ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <Globe className="size-5 text-muted-foreground" />}<div className="text-sm font-medium text-foreground">{busy ? translate('auto.components.browser.pane.BrowserPane.b313a7275b', 'Opening remote browser') : translate('auto.components.browser.pane.BrowserPane.572046436a', 'Remote browser')}</div><div className="text-xs leading-5 text-muted-foreground">{translate('auto.components.browser.pane.BrowserPane.bbe8f15e83', 'This pane is rendered from the active runtime server.')}</div></div></div>
}
