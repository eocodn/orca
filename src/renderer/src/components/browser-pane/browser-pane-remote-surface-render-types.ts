import type { RefObject } from 'react'
import type {
  BrowserCertificateFailure,
  BrowserCertificateProceedResult,
  BrowserPage as BrowserPageState
} from '../../../../shared/types'
import type { BrowserScreencastFrameMetadata } from '../../../../shared/browser-screencast-protocol'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type {
  BrowserTabPageState,
  RemoteBrowserContextMenu
} from './browser-pane-remote-model'
import type { MarkupModeController } from './markup/useMarkupMode'

export type RemoteNavigationMethod =
  | 'browser.goto'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'

export type RemoteBrowserSurfaceRenderContext = {
  activeRuntimeEnvironmentId: string
  addressBarInputRef: RefObject<HTMLInputElement | null>
  addressBarValue: string
  browserTab: BrowserPageState
  busy: boolean
  certificateChallengeId: string | null
  certificateFailure: BrowserCertificateFailure | null
  contextMenu: RemoteBrowserContextMenu | null
  contextMenuRef: RefObject<HTMLDivElement | null>
  createBrowserTab: (
    workspaceId: string,
    url: string,
    options?: { title?: string }
  ) => unknown
  frameMetadata: BrowserScreencastFrameMetadata | null
  frameUrl: string | null
  handleRemoteContextMenu: (event: React.MouseEvent<HTMLImageElement>) => void
  handleRemotePointerDown: (event: React.PointerEvent<HTMLImageElement>) => void
  handleRemotePointerUp: (event: React.PointerEvent<HTMLImageElement>) => void
  handleRemoteScreenshotKeyDown: (event: React.KeyboardEvent<HTMLImageElement>) => void
  imageRef: RefObject<HTMLImageElement | null>
  isActive: boolean
  markup: MarkupModeController
  navigateToUrl: (url: string) => void
  onSetUrl: (tabId: string, url: string) => void
  onProceedCertificate: (challengeId: string) => Promise<BrowserCertificateProceedResult>
  onUpdatePageState: (tabId: string, updates: BrowserTabPageState) => void
  remoteError: string | null
  remoteFailureExternalUrl: string | null
  remoteFailureUrl: string
  remoteFrameStyle: React.CSSProperties
  remotePageHandle: { environmentId: string; remotePageId: string } | null
  remoteViewportRef: RefObject<HTMLDivElement | null>
  remoteCertificateTrustSupported: boolean
  runRemoteNavigation: (method: RemoteNavigationMethod, url?: string) => void
  runtimeTarget: () => RuntimeClientTarget | null
  runtimeWorktree: string
  worktreeId: string
  setAddressBarValue: (value: string) => void
  setContextMenu: (value: RemoteBrowserContextMenu | null) => void
  showRemoteFailureOverlay: boolean
  submitAddressBar: () => void
}

export type CertificateProceedHandler = (
  challengeId: string
) => Promise<BrowserCertificateProceedResult>
