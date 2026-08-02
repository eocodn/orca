import type { IDisposable } from '@xterm/xterm'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { ParsedAgentStatusPayload } from '../../../../shared/agent-status-types'
import type { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import type { GlobalSettings, SetupSplitDirection, TerminalLayoutSnapshot } from '../../../../shared/types'
import type { PaneCwdMap } from './resolve-split-cwd'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PaneExternalDropHandler, PaneExternalDropResolver } from '@/lib/pane-manager/pane-manager'
import type { DirectSshPaneRetryAttemptId } from '@/store/slices/direct-ssh-terminal-recovery'
import type { EffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/detect-option-as-alt'
import type { PtyTransport } from './pty-transport'
import type { PtyTransportRecoveryState } from './pty-transport-types'
import type { ReplayingPanesRef } from './replay-guard'
import type { LinkHandlerDeps } from './terminal-link-handlers'
import type { TerminalLinkRoutingPreferenceRequester } from './terminal-url-link-hit-testing'
import type { SessionRestoredBannerReason } from './session-restored-banner-pane-state'
import type { PtyConnectionDeps } from './pty-connection-types'

export type TerminalPaneLifecycleDeps = {
  tabId: string
  worktreeId: string
  cwd?: string
  startup?: PtyConnectionDeps['startup']
  setupSplit?: { command: string; env?: Record<string, string>; direction: SetupSplitDirection } | null
  issueCommandSplit?: { command: string; env?: Record<string, string> } | null
  isActive: boolean
  isVisible: boolean
  systemPrefersDark: boolean
  settings: GlobalSettings | null | undefined
  settingsRef: RefObject<GlobalSettings | null | undefined>
  requestOpenLinksInAppPreference: TerminalLinkRoutingPreferenceRequester
  effectiveMacOptionAsAlt: EffectiveMacOptionAsAlt
  effectiveMacOptionAsAltRef: RefObject<EffectiveMacOptionAsAlt>
  initialLayoutRef: RefObject<TerminalLayoutSnapshot>
  managerRef: RefObject<PaneManager | null>
  containerRef: RefObject<HTMLDivElement | null>
  expandedStyleSnapshotRef: MutableRefObject<Map<HTMLElement, { display: string; flex: string }>>
  paneFontSizesRef: RefObject<Map<number, number>>
  paneTransportsRef: RefObject<Map<number, PtyTransport>>
  paneCwdRef: RefObject<PaneCwdMap>
  paneMode2031Ref: RefObject<Map<number, boolean>>
  paneKittyKeyboardModesRef: RefObject<Map<number, TerminalKittyKeyboardModeTracker>>
  paneLastThemeModeRef: RefObject<Map<number, 'dark' | 'light'>>
  panePtyBindingsRef: RefObject<Map<number, IDisposable>>
  replayingPanesRef: ReplayingPanesRef
  isActiveRef: RefObject<boolean>
  isVisibleRef: RefObject<boolean>
  onPtyExitRef: RefObject<(ptyId: string) => void>
  onAgentExitedRef: RefObject<(leafId: string) => void>
  onPtyErrorRef?: RefObject<(paneId: number, message: string) => void>
  onPtyRecoveryStateRef?: RefObject<
    (paneId: number, state: PtyTransportRecoveryState | null) => void
  >
  clearTabPtyId: (tabId: string, ptyId: string) => void
  consumeSuppressedPtyExit: (ptyId: string) => boolean
  isPtyShutdownPending: (ptyId: string) => boolean
  updateTabTitle: (tabId: string, title: string) => void
  setRuntimePaneTitle: (tabId: string, paneId: number, title: string) => void
  clearRuntimePaneTitle: (tabId: string, paneId: number) => void
  updateTabPtyId: (
    tabId: string,
    ptyId: string,
    replacedPtyId?: string,
    directSshRetryAttemptId?: DirectSshPaneRetryAttemptId
  ) => void
  markWorktreeUnread: (worktreeId: string) => void
  markTerminalTabUnread: (tabId: string) => void
  markTerminalPaneUnread: (paneKey: string) => void
  clearWorktreeUnread: (worktreeId: string) => void
  clearTerminalTabUnread: (tabId: string) => void
  clearTerminalPaneUnread: (paneKey: string) => void
  onShowSessionRestoredBanner: (paneId: number, reason?: SessionRestoredBannerReason) => void
  dispatchNotification: (event: {
    source: 'terminal-bell' | 'agent-task-complete'
    terminalTitle?: string
    paneKey?: string
    agentStatusSnapshot?: ParsedAgentStatusPayload
    suppressOsNotification?: boolean
  }) => void
  setCacheTimerStartedAt: (key: string, ts: number | null) => void
  syncPanePtyLayoutBinding: (paneId: number, ptyId: string | null) => void
  clearExitedPanePtyLayoutBinding: (paneId: number, exitedPtyId: string) => void
  setTabPaneExpanded: (tabId: string, expanded: boolean) => void
  setTabCanExpandPane: (tabId: string, canExpand: boolean) => void
  setExpandedPane: (paneId: number | null) => void
  syncExpandedLayout: () => void
  persistLayoutSnapshot: () => void
  setPaneTitles: Dispatch<SetStateAction<Record<number, string>>>
  paneTitlesRef: RefObject<Record<number, string>>
  setRenamingPaneId: Dispatch<SetStateAction<number | null>>
  setPaneCount: Dispatch<SetStateAction<number>>
  setPaneLayoutRevision: Dispatch<SetStateAction<number>>
  resolveExternalPaneDropTarget?: PaneExternalDropResolver
  onExternalPaneDrop?: PaneExternalDropHandler
}

export type TerminalPaneLifecycleRefs = {
  systemPrefersDarkRef: MutableRefObject<boolean>
  previousVisibleForReconcileRef: MutableRefObject<TerminalPaneVisibilitySnapshot | null>
  linkProviderDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  terminalHandleLinkDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  linkifierClickPrimingDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  fileLinkClickFallbackDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  httpLinkClickFallbackDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  selectionDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  selectionCaptureTimersRef: MutableRefObject<Map<number, number>>
  osc52DisposablesRef: MutableRefObject<Map<number, IDisposable>>
  osc7DisposablesRef: MutableRefObject<Map<number, IDisposable>>
  mouseHideDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  imeCompositionDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  imeNativeTextForwarderDisposablesRef: MutableRefObject<Map<number, IDisposable>>
  queuedInitialCwdRef: MutableRefObject<string | null | undefined>
  restoredViewportBlankingPanesRef: MutableRefObject<Set<number>>
}

export type TerminalPaneVisibilitySnapshot = {
  tabId: string
  cwd: string | null | undefined
  isVisible: boolean
}

export type TerminalPaneLifecycleContext = {
  deps: TerminalPaneLifecycleDeps
  refs: TerminalPaneLifecycleRefs
  terminalScrollbackRows: number
  applyAppearance: (manager: PaneManager) => void
  startupCwd: string
  defaultTabCwd: string
  worktreePath: string
  terminalHomePath: string | null
  getPaneLinkCwd: (paneId: number) => string
  linkDeps: LinkHandlerDeps
  ptyDeps: PtyConnectionDeps
  queueResizeAll: (focusActive: boolean) => void
  cancelResizeAll: () => void
  syncCanExpandState: () => void
  syncPaneCount: () => void
  syncPaneLayoutRevision: () => void
  getUrlOpenLinkHint: () => string
  fileOpenLinkHint: string
  osc7UncHost: string | null
  shouldPersistLayout: { value: boolean }
}

export type TerminalPaneLifecycleSetupContext = Omit<
  TerminalPaneLifecycleContext,
  'ptyDeps'
>
