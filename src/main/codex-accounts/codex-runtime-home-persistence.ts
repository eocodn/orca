import { 
  appendFileSync,
  copyFileSync,
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  win32 as pathWin32
} from 'node:path'
import { app } from 'electron'
import type { CodexManagedAccount } from '../../shared/types'
import type { Store } from '../persistence'
import { WSL_CODEX_RUNTIME_HOME_SEGMENTS } from '../pty/codex-home-wsl-env'
import { writeFileAtomically } from './fs-utils'
import {
  getOrcaManagedCodexHomePath,
  getOrcaUserDataPath,
  getCodexSessionBackfillStateDirPath,
  getSystemCodexHomePath,
  resolveOrcaManagedCodexHomePath,
  syncCodexGlobalInstructionsIntoManagedHome,
  syncSystemCodexResourcesIntoManagedHome
} from '../codex/codex-home-paths'
import { startCodexAccountSessionBridgeInBackground } from '../codex/codex-account-session-bridge'
import { startSystemCodexSessionBridgeInBackground } from '../codex/codex-session-bridge'
import {
  resolveHostCodexSessionSourceHome,
  resolveWslCodexSessionSourceHome
} from '../codex/codex-session-source-home'
import { startWslCodexSessionBridgeInBackground } from '../codex/wsl-codex-session-bridge'
import {
  prepareSystemConfigForFreshRuntimeMirror,
  syncSystemConfigIntoManagedCodexHome
} from '../codex/codex-config-mirror'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  getWslSelectionKey,
  getSelectedCodexAccountIdForTarget,
  normalizeCodexRuntimeSelection,
  setSelectedCodexAccountIdForTarget,
  type CodexAccountSelectionTarget
} from './runtime-selection'
import { getDefaultWslDistro, getWslHome } from '../wsl'
import { isCodexSystemDefaultRealHomeEnabled } from '../codex/codex-real-home-flag'
import { hasCustomCodexHomeOverride } from '../codex/codex-real-home-path'
import { invalidateCodexSessionBackfillMarker } from '../codex/codex-session-backfill-marker'
import { readShellStartupEnvVar } from '../pty/shell-startup-env'
import { assertOwnedHostCodexManagedHomePath } from './host-codex-managed-home-ownership'
import {
  codexAuthIsFresher,
  codexAuthMatchesManagedAccount,
  codexAuthMatchesSystemDefaultIdentity
} from './codex-auth-identity'
import { migrateLegacySharedAuthToPerAccountHome } from './legacy-shared-auth-migration'


import { type CodexSystemDefaultSnapshot,
  type CodexRuntimeLogoutMarker,
  type CodexRuntimeLogoutMarkerStatus,
  type CodexReadBackResult,
  type CodexReadBackMatch,
  readLaunchEnvValue,
  getEffectiveCodexHomeEnv  } from './codex-runtime-home-foundation'
import { CodexRuntimeHomeServicePhase2 } from './codex-runtime-home-migration'

export class CodexRuntimeHomeServicePhase3 extends CodexRuntimeHomeServicePhase2 {
  protected repointLegacyActiveHomePointer(activeHomePath: string, runtimeHomePath: string): void {
    if (this.activeHomeAlreadyPointsToRuntimeHome(activeHomePath, runtimeHomePath)) {
      return
    }
    if (!this.legacyActiveHomeLinkIsReplaceable(activeHomePath)) {
      return
    }

    mkdirSync(runtimeHomePath, { recursive: true })
    mkdirSync(dirname(activeHomePath), { recursive: true })
    const nextLinkPath = `${activeHomePath}.next-${process.pid}-${Date.now()}`
    this.removeLegacyActiveHomeLinkIfOwned(nextLinkPath)
    try {
      symlinkSync(
        runtimeHomePath,
        nextLinkPath,
        process.platform === 'win32' && lstatSync(runtimeHomePath).isDirectory()
          ? 'junction'
          : undefined
      )
      try {
        renameSync(nextLinkPath, activeHomePath)
      } catch (error) {
        if (!this.legacyActiveHomeLinkIsReplaceable(activeHomePath)) {
          throw error
        }
        this.removeLegacyActiveHomeLinkIfOwned(activeHomePath)
        renameSync(nextLinkPath, activeHomePath)
      }
    } finally {
      this.removeLegacyActiveHomeLinkIfOwned(nextLinkPath)
    }
  }

