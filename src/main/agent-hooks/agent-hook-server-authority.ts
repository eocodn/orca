import { AgentHookServerStatus } from './agent-hook-server-status'
import * as hookShared from './agent-hook-server-shared'
import { clearPaneCacheState, movePaneCacheState } from '../../shared/agent-hook-listener'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../shared/stable-pane-id'
import type { LegacyPaneKeyAliasEntry } from '../../shared/types'

const { isValidPaneKey, PANE_KEY_ALIASES_MAX } = hookShared

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload
type PaneKeyAliasPersistenceListener = hookShared.PaneKeyAliasPersistenceListener

export class AgentHookServerAuthority extends AgentHookServerStatus {
  setPaneKeyAliasPersistenceListener(listener: PaneKeyAliasPersistenceListener | null): void {
    this.paneKeyAliasPersistenceListener = listener
  }

  protected getPersistedPaneKeyAliases(): LegacyPaneKeyAliasEntry[] {
    return Array.from(this.legacyPaneKeyAliases.entries()).flatMap(([legacyPaneKey, entry]) =>
      entry.ptyId
        ? [
            {
              ptyId: entry.ptyId,
              legacyPaneKey,
              stablePaneKey: entry.stablePaneKey,
              updatedAt: entry.updatedAt
            }
          ]
        : []
    )
  }

  protected notifyPaneKeyAliasPersistenceListener(): void {
    this.paneKeyAliasPersistenceListener?.(this.getPersistedPaneKeyAliases())
  }

  protected boundPaneKeyAliases(): void {
    while (this.legacyPaneKeyAliases.size > PANE_KEY_ALIASES_MAX) {
      // Why: renderer-originated aliases are untrusted; insertion-order eviction bounds memory and per-message cleanup.
      const oldestKey = this.legacyPaneKeyAliases.keys().next().value
      if (!oldestKey) {
        break
      }
      this.legacyPaneKeyAliases.delete(oldestKey)
    }
  }

  protected getPhysicalPaneKeyForAuthority(paneKey: string, ptyId?: string): string {
    const ownerPaneKey = this.resolvePaneKeyAlias(paneKey)
    let fallbackPaneKey = paneKey
    for (const [physicalPaneKey, entry] of this.legacyPaneKeyAliases) {
      if (
        entry.stablePaneKey === ownerPaneKey &&
        (!ptyId || !entry.ptyId || entry.ptyId === ptyId)
      ) {
        if (entry.authorityVerified) {
          return physicalPaneKey
        }
        fallbackPaneKey = physicalPaneKey
      }
    }
    return fallbackPaneKey
  }

  canTransferPaneAuthority(
    fromPaneKey: string,
    ptyId: string | undefined,
    ownsPty: (physicalPaneKey: string, ptyId: string) => boolean
  ): boolean {
    if (!isValidPaneKey(fromPaneKey)) {
      return false
    }
    const ownerPaneKey = this.resolvePaneKeyAlias(fromPaneKey)
    const physicalPaneKey = this.getPhysicalPaneKeyForAuthority(fromPaneKey, ptyId)
    const alias = this.legacyPaneKeyAliases.get(physicalPaneKey)
    if (ptyId) {
      return Boolean(
        (alias?.authorityVerified && alias.ptyId === ptyId) ||
        ownsPty(physicalPaneKey, ptyId) ||
        (ownerPaneKey !== physicalPaneKey && ownsPty(ownerPaneKey, ptyId))
      )
    }
    // Why: hook status is renderer evidence, not PTY ownership; ID-less moves are safe only after a verified transfer minted an alias.
    return alias?.authorityVerified === true
  }

  registerPaneKeyAlias(
    legacyPaneKey: string,
    stablePaneKey: string,
    ptyId?: string,
    updatedAt = Date.now(),
    options?: { overwriteExisting?: boolean; authorityVerified?: boolean }
  ): void {
    const legacy = parseLegacyNumericPaneKey(legacyPaneKey)
    const stable = isValidPaneKey(stablePaneKey) ? parsePaneKey(stablePaneKey) : null
    if (!legacy || !stable || legacy.tabId !== stable.tabId) {
      return
    }
    const existing = this.legacyPaneKeyAliases.get(legacy.paneKey)
    if (existing && options?.overwriteExisting === false) {
      return
    }
    const normalizedPtyId =
      typeof ptyId === 'string' && ptyId.trim().length > 0 ? ptyId.trim() : existing?.ptyId
    const normalizedUpdatedAt =
      Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : (existing?.updatedAt ?? Date.now())
    const authorityVerified = options?.authorityVerified ?? false
    if (
      existing &&
      existing.stablePaneKey === stablePaneKey &&
      existing.ptyId === (normalizedPtyId ?? null) &&
      existing.updatedAt === normalizedUpdatedAt &&
      existing.authorityVerified === authorityVerified
    ) {
      return
    }
    this.legacyPaneKeyAliases.set(legacy.paneKey, {
      stablePaneKey,
      ptyId: normalizedPtyId ?? null,
      updatedAt: normalizedUpdatedAt,
      authorityVerified
    })
    this.boundPaneKeyAliases()
    if (normalizedPtyId) {
      this.notifyPaneKeyAliasPersistenceListener()
    }
  }

