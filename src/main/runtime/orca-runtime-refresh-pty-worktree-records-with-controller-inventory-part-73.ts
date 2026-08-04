import {
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId,
  type ExecutionHostId,
  isTerminalLeafId,
  makePaneKey,
  parseAppSshPtyId,
  isPtyIncarnationId,
  type PtyIncarnationId,
  FLOATING_TERMINAL_WORKTREE_ID,
  findResolvedWorktreeIdForPath,
  indexPersistedPtySurfaceBindings,
  indexPersistedPtyWorktreeBindings,
  inferWorktreeIdFromPtyId,
  runtimeWorktreeIdsEqual,
  withTimeoutResult,
  PTY_CONTROLLER_LIST_TIMEOUT_MS,
  type RuntimePtyWorktreeRecord,
  type PtyControllerTerminalIdentity,
  type PtyControllerInventory,
  type ResolvedWorktree
} from './orca-runtime-symbols'
import { OrcaRuntimeListStoredSshWorktreesForResolutionPart72 } from './orca-runtime-list-stored-ssh-worktrees-for-resolution-part-72'

export class OrcaRuntimeRefreshPtyWorktreeRecordsWithControllerInventoryPart73 extends OrcaRuntimeListStoredSshWorktreesForResolutionPart72 {
  protected async refreshPtyWorktreeRecordsWithControllerInventory(
    resolvedWorktrees: ResolvedWorktree[],
    targetWorktreeId: string | null = null,
    deadline?: number,
    connectionId?: string | null
  ): Promise<PtyControllerInventory | null> {
    if (targetWorktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
      const targetedLiveness = this.refreshFloatingWorkspacePtyLiveness()
      if (targetedLiveness !== null) {
        return {
          livePtyIds: targetedLiveness,
          terminalIdentityByPtyId: new Map()
        }
      }
    }
    if (!this.ptyController?.listProcesses) {
      return null
    }
    const inventoryGeneration = this.ptyControllerInventorySequence + 1
    this.ptyControllerInventorySequence = inventoryGeneration
    const providerKey = typeof connectionId === 'string' ? `ssh:${connectionId}` : 'local'
    if (connectionId === undefined) {
      this.ptyControllerAggregateInventoryGeneration = inventoryGeneration
    } else {
      this.ptyControllerInventoryGenerationByProvider.set(providerKey, inventoryGeneration)
    }
    const sessionsResult = await withTimeoutResult(
      this.ptyController.listProcesses(connectionId),
      deadline === undefined
        ? PTY_CONTROLLER_LIST_TIMEOUT_MS
        : Math.max(1, Math.min(PTY_CONTROLLER_LIST_TIMEOUT_MS, deadline - Date.now()))
    )
    if (!sessionsResult.ok) {
      // Why: a transient controller failure is not evidence that retained PTYs exited.
      return null
    }
    const isCurrentInventory =
      connectionId === undefined
        ? this.ptyControllerAggregateInventoryGeneration === inventoryGeneration &&
          ![...this.ptyControllerInventoryGenerationByProvider.values()].some(
            (generation) => generation > inventoryGeneration
          )
        : this.ptyControllerInventoryGenerationByProvider.get(providerKey) ===
            inventoryGeneration &&
          this.ptyControllerAggregateInventoryGeneration <= inventoryGeneration
    if (!isCurrentInventory) {
      return null
    }
    const sessions = sessionsResult.value
    const normalizedIncarnationByPtyId = new Map<string, PtyIncarnationId>()
    const seenPtyIds = new Set<string>()
    const ptyIdByCanonicalHandle = new Map<string, string>()
    const validatedHandleByPtyId = new Map<string, string>()
    for (const session of sessions) {
      if (seenPtyIds.has(session.id)) {
        return null
      }
      seenPtyIds.add(session.id)
      if (session.incarnationId === undefined) {
      } else {
        const raw = session.incarnationId as unknown
        if (typeof raw !== 'string' || raw !== raw.trim() || !isPtyIncarnationId(raw)) {
          return null
        }
        normalizedIncarnationByPtyId.set(session.id, raw)
      }
      const handle = session.terminalHandle?.trim()
      if (handle?.startsWith('term_')) {
        const priorPtyId = ptyIdByCanonicalHandle.get(handle)
        if (priorPtyId !== undefined) {
          return null
        }
        ptyIdByCanonicalHandle.set(handle, session.id)
        validatedHandleByPtyId.set(session.id, handle)
      }
    }
    const controllerIdentityByPtyId = new Map<string, PtyControllerTerminalIdentity>()
    for (const session of sessions) {
      const handle = session.terminalHandle?.trim()
      const incarnationId = normalizedIncarnationByPtyId.get(session.id)
      if (!handle?.startsWith('term_') || !incarnationId) {
        continue
      }
      controllerIdentityByPtyId.set(session.id, {
        handle,
        incarnationId,
        ...(session.wslDistro !== undefined ? { wslDistro: session.wslDistro } : {})
      })
    }
    const persistedIndexesByHostId = new Map<
      ExecutionHostId,
      {
        worktreeIdByPtyId: ReadonlyMap<string, string>
        surfaceByPtyId: ReturnType<typeof indexPersistedPtySurfaceBindings>
      }
    >()
    const getPersistedIndexes = (hostId: ExecutionHostId) => {
      const existing = persistedIndexesByHostId.get(hostId)
      if (existing) {
        return existing
      }
      const persistedSession = this.store?.getWorkspaceSession?.(hostId)
      const indexes = {
        worktreeIdByPtyId: indexPersistedPtyWorktreeBindings(persistedSession),
        surfaceByPtyId: indexPersistedPtySurfaceBindings(persistedSession)
      }
      persistedIndexesByHostId.set(hostId, indexes)
      return indexes
    }
    const allLivePtyIds = new Set(sessions.map((session) => session.id))
    const selectedLivePtyIds = new Set<string>()
    for (const session of sessions) {
      const sessionConnectionId =
        parseAppSshPtyId(session.id)?.connectionId ??
        (typeof connectionId === 'string' ? connectionId : null)
      const persistedIndexes = getPersistedIndexes(
        sessionConnectionId ? toSshExecutionHostId(sessionConnectionId) : LOCAL_EXECUTION_HOST_ID
      )
      const controllerIdentity = controllerIdentityByPtyId.get(session.id)
      const persistedWorktreeId = persistedIndexes.worktreeIdByPtyId.get(session.id)
      const providerWorktree = resolvedWorktrees.find(
        (worktree) => session.worktreeId && runtimeWorktreeIdsEqual(worktree.id, session.worktreeId)
      )
      const inferredWorktreeId = inferWorktreeIdFromPtyId(session.id)
      const persistedWorktree = persistedWorktreeId
        ? resolvedWorktrees.find((worktree) =>
            runtimeWorktreeIdsEqual(worktree.id, persistedWorktreeId)
          )
        : undefined
      const hasMigrationEvidence =
        Boolean(session.worktreeId) &&
        !providerWorktree &&
        Boolean(persistedWorktree) &&
        Boolean(inferredWorktreeId) &&
        runtimeWorktreeIdsEqual(session.worktreeId as string, inferredWorktreeId as string)
      // Why: an unresolved explicit provider owner remains authoritative unless the session id proves it was frozen before a persisted rename migration.
      const worktreeId = providerWorktree
        ? providerWorktree.id
        : hasMigrationEvidence
          ? (persistedWorktree?.id ?? null)
          : (session.worktreeId ??
            persistedWorktree?.id ??
            inferredWorktreeId ??
            findResolvedWorktreeIdForPath(resolvedWorktrees, session.cwd))
      const persistedSurface = persistedIndexes.surfaceByPtyId.get(session.id)
      const incarnationId = normalizedIncarnationByPtyId.get(session.id)
      const restoresExactSurface =
        persistedSurface &&
        incarnationId &&
        persistedSurface.incarnationId === incarnationId &&
        Boolean(worktreeId) &&
        runtimeWorktreeIdsEqual(persistedSurface.worktreeId, worktreeId as string)
      this.adoptControllerTerminalHandle(
        session.id,
        validatedHandleByPtyId.get(session.id),
        controllerIdentity?.incarnationId ?? incarnationId,
        { exactRestoredSurface: Boolean(restoresExactSurface && controllerIdentity) }
      )
      if (
        !targetWorktreeId ||
        (worktreeId && runtimeWorktreeIdsEqual(worktreeId, targetWorktreeId))
      ) {
        selectedLivePtyIds.add(session.id)
      }
      if (
        targetWorktreeId &&
        (!worktreeId || !runtimeWorktreeIdsEqual(worktreeId, targetWorktreeId))
      ) {
        continue
      }
      if (worktreeId) {
        const pty = this.recordAuthoritativePtyWorktree(session.id, worktreeId, {
          ...(incarnationId ? { incarnationId } : {}),
          ...(session.wslDistro !== undefined
            ? { isWsl: Boolean(session.wslDistro), wslDistro: session.wslDistro }
            : {}),
          ...(restoresExactSurface
            ? { tabId: persistedSurface.tabId, paneKey: persistedSurface.paneKey }
            : {})
        })
        pty.controllerTitle = session.title?.trim() || null
      }
      // Why: fire-and-forget so this listing hot path doesn't serialize a relay round-trip per session and a throw can't abort the sweep below.
      this.refreshPtyForegroundAgent(session.id)
      this.ptyInventoryOverlapGraceById.delete(session.id)
    }
    for (const pty of this.ptysById.values()) {
      if (connectionId !== undefined && pty.connectionId !== connectionId) {
        continue
      }
      if (!allLivePtyIds.has(pty.ptyId)) {
        const overlapGrace = this.ptyInventoryOverlapGraceById.get(pty.ptyId)
        if (
          this.ptyInventoryOverlapGraceById.has(pty.ptyId) &&
          overlapGrace === pty.incarnationId &&
          this.ptyController.hasPty?.(pty.ptyId) === true
        ) {
          // Why: an SSH spawn can become addressable before an overlapping relay list includes it.
          this.ptyInventoryOverlapGraceById.delete(pty.ptyId)
          allLivePtyIds.add(pty.ptyId)
          if (
            !targetWorktreeId ||
            (pty.worktreeId && runtimeWorktreeIdsEqual(pty.worktreeId, targetWorktreeId))
          ) {
            selectedLivePtyIds.add(pty.ptyId)
          }
          continue
        }
        this.ptyInventoryOverlapGraceById.delete(pty.ptyId)
        this.markPtyDisconnected(pty)
      }
    }
    this.pruneDisconnectedPtyRecords()
    return {
      livePtyIds: targetWorktreeId ? selectedLivePtyIds : allLivePtyIds,
      terminalIdentityByPtyId: controllerIdentityByPtyId
    }
  }
  protected refreshFloatingWorkspacePtyLiveness(): Set<string> | null {
    const controller = this.ptyController
    if (!controller?.hasPty) {
      return null
    }
    const knownPtyIds = new Set<string>()
    const persistedBindingByPtyId = new Map<string, { tabId: string; paneKey: string }>()
    for (const pty of this.ptysById.values()) {
      if (pty.worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
        knownPtyIds.add(pty.ptyId)
      }
    }
    for (const leaf of this.leaves.values()) {
      if (leaf.worktreeId === FLOATING_TERMINAL_WORKTREE_ID && leaf.ptyId) {
        knownPtyIds.add(leaf.ptyId)
      }
    }
    const snapshot = this.mobileSessionTabsByWorktree.get(FLOATING_TERMINAL_WORKTREE_ID)
    for (const tab of snapshot?.tabs ?? []) {
      if (tab.type !== 'terminal') {
        continue
      }
      if (tab.ptyId) {
        knownPtyIds.add(tab.ptyId)
        persistedBindingByPtyId.set(tab.ptyId, {
          tabId: tab.parentTabId,
          paneKey: this.getMobileTerminalPaneKey(tab)
        })
      }
      for (const [leafId, ptyId] of Object.entries(tab.parentLayout?.ptyIdsByLeafId ?? {})) {
        knownPtyIds.add(ptyId)
        persistedBindingByPtyId.set(ptyId, {
          tabId: tab.parentTabId,
          paneKey: isTerminalLeafId(leafId)
            ? makePaneKey(tab.parentTabId, leafId)
            : `${tab.parentTabId}:${/^pane:(\d+)$/.exec(leafId)?.[1] ?? leafId}`
        })
      }
    }

    const liveness = new Map<string, boolean>()
    try {
      for (const ptyId of knownPtyIds) {
        const live = controller.hasPty(ptyId)
        if (live === null) {
          return null
        }
        liveness.set(ptyId, live)
      }
    } catch {
      return null
    }

    const livePtyIds = new Set<string>()
    for (const [ptyId, live] of liveness) {
      let pty = this.ptysById.get(ptyId)
      if (live) {
        livePtyIds.add(ptyId)
        const binding = persistedBindingByPtyId.get(ptyId)
        if (!pty && binding) {
          // Why: a live daemon PTY restored from disk needs its pane identity before mobile can issue a safe handle.
          pty = this.recordAuthoritativePtyWorktree(ptyId, FLOATING_TERMINAL_WORKTREE_ID, {
            tabId: binding.tabId,
            paneKey: binding.paneKey
          })
        }
        if (pty) {
          this.admitPtyLifecycle(pty, pty.incarnationId ?? undefined, {
            adoptHandles: false
          })
          this.refreshPtyForegroundAgent(ptyId)
        }
      } else if (pty) {
        this.markPtyDisconnected(pty)
      }
    }
    this.pruneDisconnectedPtyRecords()
    return livePtyIds
  }
  protected pruneDisconnectedPtyTranscript(pty: RuntimePtyWorktreeRecord): void {
    if (pty.connected) {
      return
    }
    // Why: disconnected PTY records stay addressable for status/exit reads, but their transcripts must not accumulate after the process dies.
    pty.tailBuffer = []
    pty.tailTranscriptBuffer = []
    pty.tailTranscriptChars = 0
    pty.tailPartialLine = ''
    pty.tailPendingAnsi = ''
    pty.tailRedrawCursor = null
    pty.tailTruncated = false
    pty.tailLinesTotal = 0
    pty.waitBlockedAt = null
    // Why: tail is now empty, so clear the memoized wait scan; onPtyData must recompute from the reset tail if this record resumes output.
    pty.tailWaitState = undefined
  }
}
