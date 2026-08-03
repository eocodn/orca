import { randomUUID, type Repo, type RuntimeMobileSessionTabsResult, isTerminalLeafId, makePaneKey, isValidTerminalTabId, type PtyIncarnationId, getLocalProjectWorktreeGitOptions, type ResolvedWorktree } from './orca-runtime-symbols'
import { OrcaRuntimeSaveMobileMarkdownTabPart17 } from './orca-runtime-save-mobile-markdown-tab-part-17'

export class OrcaRuntimeResolveRuntimeGitTargetPart18 extends OrcaRuntimeSaveMobileMarkdownTabPart17 {
  protected async resolveRuntimeGitTarget(worktreeSelector: string): Promise<{
    worktree: ResolvedWorktree
    repo?: Repo
    connectionId?: string
    localGitOptions?: { wslDistro?: string }
  }> {
    const store = this.requireStore()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const repo = store.getRepo(worktree.repoId)
    const connectionId = repo?.connectionId ?? undefined
    const localGitOptions =
      repo && !connectionId ? getLocalProjectWorktreeGitOptions(store, repo) : {}
    return { worktree, repo, connectionId, localGitOptions }
  }
  protected async resolveRuntimeFileTarget(worktreeSelector: string): Promise<{
    worktree: ResolvedWorktree
    connectionId?: string
  }> {
    const folderScope = await this.resolveFolderWorkspaceLaunchScope(worktreeSelector)
    if (folderScope?.folderWorkspace) {
      return {
        worktree: this.folderWorkspaceToResolvedWorktree(folderScope.folderWorkspace),
        connectionId: folderScope.connectionId ?? undefined
      }
    }

    const store = this.requireStore()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const repo = store.getRepo(worktree.repoId)
    return { worktree, connectionId: repo?.connectionId ?? undefined }
  }
  onMobileSessionTabsChanged(
    listener: (snapshot: RuntimeMobileSessionTabsResult) => void,
    clientNavigationId?: string
  ): () => void {
    // Why: a notify coalesced before this subscriber existed is already folded
    // into the initial snapshot it was just sent. Draining it here — before the
    // listener joins — keeps that pending timer from landing as a redundant
    // `updated` frame carrying pre-subscribe state. Mirrors the unsubscribe flush.
    this.mobileSessionTabsNotifyCoalescer.flushAll()
    const subscription = { listener, clientNavigationId }
    this.mobileSessionTabListeners.add(subscription)
    return () => {
      // Why: flush pending coalesced notifies before dropping this listener so a
      // subscriber closing mid-window still receives the latest settled state.
      this.mobileSessionTabsNotifyCoalescer.flushAll()
      this.mobileSessionTabListeners.delete(subscription)
    }
  }
  forgetClientNavigationState(clientNavigationId: string): void {
    this.clientSessionTabSelections.forgetClient(clientNavigationId)
  }

  // Why: terminal handles are normally created lazily when first referenced via
  // RPC, but agents need their own handle at spawn time (via ORCA_TERMINAL_HANDLE
  // env var) so they can self-identify in orchestration messages without an
  // extra RPC round-trip. Pre-allocating by ptyId lets issueHandle reuse it.
  preAllocateHandleForPty(ptyId: string): string {
    const existing = this.handleByPtyId.get(ptyId)
    if (existing) {
      return existing
    }
    const handle = this.createPreAllocatedTerminalHandle()
    this.handleByPtyId.set(ptyId, handle)
    return handle
  }
  createPreAllocatedTerminalHandle(): string {
    return `term_${randomUUID()}`
  }
  registerPreAllocatedHandleForPty(ptyId: string, handle: string): void {
    this.handleByPtyId.set(ptyId, handle)
    for (const leaf of this.getLeavesForPty(ptyId)) {
      this.adoptPreAllocatedHandle(leaf)
    }
  }
  protected adoptControllerTerminalHandle(
    ptyId: string,
    handle: string | undefined,
    incarnationId?: string,
    options: { exactRestoredSurface?: boolean } = {}
  ): void {
    const trimmed = handle?.trim()
    if (!trimmed || !trimmed.startsWith('term_')) {
      return
    }
    const pty = this.ptysById.get(ptyId)
    const changedIncarnation = Boolean(
      incarnationId && pty?.incarnationId && incarnationId !== pty.incarnationId
    )
    if (changedIncarnation) {
      const priorHandle = this.handleByPtyId.get(ptyId)
      this.invalidateAllHandlesForPty(ptyId)
      pty!.tabId = null
      pty!.paneKey = null
      // Reusing an exported handle would make stale client metadata name the replacement process.
      if (priorHandle === trimmed) {
        return
      }
    }
    if (this.isTerminalHandleAdoptionBlocked(ptyId, trimmed)) {
      if (
        !options.exactRestoredSurface ||
        !this.replaceSyntheticTerminalHandlesForRestoredPty(ptyId, trimmed) ||
        this.isTerminalHandleAdoptionBlocked(ptyId, trimmed)
      ) {
        return
      }
    }
    // Why: after an app/runtime restart, the live PTY child still has its
    // original ORCA_TERMINAL_HANDLE, but the runtime's in-memory map is gone.
    this.registerPreAllocatedHandleForPty(ptyId, trimmed)
  }
  protected invalidateAllHandlesForPty(ptyId: string): void {
    this.handleByPtyId.delete(ptyId)
    const invalidated = new Set<string>()
    for (const [handle, record] of this.handles) {
      if (record.ptyId === ptyId) {
        invalidated.add(handle)
        this.handles.delete(handle)
        this.syntheticTerminalHandles.delete(handle)
        this.rejectWaitersForHandle(handle, 'terminal_handle_stale')
      }
    }
    for (const [leafKey, handle] of this.handleByLeafKey) {
      if (invalidated.has(handle)) {
        this.handleByLeafKey.delete(leafKey)
      }
    }
  }
  protected replaceSyntheticTerminalHandlesForRestoredPty(
    ptyId: string,
    controllerHandle: string
  ): boolean {
    const boundHandles = new Set<string>()
    const directHandle = this.handleByPtyId.get(ptyId)
    if (directHandle) {
      boundHandles.add(directHandle)
    }
    for (const [handle, record] of this.handles) {
      if (record.ptyId === ptyId) {
        boundHandles.add(handle)
      } else if (handle === controllerHandle) {
        return false
      }
    }
    for (const [otherPtyId, handle] of this.handleByPtyId) {
      if (otherPtyId !== ptyId && handle === controllerHandle) {
        return false
      }
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      const handle = this.handleByLeafKey.get(this.getLeafKey(leaf.tabId, leaf.leafId))
      if (handle) {
        boundHandles.add(handle)
      }
    }
    if (
      boundHandles.size === 0 ||
      [...boundHandles].some(
        (handle) => handle === controllerHandle || !this.syntheticTerminalHandles.has(handle)
      )
    ) {
      return false
    }
    this.invalidateAllHandlesForPty(ptyId)
    return true
  }

