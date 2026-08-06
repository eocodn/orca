import { AgentHookServerIngest } from './agent-hook-server-ingest'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import * as hookShared from './agent-hook-server-shared'
import { ORCA_HOOK_PROTOCOL_VERSION } from '../../shared/agent-hook-types'
import {
  clearAllListenerCaches,
  clearPaneCacheState,
  getEndpointFileName,
  HOOK_REQUEST_SLOWLORIS_MS,
  normalizeHookPayload,
  readRequestBody,
  reapRestoredClaudeSubagentsForDeadPane,
  resolveHookSource
} from '../../shared/agent-hook-listener'
import {
  claudeRosterHasRestoredSnapshotSubagent,
  claudeRosterHasWorkingSubagent,
  claudeRosterToSnapshots
} from '../../shared/claude-subagent-roster'

const { trackEmptyPaneKeyHook, paneCacheKeyMatchesTab, LAST_STATUS_FILE_NAME } = hookShared

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload

export class AgentHookServerRuntime extends AgentHookServerIngest {
  // Why: the concrete persistence subclass overrides these hooks while relay/runtime tests stay disk-free.
  protected maybeWriteEndpointFile(): void {}

  protected hydrateLastStatusFromDisk(): void {}

  protected captureHydratedAuthorityCommitments(): void {}

  flushStatusPersistSync(): void {}

  async start(options?: {
    env?: string
    userDataPath?: string
    endpointNamespace?: string
  }): Promise<void> {
    if (this.server) {
      return
    }

    if (options?.env) {
      this.env = options.env
    }
    if (options?.userDataPath) {
      // Why: dev builds share one userData path; namespace per instance while packaged keeps the stable path for PTY reconnect.
      this.endpointDir = options.endpointNamespace
        ? join(options.userDataPath, 'agent-hooks', options.endpointNamespace)
        : join(options.userDataPath, 'agent-hooks')
      this.endpointFilePathCache = join(this.endpointDir, getEndpointFileName())
      this.lastStatusFilePath = join(this.endpointDir, LAST_STATUS_FILE_NAME)
    }
    this.token = randomUUID()
    this.endpointFileWritten = false
    this.lastWrittenJson = null
    // Why: hydrate before binding the listener so an early hook POST runs against a populated map.
    if (this.lastStatusFilePath) {
      this.hydrateLastStatusFromDisk()
    }
    this.captureHydratedAuthorityCommitments()
    const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== 'POST') {
        res.writeHead(404)
        res.end()
        return
      }

      if (req.headers['x-orca-agent-hook-token'] !== this.token) {
        res.writeHead(403)
        res.end()
        return
      }

      // Why: bound request time so a stalled client can't hold a socket open (slowloris).
      req.setTimeout(HOOK_REQUEST_SLOWLORIS_MS, () => {
        req.destroy()
      })