  protected activeHomeAlreadyPointsToRuntimeHome(
    activeHomePath: string,
    runtimeHomePath: string
  ): boolean {
    try {
      return this.linkTargetsMatch(readlinkSync(activeHomePath), activeHomePath, runtimeHomePath)
    } catch {
      return false
    }
  }

  protected linkTargetsMatch(
    linkTarget: string,
    linkPath: string,
    expectedTargetPath: string
  ): boolean {
    const resolvedLinkTarget = isAbsolute(linkTarget)
      ? resolve(linkTarget)
      : resolve(dirname(linkPath), linkTarget)
    return resolvedLinkTarget === resolve(expectedTargetPath)
  }

  protected legacyActiveHomeLinkIsReplaceable(activeHomePath: string): boolean {
    try {
      const stat = lstatSync(activeHomePath)
      return stat.isSymbolicLink() || this.isWindowsReadableLink(activeHomePath)
    } catch {
      return true
    }
  }

  protected legacyActiveHomePathExists(activeHomePath: string): boolean {
    try {
      lstatSync(activeHomePath)
      return true
    } catch {
      return false
    }
  }

  protected removeLegacyActiveHomeLinkIfOwned(activeHomePath: string): void {
    try {
      const stat = lstatSync(activeHomePath)
      if (stat.isSymbolicLink()) {
        unlinkSync(activeHomePath)
      } else if (this.isWindowsReadableLink(activeHomePath)) {
        rmdirSync(activeHomePath)
      }
    } catch {
      // Missing or inaccessible temporary links are handled by the caller.
    }
  }

  protected isWindowsReadableLink(targetPath: string): boolean {
    if (process.platform !== 'win32') {
      return false
    }
    try {
      readlinkSync(targetPath)
      return true
    } catch {
      return false
    }
  }

  protected migrateLegacyManagedStateIfNeeded(): void {
    if (existsSync(this.getMigrationMarkerPath())) {
      return
    }

    const managedHomes = this.getLegacyManagedHomes()
    for (const managedHomePath of managedHomes) {
      const accountId = parse(relative(this.getManagedAccountsRoot(), managedHomePath)).dir.split(
        /[\\/]/
      )[0]
      if (!accountId) {
        continue
      }
      this.migrateLegacyHistory(managedHomePath)
      this.migrateLegacySessions(managedHomePath, accountId)
    }

    // Why: migration is one-shot; re-importing every startup would replay stale managed-home state into the shared runtime.
    writeFileAtomically(
      this.getMigrationMarkerPath(),
      `${JSON.stringify({ completedAt: Date.now(), migratedHomeCount: managedHomes.length })}\n`
    )
  }

  protected getLegacyManagedHomes(): string[] {
    const managedAccountsRoot = this.getManagedAccountsRoot()
    if (!existsSync(managedAccountsRoot)) {
      return []
    }

    const accountEntries = readdirSync(managedAccountsRoot, { withFileTypes: true })
    const managedHomes: string[] = []
    for (const entry of accountEntries) {
      if (!entry.isDirectory()) {
        continue
      }
      const managedHomePath = join(managedAccountsRoot, entry.name, 'home')
      if (existsSync(join(managedHomePath, '.orca-managed-home'))) {
        managedHomes.push(managedHomePath)
      }
    }
    return managedHomes.sort()
  }