  // Why: adoption is best-effort restart recovery and must be first-wins.
  // Re-keying a pty that already has a handle this session would strand
  // waiters registered under the old handle, and provider-reported values
  // are not trusted to be collision-free — a handle bound to a different
  // pty must never be stolen by a later report.
  protected isTerminalHandleAdoptionBlocked(ptyId: string, handle: string): boolean {
    if (this.handleByPtyId.get(ptyId) ?? this.findHandleForPtyRecord(ptyId)) {
      return true
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      const issued = this.handleByLeafKey.get(this.getLeafKey(leaf.tabId, leaf.leafId))
      if (issued && issued !== handle) {
        return true
      }
    }
    const existingRecord = this.handles.get(handle)
    if (existingRecord && existingRecord.ptyId !== ptyId) {
      return true
    }
    for (const [otherPtyId, otherHandle] of this.handleByPtyId) {
      if (otherHandle === handle && otherPtyId !== ptyId) {
        return true
      }
    }
    return false
  }
  onPtySpawned(
    ptyId: string,
    incarnationId?: PtyIncarnationId,
    options: { awaitsRegistration?: boolean } = {}
  ): void {
    const reservedIncarnation = this.reservePtyRegistrationIncarnation(ptyId, incarnationId)
    if (options.awaitsRegistration !== false) {
      // Why: surface absence cannot distinguish an in-flight admission from a completed headless lifecycle.
      this.pendingPtyRegistrationIncarnations.set(ptyId, reservedIncarnation)
      return
    }
    const pty = this.getOrCreatePtyWorktreeRecord(ptyId)
    if (pty) {
      this.admitPtyLifecycle(pty, reservedIncarnation ?? undefined, { adoptHandles: true })
    }
  }
  preparePtyRegistrationIncarnation(
    ptyId: string,
    incarnationId?: PtyIncarnationId
  ): PtyIncarnationId | null {
    const reservedIncarnation = this.reservePtyRegistrationIncarnation(ptyId, incarnationId)
    if (this.pendingPtyRegistrationIncarnations.has(ptyId)) {
      this.pendingPtyRegistrationIncarnations.set(ptyId, reservedIncarnation)
    }
    return reservedIncarnation
  }
  protected reservePtyRegistrationIncarnation(
    ptyId: string,
    incarnationId?: PtyIncarnationId
  ): PtyIncarnationId | null {
    if (incarnationId !== undefined) {
      return incarnationId
    }
    const pending = this.pendingPtyRegistrationIncarnations.get(ptyId)
    if (pending) {
      return pending
    }
    const pty = this.ptysById.get(ptyId)
    if (pty && (!pty.connected || pty.lastExitCode !== null)) {
      return `runtime-${this.runtimeId}-${this.nextSyntheticPtyIncarnation++}`
    }
    return pty?.incarnationId ?? null
  }
  registerPty(
    ptyId: string,
    worktreeId: string,
    connectionId: string | null = null,
    binding?: { tabId: string; leafId: string; incarnationId?: PtyIncarnationId },
    isWsl?: boolean
  ): PtyIncarnationId | null {
    this.assertPtyDidNotExitBeforeRegistration(ptyId, binding?.incarnationId)
    // Why: record the renderer pane identity at spawn time so a stalled graph
    // sync can't hide that a live PTY already backs a pending mobile create.
    const paneKey =
      binding && isValidTerminalTabId(binding.tabId) && isTerminalLeafId(binding.leafId)
        ? makePaneKey(binding.tabId, binding.leafId)
        : null
    const pty = this.recordAuthoritativePtyWorktree(ptyId, worktreeId, {
      connectionId,
      ...(binding && this.pendingMobileTerminalCreatesByKey.has(`${worktreeId}::${binding.tabId}`)
        ? { runtimeSessionOwned: true }
        : {}),
      ...(isWsl !== undefined ? { isWsl } : {}),
      ...(binding && paneKey ? { tabId: binding.tabId, paneKey } : {}),
      ...(binding?.incarnationId ? { incarnationId: binding.incarnationId } : {})
    })
    // Why: one successful admission may overlap one stale provider list; later absence is authoritative.
    this.ptyInventoryOverlapGraceById.set(ptyId, pty.incarnationId)
    const pendingIncarnation = this.pendingPtyRegistrationIncarnations.get(ptyId)
    if (
      pendingIncarnation === null ||
      pendingIncarnation === undefined ||
      binding?.incarnationId === undefined ||
      pendingIncarnation === binding.incarnationId
    ) {
      this.pendingPtyRegistrationIncarnations.delete(ptyId)
    }
    // Why: the renderer's own PTY spawn is the reliable signal that the pending
    // mobile create's tab is live; publish its surface main-side (#7587).
    if (binding && paneKey) {
      this.ensurePtyBackedMobileSurfaceForRendererTab(worktreeId, binding.tabId)
    }
    this.retryPendingPtyDurableRetirementsForPty(ptyId)
    return pty.incarnationId
  }
  assertPtyRegistrationAllowed(ptyId: string, incarnationId?: PtyIncarnationId): void {
    // Why: the controller must reject an early exit before persisting bindings or handles.
    this.assertPtyDidNotExitBeforeRegistration(ptyId, incarnationId)
  }
  releaseRejectedPtyRegistrationFence(
    ptyId: string,
    candidateIncarnation?: PtyIncarnationId
  ): void {
    if (!this.earlyExitedPtyIncarnations.has(ptyId)) {
      return
    }
    const exitedIncarnation = this.earlyExitedPtyIncarnations.get(ptyId) ?? null
    if (
      exitedIncarnation === null ||
      candidateIncarnation === undefined ||
      exitedIncarnation === candidateIncarnation
    ) {
      // Why: the rejected spawn call was the fence's sole late publisher; retaining it leaks fresh PTY ids.
      this.earlyExitedPtyIncarnations.delete(ptyId)
      this.pendingPtyRegistrationIncarnations.delete(ptyId)
    }
  }
  beginPtyRegistration(ptyId: string, incarnationId?: PtyIncarnationId): void {
    this.pendingPtyRegistrationIncarnations.set(ptyId, incarnationId ?? null)
  }
  acceptPtyIncarnationForExit(ptyId: string, incarnationId: PtyIncarnationId): void {
    const pty = this.ptysById.get(ptyId)
    if (pty) {
      // Why: a reconnect attach reply can prove the exit generation after stale local proof was cleared.
      pty.incarnationId = incarnationId
      pty.connected = false
      pty.disconnectedAt ??= Date.now()
      pty.lastExitCode = null
    }
  }
  cancelPendingPtyRegistration(ptyId: string, incarnationId?: PtyIncarnationId): void {
    const pending = this.pendingPtyRegistrationIncarnations.get(ptyId)
    if (
      !this.pendingPtyRegistrationIncarnations.has(ptyId) ||
      (pending !== null && incarnationId !== undefined && pending !== incarnationId)
    ) {
      return
    }
    this.pendingPtyRegistrationIncarnations.delete(ptyId)
    const exited = this.earlyExitedPtyIncarnations.get(ptyId)
    if (
      exited === null ||
      exited === undefined ||
      incarnationId === undefined ||
      exited === incarnationId
    ) {
      this.earlyExitedPtyIncarnations.delete(ptyId)
    }
    this.retryPendingPtyDurableRetirementsForPty(ptyId, incarnationId)
  }
  admitHeadlessPtyLifecycle(ptyId: string, incarnationId: PtyIncarnationId): void {
    this.assertPtyDidNotExitBeforeRegistration(ptyId, incarnationId)
    const pending = this.pendingPtyRegistrationIncarnations.get(ptyId)
    if (pending !== null && pending !== undefined && pending !== incarnationId) {
      throw new Error('terminal_incarnation_stale')
    }
    this.pendingPtyRegistrationIncarnations.delete(ptyId)
    this.headlessPtyIncarnationById.set(ptyId, incarnationId)
  }
  hasObservedExactPtyExit(ptyId: string, incarnationId: PtyIncarnationId): boolean {
    if (this.observedPtyExitIncarnations.get(ptyId)?.has(incarnationId)) {
      return true
    }
    if (this.earlyExitedPtyIncarnations.get(ptyId) === incarnationId) {
      return true
    }
    return false
  }
}
