import { type TerminalOscLinkRange, type TerminalTitleTracker, type TerminalSideEffectFact, type ParsedAgentStatusPayload, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type RuntimeCreateAgentSessionResult, type TerminalRevealIdentity, type CreateWorktreeResult, type Repo, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type TuiAgent, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type RuntimeTerminalPresentation, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionTabMove, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type TerminalPaneSplitSource, type PtyIncarnationId, isWindowsAbsolutePathLike, type PtyProviderBufferSnapshot, type PtyProcessInfo, type ProjectExecutionRuntimeResolution, HeadlessEmulator } from './orca-runtime-imports'


export type RuntimePtyTitleTrackerEntry = {
  tracker: TerminalTitleTracker
  // Why: onPtyData batches the mobile session-tab touch to once per chunk;
  // the stale-working-title timer fires between chunks and must touch
  // immediately. These flags route the tracker callback to the right mode.
  applyingChunk: boolean
  // Why: synthetic spinner ticks arrive ~12.5x/sec per working pane; the
  // synthetic path gates mobile snapshot fan-out on a non-decorative title
  // change (spinner glyph + status comparison key kept below).
  applyingSyntheticFrame: boolean
  lastMobileTitleGateKey: string | null
  chunkTouchedSessionTabs: boolean
  // Why: facts observed while applying a chunk are batched into one
  // pty:sideEffect emission per chunk, preserving status/title/bell order.
  // Timer-fired facts emit immediately between chunks.
  pendingFacts: TerminalSideEffectFact[]
  // Why: Command Code lacks hooks, so its working/done state is scraped from
  // TUI output. Null when no side-effect consumer exists (headless serve) —
  // the scrape produces facts only.
  commandCodeDetector: { observe: (data: string) => boolean } | null
}

// Why: the full OSC 9999 payload flows through emitTerminalAgentStatusEvents and
// is then forwarded to the renderer and dropped. Mobile is served by the main
// process and has no renderer store, so we retain the latest payload per pane
// here to feed worktree.ps's inline agent rows (1:1 with the desktop sidebar).
export type RuntimeAgentRowSnapshot = {
  paneKey: string
  ptyId: string
  worktreeId?: string
  tabId?: string
  payload: ParsedAgentStatusPayload
  // When the current payload.state was first observed for this pane (ms).
  stateStartedAt: number
  updatedAt: number
}

export type AgentSessionCreateOperation = {
  fingerprint: string
  promise: Promise<RuntimeCreateAgentSessionResult>
}

export type RuntimeHeadlessTerminal = {
  emulator: HeadlessEmulator
  // Why: serialize can race with newer writes appended to writeChain; return
  // the seq actually painted into this emulator, not the latest PTY seq.
  outputSequence: number
  writeChain: Promise<void>
}

export type RuntimePtyDataAdmission = Readonly<{
  admitted: boolean
  sequence: number
  completion: Promise<void>
}>

export type { RuntimeTerminalDataMeta } from './terminal-output-state'

export type RuntimeVisibleTerminalState = {
  lines: string[]
  isAlternateScreen: boolean
  sequence: number
  generation: number
}

export type ProviderBufferAcquisition = {
  generation: number
  scrollbackRows: number
  promise: Promise<PtyProviderBufferSnapshot | null>
  timedOut: boolean
}

export type RuntimeTerminalBufferSnapshot = {
  data: string
  cols: number
  rows: number
  seq?: number
  cwd?: string | null
  lastTitle?: string
  source?: 'headless' | 'renderer'
  oscLinks?: TerminalOscLinkRange[]
  alternateScreen?: boolean
  scrollbackAnsi?: string
  pendingEscapeTailAnsi?: string
}

export type HeadlessSeedMetadata = {
  cwd?: string | null
  oscLinks?: TerminalOscLinkRange[]
  /** Cold restore history must outrank a model that only saw new-generation bytes. */
  preferProviderIfExisting?: boolean
  /** Persisted kitty flags from the daemon snapshot, re-applied to the fresh
   *  emulator so hidden `CSI ? u` answers the real flags instead of ?0u
   *  (terminal-query-authority.md §kitty). */
  kittyKeyboardFlags?: number
}

