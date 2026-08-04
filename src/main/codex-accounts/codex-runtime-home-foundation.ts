import {
  existsSync
} from 'node:fs'
import {
  join
} from 'node:path'
import type { CodexManagedAccount } from '../../shared/types'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { startCodexAccountSessionBridgeInBackground } from '../codex/codex-account-session-bridge'
import {
  prepareSystemConfigForFreshRuntimeMirror,
  syncSystemConfigIntoManagedCodexHome
} from '../codex/codex-config-mirror'
import {
  getCodexSessionBackfillStateDirPath,
  getSystemCodexHomePath,
  resolveOrcaManagedCodexHomePath,
  syncCodexGlobalInstructionsIntoManagedHome,
  syncSystemCodexResourcesIntoManagedHome
} from '../codex/codex-home-paths'
import { isCodexSystemDefaultRealHomeEnabled } from '../codex/codex-real-home-flag'
import { hasCustomCodexHomeOverride } from '../codex/codex-real-home-path'
import { invalidateCodexSessionBackfillMarker } from '../codex/codex-session-backfill-marker'
import { startSystemCodexSessionBridgeInBackground } from '../codex/codex-session-bridge'
import {
  resolveHostCodexSessionSourceHome,
  resolveWslCodexSessionSourceHome
} from '../codex/codex-session-source-home'
import { startWslCodexSessionBridgeInBackground } from '../codex/wsl-codex-session-bridge'
import type { Store } from '../persistence'
import { readShellStartupEnvVar } from '../pty/shell-startup-env'
import { getDefaultWslDistro,getWslHome } from '../wsl'
import { assertOwnedHostCodexManagedHomePath } from './host-codex-managed-home-ownership'
import {
  normalizeCodexRuntimeSelection,
  type CodexAccountSelectionTarget
} from './runtime-selection'

export type CodexSystemDefaultSnapshot = {
  authJson: string | null
}

export type CodexRuntimeLogoutMarker = {
  systemDefaultAuthJson: string | null
  loggedOutAt: number
}

export type CodexRuntimeLogoutMarkerStatus =
  | { kind: 'missing' }
  | { kind: 'applies' }
  | { kind: 'system-default-changed'; systemDefaultAuthJson: string | null }

export type CodexReadBackResult = 'unchanged' | 'persisted' | 'rejected'
export type CodexReadBackMatch =
  | {
      kind: 'matched'
      account: CodexManagedAccount
      managedAuthPath: string
      managedAuthContents: string
    }
  | { kind: 'none' | 'ambiguous' }

export function readLaunchEnvValue(
  launchEnv: NodeJS.ProcessEnv,
  key: 'CODEX_HOME' | 'ORCA_CODEX_HOME' | 'HOME' | 'SHELL'
): string | undefined {
  return Object.prototype.hasOwnProperty.call(launchEnv, key) ? launchEnv[key] : process.env[key]
}

export function getEffectiveCodexHomeEnv(launchEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    CODEX_HOME: readLaunchEnvValue(launchEnv, 'CODEX_HOME'),
    ORCA_CODEX_HOME: readLaunchEnvValue(launchEnv, 'ORCA_CODEX_HOME')
  }
}

export class CodexRuntimeHomeServiceFoundation {

  [key: string]: any

  // Which managed account runtime auth.json mirrors; null means it follows system-default ~/.codex instead of a managed account.
  protected lastSyncedAccountId: string | null = null
  // Last auth.json Orca wrote to the runtime home; a later diff signals an out-of-band change (Codex token refresh, or external login to adopt).
  protected lastWrittenAuthJson: string | null = null
  // Why: WSL terminals have per-distro runtime homes; sharing the host baseline can make stale WSL auth look newer than managed storage.
  protected readonly lastWrittenWslAuthJsonByDistro = new Map<string, string | null>()
  protected readonly lastSyncedWslAccountIdByDistro = new Map<string, string | null>()
  protected readonly wslRuntimeHomePathByDistro = new Map<string, string>()
  protected skipNextReadBackForAccountId: string | null = null
  // Why: a flag-ON host account refreshes auth in its own home. Remember that
  // provenance so a later deselect/rollback never adopts stale shared bytes.
  protected lastHostAccountUsedSelfContainedHome = false

