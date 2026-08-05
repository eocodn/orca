import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Keyboard, Platform, ScrollView, TextInput } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useHostClient, useForceReconnect } from '../../../../src/transport/client-context'
import {
  useLastConnectedAt,
  useReconnectAttempt
} from '../../../../src/transport/client-context-connection-metrics'
import { useResponsiveLayout } from '../../../../src/layout/responsive-layout'
import { useMobilePrBranchContext } from '../../../../src/session/use-mobile-pr-branch-context'
import { isFloatingWorkspaceWorktreeId } from '../../../../src/session/floating-workspace'
import { useTerminalLiveInputModePreference } from '../../../../src/session/use-terminal-live-input-mode-preference'
import { useTerminalLiveInputCommit } from '../../../../src/terminal/use-terminal-live-input-commit'
import { resolveMobileTerminalInputGate } from '../../../../src/terminal/terminal-input-connection-gate'
import {
  HOST_DOCK_MIN_WIDTH,
  type MobileTerminalLinkOpenMode,
  saveTerminalTextScale
} from '../../../../src/storage/preferences'
import {
  getDefaultTerminalAccessoryBuiltInIds,
  getVisibleTerminalAccessoryKeys
} from '../../../../src/terminal/terminal-accessory-layout'
import { useWorktreeSessionTabsLoaded } from '../../../../src/session/use-initial-session-terminal-autocreate'
import { canDockSessionPanel } from '../../../../src/session/session-panel-host'
import type { AppliedSnapshotMarker } from '../../../../src/session/session-tab-snapshot-gate'
import { MobileTerminalDiagnostics } from '../../../../src/session/mobile-terminal-diagnostics'
import { useLiveWorktreeName } from '../../../../src/session/use-live-worktree-name'
import type { ConnectionState } from '../../../../src/transport/types'
import type { RpcClient } from '../../../../src/transport/rpc-client'
import type {
  TerminalWebViewHandle,
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes
} from '../../../../src/terminal/terminal-webview-contract'
import type { TerminalLiveInputSender } from '../../../../src/terminal/terminal-live-input-sender'
import type { CustomKey } from '../../../../src/components/CustomKeyModal'
import type {
  DiffNotesDelivery,
  DirtyMarkdownDraft,
  FileDocState,
  MarkdownDocState,
  MobileDisplayMode,
  MobileNewTabAgentLoadState,
  MobileSessionTab,
  MobileSessionTabType,
  Terminal,
  TerminalGestureInputBucket,
  TerminalGestureInputQueue
} from './mobile-session-route-types'
import type { DiffComment } from '../../../../../src/shared/types'
import type { MobileNewTabAgentOption } from '../../../../src/session/mobile-new-tab-agent-options'
import type { ActivePanel } from '../../../../src/session/session-panel-host'
import { createInitialSessionAutoCreateState } from '../../../../src/session/use-initial-session-terminal-autocreate'
import {
  createMobileSessionCreateWarningState,
  reconcileMobileSessionCreateWarningState
} from '../../../../src/session/mobile-session-create-warning-state'

