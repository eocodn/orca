import {
  existsSync,
  readFileSync
} from 'node:fs'
import {
  join
} from 'node:path'
import type { CodexManagedAccount } from '../../shared/types'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  syncSystemConfigIntoManagedCodexHome
} from '../codex/codex-config-mirror'
import {
  getSystemCodexHomePath,
  syncSystemCodexResourcesIntoManagedHome
} from '../codex/codex-home-paths'
import {
  codexAuthMatchesManagedAccount
} from './codex-auth-identity'
import { writeFileAtomically } from '../cross-platform-file-operations'
import {
  getSelectedCodexAccountIdForTarget,
  normalizeCodexRuntimeSelection,
  type CodexAccountSelectionTarget
} from './runtime-selection'

import {
  CodexRuntimeHomeServiceFoundation,
  type CodexReadBackResult
} from './codex-runtime-home-foundation'

export class CodexRuntimeHomeServicePhase1 extends CodexRuntimeHomeServiceFoundation {
  prepareForRateLimitFetch(target?: CodexAccountSelectionTarget): string | null {
    if (target?.runtime === 'wsl') {
      const wslTarget = this.resolveWslDefaultTarget(target)
      const syncedRuntimeHomePath = this.getPreparedWslRateLimitHomePath(wslTarget)
      return syncedRuntimeHomePath ?? this.getWslSystemCodexHomePath(wslTarget)
    }
    const selfContainedAccount = this.getSelfContainedManagedHostAccount()
    const selfContainedHome = selfContainedAccount
      ? this.getTrustedSelfContainedManagedHomePath(selfContainedAccount)
      : null
    if (
      selfContainedAccount &&
      selfContainedHome &&
      existsSync(join(selfContainedHome, 'auth.json'))
    ) {
      // Why: the quota fetch reads the account's own auth.json in place; no
      // shared-home hot-swap, and no per-poll resource relink (that is launch
      // prep). Config was mirrored on add/select and refreshed at launch.
      return selfContainedHome
    }
    if (selfContainedAccount) {
      this.clearSelfContainedManagedSelection(selfContainedAccount)
    }
    if (this.isHostSystemDefaultRealHome()) {
      // Why: null lets the fetcher fall back to the main process's inherited
      // CODEX_HOME before ~/.codex. Nested Orca launches can inherit the
      // managed home, restarting the background OAuth conflict (#5370), so
      // pin this non-interactive lane to the native home explicitly.
      return getSystemCodexHomePath()
    }
    this.syncForCurrentSelection()
    syncSystemCodexResourcesIntoManagedHome()
    syncSystemConfigIntoManagedCodexHome()
    return this.getRuntimeHomePath()
  }

