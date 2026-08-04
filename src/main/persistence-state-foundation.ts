import { app,safeStorage } from 'electron'
import { copyFileSync,existsSync,mkdirSync,readFileSync } from 'node:fs'
import { dirname,isAbsolute,join,resolve } from 'node:path'
import { isWindowsAbsolutePathLike } from '../shared/cross-platform-path'
import { getRepoExecutionHostId,LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import { hardenExistingSecureFile } from '../shared/secure-file'
import { normalizeSourceControlAiSettings } from '../shared/source-control-ai'
import { DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,SOURCE_CONTROL_TEXT_ACTION_IDS } from '../shared/source-control-ai-actions'
import { areTaskSourceContextsEqual,normalizeStoredTaskSourceContext } from '../shared/task-source-context'
import type { GlobalSettings,PersistedState,WorkspaceSessionPatch,WorkspaceSessionState } from '../shared/types'
import { areWorkspaceLinkedItemsEqual,normalizeWorkspaceLinkedItem } from '../shared/workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from '../shared/workspace-linked-item-source-context'
import { worktreeWorkspaceKey } from '../shared/workspace-scope'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../shared/worktree-id'
import { isWslUncPath } from '../shared/wsl-paths'
import { MOBILE_PAIRING_USERDATA_FILES } from './runtime/mobile-pairing-files'
import { isStartupDiagnosticsEnabled,logStartupDiagnostic } from './startup/startup-diagnostics'

export function encrypt(plaintext: string): string {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) {
    return plaintext
  }
  try {
    return safeStorage.encryptString(plaintext).toString('base64')
  } catch (err) {
    console.error('[persistence] Encryption failed:', err)
    return plaintext
  }
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext || !safeStorage.isEncryptionAvailable()) {
    return ciphertext
  }
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  } catch {
    // Why: decrypt failure usually means plaintext (pre-encryption) or a changed keychain; return raw so the cookie survives upgrade.
    console.warn(
      '[persistence] safeStorage decryption failed — returning ciphertext as-is. Possible keychain reset.'
    )
    return ciphertext
  }
}

export function decryptOptionalSecret(value: string | null | undefined): string | null {
  return value ? decrypt(value) : null
}

export function retireLegacyInstructionsForClearedTextActionRecipes(
  sourceControlAi: GlobalSettings['sourceControlAi'],
  previousSettings: GlobalSettings
): GlobalSettings['sourceControlAi'] {
  if (!sourceControlAi?.actions) {
    return sourceControlAi
  }

  const previousSourceControlAi = normalizeSourceControlAiSettings(
    previousSettings.sourceControlAi,
    previousSettings.commitMessageAi
  )
  let instructionsByOperation = sourceControlAi.instructionsByOperation
  let changed = false
  for (const actionId of SOURCE_CONTROL_TEXT_ACTION_IDS) {
    if (
      sourceControlAi.actions[actionId]?.commandInputTemplate !==
      DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId]
    ) {
      continue
    }
    if (
      previousSourceControlAi.actions?.[actionId]?.commandInputTemplate ===
        DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId] ||
      instructionsByOperation?.[actionId] !==
        previousSourceControlAi.instructionsByOperation[actionId]
    ) {
      continue
    }
    if (instructionsByOperation?.[actionId] === '') {
      continue
    }
    // Why: {basePrompt} is the explicit clear state; an empty instruction shadows rollback commitMessageAi.customPrompt on normalize/project.
    instructionsByOperation = { ...instructionsByOperation, [actionId]: '' }
    changed = true
  }

  return changed ? { ...sourceControlAi, instructionsByOperation } : sourceControlAi
}

// Why capture once (not a module const, not per-call): a const resolves before configureDevUserDataPath() redirects userData (dev/prod collide);
// per-call resolves after app.setName('Orca') flips path case and loses data on case-sensitive FS. index.ts calls initDataPath() at the right moment.
export let _dataFile: string | null = null
export let _userDataDir: string | null = null

export function initDataPath(): void {
  const userDataDir = app.getPath('userData')
  _userDataDir = userDataDir
  _dataFile = join(userDataDir, 'orca-data.json')
}

export function getDataFile(): string {
  if (!_dataFile) {
    // Safety fallback — should not be hit in normal startup.
    const userDataDir = app.getPath('userData')
    _userDataDir = userDataDir
    _dataFile = join(userDataDir, 'orca-data.json')
  }
  return _dataFile
}