export function useMobileSessionWorkspaceSetup() {
  const {
    hostId,
    worktreeId,
    name: routeWorktreeName,
    created,
    warning: createdWarning
  } = useLocalSearchParams<{
    hostId: string
    worktreeId: string
    name?: string
    created?: string
    warning?: string
  }>()
  const isFolderWorkspaceRoute = worktreeId.startsWith('folder:') // Synthetic ids have no repo scope.
  // Why: the floating sentinel has no repo/worktree, so repo-backed surfaces hide.
  const isFloatingWorkspaceRoute = isFloatingWorkspaceWorktreeId(worktreeId)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  // Why: shared client per host owned by RpcClientProvider (docs/mobile-shared-client-per-host.md).
  const { client, state: connState } = useHostClient(hostId)
  const reconnectAttempts = useReconnectAttempt(hostId)
  const lastConnectedAt = useLastConnectedAt(hostId)
  const forceReconnectHost = useForceReconnect()
  const worktreeName = useLiveWorktreeName({
    client,
    connState,
    routeName: routeWorktreeName,
    worktreeId
  })
  // Master-detail state: wide layouts dock a tapped panel beside the session; narrow keeps it null and pushes full-screen routes.
  const { isWideLayout } = useResponsiveLayout()
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [sessionContentRowWidth, setSessionContentRowWidth] = useState(0)
  const canDockPanel =
    !isFloatingWorkspaceRoute &&
    canDockSessionPanel({
      isWideLayout,
      availableWidth: sessionContentRowWidth,
      dockWidth: HOST_DOCK_MIN_WIDTH
    })
  // Why: if rotation/split-screen makes the docked row too narrow, clear activePanel so it doesn't survive into overlay/push mode.
  useEffect(() => {
    if (!canDockPanel && activePanel !== null) {
      setActivePanel(null)
    }
  }, [canDockPanel, activePanel])
  // GitHub remote probe gates the PR dock icon so non-GitHub providers can't open the hosted-review surface; skip the unused identity RPCs.
  const { isGithubRepo: prIsGithubRepo, repoLoaded: prRepoContextLoaded } =
    useMobilePrBranchContext({
      // Why: a null client parks the hook in its not-ready state — the floating
      // sentinel has no repo to probe.
      client: isFloatingWorkspaceRoute ? null : client,
      connState,
      worktreeId,
      includeBranchIdentity: false
    })
  useEffect(() => {
    if (prRepoContextLoaded && !prIsGithubRepo && activePanel === 'pr') {
      setActivePanel(null)
    }
  }, [activePanel, prRepoContextLoaded, prIsGithubRepo])
  const initialCreateWarning = typeof createdWarning === 'string' ? createdWarning.trim() : ''
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const terminalsRef = useRef<Terminal[]>([])
  const [sessionTabs, setSessionTabs] = useState<MobileSessionTab[]>([])
  const sessionTabsRef = useRef<MobileSessionTab[]>([])
  // Why: track the last applied (epoch, version) so a late older snapshot can't overwrite a newer one and resurrect closed tabs (session-tab-snapshot-gate).
  const appliedSnapshotMarkerRef = useRef<AppliedSnapshotMarker>({ epoch: null, version: -1 })
  const appliedSessionTabsRevisionRef = useRef(0)
  // Why: after an optimistic close, suppress the tab (with expiry) until the publisher confirms, so an in-flight snapshot can't flash it back.
  const closedTabTombstonesRef = useRef<Map<string, number>>(new Map())
  const [terminalsLoaded, setTerminalsLoaded] = useWorktreeSessionTabsLoaded(worktreeId)
  const [input, setInput] = useState('')
  // Why: baseline terminal zoom reloaded on focus so a Settings → Terminal change applies in place (panes stay mounted).
  const [terminalTextScale, setTerminalTextScale] = useState(1)
  // Why: terminal command-bar autocomplete opt-in, reloaded on focus so a Settings → Terminal toggle takes effect on return.
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false)
  const [terminalLinkOpenMode, setTerminalLinkOpenMode] =
    useState<MobileTerminalLinkOpenMode>('orca-browser')
  const [liveInputCapture, setLiveInputCapture] = useState('')
  const {
    clearTerminalLiveInputDefault,
    defaultTerminalHandlesToLiveInput,
    liveInputTerminalHandles,
    liveInputTerminalHandlesRef,
    pruneTerminalHandlesFromLiveInput,
    toggleTerminalLiveInput
  } = useTerminalLiveInputModePreference({ hostId, worktreeId })
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  const [activeSessionTabId, setActiveSessionTabId] = useState<string | null>(null)
  const activeSessionTabIdRef = useRef<string | null>(null)
  // Auto-scroll the tab strip so the desktop-synced active tab is revealed without a manual scroll.
  const tabStripRef = useRef<ScrollView>(null)
  const tabStripOffsetRef = useRef(0)
  const tabStripViewportWidthRef = useRef(0)
  const tabStripContentWidthRef = useRef(0)
  const tabLayoutsRef = useRef<Map<string, { x: number; width: number }>>(new Map())
  const [markdownDocs, setMarkdownDocs] = useState<Map<string, MarkdownDocState>>(new Map())
  const markdownDocsRef = useRef<Map<string, MarkdownDocState>>(new Map())
  const [fileDocs, setFileDocs] = useState<Map<string, FileDocState>>(new Map())
  const [diffComments, setDiffComments] = useState<DiffComment[]>([])
  const diffCommentsRef = useRef<DiffComment[]>([])
  const [diffCommentBusy, setDiffCommentBusy] = useState(false)
  const [pendingDiffNotesDelivery, setPendingDiffNotesDelivery] =
    useState<DiffNotesDelivery | null>(null)
  const [creating, setCreating] = useState(false)
  // Why: React state isn't a synchronous lock; this ref blocks a double-tap's second create in the same tick before `creating` re-renders.
  const creatingTerminalRef = useRef(false)
  const [creatingBrowser, setCreatingBrowser] = useState(false)
  const [creatingMarkdown, setCreatingMarkdown] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createWarningState, setCreateWarningState] = useState(() =>
    createMobileSessionCreateWarningState(initialCreateWarning)
  )
  const [showCreateTabDrawer, setShowCreateTabDrawer] = useState(false)
  const [showQuickCommands, setShowQuickCommands] = useState(false)
  const [createTabAgentLoadState, setCreateTabAgentLoadState] =
    useState<MobileNewTabAgentLoadState>('idle')
  const [createTabAgentOptions, setCreateTabAgentOptions] = useState<MobileNewTabAgentOption[]>([])
  const [showCreateBrowserModal, setShowCreateBrowserModal] = useState(false)
  const [showHeaderMoreActions, setShowHeaderMoreActions] = useState(false)
  const [actionTarget, setActionTarget] = useState<Terminal | null>(null)
  const [markdownActionTarget, setMarkdownActionTarget] = useState<Extract<
    MobileSessionTab,
    { type: 'markdown' }
  > | null>(null)
  const [fileActionTarget, setFileActionTarget] = useState<Extract<
    MobileSessionTab,
    { type: 'file' }
  > | null>(null)
  const [browserActionTarget, setBrowserActionTarget] = useState<Extract<
    MobileSessionTab,
    { type: 'browser' }
  > | null>(null)
  const [discardMarkdownTarget, setDiscardMarkdownTarget] = useState<Extract<
    MobileSessionTab,
    { type: 'markdown' }
  > | null>(null)
  const [leaveDrafts, setLeaveDrafts] = useState<DirtyMarkdownDraft[] | null>(null)
  const [renameTarget, setRenameTarget] = useState<Terminal | null>(null)
  const [customKeys, setCustomKeys] = useState<CustomKey[]>([])
  const [visibleBuiltInIds, setVisibleBuiltInIds] = useState<string[]>(
    getDefaultTerminalAccessoryBuiltInIds
  )
  const [showCustomKeyModal, setShowCustomKeyModal] = useState(false)
  const [deleteKeyTarget, setDeleteKeyTarget] = useState<CustomKey | null>(null)
  const visibleBuiltInAccessoryKeys = useMemo(
    () => getVisibleTerminalAccessoryKeys(visibleBuiltInIds),
    [visibleBuiltInIds]
  )
  // Why: Expo SDK 55 edge-to-edge doesn't resize the window on IME open, so track keyboard height ourselves and lift the input without resizing the desktop PTY.
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  // Why: server-authoritative display mode per terminal, populated from subscribe responses.
  const [terminalModes, setTerminalModes] = useState<Map<string, MobileDisplayMode>>(new Map())
  const [terminalKeyboardMetrics, setTerminalKeyboardMetrics] = useState<
    Map<string, TerminalKeyboardAvoidanceMetrics>
  >(new Map())
  const [selectModeActive, setSelectModeActive] = useState(false)
  const [canPaste, setCanPaste] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastOpacityRef = useRef(new Animated.Value(0))
  const toastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastSeqRef = useRef(0)
  // Why: WebView pushes terminal modes on every change so paste reads a synchronous snapshot — no round-trip.
  const ptyModesRef = useRef<Map<string, TerminalModes>>(new Map())
  const terminalGestureInputBucketsRef = useRef<Map<string, TerminalGestureInputBucket>>(new Map())
  const terminalGestureInputQueuesRef = useRef<Map<string, TerminalGestureInputQueue>>(new Map())
  const terminalGestureInputInFlightRef = useRef<Set<string>>(new Set())
  const terminalCwdRef = useRef<Map<string, string>>(new Map())
  const initialModesSeenRef = useRef<Set<string>>(new Set())
  const deviceTokenRef = useRef<string | null>(null)
  // Why: state (not a ref) so the connection verdict re-renders when the endpoint loads and the Tailscale hint can appear.
  const [hostEndpoint, setHostEndpoint] = useState<string | null>(null)
  const clientRef = useRef<RpcClient | null>(null)
  const connStateRef = useRef<ConnectionState>(connState)
  // Why: measured once on mount, then passed with every subscribe so the server can auto-fit the PTY to phone dims.
  const viewportRef = useRef<{ cols: number; rows: number } | null>(null)
  const viewportMeasuredRef = useRef(false)
  const terminalRefs = useRef<Map<string, TerminalWebViewHandle>>(new Map())
  const liveInputRef = useRef<TextInput>(null)
  const commandInputRef = useRef<TextInput>(null)
  const liveInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendLiveTerminalInputRef = useRef<TerminalLiveInputSender>(async () => false)
  const sessionTabActionSheetKeyboardHideSubRef = useRef<ReturnType<
    typeof Keyboard.addListener
  > | null>(null)
  const sessionTabActionSheetRequestSeqRef = useRef(0)
  const terminalUnsubsRef = useRef<Map<string, () => void>>(new Map())
  const subscribingHandlesRef = useRef<Set<string>>(new Set())
  const initializedHandlesRef = useRef<Set<string>>(new Set())
  const terminalDiagnosticsRef = useRef(new MobileTerminalDiagnostics())
  // Why: don't subscribe until the WebView fires web-ready so init() messages
  // are not queued before the document can render them.
  const webReadyHandlesRef = useRef<Set<string>>(new Set())
  const activeHandleRef = useRef<string | null>(null)
  const activeSessionTabTypeRef = useRef<MobileSessionTabType | null>(null)
  const pendingActiveSessionTabIdRef = useRef<string | null>(null)
  const pendingActiveTerminalHandleRef = useRef<string | null>(null)
  // Why: remember the page id to activate its session tab once it syncs (bridge auto-activate flags only webContents, not the app-level active tab).
  const pendingBrowserFocusPageIdRef = useRef<string | null>(null)
  const switchSessionTabRef = useRef<((tab: MobileSessionTab) => void) | null>(null)
  const pendingTerminalActivationAttemptRef = useRef<string | null>(null)
  // Why: route the terminal URL tap through a ref so it runs the current handleCreateBrowser closure (the memoized one may hold a null-client render).
  const handleCreateBrowserRef = useRef<((rawUrl?: string) => Promise<boolean>) | null>(null)

  const initialSessionAutoCreateRef = useRef(createInitialSessionAutoCreateState())
  const markdownSaveSeqRef = useRef<Map<string, number>>(new Map())
  const markdownSaveInFlightRef = useRef<Set<string>>(new Set())
  const subscribeSeqRef = useRef<Map<string, number>>(new Map())
  // Why: post-RPC refresh timers capture this screen and must not survive route reuse or unmount.
  const delayedActionTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  // Why: highest applyLayout seq seen per handle; drop older scrollback/resized as stale, but a >20 gap resets (fresh subscription/server restart).
  const layoutSeqRef = useRef<Map<string, number>>(new Map())
  const sendingRef = useRef(false)
  // Why: exact terminal-frame height for measureFitDimensions; window.innerHeight can overstate the visible area.
  const terminalFrameHeightRef = useRef<number>(0)
  // Why: sidebar resizes change the terminal frame width without a window-dim change; track it so the refit hook re-fits (see terminal-viewport-refit.ts).
  const [terminalFrameWidth, setTerminalFrameWidth] = useState(0)
  const activeSessionTab = sessionTabs.find((tab) => tab.id === activeSessionTabId) ?? null
  const {
    clearPendingLiveInputCommit,
    flushPendingLiveInputBeforeExternalSend,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit
  } = useTerminalLiveInputCommit({
    activeHandle,
    activeHandleRef,
    activeSessionTabType: activeSessionTab?.type,
    activeSessionTabTypeRef,
    connected: connState === 'connected',
    liveInputRef,
    liveInputTerminalHandles,
    liveInputTerminalHandlesRef,
    sendLiveTerminalInputRef,
    setLiveInputCapture
  })
  const { canCompose, canSend } = resolveMobileTerminalInputGate({
    connState,
    activeHandle,
    activeSessionTabType: activeSessionTab?.type
  })
  const [browserScreencastSupported, setBrowserScreencastSupported] = useState<boolean | null>(null)
  // Why: hosts without aiVault.v1 reject listSessions, so hide the header entry instead of a dead-end "update this host" panel.
  const [agentSessionHistorySupported, setAgentSessionHistorySupported] = useState<boolean | null>(
    null
  )
  const [quickCommandsSupported, setQuickCommandsSupported] = useState<boolean | null>(null)
  // Why: stable callbacks (handleFileTap) read the live value via this ref, since
  // the capability probe resolves after the callbacks are created.
  const browserScreencastSupportedRef = useRef(browserScreencastSupported)
  browserScreencastSupportedRef.current = browserScreencastSupported
  // Why: terminal gesture/input callbacks are stable/imperative, so keep their refs current before commit, not in a later effect.
  clientRef.current = client
  connStateRef.current = connState
  activeSessionTabTypeRef.current = activeSessionTab?.type ?? null
  sessionTabsRef.current = sessionTabs
  activeSessionTabIdRef.current = activeSessionTabId
  markdownDocsRef.current = markdownDocs
  const reconciledCreateWarningState = reconcileMobileSessionCreateWarningState(
    createWarningState,
    initialCreateWarning
  )
  // Why: Expo can reuse this screen for a new route; reconcile before paint so a dismissed old warning doesn't flash.
  if (reconciledCreateWarningState !== createWarningState) {
    setCreateWarningState(reconciledCreateWarningState)
  }
  const createWarning = reconciledCreateWarningState.visible

  const clearDelayedActionTimers = useCallback(() => {
    for (const timer of delayedActionTimersRef.current) {
      clearTimeout(timer)
    }
    delayedActionTimersRef.current.clear()
  }, [])

  const scheduleDelayedAction = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      delayedActionTimersRef.current.delete(timer)
      fn()
    }, ms)
    delayedActionTimersRef.current.add(timer)
  }, [])

  const clearToastHideTimer = useCallback(() => {
    if (!toastHideTimerRef.current) {
      return
    }
    clearTimeout(toastHideTimerRef.current)
    toastHideTimerRef.current = null
  }, [])

  const showToast = useCallback(
    (message: string, durationMs = 1200) => {
      const seq = toastSeqRef.current + 1
      toastSeqRef.current = seq
      clearToastHideTimer()
      setToastMessage(message)
      Animated.timing(toastOpacityRef.current, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true
      }).start(({ finished }) => {
        if (!finished || toastSeqRef.current !== seq) {
          return
        }
        toastHideTimerRef.current = setTimeout(() => {
          toastHideTimerRef.current = null
          Animated.timing(toastOpacityRef.current, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true
          }).start((result) => {
            if (result.finished && toastSeqRef.current === seq) {
              setToastMessage(null)
            }
          })
        }, durationMs)
      })
    },
    [clearToastHideTimer]
  )
  useEffect(() => {
    diffCommentsRef.current = diffComments
  }, [diffComments])

  return {
    hostId,
    worktreeId,
    routeWorktreeName,
    created,
    createdWarning,
    isFolderWorkspaceRoute,
    isFloatingWorkspaceRoute,
    router,
    insets,
    client,
    connState,
    reconnectAttempts,
    lastConnectedAt,
    forceReconnectHost,
    worktreeName,
    isWideLayout,
    activePanel,
    setActivePanel,
    sessionContentRowWidth,
    setSessionContentRowWidth,
    canDockPanel,
    prIsGithubRepo,
    prRepoContextLoaded,
    initialCreateWarning,
    terminals,
    setTerminals,
    terminalsRef,
    sessionTabs,
    setSessionTabs,
    sessionTabsRef,
    appliedSnapshotMarkerRef,
    appliedSessionTabsRevisionRef,
    closedTabTombstonesRef,
    terminalsLoaded,
    setTerminalsLoaded,
    input,
    setInput,
    terminalTextScale,
    setTerminalTextScale,
    autocompleteEnabled,
    setAutocompleteEnabled,
    terminalLinkOpenMode,
    setTerminalLinkOpenMode,
    liveInputCapture,
    setLiveInputCapture,
    clearTerminalLiveInputDefault,
    defaultTerminalHandlesToLiveInput,
    liveInputTerminalHandles,
    liveInputTerminalHandlesRef,
    pruneTerminalHandlesFromLiveInput,
    toggleTerminalLiveInput,
    activeHandle,
    setActiveHandle,
    activeSessionTabId,
    setActiveSessionTabId,
    activeSessionTabIdRef,
    tabStripRef,
    tabStripOffsetRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    tabLayoutsRef,
    markdownDocs,
    setMarkdownDocs,
    markdownDocsRef,
    fileDocs,
    setFileDocs,
    diffComments,
    setDiffComments,
    diffCommentsRef,
    diffCommentBusy,
    setDiffCommentBusy,
    pendingDiffNotesDelivery,
    setPendingDiffNotesDelivery,
    creating,
    setCreating,
    creatingTerminalRef,
    creatingBrowser,
    setCreatingBrowser,
    creatingMarkdown,
    setCreatingMarkdown,
    createError,
    setCreateError,
    createWarningState,
    setCreateWarningState,
    showCreateTabDrawer,
    setShowCreateTabDrawer,
    showQuickCommands,
    setShowQuickCommands,
    createTabAgentLoadState,
    setCreateTabAgentLoadState,
    createTabAgentOptions,
    setCreateTabAgentOptions,
    showCreateBrowserModal,
    setShowCreateBrowserModal,
    showHeaderMoreActions,
    setShowHeaderMoreActions,
    actionTarget,
    setActionTarget,
    markdownActionTarget,
    setMarkdownActionTarget,
    fileActionTarget,
    setFileActionTarget,
    browserActionTarget,
    setBrowserActionTarget,
    discardMarkdownTarget,
    setDiscardMarkdownTarget,
    leaveDrafts,
    setLeaveDrafts,
    renameTarget,
    setRenameTarget,
    customKeys,
    setCustomKeys,
    visibleBuiltInIds,
    setVisibleBuiltInIds,
    showCustomKeyModal,
    setShowCustomKeyModal,
    deleteKeyTarget,
    setDeleteKeyTarget,
    visibleBuiltInAccessoryKeys,
    keyboardHeight,
    setKeyboardHeight,
    terminalModes,
    setTerminalModes,
    terminalKeyboardMetrics,
    setTerminalKeyboardMetrics,
    selectModeActive,
    setSelectModeActive,
    canPaste,
    setCanPaste,
    toastMessage,
    setToastMessage,
    toastOpacityRef,
    toastHideTimerRef,
    toastSeqRef,
    ptyModesRef,
    terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    terminalCwdRef,
    initialModesSeenRef,
    deviceTokenRef,
    hostEndpoint,
    setHostEndpoint,
    clientRef,
    connStateRef,
    viewportRef,
    viewportMeasuredRef,
    terminalRefs,
    liveInputRef,
    commandInputRef,
    liveInputFocusTimerRef,
    sendLiveTerminalInputRef,
    sessionTabActionSheetKeyboardHideSubRef,
    sessionTabActionSheetRequestSeqRef,
    terminalUnsubsRef,
    subscribingHandlesRef,
    initializedHandlesRef,
    terminalDiagnosticsRef,
    webReadyHandlesRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    pendingActiveSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    pendingBrowserFocusPageIdRef,
    switchSessionTabRef,
    pendingTerminalActivationAttemptRef,
    handleCreateBrowserRef,
    initialSessionAutoCreateRef,
    markdownSaveSeqRef,
    markdownSaveInFlightRef,
    subscribeSeqRef,
    delayedActionTimersRef,
    layoutSeqRef,
    sendingRef,
    terminalFrameHeightRef,
    terminalFrameWidth,
    setTerminalFrameWidth,
    activeSessionTab,
    clearPendingLiveInputCommit,
    flushPendingLiveInputBeforeExternalSend,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    saveTerminalTextScale,
    handleLiveInputKeyPress,
    handleLiveInputSubmit,
    canCompose,
    canSend,
    browserScreencastSupported,
    setBrowserScreencastSupported,
    agentSessionHistorySupported,
    setAgentSessionHistorySupported,
    quickCommandsSupported,
    setQuickCommandsSupported,
    browserScreencastSupportedRef,
    reconciledCreateWarningState,
    createWarning,
    clearDelayedActionTimers,
    scheduleDelayedAction,
    clearToastHideTimer,
    showToast,
  }
}