  constructor(protected readonly store: Store) {
    this.safeMigrateLegacySharedAuth()
    this.safeMigrateLegacyManagedState()
    this.safeMigrateLegacyActiveHomePointer()
    this.initializeLastSyncedState()
    this.safeSyncForCurrentSelection()
  }

  protected initializeLastSyncedState(): void {
    const settings = this.store.getSettings()
    const activeAccount = this.getActiveAccount(
      settings.codexManagedAccounts,
      normalizeCodexRuntimeSelection(settings).host
    )
    // Why: WSL-managed homes never touch host ~/.codex; treating one as "last synced" makes cold start mangle host auth Orca never touched.
    this.lastSyncedAccountId = this.getWslManagedHomePath(activeAccount)
      ? null
      : normalizeCodexRuntimeSelection(settings).host
  }

  /**
   * Materializes the runtime home needed before launching the CLI.
   *
   * Historical session bridging is requested in the background so launch setup
   * returns as soon as the active runtime home is ready.
   */
  prepareForCodexLaunch(
    target?: CodexAccountSelectionTarget,
    launchEnv?: NodeJS.ProcessEnv
  ): string | null {
    if (target?.runtime === 'wsl') {
      const wslTarget = this.resolveWslDefaultTarget(target)
      const syncedRuntimeHomePath = this.syncWslRuntimeForCurrentSelection(wslTarget)
      this.syncWslConfigAndGlobalInstructionsForLaunch(wslTarget, syncedRuntimeHomePath)
      const runtimeHomePath = syncedRuntimeHomePath ?? this.getWslSystemCodexHomePath(wslTarget)
      this.startWslSessionBridgeForLaunch(wslTarget, runtimeHomePath)
      return runtimeHomePath
    }
    const selfContainedAccount = this.getSelfContainedManagedHostAccount()
    if (selfContainedAccount) {
      const perAccountHome = this.prepareSelfContainedManagedHomeForLaunch(selfContainedAccount)
      if (perAccountHome) {
        return perAccountHome
      }
      // Why: the account's home lost its auth.json, so the selection was just
      // dropped. Fall through and resolve this launch as the system default.
    }
    if (this.isHostSystemDefaultRealHome(launchEnv)) {
      // Why (flag ON, system default): run Codex on the user's own ~/.codex.
      // Returning null tells the PTY/env layer to inject no managed CODEX_HOME;
      // sessions, auth, and config all live in the native home. No system->
      // managed session bridge runs, so the real home stays the single source.
      return null
    }
    this.invalidateBackfillAfterManagedSystemDefaultLaunch(launchEnv)
    this.syncForCurrentSelection()
    syncSystemCodexResourcesIntoManagedHome()
    syncSystemConfigIntoManagedCodexHome()
    // Why: sessions can be large; bridge them after launch so starting a fresh TUI never waits on a full tree walk.
    void startSystemCodexSessionBridgeInBackground(
      {},
      resolveHostCodexSessionSourceHome(this.store.getSettings())
    )
    return this.getRuntimeHomePath()
  }

  // Why: with the real-home flag ON, a managed HOST account runs against its own
  // self-contained CODEX_HOME (codex-accounts/<id>/home) instead of the shared
  // runtime mirror. Its auth.json lives there and codex refreshes it in place,
  // so two accounts never race one auth.json (GAP-5) and the mirror can be
  // deleted once no lane still injects it (GAP-1). WSL accounts keep their
  // per-distro lane; the flag-OFF opt-out keeps the shared-home hot-swap.
  protected getSelfContainedManagedHostAccount(): CodexManagedAccount | null {
    const settings = this.store.getSettings()
    if (!isCodexSystemDefaultRealHomeEnabled()) {
      return null
    }
    const account = this.getActiveAccount(
      settings.codexManagedAccounts,
      normalizeCodexRuntimeSelection(settings).host
    )
    if (!account || this.getWslManagedHomePath(account)) {
      return null
    }
    return account
  }