export type RuntimePtyController = {
  spawn?(opts: {
    cols: number
    rows: number
    cwd?: string
    command?: string
    launchAgent?: TuiAgent
    commandDelivery?: 'renderer' | 'provider'
    startupCommandDelivery?: WorktreeStartupLaunch['startupCommandDelivery']
    env?: Record<string, string>
    envToDelete?: string[]
    resumeProviderSession?: AgentProviderSessionMetadata
    telemetry?: WorktreeStartupLaunch['telemetry']
    connectionId?: string | null
    worktreeId?: string
    preAllocatedHandle?: string
    tabId?: string
    leafId?: string
    sessionId?: string
    persistHostSessionBinding?: boolean
    terminalColorQueryReplies?: { foreground?: string; background?: string }
    agentSessionEnsure?: {
      claim: AgentSessionExecutionClaim
      surface: AgentSessionSurfaceBinding
    }
    agentSessionCreateOperationId?: string
    signal?: AbortSignal
    onPtySpawnCommitted?: () => void
  }): Promise<{
    id: string
    incarnationId?: PtyIncarnationId
    wslDistro?: string
    agentSessionEnsure?: AgentSessionClaimedSpawnResult
  }>
  write(ptyId: string, data: string): boolean
  kill(ptyId: string): boolean
  stopAndWait?(
    ptyId: string,
    opts?: { keepHistory?: boolean; deadlineMs?: number }
  ): Promise<boolean>
  markReversibleStops?(ptyIds: readonly string[]): () => void
  getCwd?(ptyId: string): Promise<string | null>
  getForegroundProcess(ptyId: string): Promise<string | null>
  inspectProcess?(
    ptyId: string
  ): Promise<{ foregroundProcess: string | null; hasChildProcesses: boolean; unavailable?: true }>
  confirmForegroundProcess?(ptyId: string): Promise<string | null>
  hasChildProcesses?(ptyId: string): Promise<boolean>
  clearBuffer?(ptyId: string): Promise<void>
  resize?(ptyId: string, cols: number, rows: number): boolean
  resizeIfCurrent?(
    ptyId: string,
    expectedIncarnationId: PtyIncarnationId,
    cols: number,
    rows: number
  ): Promise<boolean>
  // Why: exact-id mobile polls should not enumerate every local and SSH PTY.
  hasPty?(ptyId: string): boolean | null
  listProcesses?(connectionId?: string | null): Promise<PtyProcessInfo[]>
  serializeBuffer?(
    ptyId: string,
    opts?: { scrollbackRows?: number; altScreenForcesZeroRows?: boolean }
  ): Promise<{ data: string; cols: number; rows: number; seq?: number; lastTitle?: string } | null>
  /** Authoritative provider-owned snapshot for restored PTYs with no mounted renderer. */
  serializeProviderBuffer?(
    ptyId: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null>
  // Why: synchronous probe used by maybeHydrateHeadlessFromRenderer to skip
  // hydration when no renderer is authoritative for this PTY. See
  // docs/mobile-prefer-renderer-scrollback.md.
  hasRendererSerializer?(ptyId: string): boolean
  getRendererSerializerGeneration?(ptyId: string): number
  waitForRendererSerializer?(
    ptyId: string,
    afterGeneration: number,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<boolean>
  getSize?(ptyId: string): { cols: number; rows: number } | null
  getProvisionalSize?(ptyId: string): { cols: number; rows: number } | null
  getAppliedSize?(ptyId: string): Promise<{ cols: number; rows: number } | null>
}

export type PtyControllerTerminalIdentity = Readonly<{
  handle: string
  incarnationId: string
  wslDistro?: string | null
}>

export type PtyControllerInventory = Readonly<{
  livePtyIds: ReadonlySet<string>
  terminalIdentityByPtyId: ReadonlyMap<string, PtyControllerTerminalIdentity>
}>

export type WorktreeStartupDraftPaste = {
  agent: TuiAgent
  content: string
}

export type WorktreeStartupFollowup = {
  expectedProcess: string
  prompt: string
}

export function getAgentLaunchPlatformForRepo(
  repo: Pick<Repo, 'connectionId' | 'path'>,
  projectRuntime?: ProjectExecutionRuntimeResolution
): NodeJS.Platform {
  if (!repo.connectionId) {
    if (projectRuntime?.status === 'repair-required') {
      return projectRuntime.repair.preferredRuntime.kind === 'wsl' ? 'linux' : process.platform
    }
    if (projectRuntime?.status === 'resolved' && projectRuntime.runtime.kind === 'wsl') {
      return 'linux'
    }
    return process.platform
  }
  return isWindowsAbsolutePathLike(repo.path) ? 'win32' : 'linux'
}

// Why: long enough for a phone to reconnect and retry a create whose response
// was lost, short enough that an intentional later re-resume forks fresh.
export const MOBILE_TERMINAL_CREATE_RESULT_TTL_MS = 60_000
// Why: same idempotency window for worktree.create — a phone whose create was
// interrupted by a connection migration retries with the same clientMutationId
// and reuses the just-created worktree instead of spawning a duplicate.
export const WORKTREE_CREATE_RESULT_TTL_MS = 60_000
export const FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS = 150
export const FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS = 6_500
export const BRACKETED_PASTE_BEGIN = '\x1b[200~'
export const BRACKETED_PASTE_END = '\x1b[201~'
export const BRACKETED_PASTE_QUIET_MS = 1500
export const DRAFT_PASTE_READY_TIMEOUT_MS = 8000
export const MOBILE_TERMINAL_SURFACE_TIMEOUT_MS = 10_000
export const MOBILE_TERMINAL_READY_FALLBACK_MS = 1000
export const SSH_PANE_RECOVERY_GRACE_MS = 30_000

export function isClientDisconnectedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'client_disconnected'
}

export function createTerminalRevealWarning(handle: string, error?: unknown): string {
  const reason =
    error instanceof Error && error.message.trim().length > 0
      ? ` Reason: ${error.message.trim()}.`
      : ''
  return [
    `Terminal ${handle} is running, but Orca could not make it discoverable.${reason}`,
    `Run \`orca terminal focus --terminal ${handle}\` to reveal and focus it.`
  ].join(' ')
}

// Why: an absent `surfaceOwner` means "default", so surfacing callers must omit
// the key rather than send `true`.
export function ownerSurfacing(shouldSurface: boolean): { surfaceOwner?: false } {
  return shouldSurface ? {} : { surfaceOwner: false }
}

export function resolveTerminalPresentation(opts: {
  presentation?: RuntimeTerminalPresentation
  focus?: boolean
  activate?: boolean
}): RuntimeTerminalPresentation | undefined {
  if (opts.presentation) {
    return opts.presentation
  }
  if (opts.focus === true || opts.activate === true) {
    return 'focused'
  }
  return undefined
}

export type RuntimeNotifier = {
  worktreesChanged(repoId: string, renamed?: { oldWorktreeId: string; newWorktreeId: string }): void
  worktreeBaseStatus?(event: WorktreeBaseStatusEvent): void
  worktreeRemoteBranchConflict?(event: WorktreeRemoteBranchConflictEvent): void
  reposChanged(): void
  activateWorktree(
    repoId: string,
    worktreeId: string,
    setup?: CreateWorktreeResult['setup'],
    startup?: WorktreeStartupLaunch,
    defaultTabs?: CreateWorktreeResult['defaultTabs']
  ): void
  createTerminal(
    worktreeId: string,
    opts: {
      command?: string
      cwd?: string
      env?: Record<string, string>
      title?: string
      presentation?: RuntimeTerminalPresentation
    }
  ): void
  revealTerminalSession?(
    worktreeId: string,
    opts: {
      ptyId: string
      title?: string | null
      cwd?: string
      launchConfig?: SleepingAgentLaunchConfig
      launchToken?: string
      launchAgent?: TuiAgent
      viewMode?: 'terminal' | 'chat'
      activate?: boolean
      presentation?: RuntimeTerminalPresentation
      surfaceOwner?: false
      tabId?: string
      leafId?: string
      splitFromLeafId?: string
      splitDirection?: 'horizontal' | 'vertical'
      splitTelemetrySource?: TerminalPaneSplitSource
      focus?: boolean
      expectedProcessIdentity?: {
        terminalHandle: string
        incarnationId: string
      }
    }
  ):
    | Promise<{ tabId: string; title?: string | null; identity?: TerminalRevealIdentity }>
    | { tabId: string; title?: string | null; identity?: TerminalRevealIdentity }
    | void
  resolveLegacyWorkerTerminalRecovery?(
    paneKey: string,
    resolution: 'adopted' | 'exited' | 'rolled_back',
    ptyId?: string
  ): void
  splitTerminal(
    tabId: string,
    paneRuntimeId: number,
    opts: {
      direction: 'horizontal' | 'vertical'
      command?: string
      telemetrySource?: TerminalPaneSplitSource
    }
  ): void
  renameTerminal(tabId: string, title: string | null): void
  focusTerminal(tabId: string, worktreeId: string, leafId?: string | null): void
  focusEditorTab?(tabId: string, worktreeId: string): void
  closeSessionTab?(tabId: string, worktreeId: string): void
  moveSessionTab?(worktreeId: string, move: RuntimeMobileSessionTabMove): void
  openFile?(
    worktreeId: string,
    filePath: string,
    relativePath: string,
    runtimeEnvironmentId?: string | null
  ): void
  openDiff?(
    worktreeId: string,
    filePath: string,
    relativePath: string,
    staged: boolean,
    runtimeEnvironmentId?: string | null
  ): void
  readMobileMarkdownTab?(worktreeId: string, tabId: string): Promise<RuntimeMarkdownReadTabResult>
  saveMobileMarkdownTab?(
    worktreeId: string,
    tabId: string,
    baseVersion: string,
    content: string
  ): Promise<RuntimeMarkdownSaveTabResult>
  closeTerminal(tabId: string, paneRuntimeId?: number): void
  closeTerminalTab?(tabId: string): Promise<void>
  sleepWorktree(worktreeId: string): void
  // Why: a phone opening a worktree wakes its slept agents by asking the host
  // renderer to run its own navigation-free wake (experimental agent sleep);
  // the runtime has no in-memory sleeping records or wake authority. Optional to
  // match the many renderer-backed notifier methods only the real bridge wires.
  resumeSleepingAgents?(worktreeId: string): void
  terminalFitOverrideChanged(
    ptyId: string,
    mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit',
    cols: number,
    rows: number
  ): void
  // Why: presence-based lock signal — desktop renderer mounts the lock
  // banner when `driver.kind === 'mobile'` and unmounts otherwise. The
  // structured payload carries the active mobile actor's clientId so the
  // renderer can disambiguate multi-phone scenarios.
  terminalDriverChanged(ptyId: string, driver: RuntimeTerminalDriverState): void
  nativeChatLaunchDraftResolved?(
    tabId: string,
    resolution: { text: string; createdAt: number }
  ): void
  browserDriverChanged?(browserPageId: string, driver: RuntimeBrowserDriverState): void
}