// Why a sidecar: githubCache refreshes every poll and would rewrite the whole multi-MB orca-data.json each cycle.
// Snapshotted best-effort at quit for instant badges next launch; safe to lose.
export function getGithubCacheFile(dataFile = getDataFile()): string {
  return join(dirname(dataFile), 'orca-github-cache.json')
}

// Why: worktrees deleted outside Orca orphan their worktreeMeta, so the map grew monotonically (63% dead on a heavy install).
// GC stays narrow: local-host entries only (a local existsSync would falsely condemn SSH/WSL remote paths) and only after a 30-day idle grace.
export const WORKTREE_META_GC_GRACE_MS = 30 * 24 * 60 * 60 * 1000

export function gcStaleWorktreeMeta(state: PersistedState): number {
  // Why: a hand-corrupted "worktreeMeta": null overrides the defaults merge; normalize here instead of throwing.
  state.worktreeMeta ??= {}
  const repoById = new Map(state.repos.map((repo) => [repo.id, repo]))
  const projectIds = new Set((state.projects ?? []).map((project) => project.id))
  const now = Date.now()
  let removed = 0
  for (const key of Object.keys(state.worktreeMeta)) {
    // Why: folder-project workspace instances (keyed repoId::path::workspace:<uuid>) ARE the workspace record, not a checkout row; skip them.
    if (key.includes(FOLDER_WORKSPACE_INSTANCE_SEPARATOR)) {
      continue
    }
    const separator = key.indexOf('::')
    if (separator === -1) {
      continue
    }
    const ownerId = key.slice(0, separator)
    const worktreePath = key.slice(separator + 2)
    const meta = state.worktreeMeta[key]
    const repo = repoById.get(ownerId)
    if (repo) {
      if (repo.connectionId || getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
        continue
      }
    } else if (projectIds.has(ownerId)) {
      // Project-owned metas keep their own project/host lifecycle; leave them alone.
      continue
    }
    // Unowned entries (repo removed before metas were pruned) fall through to the same missing-path + idle-grace gate.
    if (meta?.hostId && meta.hostId !== LOCAL_EXECUTION_HOST_ID) {
      continue
    }
    if (!isAbsolute(worktreePath) || isWslUncPath(worktreePath)) {
      continue
    }
    // Why: WSL worktrees on Windows carry Linux-style paths that Windows existsSync can't probe and would falsely condemn.
    if (process.platform === 'win32' && !isWindowsAbsolutePathLike(worktreePath)) {
      continue
    }
    // Why keep timestamp-less entries: without timestamps we can't prove the 30-day grace elapsed (measured dead entries all had them).
    // Grace is checked before existsSync so active entries skip the stat fan-out (and its slow-NFS tail).
    const newestTouch = Math.max(meta?.lastActivityAt ?? 0, meta?.createdAt ?? 0)
    if (newestTouch === 0 || now - newestTouch < WORKTREE_META_GC_GRACE_MS) {
      continue
    }
    if (existsSync(worktreePath)) {
      continue
    }
    delete state.worktreeMeta[key]
    delete state.worktreeLineageById[key]
    delete state.workspaceLineageByChildKey[worktreeWorkspaceKey(key)]
    removed++
  }
  return removed
}

export function normalizeWorktreeLinkedItemMetadata(state: PersistedState): boolean {
  let changed = false
  const rawWorktreeMeta = state.worktreeMeta as unknown
  if (
    typeof rawWorktreeMeta !== 'object' ||
    rawWorktreeMeta === null ||
    Array.isArray(rawWorktreeMeta)
  ) {
    state.worktreeMeta = {}
    changed = rawWorktreeMeta !== undefined
  }
  for (const [key, meta] of Object.entries(state.worktreeMeta)) {
    // Why: hand-corrupted non-object entries are a real input class; drop them here because gcStaleWorktreeMeta
    // keeps timestamp-less keys forever and every downstream consumer trusts the Record<string, WorktreeMeta> type.
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      delete state.worktreeMeta[key]
      // Companions go with it, matching gcStaleWorktreeMeta/removeWorktreeMeta; a stranded lineage row would
      // otherwise re-attach to a worktree recreated at the same repoId::path.
      delete state.worktreeLineageById[key]
      delete state.workspaceLineageByChildKey[worktreeWorkspaceKey(key)]
      changed = true
      continue
    }
    const linkedWorkItem = normalizeWorkspaceLinkedItem(meta.linkedWorkItem)
    const sourceContext = normalizeStoredTaskSourceContext(meta.linkedTaskSourceContext)
    const linkedTaskSourceContext = isWorkspaceLinkedItemSourceContextMatch(
      linkedWorkItem,
      sourceContext
    )
      ? sourceContext
      : null
    if (!areWorkspaceLinkedItemsEqual(meta.linkedWorkItem, linkedWorkItem)) {
      meta.linkedWorkItem = linkedWorkItem
      changed = true
    }
    if (!areTaskSourceContextsEqual(meta.linkedTaskSourceContext, linkedTaskSourceContext)) {
      meta.linkedTaskSourceContext = linkedTaskSourceContext
      changed = true
    }
  }
  return changed
}

