import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Animated,
  AppState,
  Linking,
  type AppStateStatus,
  BackHandler,
  FlatList,
  Image,
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Keyboard,
  Platform,
  ActivityIndicator,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type ListRenderItem
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronsRight,
  Copy,
  Folder,
  File,
  FileText,
  GitBranch,
  Globe,
  Keyboard as KeyboardIcon,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  SquareTerminal,
  X
} from 'lucide-react-native'
import type { RpcClient } from '../../../../src/transport/rpc-client'
import { loadHosts } from '../../../../src/transport/host-store'
import { startRuntimeCapabilityProbe } from '../../../../src/transport/runtime-capability-probe'
import {
  loadTerminalAutocompleteEnabled,
  loadTerminalLinkOpenMode,
  loadTerminalTextScale,
  HOST_DOCK_MIN_WIDTH,
  saveTerminalTextScale,
  type MobileTerminalLinkOpenMode
} from '../../../../src/storage/preferences'
import { useHostClient, useForceReconnect } from '../../../../src/transport/client-context'
import {
  useLastConnectedAt,
  useReconnectAttempt
} from '../../../../src/transport/client-context-connection-metrics'
import {
  classifyConnection,
  verdictDisplayLabel
} from '../../../../src/transport/connection-health'
import { useResponsiveLayout } from '../../../../src/layout/responsive-layout'
import {
  type ActivePanel,
  canDockSessionPanel,
  resolvePanelAction,
  shouldShowSessionHeaderChecksAction,
  panelRouteDescriptor
} from '../../../../src/session/session-panel-host'
import {
  createBulkCloseSheetActions,
  createCloseWithBulkActions
} from '../../../../src/session/mobile-bulk-close-sheet-actions'
import { useMobilePrBranchContext } from '../../../../src/session/use-mobile-pr-branch-context'
import { isFloatingWorkspaceWorktreeId } from '../../../../src/session/floating-workspace'
import { SessionDockColumn } from '../../../../src/session/SessionDockColumn'
import { MobileSessionHeaderIconButton } from '../../../../src/session/MobileSessionHeaderIconButton'
import { MobileSessionHeaderMoreActionsSheet } from '../../../../src/session/MobileSessionHeaderMoreActionsSheet'
import { QuickCommandsSheet } from '../../../../src/session/QuickCommandsSheet'
import {
  buildMobileQuickCommandLaunch,
  supportsMobileQuickCommands,
  type MobileQuickCommandLaunch
} from '../../../../src/terminal/quick-commands'
import { MOBILE_AI_VAULT_CAPABILITY } from '../../../../src/agent-history/agent-history-capability'
import type { ConnectionState, RpcFailure, RpcSuccess } from '../../../../src/transport/types'
import { headlessActivationNeedsHostRenderer } from '../../../../src/worktree/worktree-activation-result'
import { useMobileDictation } from '../../../../src/hooks/use-mobile-dictation'
import {
  triggerMediumImpact,
  triggerSelection,
  triggerSuccess,
  triggerError,
  triggerEdgeBump
} from '../../../../src/platform/haptics'
import type {
  TerminalKeyboardAvoidanceMetrics,
  TerminalModes,
  TerminalWebViewHandle
} from '../../../../src/terminal/terminal-webview-contract'
import { isTerminalOscLinkRanges } from '../../../../src/terminal/terminal-osc-link-ranges'
import { useTerminalViewportRefit } from '../../../../src/terminal/terminal-viewport-refit'
import {
  getDefaultTerminalAccessoryBuiltInIds,
  getVisibleTerminalAccessoryKeys,
  loadTerminalAccessoryLayout
} from '../../../../src/terminal/terminal-accessory-layout'
import { createTerminalLiveAccessoryInput } from '../../../../src/terminal/terminal-live-accessory-input'
import { sendTerminalLiveAccessoryRawBytes } from '../../../../src/terminal/terminal-live-accessory-raw-send'
import {
  clearTerminalLiveInputFocusTimer,
  focusTerminalLiveInputTarget,
  isTerminalLiveInputWithinByteLimit,
  scheduleTerminalLiveInputFocus
} from '../../../../src/terminal/terminal-live-input'
import { dismissTerminalKeyboard } from '../../../../src/terminal/terminal-keyboard-dismiss'
import type { TerminalLiveInputSender } from '../../../../src/terminal/terminal-live-input-sender'
import { isTerminalSendRpcAccepted } from '../../../../src/terminal/terminal-send-rpc-response'
import { sendMobileTerminalQueryReply } from '../../../../src/terminal/mobile-terminal-query-reply'
import { TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY } from '../../../../../src/shared/protocol-version'
import { useTerminalLiveInputCommit } from '../../../../src/terminal/use-terminal-live-input-commit'
import { resolveMobileTerminalInputGate } from '../../../../src/terminal/terminal-input-connection-gate'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../../../../src/terminal/terminal-send-request'
import {
  getTerminalCommandKeyboardType,
  getTerminalLiveInputKeyboardType
} from '../../../../src/terminal/terminal-keyboard-type'
import { normalizeTerminalTextInput } from '../../../../src/terminal/terminal-text-input-normalization'
import {
  appendBufferedDictation,
  routeDictationTranscript
} from '../../../../src/terminal/terminal-live-dictation-routing'
import { countTerminalGestureInputSequences } from '../../../../src/terminal/terminal-gesture-input'
import {
  recoverActiveTerminalAfterForeground,
  shouldRecoverTerminalOnAppStateChange
} from '../../../../src/terminal/terminal-foreground-recovery'
import { MobileBrowserPane } from '../../../../src/browser/MobileBrowserPane'
import { normalizeBrowserUrl } from '../../../../src/browser/browser-url'
import { StatusDot } from '../../../../src/components/StatusDot'
import { ActionSheetModal } from '../../../../src/components/ActionSheetModal'
import { MobileAgentIcon } from '../../../../src/components/MobileAgentIcon'
import { TextInputModal } from '../../../../src/components/TextInputModal'
import { ConfirmModal } from '../../../../src/components/ConfirmModal'
import {
  CustomKeyModal,
  loadCustomKeys,
  saveCustomKeys,
  type CustomKey
} from '../../../../src/components/CustomKeyModal'
import {
  addMobileDiffComment,
  formatDiffComments,
  normalizeMobileDiffComments,
  removeDeliveredMobileDiffComments,
  removeMobileDiffComments
} from '../../../../src/session/mobile-diff-comments'
import {
  getTerminalRecordsFromSessionTabs,
  mergeTerminalListWithKnownRecords,
  mergeTerminalRecordsByCurrentOrder,
  mobileSessionTabsEqual,
  terminalRecordsEqual
} from '../../../../src/session/mobile-terminal-records'
import {
  getMobileSessionTabTitle,
  resolveMobileTerminalTabAgentId
} from '../../../../src/session/mobile-terminal-tab-agent'
import type { MobileNewTabAgentOption } from '../../../../src/session/mobile-new-tab-agent-options'
import { loadMobileNewTabAgentOptions } from '../../../../src/session/mobile-new-tab-agent-loader'
import { useMobileSessionImageAttachments } from '../../../../src/session/use-mobile-session-image-attachments'
import { useMobileAttachmentInputLeaseGate } from '../../../../src/session/use-mobile-attachment-input-lease-gate'
import { useMobileTerminalPaste } from '../../../../src/session/use-mobile-terminal-paste'
import { useTerminalLiveInputModePreference } from '../../../../src/session/use-terminal-live-input-mode-preference'
import { MobileTerminalLiveInputStatus } from '../../../../src/session/MobileTerminalLiveInputStatus'
import { MobileTerminalInputActions } from '../../../../src/session/MobileTerminalInputActions'
import { resolveMobileFileTabDoc } from '../../../../src/files/mobile-file-tab-doc'
import { captureMobileFileMutationOwnership } from '../../../../src/files/mobile-file-mutation-ownership'
import { openMobileTerminalFileTap } from '../../../../src/session/mobile-terminal-file-tap-open'
import { useLiveWorktreeName } from '../../../../src/session/use-live-worktree-name'
import {
  acceptSessionSnapshot,
  applyClosedTabTombstones,
  confirmsMirroredTabSelection,
  type AppliedSnapshotMarker
} from '../../../../src/session/session-tab-snapshot-gate'
import {
  createInitialSessionAutoCreateState,
  useInitialSessionTerminalAutoCreate,
  useWorktreeSessionTabsLoaded
} from '../../../../src/session/use-initial-session-terminal-autocreate'
import {
  buildMarkdownDiskFallbackDoc,
  shouldReadMarkdownFromDiskAfterReadTabFailure
} from '../../../../src/session/mobile-markdown-disk-fallback'
import { MobileDictationSetupSheet } from '../../../../src/components/MobileDictationSetupSheet'
import {
  fetchDictationSetup,
  isDictationSetupRequiredError
} from '../../../../src/dictation/mobile-dictation-setup'
import { TerminalPaneView } from '../../../../src/session/TerminalPaneView'
import { MobileNativeChatOverlay } from '../../../../src/session/MobileNativeChatOverlay'
import { MobileBrowserTabActionSheet } from '../../../../src/session/MobileBrowserTabActionSheet'
import { useMobileNativeChatController } from '../../../../src/session/use-mobile-native-chat-controller'
import { useMobileNativeChatReadability } from '../../../../src/session/use-mobile-native-chat-readability'
import { useMobileNativeChatInputLease } from '../../../../src/session/use-mobile-native-chat-input-lease'
import { useMobileNativeChatSendError } from '../../../../src/session/use-mobile-native-chat-send-error'
import { getMobileTerminalActionSheetActions } from '../../../../src/session/mobile-terminal-action-sheet-actions'
import * as nativeChatTerminalStream from '../../../../src/session/mobile-native-chat-terminal-stream'
import { mobileNativeChatScopeKey } from '../../../../src/session/mobile-native-chat-scope-key'
import {
  createTerminalPrunePredicate,
  pruneTerminalKeyboardMetrics,
  resolveRetainedTerminalHandles
} from '../../../../src/session/mobile-terminal-prune-decision'
import { useMobileNativeChatTerminalStream } from '../../../../src/session/use-mobile-native-chat-terminal-stream'
import { subscribeMobileTerminalSafely } from '../../../../src/session/mobile-terminal-stream-subscribe'
import { activateMobileSessionTab } from '../../../../src/session/mobile-session-tab-activation'
import { MobileTerminalDiagnostics } from '../../../../src/session/mobile-terminal-diagnostics'
import { runAcceptedMobileSessionTabsEffects } from '../../../../src/session/mobile-session-tabs-accepted-effects'
import type {
  SessionTabsApplyOutcome,
  SessionTabsStreamSource
} from '../../../../src/session/mobile-session-tabs-stream-health'
import { useMobileSessionTabsFetchReporting } from '../../../../src/session/use-mobile-session-tabs-fetch-reporting'
import { useMobileSessionTabsReconciliation } from '../../../../src/session/use-mobile-session-tabs-reconciliation'
import {
  getRepoIdFromMobileWorktreeId,
  getActiveTabIdForHandle,
  isFileExistsErrorMessage,
  isGestureMouseTrackingMode,
  isTerminalPhoneDisplayMode,
  MOBILE_SESSION_STATUS_LABELS,
  TERMINAL_GESTURE_INPUT_BUCKET_CAPACITY,
  TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
  TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES,
  TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS,
  TERMINAL_GESTURE_INPUT_REFILL_PER_SECOND,
  updateTerminalCwdFromStreamEvent
} from '../../../../src/session/mobile-session-route-helpers'
import { resolveTabStripScrollOffset } from '../../../../src/session/tab-strip-scroll'
import { activateOpenedSourceControlDiffTab } from '../../../../src/session/opened-mobile-session-tab'
import {
  createMobileSessionCreateWarningState,
  dismissMobileSessionCreateWarningState,
  reconcileMobileSessionCreateWarningState
} from '../../../../src/session/mobile-session-create-warning-state'
import { colors, spacing } from '../../../../src/theme/mobile-theme'
import { styles } from './mobile-session-styles'
import { useMobileSessionDocumentActions } from './use-mobile-session-document-actions'
import { useMobileSessionRecovery } from './use-mobile-session-recovery'
import { useMobileSessionTabInteractions } from './use-mobile-session-tab-interactions'
import { useMobileSessionTerminalInput } from './use-mobile-session-terminal-input'
import { useMobileSessionCreation } from './use-mobile-session-creation'
import { useMobileSessionActions } from './use-mobile-session-actions'
import { FileReader, MarkdownReader } from './mobile-session-file-readers'
import { QuickCommandsTabButton } from './QuickCommandsTabButton'
import type { DiffComment, TerminalQuickCommand } from '../../../../../src/shared/types'
import type {
  DiffCommentActions,
  DiffNotesDelivery,
  DirtyMarkdownDraft,
  FileDocState,
  MarkdownDocState,
  MobileDisplayMode,
  MobileNewTabAgentLoadState,
  MobileSessionTab,
  MobileSessionTabType,
  RuntimeRepoSummary,
  SessionTabsResult,
  Terminal,
  TerminalCreateResult,
  TerminalGestureInputBucket,
  TerminalGestureInputQueue
} from './mobile-session-route-types'
export default function SessionScreen() {
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
  // Reactive teardown signal for the native-chat covered stream; see unsubscribeTerminal.
  const [coveredStreamRevision, setCoveredStreamRevision] = useState(0)
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
  const [showDictationSetup, setShowDictationSetup] = useState(false)
  // 'hold' = press-and-hold mic, 'toggle' = tap-to-start/stop; mirrors Settings ▸ Voice ▸ Dictation Mode.
  const [dictationMode, setDictationMode] = useState<'toggle' | 'hold'>('toggle')
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
  const dictationRouteContextRef = useRef<{
    readonly handle: string | null
    readonly liveInputEnabled: boolean
  } | null>(null)
  const terminalUnsubsRef = useRef<Map<string, () => void>>(new Map())
  const subscribingHandlesRef = useRef<Set<string>>(new Set())
  const initializedHandlesRef = useRef<Set<string>>(new Set())
  const terminalDiagnosticsRef = useRef(new MobileTerminalDiagnostics())
  // Why: don't subscribe until the WebView fires web-ready — iOS may defer JS in hidden WebViews and init() messages would queue unrendered.
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
  const liveInputEnabled = activeHandle ? liveInputTerminalHandles.has(activeHandle) : false
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
  const nativeChatScopeKey = mobileNativeChatScopeKey(hostId, worktreeId, activeSessionTabId)
  const nativeChatSendError = useMobileNativeChatSendError({
    scopeKey: nativeChatScopeKey,
    showToast
  })
  const nativeChatTranscriptIsLocalReadable = useMobileNativeChatReadability(client, worktreeId)
  const {
    ready: nativeChatInputLeaseReady,
    readyRef: nativeChatInputLeaseReadyRef,
    lockReason: nativeChatInputLockReason,
    markReady: markNativeChatInputLeaseReady,
    clear: clearNativeChatInputLease
  } = useMobileNativeChatInputLease({
    activeHandle,
    connected: connState === 'connected'
  })
  const nativeChatController = useMobileNativeChatController({
    client,
    hostId,
    worktreeId,
    activeSessionTab,
    activeSessionTabId,
    activeHandleRef,
    deviceTokenRef,
    nativeChatTranscriptIsLocalReadable,
    nativeChatInputLeaseReady,
    connState,
    onSendError: nativeChatSendError.show,
    onSendResolved: nativeChatSendError.clear
  })
  const { toggleTabChatView, showNativeChat, showNativeChatRef } = nativeChatController
  nativeChatSendError.bannerMountedRef.current = showNativeChat

  const dictation = useMobileDictation({
    client,
    enabled: canSend,
    onTranscript: (text) => {
      // Why: dictation belongs to the visible composer — native chat consumes it locally, terminal mode keeps live-input routing.
      if (showNativeChatRef.current) {
        nativeChatController.setChatComposerText((current) =>
          appendBufferedDictation(current, text)
        )
        showToast('Dictation inserted')
        return
      }
      // Live mode inserts the transcript into its PTY as text (no Return); buffered mode appends to the command field.
      const routeContext = dictationRouteContextRef.current
      dictationRouteContextRef.current = null
      const route = routeDictationTranscript(
        text,
        routeContext?.liveInputEnabled ?? liveInputEnabled
      )
      if (route.kind === 'live-insert') {
        const insertHandle = routeContext?.handle ?? activeHandleRef.current
        if (!insertHandle) {
          return
        }
        void (async () => {
          const flushedPendingInput = await flushPendingLiveInputBeforeExternalSend(insertHandle)
          if (!flushedPendingInput) {
            return
          }
          const sent = await sendLiveTerminalInput(insertHandle, route.text)
          if (sent) {
            showToast('Dictation inserted')
          }
        })()
        return
      }
      setInput((current) => appendBufferedDictation(current, route.text))
      showToast('Dictation inserted')
    },
    onError: (err) => {
      dictationRouteContextRef.current = null
      // Dictation not set up on desktop → open the setup sheet instead of a dead-end toast.
      if (isDictationSetupRequiredError(err.message)) {
        setShowDictationSetup(true)
        return
      }
      triggerError()
      showToast(err.message)
    }
  })

  const startDictation = useCallback(() => {
    const routeContext = activeHandle
      ? { handle: activeHandle, liveInputEnabled: liveInputTerminalHandles.has(activeHandle) }
      : null
    dictationRouteContextRef.current = routeContext
    void dictation.start().catch((err) => {
      if (dictationRouteContextRef.current === routeContext) {
        dictationRouteContextRef.current = null
      }
      triggerError()
      showToast(err instanceof Error ? err.message : String(err))
    })
  }, [activeHandle, dictation, liveInputTerminalHandles, triggerError, showToast])

  const cancelDictation = useCallback(() => {
    dictationRouteContextRef.current = null
    void dictation.cancel()
  }, [dictation])

  // Toggle mode: one tap starts, the next stops; long-press cancels mid-record.
  const handleDictationToggle = useCallback(() => {
    if (dictation.isProcessing) {
      cancelDictation()
    } else if (dictation.isStarting) {
      return
    } else if (dictation.isRecording) {
      void dictation.stop()
    } else {
      startDictation()
    }
  }, [cancelDictation, dictation, startDictation])

  // Hold mode: press starts, release stops — like a walkie-talkie.
  const handleDictationPressIn = useCallback(() => {
    if (!dictation.isStarting && !dictation.isRecording && !dictation.isProcessing) {
      startDictation()
    }
  }, [dictation, startDictation])

  const handleDictationPressOut = useCallback(() => {
    if (dictation.isRecording) {
      void dictation.stop()
    } else if (dictation.isStarting) {
      // Released before recording began: cancel so we don't leave a live mic.
      cancelDictation()
    }
  }, [cancelDictation, dictation])

  const refreshDictationMode = useCallback(async () => {
    if (!client) {
      return
    }
    try {
      const setup = await fetchDictationSetup(client)
      setDictationMode(setup.dictationMode)
    } catch {
      // Non-fatal: fall back to the default toggle behavior.
    }
  }, [client])

  // Re-read on focus so a Settings ▸ Voice dictation-mode change is reflected on return.
  useFocusEffect(
    useCallback(() => {
      void refreshDictationMode()
    }, [refreshDictationMode])
  )

  useEffect(() => {
    diffCommentsRef.current = diffComments
  }, [diffComments])

  const getTerminalRef = useCallback((handle: string | null) => {
    return handle ? terminalRefs.current.get(handle) : undefined
  }, [])

  const unsubscribeTerminal = useCallback(
    (handle: string) => {
      terminalUnsubsRef.current.get(handle)?.()
      terminalUnsubsRef.current.delete(handle)
      subscribingHandlesRef.current.delete(handle)
      terminalDiagnosticsRef.current.terminalUnsubscribed(handle)
      subscribeSeqRef.current.set(handle, (subscribeSeqRef.current.get(handle) ?? 0) + 1)
      // Why: reset the high-water mark so a fresh subscription's first scrollback isn't dropped as stale.
      layoutSeqRef.current.delete(handle)
      // Why compare against the RENDERED lease: `clear` reports the drop from its
      // synchronous mirror, so a `subscribed`+`end` pair applied in one render batch
      // reports "dropped" while React only ever sees false → the effect never re-runs
      // and the composer stays locked (#10681). A dead PTY can also emit `end` with no
      // preceding `subscribed`, where the clear is a no-op for the same reason. Either
      // way the flip carries no signal, so bump. When the lease really was up on
      // screen, `leaseReady` already re-runs the effect and bumping too would
      // double-render this whole route on every chat open.
      const leaseWasOnScreen = nativeChatInputLeaseReadyRef.current
      const leaseDropped = clearNativeChatInputLease(handle)
      if (
        (!leaseDropped || !leaseWasOnScreen) &&
        showNativeChatRef.current &&
        handle === activeHandleRef.current
      ) {
        setCoveredStreamRevision((revision) => revision + 1)
      }
    },
    [clearNativeChatInputLease, nativeChatInputLeaseReadyRef, showNativeChatRef]
  )
  const unsubscribeTerminalRef = useRef(unsubscribeTerminal)
  unsubscribeTerminalRef.current = unsubscribeTerminal

  const clearTerminalCache = useCallback(() => {
    terminalUnsubsRef.current.forEach((unsub) => unsub())
    clearNativeChatInputLease()
    terminalUnsubsRef.current.clear()
    subscribingHandlesRef.current.clear()
    initializedHandlesRef.current.clear()
    terminalDiagnosticsRef.current.clearTerminalCache()
    webReadyHandlesRef.current.clear()
    subscribeSeqRef.current.clear()
    layoutSeqRef.current.clear()
    terminalCwdRef.current.clear()
    setTerminalKeyboardMetrics(new Map())
    for (const term of terminalRefs.current.values()) {
      term.clear()
    }
  }, [clearNativeChatInputLease])

  // Why: measure the phone viewport once from the first TerminalWebView; dims ride every subscribe so the server auto-fits without a separate RPC.
  const measureViewportOnce = useCallback(
    async (handle: string) => {
      if (viewportMeasuredRef.current) {
        return
      }
      const dims = await getTerminalRef(handle)?.measureFitDimensions(
        terminalFrameHeightRef.current || undefined
      )
      terminalDiagnosticsRef.current.viewportMeasured(handle, dims, terminalFrameHeightRef.current)
      if (dims) {
        viewportRef.current = dims
        viewportMeasuredRef.current = true
      }
    },
    [getTerminalRef]
  )

  const subscribeToTerminal = useCallback(
    (handle: string) => {
      const diagnostics = terminalDiagnosticsRef.current
      const logSkippedGate = (reason: string) =>
        diagnostics.streamSkipped(handle, reason, handle === activeHandleRef.current)
      if (!client) {
        logSkippedGate('no-client')
        return
      }
      if (terminalUnsubsRef.current.has(handle)) {
        logSkippedGate('already-subscribed')
        return
      }
      if (subscribingHandlesRef.current.has(handle)) {
        logSkippedGate('subscribe-in-flight')
        return
      }
      const covered = nativeChatTerminalStream.isTerminalCoveredByNativeChat(
        showNativeChatRef.current,
        activeHandleRef.current,
        handle
      )
      // Why: a native-chat-covered terminal has no mounted webview, so only gate on the webview when not covered.
      if (!covered) {
        if (!getTerminalRef(handle)) {
          logSkippedGate('no-webview-ref')
          return
        }
        if (!webReadyHandlesRef.current.has(handle)) {
          logSkippedGate('webview-not-ready')
          return
        }
      }

      subscribingHandlesRef.current.add(handle)
      const seq = (subscribeSeqRef.current.get(handle) ?? 0) + 1
      subscribeSeqRef.current.set(handle, seq)
      diagnostics.streamArmed(handle, seq, viewportRef.current)

      // Why: viewport is embedded in the subscribe params so the server auto-fits before serializing scrollback (no focus→safeFit race).
      const unsub = subscribeMobileTerminalSafely(
        client,
        {
          terminal: handle,
          client: { id: deviceTokenRef.current!, type: 'mobile' as const },
          viewport: nativeChatTerminalStream.mobileNativeChatSubscribeViewport(
            covered,
            viewportRef.current
          ),
          capabilities: nativeChatTerminalStream.mobileNativeChatTerminalCapabilities(covered)
        },
        (result) => {
          if (subscribeSeqRef.current.get(handle) !== seq) {
            return
          }
          const data = result as Record<string, unknown>
          diagnostics.firstStreamEvent(handle, seq, data.type)
          if (data.type === 'end' || data.type === 'error') {
            unsubscribeTerminalRef.current(handle)
            return
          }
          if (data.type === 'subscribed') {
            markNativeChatInputLeaseReady(handle)
            return
          }
          // Why: keep the subscription as the input-floor lease but don't mutate covered xterm state; return-to-terminal resubscribes.
          if (
            nativeChatTerminalStream.isTerminalCoveredByNativeChat(
              showNativeChatRef.current,
              activeHandleRef.current,
              handle
            )
          ) {
            return
          }
          // Why: drop `resized` events older than the seen seq (superseded layout); scrollback always resets the mark, else reconnect blanks the terminal.
          const eventSeq = typeof data.seq === 'number' ? data.seq : null
          if (eventSeq != null && data.type === 'resized') {
            const last = layoutSeqRef.current.get(handle)
            if (last != null && eventSeq < last && last - eventSeq <= 20) {
              console.log('[fit][session] DROP-stale-seq', {
                handle: handle.slice(-8),
                type: data.type,
                eventSeq,
                lastSeq: last,
                cols: data.cols,
                rows: data.rows,
                displayMode: data.displayMode
              })
              return
            }
            layoutSeqRef.current.set(handle, eventSeq)
          } else if (eventSeq != null && data.type === 'scrollback') {
            layoutSeqRef.current.set(handle, eventSeq)
          }
          if (data.type === 'scrollback') {
            diagnostics.streamScrollback(handle, seq, eventSeq, data)
            if (initializedHandlesRef.current.has(handle)) {
              return
            }
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
            const cols = (data.cols as number) || 80
            const rows = (data.rows as number) || 24
            const scrollbackCols = cols
            const scrollbackRows = rows
            const initialData =
              typeof data.serialized === 'string' && data.serialized.length > 0
                ? data.serialized
                : ''
            const oscLinks = isTerminalOscLinkRanges(data.oscLinks) ? data.oscLinks : undefined
            const ref = getTerminalRef(handle)
            // Why: only mark initialized once init() reaches the WebView, else later scrollback is dropped and the terminal stays blank.
            if (!ref) {
              console.log('[fit][session] scrollback DROPPED — no terminal ref', {
                handle: handle.slice(-8),
                cols,
                rows
              })
              return
            }
            ref.init(cols, rows, initialData, false, oscLinks)
            initializedHandlesRef.current.add(handle)
            if (data.displayMode) {
              setTerminalModes((prev) =>
                new Map(prev).set(handle, data.displayMode as MobileDisplayMode)
              )
            }
            // Why: cold-start refit — init()'s fit can run against a transient scrollWidth, so re-fire against a settled DOM.
            scheduleDelayedAction(() => getTerminalRef(handle)?.resetZoom(), 200)
            // Why: first subscribe has no viewport (xterm not loaded yet), so measure after init and resubscribe so the server can phone-fit.
            const needsResubscribe =
              !viewportMeasuredRef.current ||
              (viewportRef.current != null &&
                (scrollbackCols !== viewportRef.current.cols ||
                  scrollbackRows !== viewportRef.current.rows))
            if (needsResubscribe) {
              void (async () => {
                // Why: wait for init()'s rAF chain before measuring, else the measure races ahead and returns null (log dump 2026-05-06).
                await getTerminalRef(handle)?.awaitReady()
                if (subscribeSeqRef.current.get(handle) !== seq) {
                  return
                }
                const dims = await getTerminalRef(handle)?.measureFitDimensions(
                  terminalFrameHeightRef.current || undefined
                )
                // Why: re-check seq — the awaits may have let a newer subscribe cycle arm; tearing it down would resubscribe a stale generation.
                if (subscribeSeqRef.current.get(handle) !== seq) {
                  return
                }
                if (!getTerminalRef(handle)) {
                  return
                }
                // Why: scrollback came back at cols=80 (server's null-viewport fallback), so this subscriber record has no viewport — resubscribe so the server stores it.
                if (dims) {
                  diagnostics.streamResubscribing(handle, seq, dims)
                  viewportRef.current = dims
                  viewportMeasuredRef.current = true
                  unsubscribeTerminal(handle)
                  initializedHandlesRef.current.delete(handle)
                  subscribeToTerminal(handle)
                }
              })()
            }
          } else if (data.type === 'metadata') {
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
          } else if (data.type === 'data') {
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
            // Why: missing ref is the likely cause of "blank but input works" — writes dropped after mid-flight unmount or scrollback never landed.
            const dataRef = getTerminalRef(handle)
            if (!dataRef) {
              console.log('[fit][session] data DROPPED — no terminal ref', {
                handle: handle.slice(-8),
                chunkLen: typeof data.chunk === 'string' ? data.chunk.length : 0,
                initialized: initializedHandlesRef.current.has(handle)
              })
              return
            }
            if (!initializedHandlesRef.current.has(handle)) {
              console.log('[fit][session] data RECEIVED before scrollback', {
                handle: handle.slice(-8),
                chunkLen: typeof data.chunk === 'string' ? data.chunk.length : 0
              })
            }
            dataRef.write(data.chunk as string)
          } else if (data.type === 'resized') {
            updateTerminalCwdFromStreamEvent(handle, data, terminalCwdRef.current)
            // Server resize: reinit xterm on a full-buffer snapshot (width reflow rewraps scrollback), else just resize geometry.
            const cols = (data.cols as number) || 80
            const rows = (data.rows as number) || 24
            const serialized = typeof data.serialized === 'string' ? data.serialized : null
            diagnostics.streamResized(handle, seq, eventSeq, data, getTerminalRef(handle) != null)
            const oscLinks = isTerminalOscLinkRanges(data.oscLinks) ? data.oscLinks : undefined
            if (serialized != null) {
              getTerminalRef(handle)?.init(cols, rows, serialized, true, oscLinks)
            } else {
              getTerminalRef(handle)?.resize(cols, rows)
            }
            if (data.displayMode) {
              setTerminalModes((prev) =>
                new Map(prev).set(handle, data.displayMode as MobileDisplayMode)
              )
            }
            scheduleDelayedAction(() => getTerminalRef(handle)?.resetZoom(), 200)
          }
        },
        () => unsubscribeTerminalRef.current(handle)
      )

      if (subscribeSeqRef.current.get(handle) === seq) {
        terminalUnsubsRef.current.set(handle, unsub)
      } else {
        unsub()
      }
      subscribingHandlesRef.current.delete(handle)
    },
    [client, getTerminalRef, markNativeChatInputLeaseReady, scheduleDelayedAction]
  )

  const nativeChatStream = useMobileNativeChatTerminalStream({
    showNativeChat,
    activeHandle,
    activeTabType: activeSessionTab?.type ?? null,
    leaseReady: nativeChatInputLeaseReady,
    streamRevision: coveredStreamRevision,
    subscriptionsRef: terminalUnsubsRef,
    subscribingRef: subscribingHandlesRef,
    webReadyRef: webReadyHandlesRef,
    initializedRef: initializedHandlesRef,
    subscribe: subscribeToTerminal,
    unsubscribe: unsubscribeTerminal
  })

  // Why: server does the resize and emits 'resized' on the existing subscription — no client-side state tracking needed.
  const toggleInFlightRef = useRef<Set<string>>(new Set())
  const toggleDisplayMode = useCallback(
    async (handle: string) => {
      if (!client) {
        return
      }
      if (toggleInFlightRef.current.has(handle)) {
        return
      }
      const current = terminalModes.get(handle) ?? 'auto'
      // Why: 'phone' is an observed state, not a setting; the toggle only requests 'auto' or 'desktop'.
      const next: 'auto' | 'desktop' =
        current === 'auto' || current === 'phone' ? 'desktop' : 'auto'
      toggleInFlightRef.current.add(handle)
      try {
        await client.sendRequest('terminal.setDisplayMode', {
          terminal: handle,
          mode: next,
          // Why: presence-lock take-floor — requesting 'auto' is the explicit "drive at phone dims" gesture.
          ...(deviceTokenRef.current
            ? { client: { id: deviceTokenRef.current, type: 'mobile' as const } }
            : {}),
          // Why: late-bind viewport for terminals subscribed before measurement, or auto toggles no-op on a null stored viewport.
          ...(viewportRef.current && next === 'auto' ? { viewport: viewportRef.current } : {})
        })
      } catch {
        // Mode change failed — server state unchanged, UI stays in sync.
      } finally {
        toggleInFlightRef.current.delete(handle)
      }
    },
    [client, terminalModes]
  )

  const lastKnownTerminalCountRef = useRef(0)
  const fetchTerminalsInFlightRef = useRef(false)

  const fetchTerminals = useCallback(
    async (opts: { allowEmptyLoaded?: boolean } = {}) => {
      if (!client) {
        return
      }
      if (fetchTerminalsInFlightRef.current) {
        return
      }
      fetchTerminalsInFlightRef.current = true
      const allowEmptyLoaded = opts.allowEmptyLoaded ?? true

      try {
        const response = await client.sendRequest('terminal.list', {
          worktree: `id:${worktreeId}`
        })
        if (response.ok) {
          const result = (response as RpcSuccess).result as { terminals: Terminal[] }
          if (result.terminals.length === 0 && !allowEmptyLoaded) {
            return
          }
          // Why: require two consecutive empties before trusting 0, so transient empty responses don't flash the UI empty.
          if (result.terminals.length === 0 && lastKnownTerminalCountRef.current > 0) {
            lastKnownTerminalCountRef.current = 0
            return
          }

          const liveHandles = new Set(result.terminals.map((terminal) => terminal.handle))
          const pruneContext = {
            liveHandles,
            showNativeChat: showNativeChatRef.current,
            activeHandle: activeHandleRef.current
          }
          // Why: terminal.list is the lifetime signal; lagging tab snapshots must not erase a user's buffered-mode opt-out.
          // Sweep against the retained set, not the raw list: a chat-covered handle
          // keeps its subscription across a graph reload, so erasing its live-input
          // preference on the same refresh is the erasure this guard exists to stop.
          pruneTerminalHandlesFromLiveInput(resolveRetainedTerminalHandles(pruneContext))
          defaultTerminalHandlesToLiveInput([...liveHandles])
          const shouldPrune = createTerminalPrunePredicate(pruneContext)
          for (const handle of Array.from(terminalUnsubsRef.current.keys())) {
            if (!shouldPrune(handle)) {
              continue
            }
            unsubscribeTerminal(handle)
            terminalRefs.current.delete(handle)
            initializedHandlesRef.current.delete(handle)
            clearTerminalLiveInputDefault(handle)
          }
          setTerminalKeyboardMetrics((prev) => pruneTerminalKeyboardMetrics(prev, shouldPrune))
          // Why: a chat-covered handle the host reports again refills its rearm budget,
          // so an exhausted rearm can't lock the composer until leave-chat.
          nativeChatStream.notifyListedHandles(liveHandles)
          lastKnownTerminalCountRef.current = result.terminals.length
          // Why: dedupe duplicate handles (rename/split race) to avoid a React duplicate-key throw; keep first for tab-strip order.
          const seen = new Set<string>()
          const deduped = result.terminals.filter((t) => {
            if (seen.has(t.handle)) {
              return false
            }
            seen.add(t.handle)
            return true
          })

          const mergedTerminals = mergeTerminalListWithKnownRecords(
            deduped,
            terminalsRef.current,
            sessionTabsRef.current
          )
          setTerminals((prev) =>
            terminalRecordsEqual(prev, mergedTerminals) ? prev : mergedTerminals
          )
          terminalsRef.current = mergedTerminals

          // Session tabs are the UI authority; terminal.list only refreshes per-handle metadata for existing terminal surfaces.
        }
      } catch {
        // Failed to list terminals
      } finally {
        fetchTerminalsInFlightRef.current = false
      }
    },
    [
      client,
      worktreeId,
      clearTerminalLiveInputDefault,
      defaultTerminalHandlesToLiveInput,
      nativeChatStream,
      pruneTerminalHandlesFromLiveInput,
      subscribeToTerminal,
      unsubscribeTerminal
    ]
  )

  const applySessionTabs = useCallback(
    (result: SessionTabsResult): SessionTabsApplyOutcome<MobileSessionTab> => {
      const diagnostics = terminalDiagnosticsRef.current
      // Reject stale snapshots; suppress just-closed tabs until the publisher confirms absence — see session-tab-snapshot-gate.
      if (!acceptSessionSnapshot(result, appliedSnapshotMarkerRef.current)) {
        return { accepted: false }
      }
      const applicationRevision = ++appliedSessionTabsRevisionRef.current
      let nextTabs = applyClosedTabTombstones(
        result.tabs,
        closedTabTombstonesRef.current,
        Date.now()
      )
      const presentTabIds = new Set(nextTabs.map((tab) => tab.id))
      const orphanedDraftTabs: MobileSessionTab[] = []
      const currentMarkdownDocs = markdownDocsRef.current
      const currentSessionTabs = sessionTabsRef.current
      for (const [tabId, doc] of currentMarkdownDocs) {
        if (doc.status !== 'ready' || !doc.isDirty || presentTabIds.has(tabId)) {
          continue
        }
        const draftTab = currentSessionTabs.find(
          (tab): tab is Extract<MobileSessionTab, { type: 'markdown' }> =>
            tab.type === 'markdown' && tab.id === tabId
        )
        if (draftTab) {
          // Why: mobile edits live on the phone until Save; if the desktop tab vanishes, keep drafts reachable for copy/discard.
          orphanedDraftTabs.push({ ...draftTab, isActive: tabId === activeSessionTabIdRef.current })
        }
      }
      if (orphanedDraftTabs.length > 0) {
        nextTabs = [...orphanedDraftTabs, ...nextTabs]
      }
      sessionTabsRef.current = nextTabs
      initialSessionAutoCreateRef.current.sawSessionTabs ||= nextTabs.length > 0
      // Why: subscribe snapshots often repeat identical payloads; skip re-set to avoid a subscription teardown/replay loop.
      setSessionTabs((prev) => (mobileSessionTabsEqual(prev, nextTabs) ? prev : nextTabs))
      const terminalTabs = getTerminalRecordsFromSessionTabs(nextTabs)
      const terminalTabHandles = terminalTabs.map((terminal) => terminal.handle)
      defaultTerminalHandlesToLiveInput(terminalTabHandles)
      const mergedTerminalsForActive = mergeTerminalRecordsByCurrentOrder(
        terminalTabs,
        terminalsRef.current
      )
      terminalsRef.current = mergedTerminalsForActive
      setTerminals((prev) =>
        terminalRecordsEqual(prev, mergedTerminalsForActive) ? prev : mergedTerminalsForActive
      )
      lastKnownTerminalCountRef.current = Math.max(
        lastKnownTerminalCountRef.current,
        terminalTabs.length
      )
      setTerminalsLoaded(true)
      const outcome = {
        accepted: true as const,
        effectiveTabs: nextTabs,
        applicationRevision
      }

      const snapshotActive = nextTabs.find((tab) => tab.isActive) ?? nextTabs[0] ?? null
      const pendingActiveSessionTabId = pendingActiveSessionTabIdRef.current
      const pendingActiveTerminalHandle = pendingActiveTerminalHandleRef.current
      let active = snapshotActive
      let selectionSource = 'snapshot'
      if (pendingActiveSessionTabId) {
        if (snapshotActive?.id === pendingActiveSessionTabId) {
          if (confirmsMirroredTabSelection(result.publicationEpoch)) {
            pendingActiveSessionTabIdRef.current = null
          } else {
            selectionSource = 'pending-tab-local-ack'
          }
        } else {
          const pendingTab = nextTabs.find((tab) => tab.id === pendingActiveSessionTabId)
          if (pendingTab) {
            // Why: desktop tab snapshots can lag a mobile tap mid-activate-RPC; keep the local selection to avoid snapping back.
            active = pendingTab
            selectionSource = 'pending-tab'
          } else {
            pendingActiveSessionTabIdRef.current = null
          }
        }
      }
      if (pendingActiveTerminalHandle) {
        const pendingTerminalTab = nextTabs.find(
          (tab): tab is Extract<MobileSessionTab, { type: 'terminal' }> =>
            tab.type === 'terminal' && tab.terminal === pendingActiveTerminalHandle
        )
        const pendingTerminalExists = mergedTerminalsForActive.some(
          (terminal) => terminal.handle === pendingActiveTerminalHandle
        )
        if (
          snapshotActive?.type === 'terminal' &&
          snapshotActive.terminal === pendingActiveTerminalHandle
        ) {
          if (confirmsMirroredTabSelection(result.publicationEpoch)) {
            pendingActiveTerminalHandleRef.current = null
          } else {
            selectionSource = 'pending-handle-local-ack'
          }
        } else if (pendingTerminalTab) {
          // Why: desktop active flags lag a mobile tap; key by handle too, as fallback PTY tabs lack a stable tab id at startup.
          active = pendingTerminalTab
          selectionSource = 'pending-handle-tab'
        } else if (pendingTerminalExists) {
          const nextActiveTabId = getActiveTabIdForHandle(nextTabs, pendingActiveTerminalHandle)
          activeSessionTabIdRef.current = nextActiveTabId
          setActiveSessionTabId(nextActiveTabId)
          activeSessionTabTypeRef.current = 'terminal'
          // Why: every other active-handle branch assigns the ref alongside the
          // state. Leaving it stale here makes `covered` resolve against the wrong
          // handle, so a native-chat rearm silently no-ops on the webview gates.
          activeHandleRef.current = pendingActiveTerminalHandle
          setActiveHandle(pendingActiveTerminalHandle)
          subscribeToTerminal(pendingActiveTerminalHandle)
          return outcome
        } else {
          pendingActiveTerminalHandleRef.current = null
        }
      }
      diagnostics.tabsApplied(result, nextTabs, active, selectionSource)
      activeSessionTabTypeRef.current = active?.type ?? null
      activeSessionTabIdRef.current = active?.id ?? null
      setActiveSessionTabId(active?.id ?? null)
      if (active?.type === 'terminal') {
        if (typeof active.terminal !== 'string') {
          const previous = activeHandleRef.current
          if (previous) {
            unsubscribeTerminal(previous)
            initializedHandlesRef.current.delete(previous)
          }
          activeHandleRef.current = null
          setActiveHandle(null)
          return outcome
        }
        const previous = activeHandleRef.current
        if (previous && previous !== active.terminal) {
          unsubscribeTerminal(previous)
          initializedHandlesRef.current.delete(previous)
        }
        activeHandleRef.current = active.terminal
        setActiveHandle(active.terminal)
        subscribeToTerminal(active.terminal)
      } else if (active) {
        // Why: an empty snapshot can transiently omit a live terminal; explicit close clears it on RPC success.
        const previous = activeHandleRef.current
        if (previous) {
          unsubscribeTerminal(previous)
          initializedHandlesRef.current.delete(previous)
        }
        activeHandleRef.current = null
        setActiveHandle(null)
      }
      return outcome
    },
    [defaultTerminalHandlesToLiveInput, subscribeToTerminal, unsubscribeTerminal]
  )

  const {
    readMarkdownTab,
    readFileTab,
    loadDiffComments,
    persistDiffComments,
    addDiffCommentForFile,
    deleteDiffCommentForFile,
    copyDiffCommentsToClipboard,
    sendDiffCommentsToAgent,
    clearDeliveredDiffComments,
    updateMarkdownLocalContent,
    copyMarkdownLocalContent,
    getDirtyMarkdownDrafts,
    leaveSession,
    requestLeaveSession,
    discardMarkdownLocalContent,
    confirmDiscardMarkdown,
    saveMarkdownTab
  } = useMobileSessionDocumentActions({
    client,
    setMarkdownDocs,
    worktreeId,
    setFileDocs,
    connState,
    isFloatingWorkspaceRoute,
    setDiffComments,
    diffCommentsRef,
    diffCommentBusy,
    setDiffCommentBusy,
    persistDiffComments,
    showToast,
    setPendingDiffNotesDelivery,
    markdownDocs,
    setLeaveDrafts,
    setDiscardMarkdownTarget,
    discardMarkdownTarget,
    markdownSaveInFlightRef,
    markdownSaveSeqRef,
    sessionTabs,
    router,
    hostId
  })

  const {
    consumeAcceptedSessionTabs,
    hasSessionTabsRecoveryNeed,
    getSessionTabsApplicationRevision,
    fetchSessionTabs,
    ensureSessionTabs,
    fetchPendingBrowserSessionTabs,
    hostQueryReplyInputSupportedRef,
    pendingForegroundRecoveryRef,
    notifyTerminalFrameHeight,
    notifyKeyboardVisibility,
    scrollActiveTabIntoView,
    handleDeleteCustomKey,
    handleManageShortcuts
  } = useMobileSessionRecovery({
    runAcceptedMobileSessionTabsEffects,
    pendingBrowserFocusPageIdRef,
    switchSessionTabRef,
    setMarkdownDocs,
    closedTabTombstonesRef,
    nativeChatStream,
    appliedSessionTabsRevisionRef,
    worktreeId,
    terminalDiagnosticsRef,
    client,
    connState,
    applySessionTabs,
    fetchTerminals,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    setBrowserScreencastSupported,
    setAgentSessionHistorySupported,
    setQuickCommandsSupported,
    setShowQuickCommands,
    startRuntimeCapabilityProbe,
    MOBILE_AI_VAULT_CAPABILITY,
    supportsMobileQuickCommands,
    TERMINAL_QUERY_REPLY_INPUT_RUNTIME_CAPABILITY,
    hostId,
    deviceTokenRef,
    setHostEndpoint,
    loadHosts,
    loadCustomKeys,
    setCustomKeys,
    loadTerminalAccessoryLayout,
    setVisibleBuiltInIds,
    terminalRefs,
    shouldRecoverTerminalOnAppStateChange,
    Platform,
    recoverActiveTerminalAfterForeground,
    activeHandleRef,
    initializedHandlesRef,
    connStateRef,
    unsubscribeTerminal,
    subscribeToTerminal,
    scheduleDelayedAction,
    terminalFrameHeightRef,
    viewportRef,
    viewportMeasuredRef,
    showNativeChatRef,
    clientRef,
    terminals,
    terminalTextScale,
    terminalFrameWidth,
    setKeyboardHeight,
    Keyboard,
    tabLayoutsRef,
    tabStripViewportWidthRef,
    tabStripContentWidthRef,
    tabStripOffsetRef,
    tabStripRef,
    resolveTabStripScrollOffset,
    activeSessionTabId,
    AsyncStorage,
    customKeys,
    saveCustomKeys,
    router,
    sessionTabActionSheetRequestSeqRef,
    sessionTabActionSheetKeyboardHideSubRef,
    clearTerminalCache,
    pendingActiveSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    pendingTerminalActivationAttemptRef,
    initialSessionAutoCreateRef,
    createInitialSessionAutoCreateState,
    setActiveHandle,
    setTerminals,
    terminalsRef,
    setSessionTabs,
    setActiveSessionTabId,
    clearPendingLiveInputCommit,
    clearDelayedActionTimers,
    setTerminalsLoaded,
    created,
    isFloatingWorkspaceRoute,
    headlessActivationNeedsHostRenderer,
    showToast,
    loadTerminalTextScale,
    setTerminalTextScale,
    loadTerminalAutocompleteEnabled,
    setAutocompleteEnabled,
    loadTerminalLinkOpenMode,
    setTerminalLinkOpenMode
  })

  // Why: unsubscribe restores old dims (clears phone-fit banner); resubscribe phone-fits the new one.
  const {
    switchTab,
    switchSessionTab,
    setTerminalWebViewRef,
    handleTerminalWebReady,
    handleSend,
    handleAccessoryKey,
    sendLiveTerminalInput,
    focusLiveInput,
    clearSessionTabActionSheetKeyboardListener,
    openSessionTabActionSheet,
    openSessionTabActionSheetAfterKeyboardDismiss,
    dismissSoftwareKeyboard,
    handleTerminalTap,
    handleFileTapActivationSeqRef,
    handleFileTap,
    handleOpenedFileDiffActivationSeqRef,
    fileOpenStartActiveTabIdRef,
    handleFileOpenStart,
    handleOpenedFileDiff,
    handleTerminalOpenUrl,
    sendLiveTerminalInputRef
  } = useMobileSessionTabInteractions({
    triggerSelection,
    sessionTabs,
    terminalDiagnosticsRef,
    pendingActiveSessionTabIdRef,
    pendingActiveTerminalHandleRef,
    activeSessionTabTypeRef,
    defaultTerminalHandlesToLiveInput,
    setActiveSessionTabId,
    activeHandleRef,
    setActiveHandle,
    unsubscribeTerminal,
    initializedHandlesRef,
    terminalUnsubsRef,
    subscribeToTerminal,
    client,
    activateMobileSessionTab,
    worktreeId,
    readFileTab,
    markdownDocs,
    readMarkdownTab,
    switchSessionTabRef,
    terminalRefs,
    terminalGestureInputBucketsRef,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    webReadyHandlesRef,
    nativeChatStream,
    measureViewportOnce,
    activeSessionTab,
    fileDocs,
    sendingRef,
    canSend,
    input,
    setInput,
    deviceTokenRef,
    buildTerminalSendParams,
    TERMINAL_INPUT_SEND_OPTIONS,
    handleLiveInputAccessoryBytes,
    clientRef,
    connStateRef,
    sendTerminalLiveAccessoryRawBytes,
    normalizeTerminalTextInput,
    isTerminalLiveInputWithinByteLimit,
    triggerError,
    showToast,
    isTerminalSendRpcAccepted,
    liveInputEnabled,
    focusTerminalLiveInputTarget,
    keyboardHeight,
    scheduleTerminalLiveInputFocus,
    liveInputRef,
    liveInputFocusTimerRef,
    sessionTabActionSheetKeyboardHideSubRef,
    setActionTarget,
    setMarkdownActionTarget,
    setFileActionTarget,
    setBrowserActionTarget,
    clearTerminalLiveInputFocusTimer,
    scheduleDelayedAction,
    commandInputRef,
    dismissTerminalKeyboard,
    handleCreateBrowserRef,
    hostId,
    routeWorktreeName,
    router,
    terminalCwdRef,
    fetchSessionTabs,
    sessionTabsRef,
    activeSessionTabIdRef,
    activateOpenedSourceControlDiffTab,
    terminalLinkOpenMode,
    isFloatingWorkspaceRoute
  })

  const {
    toggleLiveInput,
    allowTerminalGestureInput,
    flushTerminalGestureInput,
    enqueueTerminalGestureInput,
    handleTerminalInput,
    handleTerminalQueryReply,
    handleClearTerminal,
    handleAccessoryKeyRef,
    stopAccessoryRepeat,
    startAccessoryRepeat,
    setMobileSessionRootRef,
    handleSelectionMode,
    handleSelectionCopy,
    handleSelectionEvicted,
    handleModesChanged,
    handleKeyboardAvoidanceMetrics,
    handleHaptic
  } = useMobileSessionTerminalInput({
    activeHandle,
    toggleTerminalLiveInput,
    clearPendingLiveInputCommit,
    scheduleTerminalLiveInputFocus,
    liveInputFocusTimerRef,
    clearTerminalLiveInputFocusTimer,
    liveInputRef,
    terminalGestureInputBucketsRef,
    TERMINAL_GESTURE_INPUT_BUCKET_CAPACITY,
    TERMINAL_GESTURE_INPUT_REFILL_PER_SECOND,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    clientRef,
    connStateRef,
    buildTerminalSendParams,
    deviceTokenRef,
    TERMINAL_INPUT_SEND_OPTIONS,
    TERMINAL_GESTURE_INPUT_MAX_QUEUE_AGE_MS,
    TERMINAL_GESTURE_INPUT_MAX_PENDING_SEQUENCES,
    TERMINAL_GESTURE_INPUT_FLUSH_DELAY_MS,
    client,
    connState,
    ptyModesRef,
    isGestureMouseTrackingMode,
    countTerminalGestureInputSequences,
    sendMobileTerminalQueryReply,
    hostQueryReplyInputSupportedRef,
    terminalUnsubsRef,
    getTerminalRef,
    showToast,
    handleAccessoryKey,
    toastSeqRef,
    clearTerminalCache,
    clearToastHideTimer,
    clearDelayedActionTimers,
    sessionTabActionSheetRequestSeqRef,
    clearSessionTabActionSheetKeyboardListener,
    setSelectModeActive,
    terminalRefs,
    setTerminalKeyboardMetrics,
    initialModesSeenRef,
    triggerSelection,
    triggerSuccess,
    triggerError,
    triggerEdgeBump,
    setMobileSessionRootRef
  })

  const {
    getActiveWorktreeConnectionId,
    refreshCanPaste,
    handlePaste,
    flushPendingLiveInputBeforeAttachmentSend,
    attachImage,
    isAttaching,
    nativeChatImages,
    handleCreateTerminal
  } = useMobileSessionCreation({
    client,
    isFloatingWorkspaceRoute,
    worktreeId,
    getRepoIdFromMobileWorktreeId,
    setCanPaste,
    activeHandle,
    activeHandleRef,
    activeSessionTabTypeRef,
    canSend,
    connState,
    connStateRef,
    clientRef,
    deviceTokenRef,
    flushPendingLiveInputBeforeExternalSend,
    nativeChatInputLeaseReadyRef,
    nativeChatInputLeaseReady,
    nativeChatScopeKey,
    nativeChatController,
    nativeChatSendError,
    ptyModesRef,
    refreshCanPaste,
    showToast,
    triggerError,
    triggerSelection,
    selectModeActive,
    terminalRefs,
    showCreateTabDrawer,
    pendingDiffNotesDelivery,
    setCreateTabAgentLoadState,
    setCreateTabAgentOptions,
    loadMobileNewTabAgentOptions,
    creatingTerminalRef,
    setCreating,
    setCreateError,
    activeSessionTab,
    unsubscribeTerminal,
    initializedHandlesRef,
    pendingActiveSessionTabIdRef,
    setActiveSessionTabId,
    setSessionTabs,
    defaultTerminalHandlesToLiveInput,
    pendingActiveTerminalHandleRef,
    setActiveHandle,
    setTerminals,
    terminalsRef,
    terminalRecordsEqual,
    subscribeToTerminal,
    options,
    scheduleDelayedAction,
    fetchSessionTabs,
    creatingMarkdown,
    creatingBrowser,
    browserScreencastSupportedRef,
    normalizeBrowserUrl,
    setCreatingMarkdown,
    setCreatingBrowser,
    fetchPendingBrowserSessionTabs,
    pendingBrowserFocusPageIdRef,
    setTerminalsLoaded,
    fetchTerminals,
    renameTarget,
    setRenameTarget,
    clearTerminalLiveInputDefault,
    terminals,
    sessionTabsRef,
    closedTabTombstonesRef,
    activeSessionTabIdRef
  })

  const {
    launchQuickCommand,
    handleCreateMarkdownNote,
    handleCreateBrowser,
    handleBrowserNavigationCommand,
    handleRenameTerminal,
    handleCloseTerminal,
    handleCloseSessionTab
  } = useMobileSessionActions({
    client,
    connState,
    creatingTerminalRef,
    creatingBrowser,
    creatingMarkdown,
    buildMobileQuickCommandLaunch,
    triggerError,
    showToast,
    handleCreateTerminal,
    setCreatingMarkdown,
    setCreateError,
    worktreeId,
    captureMobileFileMutationOwnership,
    isFileExistsErrorMessage,
    scheduleDelayedAction,
    fetchSessionTabs,
    setCreatingBrowser,
    browserScreencastSupportedRef,
    normalizeBrowserUrl,
    pendingBrowserFocusPageIdRef,
    fetchPendingBrowserSessionTabs,
    handleCreateBrowserRef,
    renameTarget,
    setRenameTarget,
    setTerminals,
    terminalsRef,
    fetchTerminals,
    unsubscribeTerminal,
    terminalRefs,
    initializedHandlesRef,
    clearTerminalLiveInputDefault,
    terminals,
    activeHandleRef,
    pendingActiveTerminalHandleRef,
    setActiveHandle,
    subscribeToTerminal,
    sessionTabsRef,
    setSessionTabs,
    closedTabTombstonesRef,
    activeSessionTabIdRef,
    activeSessionTabTypeRef,
    setActiveSessionTabId,
    defaultTerminalHandlesToLiveInput,
    pendingActiveSessionTabIdRef
  })

  const bulkCloseActions = createBulkCloseSheetActions({
    sessionTabsRef,
    markdownDocs,
    activeSessionTabIdRef,
    switchSessionTab,
    closeSessionTab: handleCloseSessionTab
  })
  const closeWithBulkActions = createCloseWithBulkActions(handleCloseSessionTab, bulkCloseActions)

  const visibleTabs: MobileSessionTab[] = sessionTabs
  const activeMarkdownTab = activeSessionTab?.type === 'markdown' ? activeSessionTab : null
  const activeFileTab = activeSessionTab?.type === 'file' ? activeSessionTab : null
  const activeBrowserTab = activeSessionTab?.type === 'browser' ? activeSessionTab : null
  const activePendingTerminalTab =
    activeSessionTab?.type === 'terminal' && typeof activeSessionTab.terminal !== 'string'
      ? activeSessionTab
      : null

  useEffect(() => {
    if (!client || connState !== 'connected' || !activePendingTerminalTab) {
      if (connState !== 'connected' || !activePendingTerminalTab) {
        pendingTerminalActivationAttemptRef.current = null
      }
      return
    }
    const activationKey = `${worktreeId}:${activePendingTerminalTab.id}:${activePendingTerminalTab.leafId ?? ''}`
    if (pendingTerminalActivationAttemptRef.current === activationKey) {
      return
    }
    // Why: a server-owned tab can be active but still pending; activation is the RPC that materializes its PTY handle.
    pendingTerminalActivationAttemptRef.current = activationKey
    void activateMobileSessionTab(client, {
      worktree: `id:${worktreeId}`,
      tabId: activePendingTerminalTab.id,
      leafId: activePendingTerminalTab.leafId,
      notifyClients: false,
      navigation: 'caller'
    })
      .then((response) => {
        if (!response.ok) {
          if (pendingTerminalActivationAttemptRef.current === activationKey) {
            pendingTerminalActivationAttemptRef.current = null
          }
          return
        }
        applySessionTabs((response as RpcSuccess).result as SessionTabsResult)
        scheduleDelayedAction(() => void fetchSessionTabs(), 300)
        scheduleDelayedAction(() => void fetchSessionTabs(), 1200)
      })
      .catch(() => {
        if (pendingTerminalActivationAttemptRef.current === activationKey) {
          pendingTerminalActivationAttemptRef.current = null
        }
      })
  }, [
    activePendingTerminalTab,
    applySessionTabs,
    client,
    connState,
    fetchSessionTabs,
    scheduleDelayedAction,
    worktreeId
  ])

  const showLoadingState = connState === 'connected' && !terminalsLoaded && visibleTabs.length === 0
  const showEmptyState =
    connState === 'connected' && terminalsLoaded && visibleTabs.length === 0 && !activeHandle

  // Why: a newly created workspace can hydrate with zero tabs before its first terminal exists.
  useInitialSessionTerminalAutoCreate({
    client,
    newlyCreatedWorkspace: created === '1',
    connState,
    terminalsLoaded,
    visibleTabCount: visibleTabs.length,
    activeHandle,
    createInFlight: creating || creatingBrowser || creatingMarkdown,
    stateRef: initialSessionAutoCreateRef,
    worktreeId,
    consumeCreationRoute: () => router.setParams({ created: undefined }),
    createTerminal: () => void handleCreateTerminal()
  })

  // Why: reconnect trickles to 90s at its give-up cap; surface tap-to-retry so recovery needn't wait it out (issue #5049).
  const connectionVerdict = classifyConnection({
    state: connState,
    reconnectAttempts,
    lastConnectedAt,
    endpoint: hostEndpoint
  })
  const showConnectionRetry =
    connectionVerdict.kind === 'warning' || connectionVerdict.kind === 'unreachable'

  const terminalSummary =
    connState === 'connected'
      ? showLoadingState
        ? 'Loading tabs'
        : visibleTabs.length === 1
          ? '1 tab'
          : `${visibleTabs.length} tabs`
      : showConnectionRetry
        ? `${verdictDisplayLabel(connectionVerdict)} — tap to retry`
        : MOBILE_SESSION_STATUS_LABELS[connState]

  // Why: iOS keyboard height includes the home-indicator inset; Android IME height does not.
  const keyboardLift =
    keyboardHeight > 0
      ? Platform.OS === 'ios'
        ? Math.max(0, keyboardHeight - insets.bottom)
        : keyboardHeight
      : 0
  const activeTerminalKeyboardLift = (() => {
    if (keyboardLift <= 0 || !activeHandle) {
      return 0
    }
    const metrics = terminalKeyboardMetrics.get(activeHandle)
    if (!metrics || metrics.rows <= 0 || terminalFrameHeightRef.current <= 0) {
      return keyboardLift
    }
    if (metrics.altScreen) {
      return keyboardLift
    }
    const rowHeight = terminalFrameHeightRef.current / metrics.rows
    const cursorBottom = (metrics.cursorY + 1) * rowHeight
    const dockTop = terminalFrameHeightRef.current - keyboardLift
    const margin = rowHeight
    // Why: only move the terminal when the cursor would sit under the raised input dock; short top output stays put.
    return Math.min(keyboardLift, Math.max(0, cursorBottom + margin - dockTop))
  })()
  const toastAnimatedStyle = {
    opacity: toastOpacityRef.current,
    transform: [{ translateY: -keyboardLift }]
  }
  const createTabAgentActions =
    createTabAgentLoadState === 'loading'
      ? [
          {
            label: 'Detecting Agents',
            icon: Bot,
            disabled: true,
            loading: true,
            onPress: () => {}
          }
        ]
      : createTabAgentOptions.length > 0
        ? createTabAgentOptions.map((option) => ({
            label: option.label,
            renderIcon: () => <MobileAgentIcon agentId={option.agent} size={16} />,
            onPress: () => {
              setShowCreateTabDrawer(false)
              void handleCreateTerminal(option.agent)
            }
          }))
        : createTabAgentLoadState === 'loaded'
          ? [
              {
                label: 'No Enabled Agents',
                icon: Bot,
                disabled: true,
                onPress: () => {}
              }
            ]
          : createTabAgentLoadState === 'error'
            ? [
                {
                  label: 'Agent Presets Unavailable',
                  hint: 'Check the host connection',
                  icon: Bot,
                  disabled: true,
                  onPress: () => {}
                }
              ]
            : []
  const sendDiffNotesAgentActions =
    pendingDiffNotesDelivery === null
      ? []
      : createTabAgentLoadState === 'loading'
        ? [
            {
              label: 'Detecting Agents',
              icon: Bot,
              disabled: true,
              loading: true,
              onPress: () => {}
            }
          ]
        : createTabAgentOptions.length > 0
          ? createTabAgentOptions.map((option) => ({
              label: option.label,
              hint: 'New agent session',
              icon: Bot,
              onPress: () => {
                const delivery = pendingDiffNotesDelivery
                setPendingDiffNotesDelivery(null)
                if (!delivery) {
                  return
                }
                void handleCreateTerminal(option.agent, {
                  initialPrompt: delivery.prompt,
                  onPromptSent: () => void clearDeliveredDiffComments(delivery.comments)
                })
              }
            }))
          : createTabAgentLoadState === 'loaded'
            ? [
                {
                  label: 'No Enabled Agents',
                  icon: Bot,
                  disabled: true,
                  onPress: () => {}
                }
              ]
            : createTabAgentLoadState === 'error'
              ? [
                  {
                    label: 'Agent Presets Unavailable',
                    hint: 'Copy notes instead',
                    icon: Bot,
                    disabled: true,
                    onPress: () => {}
                  }
                ]
              : []

  // Panel-icon taps route through the dock-vs-push decision (U1): dock-capable rows dock, constrained rows push.
  const handleSessionContentRowLayout = useCallback((event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width)
    setSessionContentRowWidth((prev) => (prev === width ? prev : width))
  }, [])

  const handlePanelTap = (tapped: Exclude<ActivePanel, null>) => {
    const action = resolvePanelAction({ canDock: canDockPanel, tapped, current: activePanel })
    if (action.kind === 'dock') {
      setActivePanel(action.next)
      return
    }
    const descriptor = panelRouteDescriptor(action.panel)
    router.push({
      pathname: descriptor.pathname,
      params: {
        hostId,
        worktreeId,
        name: worktreeName || '',
        // SC + PR both land on the source-control hub with origin:'session' for post-diff-open dismissal (U2); Files opts out.
        ...(action.panel === 'sourceControl' || action.panel === 'pr' ? { origin: 'session' } : {}),
        // The PR panel routes into the hub's Pull Request segment via descriptor params.
        ...descriptor.params
      }
    })
  }

  const openAgentSessionHistory = () => {
    const params = new URLSearchParams({ name: worktreeName || '' })
    router.push(`/h/${hostId}/agent-history/${encodeURIComponent(worktreeId)}?${params.toString()}`)
  }
  const showAgentSessionHistoryAction =
    !isFolderWorkspaceRoute && !isFloatingWorkspaceRoute && agentSessionHistorySupported === true
  const showChecksAction = shouldShowSessionHeaderChecksAction({
    isFolderWorkspaceRoute: isFolderWorkspaceRoute || isFloatingWorkspaceRoute,
    repoContextLoaded: prRepoContextLoaded,
    hostedChecksSupported: prIsGithubRepo
  })
  const showHeaderMoreButton = showAgentSessionHistoryAction || showChecksAction
  const createTabBusy = creating || creatingBrowser || creatingMarkdown

  return (
    <View ref={setMobileSessionRootRef} style={styles.container}>
      <View style={styles.kavInner}>
        <SafeAreaView style={styles.sessionChrome} edges={['top']}>
          <View style={styles.sessionTopBar}>
            <Pressable
              style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              onPress={requestLeaveSession}
              hitSlop={8}
              accessibilityLabel="Back to worktrees"
            >
              <ChevronLeft size={22} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>

            <View style={styles.sessionTitleBlock}>
              <Text style={styles.sessionTitle} numberOfLines={1}>
                {worktreeName || 'Terminal'}
              </Text>
              <Pressable
                style={styles.sessionMetaRow}
                disabled={!showConnectionRetry}
                onPress={() => {
                  if (hostId) {
                    void forceReconnectHost(hostId)
                  }
                }}
                accessibilityRole={showConnectionRetry ? 'button' : undefined}
                accessibilityLabel={showConnectionRetry ? 'Reconnect to desktop' : undefined}
              >
                <StatusDot state={connState} />
                <Text style={styles.sessionMetaText} numberOfLines={1}>
                  {terminalSummary}
                </Text>
              </Pressable>
            </View>
            {!isFloatingWorkspaceRoute && (
              <MobileSessionHeaderIconButton
                active={activePanel === 'files'}
                accessibilityLabel="Open file explorer"
                icon={Folder}
                onPress={() => handlePanelTap('files')}
              />
            )}
            {!isFolderWorkspaceRoute && !isFloatingWorkspaceRoute && (
              <MobileSessionHeaderIconButton
                active={activePanel === 'sourceControl'}
                accessibilityLabel="Open source control"
                icon={GitBranch}
                onPress={() => handlePanelTap('sourceControl')}
              />
            )}
            {showHeaderMoreButton ? (
              <MobileSessionHeaderIconButton
                active={activePanel === 'pr'}
                accessibilityLabel="More session actions"
                icon={MoreHorizontal}
                onPress={() => setShowHeaderMoreActions(true)}
              />
            ) : null}
          </View>

          {visibleTabs.length > 0 && (
            <View style={styles.tabBar}>
              {/* Why: tab taps must register on first press with the keyboard open instead of being eaten by dismissal (#5106). */}
              <ScrollView
                ref={tabStripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tabScroll}
                contentContainerStyle={styles.tabContent}
                keyboardShouldPersistTaps="handled"
                scrollEventThrottle={16}
                onScroll={(e) => {
                  tabStripOffsetRef.current = e.nativeEvent.contentOffset.x
                }}
                onLayout={(e) => {
                  tabStripViewportWidthRef.current = e.nativeEvent.layout.width
                  scrollActiveTabIntoView(activeSessionTabIdRef.current, false)
                }}
                onContentSizeChange={(width) => {
                  tabStripContentWidthRef.current = width
                  scrollActiveTabIntoView(activeSessionTabIdRef.current, false)
                }}
              >
                {visibleTabs.map((t) => (
                  <Pressable
                    key={t.id}
                    style={[styles.tab, t.id === activeSessionTabId && styles.tabActive]}
                    onLayout={(e) => {
                      const { x, width } = e.nativeEvent.layout
                      tabLayoutsRef.current.set(t.id, { x, width })
                      if (t.id === activeSessionTabIdRef.current) {
                        scrollActiveTabIntoView(t.id, false)
                      }
                    }}
                    onPress={() => switchSessionTab(t)}
                    onLongPress={() => {
                      triggerMediumImpact()
                      openSessionTabActionSheetAfterKeyboardDismiss(t)
                    }}
                    delayLongPress={400}
                  >
                    <View style={styles.tabLabelRow}>
                      {t.type === 'browser' && (
                        <Globe size={13} color={colors.textSecondary} strokeWidth={2.1} />
                      )}
                      {t.type === 'markdown' && (
                        <FileText size={13} color={colors.textSecondary} strokeWidth={2.1} />
                      )}
                      {t.type === 'file' && (
                        <File size={13} color={colors.textSecondary} strokeWidth={2.1} />
                      )}
                      {t.type === 'terminal' &&
                        (() => {
                          const agentId = resolveMobileTerminalTabAgentId(t)
                          return agentId ? <MobileAgentIcon agentId={agentId} size={13} /> : null
                        })()}
                      <Text
                        style={[
                          styles.tabText,
                          t.id === activeSessionTabId && styles.tabTextActive
                        ]}
                        numberOfLines={1}
                      >
                        {getMobileSessionTabTitle(t)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
              {/* Why: pinned outside the scroll strip so the new-agent button stays reachable however far the tabs scroll. */}
              <Pressable
                style={({ pressed }) => [
                  styles.newTerminalButton,
                  pressed && styles.newTerminalButtonPressed,
                  (creating || creatingBrowser || creatingMarkdown || connState !== 'connected') &&
                    styles.newTerminalButtonDisabled
                ]}
                disabled={
                  creating || creatingBrowser || creatingMarkdown || connState !== 'connected'
                }
                onPress={() => {
                  setCreateError('')
                  setShowCreateTabDrawer(true)
                }}
                accessibilityLabel="New tab"
              >
                <Plus size={16} color={colors.textSecondary} strokeWidth={2.2} />
              </Pressable>
              {/* Why: stable placement matters, while old hosts must stay gated because they strip agentPrompt. */}
              <QuickCommandsTabButton
                disabled={
                  creating || creatingBrowser || creatingMarkdown || connState !== 'connected'
                }
                onPress={() => {
                  if (quickCommandsSupported === true) {
                    setShowQuickCommands(true)
                    return
                  }
                  showToast(
                    quickCommandsSupported === false
                      ? 'Desktop update required for quick commands'
                      : 'Checking desktop capabilities — try again in a moment',
                    1600
                  )
                }}
              />
            </View>
          )}
        </SafeAreaView>

        {/* Content-row host (KTD2): on wide, content shares this row with the docked panel as the flex-1 left child. */}
        <View style={styles.sessionContentRow} onLayout={handleSessionContentRowLayout}>
          <View style={styles.sessionContentMain}>
            {createWarning ? (
              <View style={styles.createWarningBanner}>
                <AlertTriangle size={16} color={colors.statusAmber} strokeWidth={2.2} />
                <Text style={styles.createWarningText}>{createWarning}</Text>
                <Pressable
                  style={styles.createWarningDismiss}
                  onPress={() => setCreateWarningState(dismissMobileSessionCreateWarningState)}
                  accessibilityLabel="Dismiss workspace creation warning"
                  hitSlop={8}
                >
                  <X size={16} color={colors.textMuted} strokeWidth={2.2} />
                </Pressable>
              </View>
            ) : null}

            {showLoadingState ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
              </View>
            ) : showEmptyState ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No tabs in this session</Text>
                {createError ? <Text style={styles.createError}>{createError}</Text> : null}
                <View style={styles.emptyActions}>
                  <Pressable
                    style={[
                      styles.createButton,
                      (createTabBusy || connState !== 'connected') && styles.createButtonDisabled
                    ]}
                    disabled={createTabBusy || connState !== 'connected'}
                    onPress={() => {
                      setCreateError('')
                      setShowCreateTabDrawer(true)
                    }}
                  >
                    <Text style={styles.createButtonText}>
                      {createTabBusy ? 'Creating...' : 'Create Tab'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : activeMarkdownTab ? (
              <View style={styles.markdownFrame}>
                <MarkdownReader
                  documentId={activeMarkdownTab.id}
                  doc={markdownDocs.get(activeMarkdownTab.id)}
                  onRefresh={() => void readMarkdownTab(activeMarkdownTab)}
                  onChange={(content) => updateMarkdownLocalContent(activeMarkdownTab.id, content)}
                  onSave={() => void saveMarkdownTab(activeMarkdownTab)}
                  onCopy={() => void copyMarkdownLocalContent(activeMarkdownTab.id)}
                  onDiscard={() => discardMarkdownLocalContent(activeMarkdownTab)}
                  keyboardLift={keyboardLift}
                />
                {toastMessage && (
                  <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                    <Text style={styles.toastText}>{toastMessage}</Text>
                  </Animated.View>
                )}
              </View>
            ) : activeFileTab ? (
              <View style={styles.markdownFrame}>
                <FileReader
                  doc={fileDocs.get(activeFileTab.id)}
                  title={activeFileTab.title || 'File'}
                  relativePath={activeFileTab.relativePath}
                  language={activeFileTab.language}
                  diffCommentActions={
                    activeFileTab.diffSource === 'staged' || activeFileTab.diffSource === 'unstaged'
                      ? {
                          comments: diffComments,
                          busy: diffCommentBusy,
                          onAdd: addDiffCommentForFile,
                          onDelete: deleteDiffCommentForFile,
                          onCopyAll: copyDiffCommentsToClipboard,
                          onSendAll: sendDiffCommentsToAgent
                        }
                      : undefined
                  }
                />
                {toastMessage && (
                  <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                    <Text style={styles.toastText}>{toastMessage}</Text>
                  </Animated.View>
                )}
              </View>
            ) : activeBrowserTab ? (
              <View style={styles.browserFrame}>
                {/* Why: pane owns imperative frame refs; don't render a stale frame while the old stream effect cleans up. */}
                <MobileBrowserPane
                  key={activeBrowserTab.browserPageId ?? activeBrowserTab.id}
                  client={client}
                  worktreeId={worktreeId}
                  tab={activeBrowserTab}
                  screencastSupported={browserScreencastSupported}
                  keyboardLift={keyboardLift}
                  bottomInset={insets.bottom}
                  onToast={showToast}
                />
                {toastMessage && (
                  <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                    <Text style={styles.toastText}>{toastMessage}</Text>
                  </Animated.View>
                )}
              </View>
            ) : activePendingTerminalTab ? (
              <View style={styles.emptyState}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text style={styles.emptyText}>
                  {activePendingTerminalTab.title || 'Loading terminal'}
                </Text>
              </View>
            ) : (
              <View
                style={styles.terminalFrame}
                onLayout={(e) => {
                  terminalFrameHeightRef.current = e.nativeEvent.layout.height
                  // Why: notify height imperatively so dock settling re-fits the PTY without rerendering SessionScreen.
                  const nextWidth = Math.round(e.nativeEvent.layout.width)
                  const nextHeight = Math.round(e.nativeEvent.layout.height)
                  setTerminalFrameWidth((prev) => (prev === nextWidth ? prev : nextWidth))
                  notifyTerminalFrameHeight(nextHeight)
                }}
              >
                {terminals.map((terminal) => (
                  <TerminalPaneView
                    key={terminal.handle}
                    handle={terminal.handle}
                    active={terminal.handle === activeHandle}
                    keyboardLift={terminal.handle === activeHandle ? activeTerminalKeyboardLift : 0}
                    terminalTheme={terminal.terminalTheme}
                    textScale={terminalTextScale}
                    onTextScaleChange={(scale) => {
                      // Why: pinch-to-zoom reports a new preset; persist it so the size sticks across panes and launches.
                      setTerminalTextScale(scale)
                      void saveTerminalTextScale(scale)
                    }}
                    onRef={setTerminalWebViewRef}
                    onWebReady={handleTerminalWebReady}
                    onSelectionMode={handleSelectionMode}
                    onSelectionCopy={handleSelectionCopy}
                    onSelectionEvicted={handleSelectionEvicted}
                    onModesChanged={handleModesChanged}
                    onKeyboardAvoidanceMetrics={handleKeyboardAvoidanceMetrics}
                    onHaptic={handleHaptic}
                    onTerminalInput={handleTerminalInput}
                    onTerminalQueryReply={handleTerminalQueryReply}
                    onTerminalTap={handleTerminalTap}
                    onFileTap={handleFileTap}
                    onOpenUrl={handleTerminalOpenUrl}
                  />
                ))}
                <MobileNativeChatOverlay
                  controller={nativeChatController}
                  images={nativeChatImages}
                  onMicPress={handleDictationToggle}
                  micActive={dictation.isRecording}
                  dictationMode={dictationMode}
                  onMicPressIn={handleDictationPressIn}
                  onMicPressOut={handleDictationPressOut}
                  inputLockReason={nativeChatInputLockReason}
                  sendErrorMessage={nativeChatSendError.message}
                  onClearSendError={nativeChatSendError.clear}
                  keyboardInset={keyboardLift}
                />
                {toastMessage && (
                  <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
                    <Text style={styles.toastText}>{toastMessage}</Text>
                  </Animated.View>
                )}
              </View>
            )}

            {/* Why: translate instead of resize so keyboard toggles don't trigger a server-side PTY viewport change. */}
            {!activeMarkdownTab && !activeFileTab && !activeBrowserTab && !showNativeChat && (
              <View
                style={[
                  styles.commandDock,
                  { paddingBottom: insets.bottom, transform: [{ translateY: -keyboardLift }] }
                ]}
              >
                {/* Accessory keys */}
                <View style={styles.accessoryBar}>
                  {/* Why: fixed keyboard escape hatch; outside ScrollView + shortcut path so it can't scroll away or be hidden (#5106). */}
                  {keyboardLift > 0 && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.keyboardDismissKey,
                        pressed && styles.accessoryKeyPressed
                      ]}
                      onPress={dismissSoftwareKeyboard}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss keyboard"
                      accessibilityHint="Hides the software keyboard and keeps the current terminal session open."
                    >
                      <View style={styles.keyboardDismissGlyph}>
                        <KeyboardIcon size={15} color={colors.textSecondary} strokeWidth={2} />
                        <ChevronDown
                          size={10}
                          color={colors.textSecondary}
                          strokeWidth={2.5}
                          style={styles.keyboardDismissChevron}
                        />
                      </View>
                    </Pressable>
                  )}
                  {/* Why: default tap handling makes the first accessory-key tap dismiss the keyboard and get swallowed (#5106). */}
                  <ScrollView
                    style={styles.accessoryScroll}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.accessoryContent}
                    keyboardShouldPersistTaps="always"
                  >
                    <Pressable
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        pressed && styles.accessoryKeyPressed,
                        !canSend && styles.accessoryKeyDisabled
                      ]}
                      disabled={!canSend}
                      onPress={() => {
                        if (activeHandle) {
                          void toggleDisplayMode(activeHandle)
                        }
                      }}
                      accessibilityLabel={
                        isTerminalPhoneDisplayMode(activeHandle, terminalModes)
                          ? 'Switch to desktop mode'
                          : 'Switch to phone mode'
                      }
                    >
                      {isTerminalPhoneDisplayMode(activeHandle, terminalModes) ? (
                        <Monitor
                          size={14}
                          color={canSend ? colors.textSecondary : colors.textMuted}
                        />
                      ) : (
                        <Smartphone
                          size={14}
                          color={canSend ? colors.textSecondary : colors.textMuted}
                        />
                      )}
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        liveInputEnabled && styles.accessoryKeyActive,
                        pressed && styles.accessoryKeyPressed,
                        !canCompose && styles.accessoryKeyDisabled
                      ]}
                      // Why: offline, live mode is dead but the buffered box still composes — keep the escape hatch tappable (#6713).
                      disabled={!canCompose}
                      onPress={toggleLiveInput}
                      accessibilityLabel={
                        liveInputEnabled
                          ? 'Switch to buffered command input'
                          : 'Switch to live terminal input'
                      }
                    >
                      <ChevronsRight
                        size={14}
                        color={
                          liveInputEnabled
                            ? colors.bgBase
                            : canCompose
                              ? colors.textSecondary
                              : colors.textMuted
                        }
                      />
                    </Pressable>
                    {canPaste && (
                      <Pressable
                        style={({ pressed }) => [
                          styles.accessoryKey,
                          pressed && styles.accessoryKeyPressed,
                          !canSend && styles.accessoryKeyDisabled
                        ]}
                        disabled={!canSend}
                        onPress={() => void handlePaste()}
                        accessibilityLabel="Paste from clipboard"
                      >
                        <Text
                          style={[
                            styles.accessoryKeyText,
                            !canSend && styles.accessoryKeyTextDisabled
                          ]}
                        >
                          Paste
                        </Text>
                      </Pressable>
                    )}
                    {visibleBuiltInAccessoryKeys.map((key) => (
                      <Pressable
                        key={key.id}
                        style={({ pressed }) => [
                          styles.accessoryKey,
                          pressed && styles.accessoryKeyPressed,
                          !canSend && styles.accessoryKeyDisabled
                        ]}
                        disabled={!canSend}
                        onPressIn={() => {
                          if (!key.repeatable) {
                            return
                          }
                          const input = createTerminalLiveAccessoryInput(key)
                          void handleAccessoryKey(input)
                          startAccessoryRepeat(input)
                        }}
                        onPressOut={() => {
                          if (key.repeatable) {
                            stopAccessoryRepeat()
                          }
                        }}
                        onPress={() => {
                          if (key.repeatable) {
                            return
                          }
                          void handleAccessoryKey(createTerminalLiveAccessoryInput(key))
                        }}
                        accessibilityLabel={key.accessibilityLabel ?? `Send ${key.label}`}
                      >
                        <Text
                          style={[
                            styles.accessoryKeyText,
                            !canSend && styles.accessoryKeyTextDisabled
                          ]}
                        >
                          {key.label}
                        </Text>
                      </Pressable>
                    ))}
                    {customKeys.map((key) => (
                      <Pressable
                        key={key.id}
                        style={({ pressed }) => [
                          styles.accessoryKey,
                          styles.customAccessoryKey,
                          pressed && styles.accessoryKeyPressed,
                          !canSend && styles.accessoryKeyDisabled
                        ]}
                        disabled={!canSend}
                        onPress={() => void handleAccessoryKey({ bytes: key.bytes })}
                        onLongPress={() => {
                          triggerMediumImpact()
                          setDeleteKeyTarget(key)
                        }}
                        delayLongPress={400}
                        accessibilityLabel={`Send ${key.label}`}
                      >
                        <Text
                          style={[
                            styles.accessoryKeyText,
                            !canSend && styles.accessoryKeyTextDisabled
                          ]}
                        >
                          {key.label}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      style={({ pressed }) => [
                        styles.accessoryKey,
                        pressed && styles.accessoryKeyPressed
                      ]}
                      onPress={() => setShowCustomKeyModal(true)}
                      accessibilityLabel="Add custom shortcut"
                    >
                      <Plus size={14} color={colors.textSecondary} strokeWidth={2.2} />
                    </Pressable>
                  </ScrollView>
                </View>

                {/* Input bar */}
                {liveInputEnabled ? (
                  <View style={[styles.inputBar, styles.liveInputBar]}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.liveInputFocusTarget,
                        pressed && styles.liveInputFocusTargetPressed,
                        !canSend && styles.liveInputFocusTargetDisabled
                      ]}
                      disabled={!canSend}
                      onPress={focusLiveInput}
                      accessibilityRole="button"
                      accessibilityLabel="Show keyboard for live terminal input"
                      accessibilityHint="Typed text is sent directly to the active terminal"
                    >
                      <KeyboardIcon size={16} color={colors.textSecondary} strokeWidth={2} />
                      <MobileTerminalLiveInputStatus
                        dictation={dictation}
                        isAttaching={isAttaching}
                      />
                    </Pressable>
                    <MobileTerminalInputActions
                      canSend={canSend}
                      isAttaching={isAttaching}
                      dictation={dictation}
                      dictationMode={dictationMode}
                      buttonStyle={styles.dictationButton}
                      activeButtonStyle={styles.dictationButtonActive}
                      disabledButtonStyle={styles.sendButtonDisabled}
                      onAttachImage={() => void attachImage('library')}
                      onAttachFile={() => void attachImage('files')}
                      onDictationToggle={handleDictationToggle}
                      onDictationPressIn={handleDictationPressIn}
                      onDictationPressOut={handleDictationPressOut}
                      onDictationCancel={cancelDictation}
                    />
                    <TextInput
                      ref={liveInputRef}
                      style={styles.liveInputCapture}
                      value={liveInputCapture}
                      onChangeText={handleLiveInputChange}
                      onKeyPress={handleLiveInputKeyPress}
                      onSubmitEditing={handleLiveInputSubmit}
                      placeholder=""
                      showSoftInputOnFocus
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      smartInsertDelete={false}
                      // Why: iOS textContentType overrides autoComplete and can narrow the keyboard; keep IME switching available.
                      autoComplete="off"
                      keyboardType={getTerminalLiveInputKeyboardType(Platform.OS)}
                      returnKeyType="default"
                      blurOnSubmit={false}
                      editable={canSend}
                      importantForAutofill="no"
                    />
                  </View>
                ) : (
                  <View style={styles.inputBar}>
                    <TextInput
                      ref={commandInputRef}
                      // Why: Android caches IME inputType at mount, so toggling autocomplete must remount there; iOS updates in place.
                      key={
                        Platform.OS === 'android'
                          ? autocompleteEnabled
                            ? 'cmd-input-ac-on'
                            : 'cmd-input-ac-off'
                          : 'cmd-input'
                      }
                      style={styles.textInput}
                      value={input}
                      // Why: iOS kills active dictation/IME if JS writes a value differing from native text; store raw, normalize at send.
                      onChangeText={setInput}
                      placeholder="Type a command…"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={autocompleteEnabled}
                      spellCheck={autocompleteEnabled}
                      smartInsertDelete={false}
                      // Why: not autofill content, but keyboard must stay default so non-Latin IMEs remain selectable.
                      autoComplete="off"
                      keyboardType={getTerminalCommandKeyboardType(
                        Platform.OS,
                        autocompleteEnabled
                      )}
                      returnKeyType="send"
                      // Why: composing is local — an outage must not lock the field or discard typed text (#6713).
                      editable={canCompose}
                      onSubmitEditing={() => void handleSend()}
                    />
                    <MobileTerminalInputActions
                      canSend={canSend}
                      isAttaching={isAttaching}
                      dictation={dictation}
                      dictationMode={dictationMode}
                      buttonStyle={styles.dictationButton}
                      activeButtonStyle={styles.dictationButtonActive}
                      disabledButtonStyle={styles.sendButtonDisabled}
                      onAttachImage={() => void attachImage('library')}
                      onAttachFile={() => void attachImage('files')}
                      onDictationToggle={handleDictationToggle}
                      onDictationPressIn={handleDictationPressIn}
                      onDictationPressOut={handleDictationPressOut}
                      onDictationCancel={cancelDictation}
                    />
                    <Pressable
                      style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
                      disabled={!canSend}
                      onPress={() => void handleSend()}
                      accessibilityLabel="Send command"
                    >
                      <ArrowUp size={18} color={colors.textSecondary} strokeWidth={2.5} />
                    </Pressable>
                  </View>
                )}
              </View>
            )}
          </View>
          {canDockPanel && activePanel !== null && (
            <SessionDockColumn
              activePanel={activePanel}
              hostId={hostId}
              worktreeId={worktreeId}
              name={worktreeName || ''}
              availableWidth={sessionContentRowWidth}
              onRequestClose={() => setActivePanel(null)}
              onFileOpenStart={handleFileOpenStart}
              onOpenedFileDiff={handleOpenedFileDiff}
            />
          )}
        </View>
      </View>

      <MobileSessionHeaderMoreActionsSheet
        visible={showHeaderMoreActions}
        showAgentSessionHistory={showAgentSessionHistoryAction}
        showChecks={showChecksAction}
        onOpenAgentSessionHistory={openAgentSessionHistory}
        onOpenChecks={() => handlePanelTap('pr')}
        onClose={() => setShowHeaderMoreActions(false)}
      />

      <QuickCommandsSheet
        visible={showQuickCommands && quickCommandsSupported === true}
        onClose={() => setShowQuickCommands(false)}
        client={client}
        repoId={
          isFolderWorkspaceRoute || isFloatingWorkspaceRoute
            ? null
            : getRepoIdFromMobileWorktreeId(worktreeId) || null
        }
        repoName={worktreeName || null}
        onLaunch={launchQuickCommand}
      />

      <ActionSheetModal
        visible={showCreateTabDrawer}
        title="New Tab"
        actions={[
          ...createTabAgentActions,
          {
            label: 'Terminal',
            icon: SquareTerminal,
            onPress: () => {
              setShowCreateTabDrawer(false)
              void handleCreateTerminal()
            }
          },
          // Why: browser/markdown creation resolve a real worktree on the host
          // (browser.tabCreate, files.createFile); the floating sentinel is
          // terminal-only over RPC, so those options hide there.
          ...(isFloatingWorkspaceRoute
            ? []
            : [
                {
                  label: 'Browser',
                  icon: Globe,
                  closeBeforePress: true,
                  onPress: () => {
                    if (browserScreencastSupported !== true) {
                      showToast('Desktop update required for mobile browser streaming', 1600)
                      return
                    }
                    setShowCreateBrowserModal(true)
                  }
                },
                {
                  label: 'Markdown Note',
                  icon: FileText,
                  onPress: () => {
                    setShowCreateTabDrawer(false)
                    void handleCreateMarkdownNote()
                  }
                }
              ])
        ]}
        onClose={() => setShowCreateTabDrawer(false)}
      />

      <ActionSheetModal
        visible={pendingDiffNotesDelivery !== null}
        title="Send Review Notes"
        message="Choose an agent session for the current notes."
        actions={[
          ...sendDiffNotesAgentActions,
          {
            label: 'Copy Notes',
            icon: Copy,
            onPress: () => {
              const delivery = pendingDiffNotesDelivery
              setPendingDiffNotesDelivery(null)
              if (!delivery) {
                return
              }
              void Clipboard.setStringAsync(delivery.prompt)
                .then(() => {
                  triggerSuccess()
                  showToast('Notes copied')
                })
                .catch(() => {
                  triggerError()
                  showToast("Couldn't copy notes", 1500)
                })
            }
          }
        ]}
        onClose={() => setPendingDiffNotesDelivery(null)}
      />

      <ActionSheetModal
        visible={actionTarget != null}
        title={actionTarget?.title || 'Terminal'}
        actions={getMobileTerminalActionSheetActions({
          target: actionTarget,
          tabs: sessionTabs.filter((tab) => tab.type === 'terminal'),
          isTabChatView: nativeChatController.isTabChatView,
          nativeChatTranscriptIsLocalReadable,
          onDismiss: () => setActionTarget(null),
          onToggleChat: toggleTabChatView,
          isPhoneMode: (handle) => isTerminalPhoneDisplayMode(handle, terminalModes),
          onToggleDisplayMode: (handle) => void toggleDisplayMode(handle),
          onRename: setRenameTarget,
          onClear: (target) => void handleClearTerminal(target),
          onClose: (target) => void handleCloseTerminal(target),
          onCloseSessionTab: (tab) => void handleCloseSessionTab(tab),
          bulkCloseActions
        })}
        onClose={() => setActionTarget(null)}
      />
      <ActionSheetModal
        visible={markdownActionTarget != null}
        title={markdownActionTarget?.title || 'Markdown'}
        actions={[
          {
            label: 'Refresh',
            icon: RefreshCw,
            // Why: dirty refresh opens ConfirmModal; wait for this sheet's native
            // Modal to unmount first (same dual-Modal race as tab Rename, #10331).
            closeBeforePress: true,
            onPress: () => {
              const target = markdownActionTarget
              if (target) {
                discardMarkdownLocalContent(target)
              }
            }
          },
          {
            label: 'Copy Path',
            icon: FileText,
            onPress: () => {
              const target = markdownActionTarget
              setMarkdownActionTarget(null)
              if (target) {
                void Clipboard.setStringAsync(target.relativePath || target.filePath)
                showToast('Path copied')
              }
            }
          },
          ...closeWithBulkActions(markdownActionTarget, () => setMarkdownActionTarget(null))
        ]}
        onClose={() => setMarkdownActionTarget(null)}
      />
      <ActionSheetModal
        visible={fileActionTarget != null}
        title={fileActionTarget?.title || 'File'}
        actions={[
          {
            label: 'Refresh',
            icon: RefreshCw,
            onPress: () => {
              const target = fileActionTarget
              setFileActionTarget(null)
              if (target) {
                void readFileTab(target)
              }
            }
          },
          ...closeWithBulkActions(fileActionTarget, () => setFileActionTarget(null))
        ]}
        onClose={() => setFileActionTarget(null)}
      />
      <MobileBrowserTabActionSheet
        target={browserActionTarget}
        onClose={() => setBrowserActionTarget(null)}
        onNavigate={handleBrowserNavigationCommand}
        onCloseTab={handleCloseSessionTab}
        bulkCloseActions={bulkCloseActions}
      />
      <ActionSheetModal
        visible={leaveDrafts != null}
        title="Unsaved markdown changes"
        message="Copy or discard phone drafts before leaving."
        actions={[
          {
            label: 'Copy All & Leave',
            icon: FileText,
            onPress: () => {
              const drafts = leaveDrafts ?? []
              const combined = drafts
                .map((draft) => `# ${draft.title}\n\n${draft.content}`)
                .join('\n\n---\n\n')
              void Clipboard.setStringAsync(combined)
                .then(() => {
                  setLeaveDrafts(null)
                  leaveSession()
                })
                .catch(() => {
                  triggerError()
                  showToast("Couldn't copy drafts", 1500)
                })
            }
          },
          {
            label: 'Discard & Leave',
            destructive: true,
            onPress: () => {
              setLeaveDrafts(null)
              leaveSession()
            }
          }
        ]}
        onClose={() => setLeaveDrafts(null)}
      />
      <ConfirmModal
        visible={discardMarkdownTarget != null}
        title="Discard Changes"
        message="Replace the phone draft with the latest desktop file?"
        confirmLabel="Discard"
        destructive
        onConfirm={confirmDiscardMarkdown}
        onCancel={() => setDiscardMarkdownTarget(null)}
      />
      <TextInputModal
        visible={renameTarget != null}
        title="Rename Terminal"
        defaultValue={renameTarget?.title || 'Terminal'}
        placeholder="Terminal name"
        onSubmit={(value) => void handleRenameTerminal(value)}
        onCancel={() => setRenameTarget(null)}
      />
      <TextInputModal
        visible={showCreateBrowserModal}
        title="New Browser"
        message="Enter a URL, or leave blank for a new tab."
        defaultValue=""
        placeholder="https://example.com"
        submitLabel="Open"
        allowEmpty
        selectTextOnFocus
        keyboardType={Platform.OS === 'ios' ? 'url' : 'default'}
        onSubmit={(value) => {
          void handleCreateBrowser(value).then((created) => {
            if (created) {
              setShowCreateBrowserModal(false)
            }
          })
        }}
        onCancel={() => setShowCreateBrowserModal(false)}
      />
      <CustomKeyModal
        visible={showCustomKeyModal}
        onClose={() => setShowCustomKeyModal(false)}
        onKeysChanged={setCustomKeys}
        onManageShortcuts={handleManageShortcuts}
      />
      <MobileDictationSetupSheet
        visible={showDictationSetup}
        client={client}
        onClose={() => setShowDictationSetup(false)}
        onReady={() => setShowDictationSetup(false)}
      />
      <ActionSheetModal
        visible={deleteKeyTarget != null}
        title={deleteKeyTarget?.label ?? 'Shortcut'}
        message="Remove this custom shortcut?"
        actions={[
          {
            label: 'Remove',
            destructive: true,
            onPress: () => {
              if (deleteKeyTarget) {
                void handleDeleteCustomKey(deleteKeyTarget)
              }
              setDeleteKeyTarget(null)
            }
          }
        ]}
        onClose={() => setDeleteKeyTarget(null)}
      />
    </View>
  )
}