      try {
        const body = await readRequestBody(req)
        const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
        const source = resolveHookSource(pathname)
        if (!source) {
          res.writeHead(404)
          res.end()
          return
        }

        trackEmptyPaneKeyHook(body)
        const aliasedBody = this.normalizeHookBodyPaneKeyAlias(body)
        const normalized = normalizeHookPayload(this.state, source, aliasedBody, this.env)
        if (normalized && !this.shouldSuppressClosedTabStatus(normalized.paneKey)) {
          this.recordCurrentAuthorityObservation(normalized)
          const enriched = this.applyNormalizedStatus(normalized)
          this.scheduleAssistantMessageRetry(source, aliasedBody, enriched)
          this.scheduleCodexSubagentPoll(source, aliasedBody, enriched)
        }

        res.writeHead(204)
        res.end()
      } catch {
        // Why: fail open — return success on malformed payloads so a broken hook never blocks the agent.
        res.writeHead(204)
        res.end()
      }
    }
    // Why: node ignores a returned promise, so the handler must settle it itself; handleRequest never rejects.
    this.server = createServer((req, res) => {
      void handleRequest(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      // Why: swap the startup reject-handler for a logging one so a later runtime 'error' can't crash main as an unhandled event.
      const onStartupError = (err: Error): void => {
        const failedServer = this.server
        failedServer?.off('listening', onListening)
        // Why: a failed listen leaves a non-serving Server object assigned, which would make the next start() return early.
        if (this.server === failedServer) {
          this.server = null
          this.port = 0
        }
        reject(err)
      }
      const onListening = (): void => {
        this.server?.off('error', onStartupError)
        this.server?.on('error', (err) => {
          console.error('[agent-hooks] server error', err)
        })
        const address = this.server!.address()
        if (address && typeof address === 'object') {
          this.port = address.port
        }
        this.maybeWriteEndpointFile()
        resolve()
      }
      this.server!.once('error', onStartupError)
      this.server!.listen(0, '127.0.0.1', onListening)
    })
  }

  stop(): void {
    // Why: flush the pending debounced write before clearing the map, else a hook <250ms before quit is lost on relaunch.
    this.flushStatusPersistSync()
    this.server?.close()
    this.server = null
    this.port = 0
    this.token = ''
    this.env = 'production'
    this.onAgentStatus = null
    this.onPaneStatusCleared = null
    for (const timer of this.assistantMessageRetryTimers.values()) {
      clearTimeout(timer)
    }
    this.assistantMessageRetryTimers.clear()
    for (const timer of this.codexSubagentPollTimers.values()) {
      clearTimeout(timer)
    }
    this.codexSubagentPollTimers.clear()
    // Why: don't unlink the endpoint file — a stale file matches fail-open and avoids a TOCTOU race with a concurrent Orca.
    this.endpointDir = null
    this.endpointFilePathCache = null
    this.endpointFileWritten = false
    this.lastStatusFilePath = null
    this.lastWrittenJson = null
    this.runtimeObservedStatusPaneKeys.clear()
    this.hydratedAuthorityCommitments = Object.freeze([])
    this.hydratedLaunchTokenHashByPaneKey.clear()
    this.persistedAuthorityCommitmentsByPaneKey.clear()
    this.revokedHydratedAuthorityCommitments = new WeakSet()
    this.currentAuthorityObservations.clear()
    this.promptSentDedupeByPaneKey.clear()
    this.closedAgentStatusTabIds.clear()
    this.closedAgentStatusPaneKeys.clear()
    this.connectionTimestampWatermarkById.clear()
    this.legacyPaneKeyAliases.clear()
    clearAllListenerCaches(this.state)
    this.notifyStatusChangeListeners()
  }

  /** Drop only the status row (user dismissal); do NOT wipe prompt/tool caches since the pane's agent may still be alive. Use clearPaneState for PTY-teardown. */
  dropStatusEntry(paneKey: string): void {
    if (!this.deleteStatusEntry(paneKey, { preserveAuthority: true })) {
      return
    }
    this.scheduleStatusPersist()
    this.notifyStatusChangeListeners()
  }

  /** Clear statuses proven to belong to one lost SSH transport. */
  clearStatusEntriesForConnection(connectionId: string): void {
    const normalizedConnectionId = connectionId.trim()
    if (normalizedConnectionId.length === 0) {
      return
    }
    const clearedAt = Math.max(
      Date.now(),
      (this.connectionTimestampWatermarkById.get(normalizedConnectionId) ?? -1) + 1
    )
    this.connectionTimestampWatermarkById.set(normalizedConnectionId, clearedAt)
    let statusChanged = false
    for (const [paneKey, rawEntry] of this.state.lastStatusByPaneKey) {
      const entry = rawEntry as EnrichedAgentHookEventPayload
      // Why: unstamped rows can't be attributed to one host; leave them for normal pane teardown.
      if (entry.connectionId !== normalizedConnectionId) {
        continue
      }
      const deleted = this.deleteStatusEntry(paneKey, { preserveAuthority: true })
      if (deleted) {
        statusChanged = true
        if (deleted.payload.agentType === 'codex') {
          // Why: a replacement remote process may reuse the pane; don't merge it with the lost connection's children.
          this.state.codexSubagentRosterByPaneKey.delete(paneKey)
          this.state.codexLeadStateByPaneKey.delete(paneKey)
        }
      }
    }
    for (const [paneKey, evidence] of this.currentAuthorityObservations) {
      if (evidence.connectionId === normalizedConnectionId) {
        this.currentAuthorityObservations.delete(paneKey)
      }
    }
    if (statusChanged) {
      // Why: persist/notify once — one disconnect can own many panes.
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
    // Why: always send the cutoff even with no matched entry — another host may have overwritten this pane's row.
    this.onPaneStatusCleared?.({
      transient: true,
      connectionId: normalizedConnectionId,
      clearedAt
    })
  }

  protected deleteStatusEntry(
    paneKey: string,
    options?: { preserveAuthority?: boolean }
  ): EnrichedAgentHookEventPayload | null {
    const resolvedPaneKey = this.resolvePaneKeyAlias(paneKey)
    const existing = this.state.lastStatusByPaneKey.get(resolvedPaneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!existing) {
      return null
    }
    this.state.lastStatusByPaneKey.delete(resolvedPaneKey)
    if (!options?.preserveAuthority) {
      this.hydratedLaunchTokenHashByPaneKey.delete(resolvedPaneKey)
      this.persistedAuthorityCommitmentsByPaneKey.delete(resolvedPaneKey)
    }
    this.clearAssistantMessageRetry(resolvedPaneKey)
    this.clearCodexSubagentPoll(resolvedPaneKey)
    this.runtimeObservedStatusPaneKeys.delete(resolvedPaneKey)
    this.currentAuthorityObservations.delete(resolvedPaneKey)
    if (existing.payload.state === 'done') {
      this.promptSentDedupeByPaneKey.delete(resolvedPaneKey)
    }
    return existing
  }

  dropStatusEntriesByTabPrefix(tabId: string): void {
    this.markTabClosedForAgentStatus(tabId)
    const paneKeysToClear = new Set<string>()
    for (const key of this.state.lastStatusByPaneKey.keys()) {
      if (paneCacheKeyMatchesTab(key, tabId)) {
        paneKeysToClear.add(key)
      }
    }
    for (const key of this.state.lastPromptByPaneKey.keys()) {
      if (paneCacheKeyMatchesTab(key, tabId)) {
        paneKeysToClear.add(key.split('\0', 1)[0] ?? key)
      }
    }
    for (const key of this.state.lastToolByPaneKey.keys()) {
      if (paneCacheKeyMatchesTab(key, tabId)) {
        paneKeysToClear.add(key.split('\0', 1)[0] ?? key)
      }
    }
    for (const key of this.state.antigravityCompletedTranscriptByPaneKey.keys()) {
      if (paneCacheKeyMatchesTab(key, tabId)) {
        paneKeysToClear.add(key.split('\0', 1)[0] ?? key)
      }
    }
    for (const key of this.state.ampCompletedCacheKeys) {
      if (paneCacheKeyMatchesTab(key, tabId)) {
        paneKeysToClear.add(key.split('\0', 1)[0] ?? key)
      }
    }
    for (const paneKey of this.runtimeObservedStatusPaneKeys) {
      if (paneCacheKeyMatchesTab(paneKey, tabId)) {
        paneKeysToClear.add(paneKey)
      }
    }
    for (const paneKey of this.promptSentDedupeByPaneKey.keys()) {
      if (paneCacheKeyMatchesTab(paneKey, tabId)) {
        paneKeysToClear.add(paneKey)
      }
    }
    for (const commitment of this.hydratedAuthorityCommitments) {
      if (paneCacheKeyMatchesTab(commitment.paneKey, tabId)) {
        paneKeysToClear.add(commitment.paneKey)
      }
    }

    let aliasChanged = false
    for (const [legacyPaneKey, entry] of this.legacyPaneKeyAliases) {
      const ownerMatches = paneCacheKeyMatchesTab(entry.stablePaneKey, tabId)
      if (ownerMatches) {
        this.legacyPaneKeyAliases.delete(legacyPaneKey)
        paneKeysToClear.add(legacyPaneKey)
        paneKeysToClear.add(entry.stablePaneKey)
        this.markPaneClosedForAgentStatus(legacyPaneKey)
        this.markPaneClosedForAgentStatus(entry.stablePaneKey)
        aliasChanged = true
      }
    }
    const authorityChanged = this.revokeHydratedAuthorityForPaneKeys(paneKeysToClear)

    let statusChanged = false
    for (const paneKey of paneKeysToClear) {
      if (this.state.lastStatusByPaneKey.has(paneKey)) {
        statusChanged = true
      }
      this.clearAssistantMessageRetry(paneKey)
      this.clearCodexSubagentPoll(paneKey)
      clearPaneCacheState(this.state, paneKey)
      this.runtimeObservedStatusPaneKeys.delete(paneKey)
      this.currentAuthorityObservations.delete(paneKey)
      this.promptSentDedupeByPaneKey.delete(paneKey)
    }
    if (aliasChanged) {
      this.notifyPaneKeyAliasPersistenceListener()
    }
    if (statusChanged || authorityChanged) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
  }

  clearPaneState(paneKey: string): void {
    const resolvedPaneKey = this.resolvePaneKeyAlias(paneKey)
    const paneKeys = new Set([paneKey, resolvedPaneKey])
    // Why: only persist when a status entry was actually evicted; dropping prompt/tool caches doesn't change the file.
    const hadStatus = this.state.lastStatusByPaneKey.has(resolvedPaneKey)
    this.clearAssistantMessageRetry(resolvedPaneKey)
    this.clearCodexSubagentPoll(resolvedPaneKey)
    clearPaneCacheState(this.state, resolvedPaneKey)
    this.currentAuthorityObservations.delete(resolvedPaneKey)
    this.promptSentDedupeByPaneKey.delete(resolvedPaneKey)
    let clearedAlias = false
    for (const [legacyPaneKey, stablePaneKey] of this.legacyPaneKeyAliases) {
      if (stablePaneKey.stablePaneKey === resolvedPaneKey) {
        this.legacyPaneKeyAliases.delete(legacyPaneKey)
        paneKeys.add(legacyPaneKey)
        paneKeys.add(stablePaneKey.stablePaneKey)
        clearPaneCacheState(this.state, legacyPaneKey)
        this.currentAuthorityObservations.delete(legacyPaneKey)
        this.promptSentDedupeByPaneKey.delete(legacyPaneKey)
        clearedAlias = true
      }
    }
    const authorityChanged = this.revokeHydratedAuthorityForPaneKeys(paneKeys)
    if (clearedAlias) {
      this.notifyPaneKeyAliasPersistenceListener()
    }
    if (hadStatus || authorityChanged) {
      this.runtimeObservedStatusPaneKeys.delete(resolvedPaneKey)
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
      this.onPaneStatusCleared?.({ paneKey: resolvedPaneKey })
    }
  }

  /** Second reap path for restored Claude subagent rows: drop the ones whose pane
   *  has no live local agent process behind it any more. A PTY that dies while Orca
   *  is down never runs the teardown that clears pane state, so hydrate rebuilds a
   *  roster nothing can ever retire — the inventory reap needs the parent to emit a
   *  complete `background_tasks` list and an idle parent never does. The row then
   *  gates the pane 'working' for the rest of its life and hibernation, which
   *  requires 'done', can never reclaim the agent's heap.
   *
   *  Both the execution host and relay binding must prove local ownership before
   *  targeted PTY liveness is consulted. Panes that reported in this runtime are
   *  also skipped. Returns the number of panes changed. */
  async reapRestoredClaudeSubagentsWithoutLiveAgent(
    isLocalExecutionHost: (worktreeId: string | undefined) => boolean,
    isLocalPaneAgentLive: (paneKey: string) => Promise<boolean>,
    isLocalPaneLivenessEvidenceCurrent: (paneKey: string) => boolean
  ): Promise<number> {
    const candidates: { paneKey: string; entry: EnrichedAgentHookEventPayload }[] = []
    for (const [paneKey, entry] of this.state.lastStatusByPaneKey) {
      const enriched = entry as EnrichedAgentHookEventPayload
      if (
        enriched.payload.agentType === 'claude' &&
        enriched.connectionId === null &&
        isLocalExecutionHost(enriched.worktreeId) &&
        claudeRosterHasRestoredSnapshotSubagent(
          this.state.claudeSubagentRosterByPaneKey.get(paneKey)
        ) &&
        !this.runtimeObservedStatusPaneKeys.has(paneKey)
      ) {
        candidates.push({ paneKey, entry: enriched })
      }
    }
    const liveness = await Promise.all(
      candidates.map(async (candidate) => {
        try {
          return await isLocalPaneAgentLive(candidate.paneKey)
        } catch {
          return true
        }
      })
    )
    let changedPanes = 0
    for (const [index, candidate] of candidates.entries()) {
      const { paneKey, entry: enriched } = candidate
      if (
        liveness[index] ||
        !isLocalPaneLivenessEvidenceCurrent(paneKey) ||
        this.state.lastStatusByPaneKey.get(paneKey) !== enriched ||
        this.runtimeObservedStatusPaneKeys.has(paneKey) ||
        !isLocalExecutionHost(enriched.worktreeId)
      ) {
        continue
      }
      if (!reapRestoredClaudeSubagentsForDeadPane(this.state, paneKey)) {
        continue
      }
      changedPanes += 1
      const roster = this.state.claudeSubagentRosterByPaneKey.get(paneKey)
      const subagents = claudeRosterToSnapshots(roster)
      // Why: the pane's persisted 'working' was the child gate holding a finished
      // lead open (subagent events never set lead state). With the last working row
      // gone and no process left to report, 'done' is the only truthful state — and
      // the one hibernation needs once this pane's agent is restored.
      const state =
        enriched.payload.state === 'working' && !claudeRosterHasWorkingSubagent(roster)
          ? 'done'
          : enriched.payload.state
      const stateChanged = state !== enriched.payload.state
      const reconciledAt = stateChanged
        ? Math.max(Date.now(), enriched.receivedAt + 1)
        : enriched.receivedAt
      const reconciled: EnrichedAgentHookEventPayload = {
        ...enriched,
        receivedAt: reconciledAt,
        stateStartedAt: stateChanged ? reconciledAt : enriched.stateStartedAt,
        payload: { ...enriched.payload, state, subagents }
      }
      this.state.lastStatusByPaneKey.set(paneKey, reconciled)
    }
    if (changedPanes > 0) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
    return changedPanes
  }

  buildPtyEnv(): Record<string, string> {
    if (this.port <= 0 || !this.token) {
      return {}
    }

    const env: Record<string, string> = {
      ORCA_AGENT_HOOK_PORT: String(this.port),
      ORCA_AGENT_HOOK_TOKEN: this.token,
      ORCA_AGENT_HOOK_ENV: this.env,
      ORCA_AGENT_HOOK_VERSION: ORCA_HOOK_PROTOCOL_VERSION
    }
    // Why: hooks source this file at invocation; dev namespaces it so parallel `pnpm dev` runs don't steal each other's hooks.
    if (this.endpointFileWritten && this.endpointFilePathCache) {
      env.ORCA_AGENT_HOOK_ENDPOINT = this.endpointFilePathCache
    }
    return env
  }
}
