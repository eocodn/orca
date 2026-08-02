import { AgentHookServerRuntime } from './agent-hook-server-runtime'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as hookShared from './agent-hook-server-shared'
import {
  authorityCommitmentsMatch,
  dropHydratedIdleClaudeSubagents,
  HYDRATE_MAX_AGE_MS,
  isValidPaneKey,
  LAST_STATUS_FILE_VERSION,
  readPersistedLaunchTokenHash,
  sanitizeHydratedEntry,
  sanitizePersistedAuthorityCommitment,
  STATUS_PERSIST_DEBOUNCE_MS
} from './agent-hook-server-shared'
import {
  seedClaudeSubagentRosterFromSnapshots,
  seedCodexStateFromSnapshot,
  writeEndpointFile,
  type HookListenerState
} from '../../shared/agent-hook-listener'
import { ORCA_HOOK_PROTOCOL_VERSION } from '../../shared/agent-hook-types'

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload
type PersistedAgentHookEventPayload = hookShared.PersistedAgentHookEventPayload
type PersistedAgentHookAuthorityCommitment = hookShared.PersistedAgentHookAuthorityCommitment
type LastStatusFile = hookShared.LastStatusFile

export class AgentHookServer extends AgentHookServerRuntime {
  get endpointFilePath(): string | null {
    return this.endpointFilePathCache
  }

  /** Test/diagnostic accessor for the on-disk last-status file path. */
  get lastStatusPath(): string | null {
    return this.lastStatusFilePath
  }

  protected maybeWriteEndpointFile(): void {
    if (!this.endpointDir || !this.endpointFilePathCache) {
      return
    }
    this.endpointFileWritten = false
    const ok = writeEndpointFile(this.endpointDir, this.endpointFilePathCache, {
      port: this.port,
      token: this.token,
      env: this.env,
      version: ORCA_HOOK_PROTOCOL_VERSION
    })
    this.endpointFileWritten = ok
  }

