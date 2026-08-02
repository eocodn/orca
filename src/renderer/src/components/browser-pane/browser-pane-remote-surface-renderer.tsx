/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- The controller owns external runtime state; this file only composes its view. */
import { RemoteBrowserContextMenu } from './browser-pane-remote-context-menu'
import { RemoteBrowserToolbar } from './browser-pane-remote-toolbar'
import { RemoteBrowserViewport } from './browser-pane-remote-viewport'
import type { RemoteBrowserSurfaceRenderContext } from './browser-pane-remote-surface-render-types'

export function RemoteBrowserPagePaneView({
  context
}: {
  context: RemoteBrowserSurfaceRenderContext
}): React.JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background">
      <RemoteBrowserContextMenu
        contextMenu={context.contextMenu}
        contextMenuRef={context.contextMenuRef}
        createBrowserTab={context.createBrowserTab}
        runRemoteNavigation={context.runRemoteNavigation}
        setContextMenu={context.setContextMenu}
        worktreeId={context.worktreeId}
      />
      <RemoteBrowserToolbar
        addressBarInputRef={context.addressBarInputRef}
        addressBarValue={context.addressBarValue}
        browserTab={context.browserTab}
        busy={context.busy}
        frameUrl={context.frameUrl}
        isActive={context.isActive}
        markup={context.markup}
        navigateToUrl={context.navigateToUrl}
        runRemoteNavigation={context.runRemoteNavigation}
        setAddressBarValue={context.setAddressBarValue}
        submitAddressBar={context.submitAddressBar}
      />
      <RemoteBrowserViewport
        browserTab={context.browserTab}
        busy={context.busy}
        certificateFailure={context.certificateFailure}
        frameUrl={context.frameUrl}
        handleRemoteContextMenu={context.handleRemoteContextMenu}
        handleRemotePointerDown={context.handleRemotePointerDown}
        handleRemotePointerUp={context.handleRemotePointerUp}
        handleRemoteScreenshotKeyDown={context.handleRemoteScreenshotKeyDown}
        imageRef={context.imageRef}
        markup={context.markup}
        onProceedCertificate={context.onProceedCertificate}
        remoteCertificateTrustSupported={context.remoteCertificateTrustSupported}
        remoteError={context.remoteError}
        remoteFailureExternalUrl={context.remoteFailureExternalUrl}
        remoteFailureUrl={context.remoteFailureUrl}
        remoteFrameStyle={context.remoteFrameStyle}
        remotePageHandle={context.remotePageHandle}
        remoteViewportRef={context.remoteViewportRef}
        runRemoteNavigation={context.runRemoteNavigation}
        runtimeTarget={context.runtimeTarget}
        runtimeWorktree={context.runtimeWorktree}
        showRemoteFailureOverlay={context.showRemoteFailureOverlay}
      />
    </div>
  )
}