  syncForCurrentSelection(target?: CodexAccountSelectionTarget): void {
    if (target?.runtime === 'wsl') {
      this.syncWslRuntimeForCurrentSelection(target)
      return
    }

    const selfContainedAccount = this.getSelfContainedManagedHostAccount()
    if (selfContainedAccount) {
      // Why: self-contained managed homes hold their own auth, so the shared
      // runtime home's snapshot/hot-swap/read-back machinery below must not run.
      this.syncSelfContainedManagedSelection(selfContainedAccount)
      return
    }

    const settings = this.store.getSettings()
    if (this.lastHostAccountUsedSelfContainedHome) {
      // Why: E auth is already canonical in the per-account home. Reset the
      // legacy mirror baseline without reading it; flag-OFF can then seed the
      // mirror from canonical storage, while real-home deselect needs no sync.
      this.lastHostAccountUsedSelfContainedHome = false
      this.lastSyncedAccountId = null
      this.lastWrittenAuthJson = null
      if (this.isHostSystemDefaultRealHome()) {
        return
      }
    }
    const runtimeAuthExistedBeforeSync = existsSync(this.getRuntimeAuthPath())
    if (this.lastSyncedAccountId === null) {
      this.captureSystemDefaultSnapshot({ force: false })
    }
    const activeAccount = this.getActiveAccount(
      settings.codexManagedAccounts,
      normalizeCodexRuntimeSelection(settings).host
    )
    const previousAccount = this.getActiveAccount(
      settings.codexManagedAccounts,
      this.lastSyncedAccountId
    )
    if (this.getWslManagedHomePath(activeAccount)) {
      const previousWasHostManaged = previousAccount && !this.getWslManagedHomePath(previousAccount)
      const outgoingReadBackResult = previousWasHostManaged
        ? this.readBackRefreshedTokensForAccount(previousAccount, {
            updateLastWrittenAuthJson: false
          })
        : 'unchanged'
      if (previousWasHostManaged) {
        this.restoreSystemDefaultSnapshot({
          detectExternalLogin: outgoingReadBackResult !== 'rejected'
        })
      }
      this.lastSyncedAccountId = null
      this.lastWrittenAuthJson = null
      this.skipNextReadBackForAccountId = null
      return
    }
    let outgoingReadBackResult: CodexReadBackResult = 'unchanged'
    if (previousAccount && previousAccount.id !== activeAccount?.id) {
      outgoingReadBackResult = this.readBackRefreshedTokensForAccount(previousAccount, {
        updateLastWrittenAuthJson: true
      })
    }
    if (!activeAccount) {
      if (normalizeCodexRuntimeSelection(settings).host) {
        this.store.updateSettings({
          activeCodexManagedAccountId: null,
          activeCodexManagedAccountIdsByRuntime: {
            ...normalizeCodexRuntimeSelection(settings),
            host: null
          }
        })
      }
      // Why: only restore the system-default mirror when leaving a managed account; otherwise later syncs mirror current ~/.codex instead of replaying an old snapshot.
      if (this.lastSyncedAccountId !== null) {
        this.restoreSystemDefaultSnapshot({
          detectExternalLogin: outgoingReadBackResult !== 'rejected'
        })
        this.lastSyncedAccountId = null
      } else if (!runtimeAuthExistedBeforeSync) {
        const logoutMarkerStatus = this.getRuntimeLogoutMarkerStatus()
        if (logoutMarkerStatus.kind === 'applies') {
          this.lastWrittenAuthJson = null
        } else if (
          logoutMarkerStatus.kind === 'system-default-changed' &&
          logoutMarkerStatus.systemDefaultAuthJson !== null
        ) {
          this.restoreSystemDefaultSnapshot({ detectExternalLogin: false })
        } else if (logoutMarkerStatus.kind === 'system-default-changed') {
          // Why: a real ~/.codex logout after a local runtime logout should keep runtime auth absent, not restore the stale snapshot.
          this.captureSystemDefaultSnapshot({ force: true })
          this.persistRuntimeLogoutMarker(null)
          this.lastWrittenAuthJson = null
        } else if (this.lastWrittenAuthJson === null) {
          // Why: unmanaged sessions use an Orca-owned CODEX_HOME; seed it once from system-default auth so terminals stay logged in without mutating ~/.codex.
          this.restoreSystemDefaultSnapshot({ detectExternalLogin: false })
        } else {
          this.persistRuntimeLogoutMarker()
        }
      } else {
        this.clearRuntimeLogoutMarker()
        this.syncRuntimeAuthWithSystemDefault()
      }
      return
    }

    const activeAuthPath = join(activeAccount.managedHomePath, 'auth.json')
    if (!existsSync(activeAuthPath)) {
      console.warn(
        '[codex-runtime-home] Active managed account is missing auth.json, restoring system default'
      )
      if (this.lastSyncedAccountId === activeAccount.id) {
        outgoingReadBackResult = this.recoverRefreshForMissingActiveAccount(activeAccount)
      }
      this.store.updateSettings({
        activeCodexManagedAccountId: null,
        activeCodexManagedAccountIdsByRuntime: {
          ...normalizeCodexRuntimeSelection(settings),
          host: null
        }
      })
      if (this.lastSyncedAccountId !== null) {
        this.restoreSystemDefaultSnapshot({
          detectExternalLogin: outgoingReadBackResult !== 'rejected'
        })
        this.lastSyncedAccountId = null
      }
      return
    }

    if (this.lastSyncedAccountId === null) {
      this.captureSystemDefaultSnapshot({ force: true })
    }

    // Why: Codex refreshes OAuth tokens in the runtime auth.json; if it differs from Orca's last write, read those back to managed storage before overwriting.
    if (this.lastSyncedAccountId === activeAccount.id) {
      if (this.skipNextReadBackForAccountId === activeAccount.id) {
        this.skipNextReadBackForAccountId = null
      } else {
        this.readBackRefreshedTokens({
          updateLastWrittenAuthJson: true
        })
      }
    }

    if (this.lastSyncedAccountId !== activeAccount.id) {
      this.skipNextReadBackForAccountId = null
    }
    this.lastSyncedAccountId = activeAccount.id
    this.writeRuntimeAuth(readFileSync(activeAuthPath, 'utf-8'))
  }