  // Why: session discovery must surface a managed account's own rollouts wherever
  // they physically live. Flag ON makes every host managed home a live CODEX_HOME,
  // so scan them all. Flag OFF (opt-out/rollback) hands launches back to the shared
  // mirror, but a home that already accumulated rollouts while the flag was ON must
  // still surface them — otherwise opting out silently hides history that is safe on
  // disk. Gate the flag-OFF case on a sessions/ tree so a never-enabled install stays
  // byte-identical to today (its per-account homes hold only auth, no rollouts).
  protected getManagedHostAccountHomesForSessionDiscovery(): string[] {
    const settings = this.store.getSettings()
    const flagEnabled = isCodexSystemDefaultRealHomeEnabled()
    const homes: string[] = []
    for (const account of settings.codexManagedAccounts) {
      if (this.getWslManagedHomePath(account)) {
        continue
      }
      const trustedHome = this.getTrustedSelfContainedManagedHomePath(account)
      if (trustedHome && (flagEnabled || existsSync(join(trustedHome, 'sessions')))) {
        homes.push(trustedHome)
      }
    }
    return homes
  }

  protected prepareSelfContainedManagedHomeForLaunch(account: CodexManagedAccount): string | null {
    const perAccountHome = this.getTrustedSelfContainedManagedHomePath(account)
    if (!perAccountHome || !existsSync(join(perAccountHome, 'auth.json'))) {
      // Why: drop the selection so this and future launches resolve to the
      // system default rather than a home codex cannot authenticate against.
      this.clearSelfContainedManagedSelection(account)
      return null
    }
    // Why: link the user's real ~/.codex resources and mirror config into THIS
    // home (never symlinking into or mutating ~/.codex), so the per-account home
    // is a complete CODEX_HOME. Hooks/trust are installed by the launch caller.
    this.lastSyncedAccountId = account.id
    this.lastHostAccountUsedSelfContainedHome = true
    syncSystemCodexResourcesIntoManagedHome(perAccountHome)
    syncSystemConfigIntoManagedCodexHome({
      runtimeHomePath: perAccountHome,
      systemHomePath: getSystemCodexHomePath()
    })
    this.startSelfContainedSessionBridgeForLaunch(perAccountHome)
    return perAccountHome
  }

  // Why: Codex's own `/resume` picker only lists rollouts under the launch
  // CODEX_HOME, so a self-contained account home starts out with no history at
  // all. Hardlink every other Orca-visible home's rollouts in — after launch,
  // since history trees can be large — so switching accounts no longer hides
  // the user's conversations.
  protected startSelfContainedSessionBridgeForLaunch(perAccountHome: string): void {
    void startCodexAccountSessionBridgeInBackground({
      targetCodexHomePath: perAccountHome,
      sourceCodexHomePaths: this.getSelfContainedSessionBridgeSourceHomes()
    })
  }

  protected getSelfContainedSessionBridgeSourceHomes(): string[] {
    return [
      // Why: history-only override lets custom-CODEX_HOME users bridge from the
      // home they actually record sessions in; falls back to the real ~/.codex.
      resolveHostCodexSessionSourceHome(this.store.getSettings()) ?? getSystemCodexHomePath(),
      // Why: path only — a per-account install must not materialize the mirror.
      resolveOrcaManagedCodexHomePath(),
      ...this.getManagedHostAccountHomesForSessionDiscovery()
    ]
  }

  // Why: the per-account home is both the launch CODEX_HOME and the credential
  // store, so codex reads/refreshes auth.json in place — there is no shared-home
  // hot-swap or token read-back to reconcile. Only validate the credential
  // survives; a vanished auth.json drops the selection to the system default.
  protected syncSelfContainedManagedSelection(account: CodexManagedAccount): void {
    const perAccountHome = this.getTrustedSelfContainedManagedHomePath(account)
    if (perAccountHome && existsSync(join(perAccountHome, 'auth.json'))) {
      this.lastSyncedAccountId = account.id
      this.lastHostAccountUsedSelfContainedHome = true
      // Why: selection runs well before the user restarts a pane, so history is
      // already linked in by the time the newly launched Codex opens /resume.
      this.startSelfContainedSessionBridgeForLaunch(perAccountHome)
      return
    }
    this.clearSelfContainedManagedSelection(account)
  }

  protected getTrustedSelfContainedManagedHomePath(account: CodexManagedAccount): string | null {
    try {
      assertOwnedHostCodexManagedHomePath({
        candidatePath: account.managedHomePath,
        managedAccountsRoot: this.getManagedAccountsRoot(),
        systemCodexHomePath: getSystemCodexHomePath(),
        expectedAccountId: account.id
      })
      // Preserve the persisted path spelling (notably /var vs /protected/var on
      // macOS) so injected CODEX_HOME stays stable across the rollout.
      return account.managedHomePath
    } catch (error) {
      console.warn('[codex-runtime-home] Refusing untrusted managed account home:', error)
      return null
    }
  }