  protected hydrateLastStatusFromDisk(): void {
    if (!this.lastStatusFilePath) {
      return
    }
    // Why: keep hydrate idempotent so a future re-start path can't merge prior-session state.
    this.state.lastStatusByPaneKey.clear()
    this.hydratedLaunchTokenHashByPaneKey.clear()
    this.persistedAuthorityCommitmentsByPaneKey.clear()
    let raw: string
    try {
      raw = readFileSync(this.lastStatusFilePath, 'utf8')
    } catch (err) {
      // Why: missing file is normal (first launch); other errors degrade to empty hydration + one warn.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[agent-hooks] failed to read last-status file:', err)
      }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.warn('[agent-hooks] last-status file is not valid JSON; ignoring')
      return
    }
    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('[agent-hooks] last-status file is not an object; ignoring')
      return
    }
    const file = parsed as Partial<LastStatusFile>
    if (file.version !== LAST_STATUS_FILE_VERSION) {
      console.warn(
        `[agent-hooks] last-status file version mismatch (${String(
          file.version
        )} != ${LAST_STATUS_FILE_VERSION}); ignoring`
      )
      return
    }
    const entries = file.entries
    if (typeof entries !== 'object' || entries === null) {
      console.warn('[agent-hooks] last-status file entries missing or wrong shape; ignoring')
      return
    }
    let hydrated = 0
    let dropped = 0
    let prunedLegacyClaudeSubagents = 0
    let scrubbedLegacyLaunchTokens = 0
    // Why: drop entries older than HYDRATE_MAX_AGE_MS to bound disk growth (one Date.now() for a consistent cutoff).
    const ttlCutoff = Date.now() - HYDRATE_MAX_AGE_MS
    for (const [paneKey, rawEntry] of Object.entries(entries)) {
      const resolvedPaneKey = this.resolvePaneKeyAlias(paneKey)
      const rawResolvedEntry =
        resolvedPaneKey === paneKey || typeof rawEntry !== 'object' || rawEntry === null
          ? rawEntry
          : { ...(rawEntry as Record<string, unknown>), paneKey: resolvedPaneKey }
      const entry = sanitizeHydratedEntry(resolvedPaneKey, rawResolvedEntry)
      if (entry && entry.receivedAt >= ttlCutoff) {
        const launchTokenHash = readPersistedLaunchTokenHash(rawResolvedEntry)
        if (launchTokenHash) {
          this.hydratedLaunchTokenHashByPaneKey.set(resolvedPaneKey, launchTokenHash)
          const evidence = this.toAuthorityEvidence(entry, launchTokenHash)
          if (evidence) {
            this.persistedAuthorityCommitmentsByPaneKey.set(resolvedPaneKey, evidence)
          }
        }
        if (
          typeof rawResolvedEntry === 'object' &&
          rawResolvedEntry !== null &&
          typeof (rawResolvedEntry as Record<string, unknown>).launchToken === 'string'
        ) {
          scrubbedLegacyLaunchTokens += 1
        }
        const hydratedPayload = dropHydratedIdleClaudeSubagents(entry.payload)
        if (hydratedPayload !== entry.payload) {
          prunedLegacyClaudeSubagents +=
            (entry.payload.subagents?.length ?? 0) - (hydratedPayload.subagents?.length ?? 0)
          entry.payload = hydratedPayload
        }
        this.state.lastStatusByPaneKey.set(resolvedPaneKey, entry)
        if (entry.connectionId) {
          // Why: a restart can see an earlier wall clock; seed ordering so new events stay after disk state.
          const previousWatermark = this.connectionTimestampWatermarkById.get(entry.connectionId)
          this.connectionTimestampWatermarkById.set(
            entry.connectionId,
            Math.max(previousWatermark ?? -1, entry.receivedAt)
          )
        }
        // Why: restore live child hierarchy immediately; provider-specific reconciliation reaps stale seeds.
        if (entry.payload.agentType === 'codex') {
          seedCodexStateFromSnapshot(this.state, resolvedPaneKey, entry.payload)
        } else if (entry.payload.agentType === 'claude' && entry.payload.subagents) {
          seedClaudeSubagentRosterFromSnapshots(
            this.state,
            resolvedPaneKey,
            entry.payload.subagents
          )
        }
        hydrated += 1
      } else {
        dropped += 1
      }
    }
    for (const [paneKey, rawCommitment] of Object.entries(file.authorityCommitments ?? {})) {
      const resolvedPaneKey = this.resolvePaneKeyAlias(paneKey)
      const commitment = sanitizePersistedAuthorityCommitment(resolvedPaneKey, rawCommitment)
      if (!commitment || commitment.observedAt < ttlCutoff) {
        dropped += 1
        continue
      }
      const existing = this.persistedAuthorityCommitmentsByPaneKey.get(resolvedPaneKey)
      if (existing && !authorityCommitmentsMatch(existing, commitment)) {
        this.persistedAuthorityCommitmentsByPaneKey.delete(resolvedPaneKey)
        this.hydratedLaunchTokenHashByPaneKey.delete(resolvedPaneKey)
        dropped += 1
        continue
      }
      this.persistedAuthorityCommitmentsByPaneKey.set(resolvedPaneKey, commitment)
      this.hydratedLaunchTokenHashByPaneKey.set(resolvedPaneKey, commitment.launchTokenHash)
    }
    if (dropped > 0) {
      console.warn(
        `[agent-hooks] last-status hydrate dropped ${dropped} entries (kept ${hydrated})`
      )
    }
    if (dropped > 0 || prunedLegacyClaudeSubagents > 0 || scrubbedLegacyLaunchTokens > 0) {
      // Why: persist load-time pruning and bearer scrubbing once.
      this.runStatusPersist()
    } else if (hydrated > 0) {
      // Why: prime dedup from raw bytes (not re-serialized) only when hydration was lossless.
      this.lastWrittenJson = raw
    }
  }

  protected captureHydratedAuthorityCommitments(): void {
    this.revokedHydratedAuthorityCommitments = new WeakSet()
    for (const entry of this.state.lastStatusByPaneKey.values()) {
      const evidence = this.toAuthorityEvidence(
        entry as EnrichedAgentHookEventPayload,
        this.hydratedLaunchTokenHashByPaneKey.get(entry.paneKey)
      )
      if (evidence && !this.persistedAuthorityCommitmentsByPaneKey.has(entry.paneKey)) {
        this.persistedAuthorityCommitmentsByPaneKey.set(entry.paneKey, evidence)
      }
    }
    this.hydratedAuthorityCommitments = Object.freeze(
      Array.from(this.persistedAuthorityCommitmentsByPaneKey.values())
    )
  }

  protected serializeStatusFile(): string {
    const entries: Record<string, PersistedAgentHookEventPayload> = {}
    const authorityCommitments: Record<string, PersistedAgentHookAuthorityCommitment> = {}
    const conflictedCommitments = new Set<string>()
    for (const [paneKey, commitment] of this.persistedAuthorityCommitmentsByPaneKey) {
      authorityCommitments[paneKey] = { ...commitment }
    }
    for (const [paneKey, payload] of this.state.lastStatusByPaneKey) {
      // Why: never persist invalid keys (matches the hydrate-path invariant).
      if (!isValidPaneKey(paneKey)) {
        continue
      }
      const {
        promptInteractionKey: _promptInteractionKey,
        launchToken,
        ...persistedPayload
      } = payload as EnrichedAgentHookEventPayload
      const launchTokenHash = launchToken?.trim()
        ? createHash('sha256').update(launchToken.trim()).digest('hex')
        : this.hydratedLaunchTokenHashByPaneKey.get(paneKey)
      entries[paneKey] = {
        ...persistedPayload,
        ...(launchTokenHash ? { launchTokenHash } : {})
      }
      const commitment = this.toAuthorityEvidence(payload, launchTokenHash)
      if (commitment && !conflictedCommitments.has(paneKey)) {
        const existing = authorityCommitments[paneKey]
        if (existing && !authorityCommitmentsMatch(existing, commitment)) {
          delete authorityCommitments[paneKey]
          conflictedCommitments.add(paneKey)
        } else {
          authorityCommitments[paneKey] = { ...commitment }
        }
      }
    }
    const file: LastStatusFile = {
      version: LAST_STATUS_FILE_VERSION,
      entries,
      authorityCommitments
    }
    return JSON.stringify(file)
  }

  protected scheduleStatusPersist(): void {
    if (!this.lastStatusFilePath) {
      return
    }
    // Why: reset the timer each call so the write fires only after the last event in a burst.
    if (this.statusPersistTimer) {
      clearTimeout(this.statusPersistTimer)
    }
    this.statusPersistTimer = setTimeout(() => {
      this.statusPersistTimer = null
      this.runStatusPersist()
    }, STATUS_PERSIST_DEBOUNCE_MS)
    // Why: don't keep the event loop alive just for a status flush — quit already flushes sync.
    if (typeof this.statusPersistTimer.unref === 'function') {
      this.statusPersistTimer.unref()
    }
  }

  flushStatusPersistSync(): void {
    if (this.statusPersistTimer) {
      clearTimeout(this.statusPersistTimer)
      this.statusPersistTimer = null
    }
    if (!this.lastStatusFilePath) {
      return
    }
    this.runStatusPersist()
  }

  protected runStatusPersist(): void {
    if (!this.lastStatusFilePath || !this.endpointDir) {
      return
    }
    const json = this.serializeStatusFile()
    if (json === this.lastWrittenJson) {
      return
    }
    const tmpPath = join(this.endpointDir, `.last-status-${process.pid}-${randomUUID()}.tmp`)
    let tmpWritten = false
    try {
      mkdirSync(this.endpointDir, { recursive: true, mode: 0o700 })
      if (process.platform !== 'win32') {
        try {
          chmodSync(this.endpointDir, 0o700)
        } catch {
          // best-effort
        }
      }
      writeFileSync(tmpPath, json, { mode: 0o600 })
      tmpWritten = true
      renameSync(tmpPath, this.lastStatusFilePath)
      this.lastWrittenJson = json
    } catch (err) {
      console.warn('[agent-hooks] failed to write last-status file:', err)
      if (tmpWritten) {
        try {
          unlinkSync(tmpPath)
        } catch {
          // tmp already gone
        }
      }
    }
  }

  /** Test-only accessor for the per-instance listener state (narrow getter avoids an `as unknown` cast). */
  _getStateForTests(): HookListenerState {
    return this.state
  }

  _resetPromptSentDedupeForTests(): void {
    this.promptSentDedupeByPaneKey.clear()
  }

  _resetConnectionTimestampWatermarksForTests(): void {
    this.connectionTimestampWatermarkById.clear()
  }

}
