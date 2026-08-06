import { join } from 'node:path'
import { AgentHookServerIngest } from './agent-hook-server-ingest'
import { clearAllStatusEventCaches, clearPaneCacheState } from '../../shared/agent-status-event'
import * as hookShared from './agent-hook-server-shared'

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload

/** Main status runtime: generic OSC/PTY state only, with durable cache and ownership fencing. */
export class AgentHookServerRuntime extends AgentHookServerIngest {
  protected maybeWriteEndpointFile(): void {}
  protected hydrateLastStatusFromDisk(): void {}
  protected captureHydratedAuthorityCommitments(): void {}
  flushStatusPersistSync(): void {}

  async hydrate(options?: { env?: string; userDataPath?: string }): Promise<void> {
    if (options?.env) this.env = options.env
    if (options?.userDataPath) {
      this.endpointDir = join(options.userDataPath, 'agent-status')
      this.lastStatusFilePath = join(this.endpointDir, 'last-status.json')
      this.hydrateLastStatusFromDisk()
    }
    this.captureHydratedAuthorityCommitments()
  }

  stop(): void {
    this.flushStatusPersistSync()
    this.server = null
    this.port = 0
    this.token = ''
    this.env = 'production'
    this.onAgentStatus = null
    this.onPaneStatusCleared = null
    this.endpointDir = null
    this.endpointFilePathCache = null
    this.endpointFileWritten = false
    this.lastStatusFilePath = null
    this.lastWrittenJson = null
    this.runtimeObservedStatusPaneKeys.clear()
    this.hydratedAuthorityCommitments = Object.freeze([])
    this.revokedHydratedAuthorityCommitments = new WeakSet()
    this.hydratedLaunchTokenHashByPaneKey.clear()
    this.persistedAuthorityCommitmentsByPaneKey.clear()
    this.currentAuthorityObservations.clear()
    this.promptSentDedupeByPaneKey.clear()
    this.closedAgentStatusTabIds.clear()
    this.closedAgentStatusPaneKeys.clear()
    this.connectionTimestampWatermarkById.clear()
    this.legacyPaneKeyAliases.clear()
    clearAllStatusEventCaches(this.state)
    this.notifyStatusChangeListeners()
  }

  dropStatusEntry(paneKey: string): void {
    if (!this.deleteStatusEntry(paneKey, { preserveAuthority: true })) return
    this.scheduleStatusPersist()
    this.notifyStatusChangeListeners()
  }

  protected deleteStatusEntry(
    paneKey: string,
    _options: { preserveAuthority?: boolean } = {}
  ): boolean {
    const resolved = this.resolvePaneKeyAlias(paneKey)
    const existed = this.state.lastStatusByPaneKey.has(resolved)
    clearPaneCacheState(this.state, resolved)
    this.runtimeObservedStatusPaneKeys.delete(resolved)
    return existed
  }

  clearStatusEntriesForConnection(connectionId: string): void {
    const normalized = connectionId.trim()
    if (!normalized) return
    const clearedAt = Math.max(
      Date.now(),
      (this.connectionTimestampWatermarkById.get(normalized) ?? -1) + 1
    )
    this.connectionTimestampWatermarkById.set(normalized, clearedAt)
    let changed = false
    for (const [paneKey, raw] of this.state.lastStatusByPaneKey) {
      const entry = raw as EnrichedAgentHookEventPayload
      if (entry.connectionId !== normalized) continue
      changed = this.deleteStatusEntry(paneKey, { preserveAuthority: true }) || changed
      this.currentAuthorityObservations.delete(paneKey)
    }
    if (changed) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
    // The disconnect watermark is authoritative even when no cached row matched:
    // late events from this connection must still be fenced out.
    this.onPaneStatusCleared?.({
      connectionId: normalized,
      clearedAt,
      transient: true
    })
  }

  clearPaneState(paneKey: string): void {
    const resolved = this.resolvePaneKeyAlias(paneKey)
    this.revokeHydratedAuthorityForPaneKeys(new Set([resolved]))
    clearPaneCacheState(this.state, resolved)
    this.runtimeObservedStatusPaneKeys.delete(resolved)
    this.scheduleStatusPersist()
    this.notifyStatusChangeListeners()
    this.onPaneStatusCleared?.({ paneKey: resolved })
  }

  buildPtyEnv(): Record<string, string> {
    return {}
  }

  dropStatusEntriesByTabPrefix(tabId: string): void {
    const normalizedTabId = tabId.trim()
    if (!normalizedTabId) return
    this.markTabClosedForAgentStatus(normalizedTabId)
    const paneKeys = new Set<string>()
    const belongsToTab = (key: string): boolean => {
      const paneKey = key.split('\0', 1)[0] ?? key
      return paneKey.startsWith(`${normalizedTabId}:`)
    }
    for (const key of this.state.lastStatusByPaneKey.keys())
      if (belongsToTab(key)) paneKeys.add(key)
    for (const key of this.state.lastPromptByPaneKey.keys())
      if (belongsToTab(key)) paneKeys.add(key.split('\0', 1)[0] ?? key)
    for (const key of this.state.lastToolByPaneKey.keys())
      if (belongsToTab(key)) paneKeys.add(key.split('\0', 1)[0] ?? key)
    for (const key of this.runtimeObservedStatusPaneKeys) if (belongsToTab(key)) paneKeys.add(key)
    for (const key of this.currentAuthorityObservations.keys())
      if (belongsToTab(key)) paneKeys.add(key)
    for (const key of this.promptSentDedupeByPaneKey.keys())
      if (belongsToTab(key)) paneKeys.add(key)
    for (const key of this.persistedAuthorityCommitmentsByPaneKey.keys())
      if (belongsToTab(key)) paneKeys.add(key)
    for (const key of this.hydratedLaunchTokenHashByPaneKey.keys())
      if (belongsToTab(key)) paneKeys.add(key)
    for (const commitment of this.hydratedAuthorityCommitments)
      if (belongsToTab(commitment.paneKey)) paneKeys.add(commitment.paneKey)

    let aliasChanged = false
    for (const [physicalPaneKey, entry] of this.legacyPaneKeyAliases) {
      if (!belongsToTab(entry.stablePaneKey)) continue
      paneKeys.add(physicalPaneKey)
      paneKeys.add(entry.stablePaneKey)
      this.markPaneClosedForAgentStatus(physicalPaneKey)
      this.markPaneClosedForAgentStatus(entry.stablePaneKey)
      this.legacyPaneKeyAliases.delete(physicalPaneKey)
      aliasChanged = true
    }
    const authorityChanged = this.revokeHydratedAuthorityForPaneKeys(paneKeys)
    let statusChanged = false
    for (const key of paneKeys) {
      statusChanged = this.state.lastStatusByPaneKey.has(key) || statusChanged
      this.clearAssistantMessageRetry(key)
      this.clearCodexSubagentPoll(key)
      clearPaneCacheState(this.state, key)
      this.runtimeObservedStatusPaneKeys.delete(key)
      this.currentAuthorityObservations.delete(key)
      this.promptSentDedupeByPaneKey.delete(key)
    }
    if (aliasChanged) {
      this.notifyPaneKeyAliasPersistenceListener()
    }
    if (statusChanged || authorityChanged) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
  }
}