  protected clearSelfContainedManagedSelection(account: CodexManagedAccount): void {
    console.warn(
      '[codex-runtime-home] Active managed account home is invalid or missing auth.json, clearing selection'
    )
    const settings = this.store.getSettings()
    if (normalizeCodexRuntimeSelection(settings).host !== account.id) {
      return
    }
    this.store.updateSettings({
      activeCodexManagedAccountId: null,
      activeCodexManagedAccountIdsByRuntime: {
        ...normalizeCodexRuntimeSelection(settings),
        host: null
      }
    })
    this.lastSyncedAccountId = null
    this.lastHostAccountUsedSelfContainedHome = false
  }

  protected invalidateBackfillAfterManagedSystemDefaultLaunch(launchEnv?: NodeJS.ProcessEnv): void {
    const settings = this.store.getSettings()
    if (normalizeCodexRuntimeSelection(settings).host !== null) {
      return
    }
    const realHomeSelected = this.isHostSystemDefaultRealHomeSelected(launchEnv)
    if (realHomeSelected || !isCodexSystemDefaultRealHomeEnabled()) {
      invalidateCodexSessionBackfillMarker(
        join(getCodexSessionBackfillStateDirPath(), 'backfill-complete.json')
      )
    }
  }

  protected startWslSessionBridgeForLaunch(
    target: CodexAccountSelectionTarget,
    runtimeHomePath: string | null
  ): void {
    if (process.platform !== 'win32' || !runtimeHomePath) {
      return
    }
    const runtimeHomeWsl = parseWslUncPath(runtimeHomePath)
    const distro = target.wslDistro?.trim() || runtimeHomeWsl?.distro || getDefaultWslDistro()
    if (!distro) {
      return
    }
    // Why: history-only override lets custom-CODEX_HOME users bridge from their real home; falls back to <wslHome>/.codex.
    const systemCodexHomePath =
      resolveWslCodexSessionSourceHome(this.store.getSettings(), distro) ??
      this.getWslSystemCodexHomePath({ runtime: 'wsl', wslDistro: distro })
    if (!systemCodexHomePath || systemCodexHomePath === runtimeHomePath) {
      return
    }
    // Why: WSL history must be hardlinked inside the distro; host-side links can't bridge Windows and WSL filesystems in a resume-visible way.
    void startWslCodexSessionBridgeInBackground({
      distro,
      systemCodexHomePath,
      managedCodexHomePath: runtimeHomePath
    })
  }

  getHostCodexHomePathsForSessionDiscovery(): string[] {
    const homes = [this.getRuntimeHomePath()]
    if (this.isHostSystemDefaultRealHome() || this.getSelfContainedManagedHostAccount()) {
      // Why: nested Orca processes can retain an ambient managed CODEX_HOME.
      // Per-account lanes no longer bridge real-home history into the shared
      // mirror, so include the real root for both directly-routed host lanes.
      homes.push(getSystemCodexHomePath())
    }
    // Why: flag ON routes each managed host account to its own self-contained
    // home, so its rollouts live there rather than in the shared mirror. Scan
    // every such home — plus any that retained rollouts across an opt-out — so
    // account-scoped sessions still surface in the AI Vault.
    for (const perAccountHome of this.getManagedHostAccountHomesForSessionDiscovery()) {
      homes.push(perAccountHome)
    }
    return homes.filter((home, index) => homes.indexOf(home) === index)
  }

  /**
   * The account-owned CODEX_HOME the current HOST selection runs against, or
   * null when the selection is not routed to one (system default, or the
   * flag-OFF shared mirror, which every account hot-swaps and so names no
   * account).
   *
   * Read-only on purpose: session discovery ranks homes with this before any
   * launch prep, so it must create no directories and sync no auth.
   */
  getSelectedHostAccountCodexHomePath(): string | null {
    const selfContainedAccount = this.getSelfContainedManagedHostAccount()
    return selfContainedAccount
      ? this.getTrustedSelfContainedManagedHomePath(selfContainedAccount)
      : null
  }

