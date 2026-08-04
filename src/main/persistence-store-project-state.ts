import { createHash,randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  unlinkSync
} from 'node:fs'
import { mkdir,open,rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { renameDurableSync,writeFileDurableSync } from './durable-file-write'
import { encrypt } from './persistence-state-foundation'

import type {
  PersistedState
} from '../shared/types'


import {
  parseCodexResetCreditAttemptLedger,
  type CodexResetCreditAttemptLedger
} from '../shared/codex-reset-credit-attempt-ledger'

import { Store } from './persistence'
import { StorePhase1 } from './persistence-store-repository-state'

export class StorePhase2 extends StorePhase1 {
  protected migrateTabSwitchKeybindings(
    state: PersistedState,
    fileExistedOnLoad: boolean
  ): PersistedState {
    const existing = state.settings?.tabSwitchKeybindingSeed
    if (existing === 'pending' || existing === 'done') {
      return state
    }
    // Why: mark dirty so the frozen cohort persists; else a fresh install re-reads as "existing" after its file lands.
    this.loadNeedsSave = true
    return {
      ...state,
      settings: {
        ...state.settings,
        // Existing installs pin old chords via a keybindings.json seed; fresh installs use the new registry defaults.
        tabSwitchKeybindingSeed: fileExistedOnLoad ? 'pending' : 'done'
      }
    }
  }

  protected migrateTelemetry(state: PersistedState, fileExistedOnLoad: boolean): PersistedState {
    const existing = state.settings?.telemetry
    // Why: require all three invariants; keying on existedBeforeTelemetryRelease alone lets a partial block skip migration.
    if (
      typeof existing?.existedBeforeTelemetryRelease === 'boolean' &&
      typeof existing.installId === 'string' &&
      existing.installId.length > 0 &&
      (existing.optedIn === true || existing.optedIn === false || existing.optedIn === null)
    ) {
      return state
    }
    // Why: resolve cohort once; re-inferring it in the optedIn fallback could misclassify a partially-written new user.
    const resolvedExistedBefore =
      typeof existing?.existedBeforeTelemetryRelease === 'boolean'
        ? existing.existedBeforeTelemetryRelease
        : fileExistedOnLoad
    return {
      ...state,
      settings: {
        ...state.settings,
        telemetry: {
          ...existing,
          existedBeforeTelemetryRelease: resolvedExistedBefore,
          // Why: preserve any explicit opt-in/out; fall back to cohort default only when optedIn is undefined, never when false.
          optedIn:
            existing?.optedIn === true || existing?.optedIn === false || existing?.optedIn === null
              ? existing.optedIn
              : resolvedExistedBefore
                ? null
                : true,
          installId:
            typeof existing?.installId === 'string' && existing.installId.length > 0
              ? existing.installId
              : randomUUID()
        }
      }
    }
  }

  // Why 1s trailing + 5s max-wait (was 300ms unbounded): coalesce mutation bursts; max-wait bounds crash staleness at 5s.
  protected static SAVE_DEBOUNCE_MS = 1_000
  protected static SAVE_MAX_WAIT_MS = 5_000

  protected scheduleSave(): void {
    const now = Date.now()
    this.firstPendingSaveAt ??= now
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
    }
    const untilMaxWait = Math.max(0, this.firstPendingSaveAt + Store.SAVE_MAX_WAIT_MS - now)
    const delay = Math.min(Store.SAVE_DEBOUNCE_MS, untilMaxWait)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.firstPendingSaveAt = null
      // Why (issue #1158): serialize async writes so backup rotation can't race two callers over the same paths.
      const prev = this.pendingWrite ?? Promise.resolve()
      const next = prev
        .then(() => this.writeToDiskAsync())
        .catch((err) => {
          console.error('[persistence] Failed to write state:', err)
          if (!this.writesFrozen) {
            this.scheduleSave()
          }
        })
        .finally(() => {
          if (this.pendingWrite === next) {
            this.pendingWrite = null
          }
        })
      this.pendingWrite = next
    }, delay)
  }

  /** Wait for any in-flight async disk write to complete. Used in tests. */
  async waitForPendingWrite(): Promise<void> {
    await Promise.all([this.pendingWrite, this.activeViewPreference.waitForPendingWrite()])
  }

  getStateRevision(): string {
    return this.buildStateToSave().stateHash
  }

  // Why githubCache is omitted: memory-only this session (see getGithubCacheFile), so refreshes never touch the durable file.
  protected getDurableState(): Omit<PersistedState, 'githubCache'> {
    const { githubCache: _memoryOnly, ...durable } = this.state
    return durable
  }

  // Why: build payload synchronously so hash and serialized bytes reflect the same state tick (no await interleave). One full-state stringify serves both the on-disk payload and the no-op-write guard hash: each secret slot is serialized as a fresh unguessable sentinel, then sentinels are substituted to ciphertext for the payload and to plaintext for the hash. The hash is thus a pure function of plaintext state (skips a byte-identical rewrite) without a second stringify.
  protected buildStateToSave(): { payload: string; stateHash: string } {
    // Why sentinels (not a blob/key string match): the substitution must be
    // position-exact. A plain search for the ciphertext — or even for a
    // `"key":"blob"` token — can be mimicked by user-controlled state (e.g. an
    // agentDefaultEnv var named after a secret field, or a value equal to a
    // ciphertext), which would substitute the wrong site and let two DISTINCT
    // states normalize equal → a silently dropped write (data loss), reachable
    // on deterministic-IV platforms (macOS/legacy-Linux OSCrypt). A per-slot
    // random UUID can't occur anywhere else in the serialized state (the user
    // sets their data before it is minted), so it appears exactly once.
    const secretSubs: { sentinel: string; blob: string; plaintext: string }[] = []
    const encryptToSentinel = (plaintext: string): string => {
      const blob = encrypt(plaintext)
      // Deterministic already (empty secret / safeStorage unavailable / encrypt
      // failure): blob === plaintext, so no normalization — and no sentinel,
      // which also avoids substituting an empty or plaintext-shaped slot.
      if (blob === plaintext) {
        return blob
      }
      const sentinel = `orca-secret-slot-${randomUUID()}`
      secretSubs.push({ sentinel, blob, plaintext })
      return sentinel
    }
    // Why: clone before encrypting secrets so in-memory this.state stays plaintext.
    const stateToSave = {
      ...this.getDurableState(),
      settings: {
        ...this.state.settings,
        opencodeSessionCookie: encryptToSentinel(this.state.settings.opencodeSessionCookie),
        httpProxyUrl: encryptToSentinel(this.state.settings.httpProxyUrl ?? '')
      },
      ui: {
        ...this.state.ui,
        browserKagiSessionLink: this.state.ui.browserKagiSessionLink
          ? encryptToSentinel(this.state.ui.browserKagiSessionLink)
          : null
      }
    }
    // Why compact: ~20% fewer bytes and less serialize time; all readers JSON.parse so formatting is irrelevant.
    // One full-state stringify; secret slots currently hold sentinels.
    const serialized = JSON.stringify(stateToSave)
    // Substitute each unique sentinel exactly once: ciphertext for the on-disk
    // payload, plaintext for the guard hash. Function-form replacement keeps
    // `$` in blob/plaintext inert; both sides read the sentinel as JSON-escaped
    // in `serialized`, so each replace is byte-for-byte position-exact.
    let payload = serialized
    let hashInput = serialized
    for (const { sentinel, blob, plaintext } of secretSubs) {
      const escapedSentinel = JSON.stringify(sentinel).slice(1, -1)
      payload = payload.replace(escapedSentinel, () => blob)
      hashInput = hashInput.replace(escapedSentinel, () => JSON.stringify(plaintext).slice(1, -1))
    }
    const stateHash = createHash('sha1').update(hashInput).digest('hex')
    return { payload, stateHash }
  }

  // Why: async writes avoid blocking the main Electron thread on every debounced save.
  protected async writeToDiskAsync(): Promise<void> {
    if (this.writesFrozen) {
      return
    }
    const gen = this.writeGeneration
    const { payload, stateHash } = this.buildStateToSave()
    // Why: don't rewrite a byte-identical multi-MB file when state nets out to already-persisted.
    if (stateHash === this.lastWrittenStateHash) {
      return
    }
    const dataFile = this.dataFile
    const dir = dirname(dataFile)
    await mkdir(dir, { recursive: true }).catch(() => {})
    const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`

    // Why: on any write/rename failure, remove the tmp file so it doesn't leave a multi-MB orphan.
    let renamed = false
    try {
      // Why: fsync before rename, then fsync the directory; see writeFileDurable.
      const handle = await open(tmpFile, 'w')
      try {
        await handle.writeFile(payload, 'utf-8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      // Why: if flush() bumped writeGeneration mid-write, it already wrote fresher state; don't overwrite it.
      if (this.writeGeneration !== gen) {
        return
      }
      // Why: the commit must not yield after the generation check; flushOrThrow is synchronous and cannot await an in-flight rename.
      renameDurableSync(tmpFile, dataFile)
      renamed = true
      // Why re-check gen: retain the newer hash if a future synchronous caller changes the generation after this commit.
      if (this.writeGeneration === gen) {
        this.lastWrittenStateHash = stateHash
      }
    } finally {
      if (!renamed) {
        await rm(tmpFile).catch(() => {})
      }
    }
    // Why (issue #1158): rotate backups only after rename succeeded, and let a concurrent flush own rotation.
    if (this.writeGeneration !== gen) {
      return
    }
    const now = Date.now()
    if (this.shouldRotateBackups(now, dataFile)) {
      await this.rotateBackupsAsync(dataFile)
    }
  }

  // Why: sync variant only for flush() at shutdown, where the process may exit before an async write completes.
  protected writeToDiskSync(opts: { force?: boolean } = {}): void {
    if (this.writesFrozen) {
      throw new Error('persistence_writes_frozen')
    }
    const { payload, stateHash } = this.buildStateToSave()
    // Why: matching hash means the file already holds this state; force overrides when an async rename may be racing past the gen check.
    if (!opts.force && stateHash === this.lastWrittenStateHash) {
      return
    }
    const dataFile = this.dataFile
    const dir = dirname(dataFile)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const tmpFile = `${dataFile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`

    // Why: on any write/rename failure, remove the tmp file so shutdown crashes don't leak orphans.
    let renamed = false
    try {
      // Why: fsync the temp file and the directory; a bare rename can survive as stale or empty
      // content after power loss, losing projects/tabs back to the newest usable .bak slot.
      writeFileDurableSync(tmpFile, dataFile, payload)
      renamed = true
      this.lastWrittenStateHash = stateHash
    } finally {
      if (!renamed) {
        try {
          unlinkSync(tmpFile)
        } catch {
          // Best-effort cleanup; the write already failed, swallow secondary error.
        }
      }
    }
    const now = Date.now()
    if (this.shouldRotateBackups(now, dataFile)) {
      this.rotateBackupsSync(dataFile)
    }
  }

  flushOrThrow(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.firstPendingSaveAt = null
    const asyncWriteWasInFlight = this.pendingWrite !== null
    // Why: bump writeGeneration so an in-flight async write skips its rename and can't overwrite this sync write.
    this.writeGeneration++
    this.pendingWrite = null
    this.writeToDiskSync({ force: asyncWriteWasInFlight })
  }

  flushActiveViewPreferenceOrThrow(): void {
    this.activeViewPreference.flushOrThrow()
  }

  getCodexResetCreditAttemptLedger(): CodexResetCreditAttemptLedger {
    return parseCodexResetCreditAttemptLedger(this.state.codexResetCreditAttemptLedger)
  }

  replaceCodexResetCreditAttemptLedgerAndFlush(ledger: CodexResetCreditAttemptLedger): void {
    if (this.writesFrozen) {
      throw new Error('Cannot persist Codex reset-credit attempts while writes are frozen')
    }
    const next = parseCodexResetCreditAttemptLedger(ledger)
    const previous = this.state.codexResetCreditAttemptLedger
      ? structuredClone(this.state.codexResetCreditAttemptLedger)
      : undefined
    this.state.codexResetCreditAttemptLedger = next
    try {
      this.flushOrThrow()
    } catch (error) {
      // Why: callers use a successful return as the durability barrier before
      // handing a scarce-credit mutation to the provider.
      this.state.codexResetCreditAttemptLedger = previous
      throw error
    }
  }

  // ── Repos ──────────────────────────────────────────────────────────


}