  transferPaneAuthority(
    fromPaneKey: string,
    toPaneKey: string,
    ptyId?: string,
    updatedAt = Date.now(),
    options?: { authorityVerified?: boolean }
  ): void {
    if (!isValidPaneKey(fromPaneKey) || !isValidPaneKey(toPaneKey)) {
      return
    }
    const previousOwnerPaneKey = this.resolvePaneKeyAlias(fromPaneKey)
    const physicalPaneKey = this.getPhysicalPaneKeyForAuthority(fromPaneKey, ptyId)
    const existing = this.legacyPaneKeyAliases.get(physicalPaneKey)
    const normalizedPtyId = ptyId?.trim() || existing?.ptyId || null
    const hadStatus = this.state.lastStatusByPaneKey.has(previousOwnerPaneKey)
    movePaneCacheState(this.state, previousOwnerPaneKey, toPaneKey)
    const movedStatus = this.state.lastStatusByPaneKey.get(toPaneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (movedStatus) {
      const owner = parsePaneKey(toPaneKey)
      this.state.lastStatusByPaneKey.set(toPaneKey, {
        ...movedStatus,
        paneKey: toPaneKey,
        tabId: owner?.tabId
      })
    }
    const hydratedLaunchTokenHash = this.hydratedLaunchTokenHashByPaneKey.get(previousOwnerPaneKey)
    if (hydratedLaunchTokenHash) {
      this.hydratedLaunchTokenHashByPaneKey.delete(previousOwnerPaneKey)
      this.hydratedLaunchTokenHashByPaneKey.set(toPaneKey, hydratedLaunchTokenHash)
    }
    const persistedAuthority = this.persistedAuthorityCommitmentsByPaneKey.get(previousOwnerPaneKey)
    if (persistedAuthority) {
      const owner = parsePaneKey(toPaneKey)
      this.persistedAuthorityCommitmentsByPaneKey.delete(previousOwnerPaneKey)
      this.persistedAuthorityCommitmentsByPaneKey.set(
        toPaneKey,
        Object.freeze({
          ...persistedAuthority,
          paneKey: toPaneKey,
          ...(owner?.tabId ? { tabId: owner.tabId } : {})
        })
      )
    }
    if (this.runtimeObservedStatusPaneKeys.delete(previousOwnerPaneKey)) {
      this.runtimeObservedStatusPaneKeys.add(toPaneKey)
    }
    const authorityObservation = this.currentAuthorityObservations.get(previousOwnerPaneKey)
    if (authorityObservation) {
      const owner = parsePaneKey(toPaneKey)
      this.currentAuthorityObservations.delete(previousOwnerPaneKey)
      this.currentAuthorityObservations.set(
        toPaneKey,
        Object.freeze({
          ...authorityObservation,
          paneKey: toPaneKey,
          tabId: owner?.tabId
        })
      )
    }
    const promptDedupe = this.promptSentDedupeByPaneKey.get(previousOwnerPaneKey)
    if (promptDedupe !== undefined) {
      this.promptSentDedupeByPaneKey.delete(previousOwnerPaneKey)
      this.promptSentDedupeByPaneKey.set(toPaneKey, promptDedupe)
    }
    this.clearAssistantMessageRetry(previousOwnerPaneKey)
    this.clearCodexSubagentPoll(previousOwnerPaneKey)
    // Why: the live process keeps posting the physical source key after detach; persist a chain-safe mapping to the current owner.
    this.legacyPaneKeyAliases.set(physicalPaneKey, {
      stablePaneKey: toPaneKey,
      ptyId: normalizedPtyId,
      updatedAt,
      authorityVerified: options?.authorityVerified ?? true
    })
    this.boundPaneKeyAliases()
    this.closedAgentStatusPaneKeys.delete(toPaneKey)
    this.notifyPaneKeyAliasPersistenceListener()
    if (hadStatus || persistedAuthority) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
  }

  retirePaneAuthority(paneKey: string): void {
    const ownerPaneKey = this.resolvePaneKeyAlias(paneKey)
    const paneKeys = new Set([paneKey, ownerPaneKey])
    let aliasChanged = false
    for (const [physicalPaneKey, entry] of this.legacyPaneKeyAliases) {
      if (physicalPaneKey === paneKey || entry.stablePaneKey === ownerPaneKey) {
        this.legacyPaneKeyAliases.delete(physicalPaneKey)
        paneKeys.add(physicalPaneKey)
        paneKeys.add(entry.stablePaneKey)
        aliasChanged = true
      }
    }
    const authorityChanged = this.revokeHydratedAuthorityForPaneKeys(paneKeys)
    const hadStatus = [...paneKeys].some((key) => this.state.lastStatusByPaneKey.has(key))
    for (const key of paneKeys) {
      this.markPaneClosedForAgentStatus(key)
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
    if (hadStatus || authorityChanged) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
    }
  }

  clearPaneKeyAliasesForPty(
    ptyId: string,
    options?: { shouldClearStablePaneKey?: (paneKey: string) => boolean }
  ): void {
    let aliasChanged = false
    let statusChanged = false
    const clearedStatusPaneKeys = new Set<string>()
    for (const [legacyPaneKey, entry] of this.legacyPaneKeyAliases) {
      if (entry.ptyId === ptyId) {
        const shouldClearStablePaneKey =
          options?.shouldClearStablePaneKey?.(entry.stablePaneKey) ?? true
        const revokedPaneKeys = new Set([legacyPaneKey])
        if (shouldClearStablePaneKey) {
          revokedPaneKeys.add(entry.stablePaneKey)
        }
        if (this.revokeHydratedAuthorityForPaneKeys(revokedPaneKeys)) {
          statusChanged = true
        }
        this.legacyPaneKeyAliases.delete(legacyPaneKey)
        clearPaneCacheState(this.state, legacyPaneKey)
        this.currentAuthorityObservations.delete(legacyPaneKey)
        this.promptSentDedupeByPaneKey.delete(legacyPaneKey)
        if (shouldClearStablePaneKey && this.state.lastStatusByPaneKey.has(entry.stablePaneKey)) {
          statusChanged = true
          clearedStatusPaneKeys.add(entry.stablePaneKey)
        }
        if (shouldClearStablePaneKey) {
          // Why: hydrated rows live under the stable key; if this PTY dies before ptyPaneKey rebuilds, alias cleanup is the only evictor.
          clearPaneCacheState(this.state, entry.stablePaneKey)
          this.runtimeObservedStatusPaneKeys.delete(entry.stablePaneKey)
          this.currentAuthorityObservations.delete(entry.stablePaneKey)
          this.promptSentDedupeByPaneKey.delete(entry.stablePaneKey)
        }
        aliasChanged = true
      }
    }
    if (aliasChanged) {
      this.notifyPaneKeyAliasPersistenceListener()
    }
    if (statusChanged) {
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
      for (const paneKey of clearedStatusPaneKeys) {
        this.onPaneStatusCleared?.({ paneKey })
      }
    }
  }

  protected revokeHydratedAuthorityForPaneKeys(paneKeys: ReadonlySet<string>): boolean {
    let changed = false
    for (const commitment of this.hydratedAuthorityCommitments) {
      if (
        paneKeys.has(commitment.paneKey) ||
        paneKeys.has(this.resolvePaneKeyAlias(commitment.paneKey))
      ) {
        this.revokedHydratedAuthorityCommitments.add(commitment)
        changed = true
      }
    }
    for (const paneKey of paneKeys) {
      const resolvedPaneKey = this.resolvePaneKeyAlias(paneKey)
      changed = this.hydratedLaunchTokenHashByPaneKey.delete(paneKey) || changed
      changed = this.hydratedLaunchTokenHashByPaneKey.delete(resolvedPaneKey) || changed
      changed = this.persistedAuthorityCommitmentsByPaneKey.delete(paneKey) || changed
      changed = this.persistedAuthorityCommitmentsByPaneKey.delete(resolvedPaneKey) || changed
    }
    return changed
  }

  protected normalizeHookBodyPaneKeyAlias(body: unknown): unknown {
    if (typeof body !== 'object' || body === null) {
      return body
    }
    const record = body as Record<string, unknown>
    const rawPaneKey = typeof record.paneKey === 'string' ? record.paneKey.trim() : ''
    const stablePaneKey = this.legacyPaneKeyAliases.get(rawPaneKey)?.stablePaneKey
    if (!stablePaneKey) {
      return body
    }
    // Why: detached shells keep posting the immutable physical pane key; normalize pane and tab identity to the current owner.
    return { ...record, paneKey: stablePaneKey, tabId: parsePaneKey(stablePaneKey)?.tabId }
  }

}