  // Why: the real-home hook installer flips this gate off when the trust-grant
  // client reports the host incapable, keeping that host byte-identical to the
  // managed lane instead of shipping status-blind panes.
  protected realHomeLaneGate: () => boolean = () => true

  setRealHomeLaneGate(gate: () => boolean): void {
    this.realHomeLaneGate = gate
  }

  // Why: real-home routing applies only to the host system-default selection
  // with the staged flag ON. Managed accounts keep hot-swap isolation; custom
  // CODEX_HOMEs stay managed until phase 1 can track cleanup across old homes.
  isHostSystemDefaultRealHomeSelected(launchEnv?: NodeJS.ProcessEnv): boolean {
    const settings = this.store.getSettings()
    if (
      !isCodexSystemDefaultRealHomeEnabled() ||
      normalizeCodexRuntimeSelection(settings).host !== null
    ) {
      return false
    }
    // Why: PTY callers can overlay environment values that the Electron main
    // process never inherited. Those custom homes must keep the managed lane.
    const effectiveEnv = launchEnv ? getEffectiveCodexHomeEnv(launchEnv) : process.env
    if (hasCustomCodexHomeOverride(effectiveEnv)) {
      return false
    }
    // Why: Finder/Dock launches do not inherit shell exports, but the login
    // shell can re-export a custom home after spawn and bypass the trusted lane.
    const shellCodexHome = readShellStartupEnvVar(
      'CODEX_HOME',
      launchEnv ? readLaunchEnvValue(launchEnv, 'HOME') : process.env.HOME,
      launchEnv ? readLaunchEnvValue(launchEnv, 'SHELL') : process.env.SHELL
    )
    return !hasCustomCodexHomeOverride({ CODEX_HOME: shellCodexHome })
  }

  isHostSystemDefaultRealHome(launchEnv?: NodeJS.ProcessEnv): boolean {
    return this.isHostSystemDefaultRealHomeSelected(launchEnv) && this.realHomeLaneGate()
  }

  syncActiveWslSelectionsBeforeRestart(): void {
    if (process.platform !== 'win32') {
      return
    }

    const settings = this.store.getSettings()
    for (const [selectedDistroKey, accountId] of Object.entries(
      normalizeCodexRuntimeSelection(settings).wsl
    )) {
      if (!accountId) {
        continue
      }
      const account = this.getActiveAccount(settings.codexManagedAccounts, accountId)
      if (!account || account.managedHomeRuntime !== 'wsl') {
        continue
      }
      this.safeReadBackActiveWslAccountBeforeRestart(account, selectedDistroKey)
    }
  }

  protected getWslSystemCodexHomePath(target: CodexAccountSelectionTarget): string | null {
    if (process.platform !== 'win32') {
      return null
    }
    const distro = target.wslDistro?.trim() || getDefaultWslDistro()
    if (!distro) {
      return null
    }
    const home = getWslHome(distro)
    return home ? this.joinWslPath(home, '.codex') : null
  }

  protected syncWslConfigAndGlobalInstructionsForLaunch(
    target: CodexAccountSelectionTarget,
    runtimeHomePath: string | null
  ): void {
    if (!runtimeHomePath) {
      return
    }
    const distro =
      parseWslUncPath(runtimeHomePath)?.distro || target.wslDistro?.trim() || getDefaultWslDistro()
    if (!distro) {
      return
    }
    const systemHomePath = this.getWslSystemCodexHomePath({ runtime: 'wsl', wslDistro: distro })
    if (!systemHomePath || systemHomePath === runtimeHomePath) {
      return
    }
    // Why: WSL uses a distro-local CODEX_HOME, so host resource mirroring can't provide the distro user's global instructions.
    syncCodexGlobalInstructionsIntoManagedHome({
      systemHomePath,
      managedHomePath: runtimeHomePath
    })
    syncSystemConfigIntoManagedCodexHome({ runtimeHomePath, systemHomePath })
  }


}

// Why: Codex reads this config inside WSL, so relative path settings must anchor to the Linux-side home (verbatim copy breaks load, os error 2).
export function prepareWslRuntimeSeedConfig(
  configContents: string,
  sourceHomePath: string
): string {
  return prepareSystemConfigForFreshRuntimeMirror(
    configContents,
    parseWslUncPath(sourceHomePath)?.linuxPath ?? sourceHomePath
  )
}