  // Why: re-auth/add-account write fresh managed tokens, so skip the next read-back to avoid clobbering them with stale runtime tokens.
  clearLastWrittenAuthJson(
    accountId = normalizeCodexRuntimeSelection(this.store.getSettings()).host
  ): void {
    if (accountId === normalizeCodexRuntimeSelection(this.store.getSettings()).host) {
      this.lastWrittenAuthJson = null
    }
    this.skipNextReadBackForAccountId = accountId
  }

  protected readBackRefreshedTokens(options: {
    updateLastWrittenAuthJson: boolean
  }): CodexReadBackResult {
    const selectedAccountId = normalizeCodexRuntimeSelection(this.store.getSettings()).host
    if (selectedAccountId) {
      const selectedAccountResult = this.readBackRefreshedTokensFromPath(
        this.getRuntimeAuthPath(),
        {
          ...options,
          expectedAccountId: selectedAccountId
        }
      )
      if (selectedAccountResult !== 'rejected') {
        return selectedAccountResult
      }
    }

    return this.readBackRefreshedTokensFromPath(this.getRuntimeAuthPath(), options)
  }

  protected readBackRefreshedTokensFromPath(
    runtimeAuthPath: string,
    options: {
      updateLastWrittenAuthJson: boolean
      lastWrittenAuthJson?: string | null
      setLastWrittenAuthJson?: (contents: string) => void
      expectedAccountId?: string
    }
  ): CodexReadBackResult {
    try {
      if (!existsSync(runtimeAuthPath)) {
        return 'unchanged'
      }

      const lastWrittenAuthJson =
        options.lastWrittenAuthJson === undefined
          ? this.lastWrittenAuthJson
          : options.lastWrittenAuthJson
      const runtimeContents = readFileSync(runtimeAuthPath, 'utf-8')
      if (lastWrittenAuthJson !== null && runtimeContents === lastWrittenAuthJson) {
        return 'unchanged'
      }

      const match = this.findManagedAccountForRuntimeAuth(
        runtimeContents,
        options.expectedAccountId
      )
      if (match.kind !== 'matched') {
        if (match.kind === 'ambiguous') {
          console.warn('[codex-runtime-home] Refusing ambiguous Codex auth read-back')
        }
        return 'rejected'
      }
      // Why: after restart there's no last-written baseline, so identity alone can't prove runtime auth is newer than managed storage.
      if (
        lastWrittenAuthJson === null &&
        !this.runtimeAuthIsFresher(runtimeContents, match.managedAuthContents)
      ) {
        return 'rejected'
      }

      writeFileAtomically(match.managedAuthPath, runtimeContents, { mode: 0o600 })
      if (options.updateLastWrittenAuthJson) {
        if (options.setLastWrittenAuthJson) {
          options.setLastWrittenAuthJson(runtimeContents)
        } else {
          this.lastWrittenAuthJson = runtimeContents
        }
      }
      return 'persisted'
    } catch (error) {
      // Why: read-back is best-effort; a transient fs error must not block the forward sync — worst case is one more stale-token cycle.
      console.warn('[codex-runtime-home] Failed to read back refreshed tokens:', error)
      return 'rejected'
    }
  }