export function readGithubCacheSnapshot(dataFile: string): PersistedState['githubCache'] | null {
  try {
    const parsed = JSON.parse(readFileSync(getGithubCacheFile(dataFile), 'utf-8')) as unknown
    const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
    if (
      isPlainRecord(parsed) &&
      isPlainRecord((parsed as { pr?: unknown }).pr) &&
      isPlainRecord((parsed as { issue?: unknown }).issue)
    ) {
      return parsed as PersistedState['githubCache']
    }
  } catch {
    // Missing or corrupt snapshot: start with an empty cache and refetch.
  }
  return null
}

/**
 * Return the userData directory captured at initDataPath() time, before app.setName() can change how app.getPath('userData') resolves.
 *
 * Subsystems sharing storage with orca-data.json read this instead of resolving late, which on case-sensitive FS can lose paired devices.
 */
export function getCanonicalUserDataPath(): string {
  if (!_userDataDir) {
    // Safety fallback — should not be hit in normal startup.
    _userDataDir = app.getPath('userData')
  }
  return _userDataDir
}

/**
 * Copy legacy mobile pairing credentials into the canonical userData directory.
 *
 * Copies the registry and E2EE keypair forward as a pair so an update doesn't force a re-pair or mix devices with the wrong key.
 */
export function migrateMobilePairingDataToCanonicalUserDataPath(sourceUserDataDir: string): void {
  const targetUserDataDir = getCanonicalUserDataPath()
  if (resolve(sourceUserDataDir) === resolve(targetUserDataDir)) {
    return
  }

  const migrations = MOBILE_PAIRING_USERDATA_FILES.map((fileName) => ({
    sourcePath: join(sourceUserDataDir, fileName),
    targetPath: join(targetUserDataDir, fileName)
  }))
  if (migrations.some(({ sourcePath }) => !existsSync(sourcePath))) {
    return
  }
  if (migrations.some(({ targetPath }) => existsSync(targetPath))) {
    return
  }

  mkdirSync(targetUserDataDir, { recursive: true })
  for (const { sourcePath, targetPath } of migrations) {
    copyFileSync(sourcePath, targetPath)
    // Why: copyFileSync drops Windows ACLs, so re-assert current-user-only on these credential copies (device tokens, E2EE key).
    hardenExistingSecureFile(targetPath)
  }
}

// Why (issue #1158): keep 5 rolling backups at >=1h spacing so a corrupt/empty write leaves an earlier copy recoverable.
export const BACKUP_COUNT = 5
export const BACKUP_MIN_INTERVAL_MS = 60 * 60 * 1000
export const WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS = new Set<keyof WorkspaceSessionState>([
  'tabsByWorktree',
  'terminalLayoutsByTabId'
])

export function logPersistenceStartupMilestone(
  event: string,
  details: Record<string, unknown> = {}
): void {
  if (isStartupDiagnosticsEnabled()) {
    logStartupDiagnostic(event, { t: Math.round(performance.now()), ...details })
  }
}

export function workspaceSessionPatchNeedsFullNormalization(patch: WorkspaceSessionPatch): boolean {
  return Object.keys(patch).some((key) =>
    WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS.has(key as keyof WorkspaceSessionState)
  )
}

/** Normalize non-'local' host partitions; 'local' (the legacy workspaceSession blob) is dropped so the two surfaces never diverge.
 *  Each partition is zod-validated independently, so one corrupt host drops to defaults without taking out the others. Idempotent. */