  protected migrateLegacyHistory(managedHomePath: string): void {
    const legacyHistoryPath = join(managedHomePath, 'history.jsonl')
    if (!existsSync(legacyHistoryPath)) {
      return
    }

    const runtimeHistoryPath = join(this.getRuntimeHomePath(), 'history.jsonl')
    const existingLines = existsSync(runtimeHistoryPath)
      ? readFileSync(runtimeHistoryPath, 'utf-8').split('\n').filter(Boolean)
      : []
    const mergedLines = [...existingLines]
    const seenLines = new Set(existingLines)
    for (const line of readFileSync(legacyHistoryPath, 'utf-8').split('\n')) {
      if (!line || seenLines.has(line)) {
        continue
      }
      seenLines.add(line)
      mergedLines.push(line)
    }

    if (mergedLines.length === 0) {
      return
    }
    writeFileAtomically(runtimeHistoryPath, `${mergedLines.join('\n')}\n`)
  }

  protected migrateLegacySessions(managedHomePath: string, accountId: string): void {
    const legacySessionsRoot = join(managedHomePath, 'sessions')
    if (!existsSync(legacySessionsRoot)) {
      return
    }

    const runtimeSessionsRoot = join(this.getRuntimeHomePath(), 'sessions')
    mkdirSync(runtimeSessionsRoot, { recursive: true })
    for (const legacyFilePath of this.listFilesRecursively(legacySessionsRoot)) {
      const relativePath = relative(legacySessionsRoot, legacyFilePath)
      const runtimeFilePath = join(runtimeSessionsRoot, relativePath)
      mkdirSync(dirname(runtimeFilePath), { recursive: true })
      if (!existsSync(runtimeFilePath)) {
        copyFileSync(legacyFilePath, runtimeFilePath)
        continue
      }

      const legacyContents = readFileSync(legacyFilePath)
      const runtimeContents = readFileSync(runtimeFilePath)
      if (runtimeContents.equals(legacyContents)) {
        continue
      }

      const preservedPath = this.getPreservedLegacySessionPath(runtimeFilePath, accountId)
      copyFileSync(legacyFilePath, preservedPath)
      this.appendMigrationDiagnostic({
        type: 'session-conflict',
        accountId,
        runtimeFilePath,
        preservedPath
      })
    }
  }