  protected readBackRefreshedTokensForAccount(
    account: CodexManagedAccount,
    options: { updateLastWrittenAuthJson: boolean }
  ): CodexReadBackResult {
    return this.readBackRefreshedTokensFromPath(this.getRuntimeAuthPath(), {
      ...options,
      expectedAccountId: account.id
    })
  }

  protected recoverRefreshForMissingActiveAccount(account: CodexManagedAccount): CodexReadBackResult {
    try {
      const runtimeAuthPath = this.getRuntimeAuthPath()
      if (!existsSync(runtimeAuthPath) || this.lastWrittenAuthJson === null) {
        return 'rejected'
      }
      const runtimeContents = readFileSync(runtimeAuthPath, 'utf-8')
      if (runtimeContents === this.lastWrittenAuthJson) {
        return 'unchanged'
      }
      // Why: the canonical file is gone, so the exact in-memory bytes Orca
      // previously mirrored are the only safe identity baseline for recovery.
      if (!codexAuthMatchesManagedAccount(runtimeContents, account, this.lastWrittenAuthJson)) {
        return 'rejected'
      }
      writeFileAtomically(join(account.managedHomePath, 'auth.json'), runtimeContents, {
        mode: 0o600
      })
      this.lastWrittenAuthJson = runtimeContents
      return 'persisted'
    } catch (error) {
      console.warn('[codex-runtime-home] Failed to recover missing managed auth:', error)
      return 'rejected'
    }
  }

  protected safeSyncForCurrentSelection(): void {
    try {
      this.syncForCurrentSelection()
    } catch (error) {
      console.warn('[codex-runtime-home] Failed to sync runtime auth state:', error)
    }
  }

  protected getActiveAccount(
    accounts: CodexManagedAccount[],
    activeAccountId: string | null
  ): CodexManagedAccount | null {
    if (!activeAccountId) {
      return null
    }
    return accounts.find((account) => account.id === activeAccountId) ?? null
  }

  protected getWslManagedHomePath(account: CodexManagedAccount | null): string | null {
    if (!account) {
      return null
    }
    if (account.managedHomeRuntime === 'wsl' && parseWslUncPath(account.managedHomePath)) {
      return account.managedHomePath
    }
    return parseWslUncPath(account.managedHomePath) ? account.managedHomePath : null
  }

  protected getPreparedWslRateLimitHomePath(target: CodexAccountSelectionTarget): string | null {
    const distro = target.wslDistro?.trim()
    if (distro) {
      const settings = this.store.getSettings()
      const selectedAccountId = getSelectedCodexAccountIdForTarget(settings, target)
      if (selectedAccountId === null) {
        // Why: the system-default account changes outside Orca, so read its real home directly to avoid a stale cached runtime copy.
        return this.getWslSystemCodexHomePath(target)
      }
      const cachedRuntimeHomePath = this.wslRuntimeHomePathByDistro.get(distro)
      if (
        cachedRuntimeHomePath &&
        this.lastSyncedWslAccountIdByDistro.has(distro) &&
        this.lastSyncedWslAccountIdByDistro.get(distro) === selectedAccountId
      ) {
        // Why: RateLimitService resolves provenance twice per poll; stay path-only so it doesn't block main on UNC reads and a wsl.exe probe.
        return cachedRuntimeHomePath
      }
    }
    return this.syncWslRuntimeForCurrentSelection(target)
  }
}