  protected listFilesRecursively(rootPath: string): string[] {
    const stat = statSync(rootPath)
    if (!stat.isDirectory()) {
      return [rootPath]
    }

    const files: string[] = []
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      const childPath = join(rootPath, entry.name)
      if (entry.isDirectory()) {
        this.appendListedFiles(files, this.listFilesRecursively(childPath))
        continue
      }
      if (entry.isFile()) {
        files.push(childPath)
      }
    }
    return files.sort()
  }

  protected appendListedFiles(target: string[], source: readonly string[]): void {
    // Why: tolerate directories larger than V8's argument limit for spread calls.
    for (const filePath of source) {
      target.push(filePath)
    }
  }

  protected getPreservedLegacySessionPath(runtimeFilePath: string, accountId: string): string {
    const extension = extname(runtimeFilePath)
    const basename = runtimeFilePath.slice(0, runtimeFilePath.length - extension.length)
    return `${basename}.orca-legacy-${accountId}${extension}`
  }

  protected appendMigrationDiagnostic(record: Record<string, string>): void {
    const diagnosticsPath = this.getMigrationDiagnosticsPath()
    try {
      appendFileSync(diagnosticsPath, `${JSON.stringify(record)}\n`, { encoding: 'utf-8' })
    } catch (error) {
      // Why: diagnostics must not fail the one-shot migration after the session file is already preserved.
      console.warn('[codex-runtime-home] Failed to append migration diagnostic:', error)
    }
  }

  protected captureSystemDefaultSnapshot(options: { force: boolean }): void {
    const snapshotPath = this.getSystemDefaultSnapshotPath()
    if (!options.force && existsSync(snapshotPath)) {
      return
    }

    const runtimeAuthPath = join(getSystemCodexHomePath(), 'auth.json')
    const snapshot: CodexSystemDefaultSnapshot = {
      authJson: existsSync(runtimeAuthPath) ? readFileSync(runtimeAuthPath, 'utf-8') : null
    }
    writeFileAtomically(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
  }

  protected syncRuntimeAuthWithSystemDefault(): void {
    const runtimeAuthPath = this.getRuntimeAuthPath()
    const systemDefaultAuthPath = join(getSystemCodexHomePath(), 'auth.json')
    if (!existsSync(runtimeAuthPath)) {
      return
    }

    try {
      const runtimeAuth = readFileSync(runtimeAuthPath, 'utf-8')
      if (!existsSync(systemDefaultAuthPath)) {
        const snapshot = this.readSystemDefaultSnapshot(this.getSystemDefaultSnapshotPath())
        const mirroredSystemDefaultAuth = this.lastWrittenAuthJson ?? snapshot?.authJson ?? null
        if (mirroredSystemDefaultAuth !== null && runtimeAuth === mirroredSystemDefaultAuth) {
          this.clearRuntimeAuthAfterSystemDefaultLogout(runtimeAuthPath)
          return
        }
        if (
          mirroredSystemDefaultAuth !== null &&
          this.runtimeAuthMatchesSystemDefaultIdentity(runtimeAuth, mirroredSystemDefaultAuth)
        ) {
          this.clearRuntimeAuthAfterSystemDefaultLogout(runtimeAuthPath)
        }
        return
      }
      const systemDefaultAuth = readFileSync(systemDefaultAuthPath, 'utf-8')
      if (runtimeAuth !== systemDefaultAuth) {
        const snapshot = this.readSystemDefaultSnapshot(this.getSystemDefaultSnapshotPath())
        const mirroredSystemDefaultAuth = this.lastWrittenAuthJson ?? snapshot?.authJson ?? null
        if (
          mirroredSystemDefaultAuth !== null &&
          systemDefaultAuth === mirroredSystemDefaultAuth &&
          this.runtimeAuthMatchesSystemDefaultIdentity(runtimeAuth, mirroredSystemDefaultAuth)
        ) {
          // Why: Codex refreshes tokens in the runtime CODEX_HOME; read that back to ~/.codex so the next sync won't clobber fresh creds with stale ones.
          this.writeSystemDefaultAuth(runtimeAuth)
          this.captureSystemDefaultSnapshot({ force: true })
          this.lastWrittenAuthJson = runtimeAuth
          return
        }
        // Why: mirror external logins/logouts into Orca's runtime home so unmanaged Codex sessions keep matching the current system-default state.
        this.captureSystemDefaultSnapshot({ force: true })
        this.writeRuntimeAuth(systemDefaultAuth)
      }
    } catch (error) {
      console.warn('[codex-runtime-home] Failed to sync system-default auth:', error)
    }
  }

  protected restoreSystemDefaultSnapshot(options: { detectExternalLogin: boolean }): void {
    const snapshotPath = this.getSystemDefaultSnapshotPath()
    const runtimeAuthPath = this.getRuntimeAuthPath()
    const systemDefaultAuthPath = join(getSystemCodexHomePath(), 'auth.json')
    if (existsSync(systemDefaultAuthPath)) {
      const systemDefaultAuth = readFileSync(systemDefaultAuthPath, 'utf-8')
      this.captureSystemDefaultSnapshot({ force: true })
      this.writeRuntimeAuth(systemDefaultAuth)
      return
    }

    if (options.detectExternalLogin && !existsSync(runtimeAuthPath)) {
      // Why: with Orca owning CODEX_HOME, a deleted runtime auth.json is a local logout, not a cue to restore the user's real ~/.codex snapshot.
      this.persistRuntimeLogoutMarker()
      this.lastWrittenAuthJson = null
      return
    }

    if (options.detectExternalLogin) {
      // Why: if ~/.codex/auth.json vanished while a managed account was selected, switching back must preserve that external system-default logout.
      rmSync(runtimeAuthPath, { force: true })
      this.captureSystemDefaultSnapshot({ force: true })
      this.persistRuntimeLogoutMarker()
      this.lastWrittenAuthJson = null
      return
    }

    if (!existsSync(snapshotPath)) {
      this.captureSystemDefaultSnapshot({ force: true })
    }

    const snapshot = this.readSystemDefaultSnapshot(snapshotPath)
    if (!snapshot) {
      console.warn('[codex-runtime-home] Ignoring invalid system-default auth snapshot')
      rmSync(snapshotPath, { force: true })
      this.captureSystemDefaultSnapshot({ force: true })
      const refreshedSnapshot = this.readSystemDefaultSnapshot(snapshotPath)
      if (!refreshedSnapshot) {
        rmSync(runtimeAuthPath, { force: true })
        this.lastWrittenAuthJson = null
        return
      }
      if (refreshedSnapshot.authJson === null) {
        rmSync(runtimeAuthPath, { force: true })
        this.lastWrittenAuthJson = null
        return
      }
      this.writeRuntimeAuth(refreshedSnapshot.authJson)
      return
    }
    if (snapshot.authJson === null) {
      rmSync(runtimeAuthPath, { force: true })
      this.lastWrittenAuthJson = null
      return
    }
    this.writeRuntimeAuth(snapshot.authJson)
  }

  protected writeSystemDefaultAuth(contents: string): void {
    const systemDefaultAuthPath = join(getSystemCodexHomePath(), 'auth.json')
    mkdirSync(dirname(systemDefaultAuthPath), { recursive: true })
    writeFileAtomically(systemDefaultAuthPath, contents, { mode: 0o600 })
    this.ensureOwnerOnlyMode(systemDefaultAuthPath)
  }

  protected clearRuntimeAuthAfterSystemDefaultLogout(runtimeAuthPath: string): void {
    // Why: a vanished ~/.codex auth means external logout for unmanaged sessions, even if runtime auth already refreshed in Orca's CODEX_HOME.
    rmSync(runtimeAuthPath, { force: true })
    this.captureSystemDefaultSnapshot({ force: true })
    this.persistRuntimeLogoutMarker()
    this.lastWrittenAuthJson = null
  }

  protected readSystemDefaultAuth(): string | null {
    const systemDefaultAuthPath = join(getSystemCodexHomePath(), 'auth.json')
    return existsSync(systemDefaultAuthPath) ? readFileSync(systemDefaultAuthPath, 'utf-8') : null
  }

  protected writeRuntimeAuth(contents: string): void {
    // Why: auth.json holds credentials; restrict to owner-only so other users on a shared machine cannot read it.
    this.clearRuntimeLogoutMarker()
    if (this.fileContentsEqual(this.getRuntimeAuthPath(), contents)) {
      this.ensureOwnerOnlyMode(this.getRuntimeAuthPath())
      this.lastWrittenAuthJson = contents
      return
    }
    writeFileAtomically(this.getRuntimeAuthPath(), contents, { mode: 0o600 })
    this.lastWrittenAuthJson = contents
  }

  protected writeRuntimeAuthAtPath(authPath: string, contents: string): void {
    if (this.fileContentsEqual(authPath, contents)) {
      this.ensureOwnerOnlyMode(authPath)
      return
    }
    mkdirSync(dirname(authPath), { recursive: true })
    writeFileAtomically(authPath, contents, { mode: 0o600 })
  }

  protected fileContentsEqual(targetPath: string, contents: string): boolean {
    try {
      return existsSync(targetPath) && readFileSync(targetPath, 'utf-8') === contents
    } catch {
      return false
    }
  }


}
