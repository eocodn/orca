import { statSync, realpathSync } from 'node:fs'
import { join, isAbsolute, resolve, sep } from 'node:path'
import type { RepoProjectHostSetupMethod, Repo, LegacyPaneKeyAliasEntry, TerminalLayoutSnapshot } from '../shared/types'
import type { GitRemoteIdentity } from '../shared/git-remote-identity'
import type { MigrationUnsupportedPtyEntry } from '../shared/agent-status-types'
import { type SshRemotePtyLease } from '../shared/ssh-types'
import { sanitizeRepoIcon } from '../shared/repo-icon'
import { normalizeRepoBadgeColor } from '../shared/repo-badge-color'
import { sanitizeRepoUpstream } from './persistence-state-ui-normalization'

export { backfillLegacyAutomationContexts,
  type LegacySshTarget,
  normalizeSshTarget,
  type SanitizeOnboardingUpdateOptions,
  remapLegacyOnboardingLastCompletedStep,
  sanitizeOnboardingUpdate,
  normalizeLoadedOnboardingState,
  resolveSetupGuideSidebarDismissedOnLoad,
  readDeprecatedExperimentFlag,
  readLegacySidekickFlag,
  sanitizeRepoUpstream } from './persistence-state-ui-normalization'

export function sanitizeGitRemoteIdentity(value: unknown): GitRemoteIdentity | null | undefined {
  // Why: `null` is a resolved "no usable remote" marker; dropping it would make
  // a settled repo indistinguishable from one whose identity probe is pending.
  if (value === null) {
    return null
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const candidate = value as {
    canonicalKey?: unknown
    remoteName?: unknown
    remoteUrl?: unknown
  }
  const canonicalKey =
    typeof candidate.canonicalKey === 'string' ? candidate.canonicalKey.trim() : ''
  const remoteName = typeof candidate.remoteName === 'string' ? candidate.remoteName.trim() : ''
  const remoteUrl = typeof candidate.remoteUrl === 'string' ? candidate.remoteUrl.trim() : ''
  return canonicalKey && remoteName && remoteUrl
    ? { canonicalKey, remoteName, remoteUrl }
    : undefined
}

export function sanitizeRepoProjectHostSetupMethod(
  value: unknown
): RepoProjectHostSetupMethod | undefined {
  return value === 'imported-existing-folder' || value === 'cloned' ? value : undefined
}

export function sanitizeForkSyncMode(value: unknown): Repo['forkSyncMode'] | undefined {
  return value === 'ask' || value === 'safe-auto' || value === 'off' ? value : undefined
}

export function sanitizeRepoUpdatesForPersistence<
  T extends Partial<
    Pick<
      Repo,
      | 'badgeColor'
      | 'repoIcon'
      | 'upstream'
      | 'gitRemoteIdentity'
      | 'worktreeBasePath'
      | 'projectHostSetupMethod'
      | 'forkSyncMode'
    >
  >
>(updates: T): T {
  const sanitized = { ...updates }
  if ('badgeColor' in sanitized) {
    const badgeColor = normalizeRepoBadgeColor(sanitized.badgeColor)
    if (!badgeColor) {
      delete sanitized.badgeColor
    } else {
      sanitized.badgeColor = badgeColor
    }
  }
  if ('repoIcon' in sanitized) {
    const repoIcon = sanitizeRepoIcon(sanitized.repoIcon)
    if (repoIcon === undefined) {
      delete sanitized.repoIcon
    } else {
      sanitized.repoIcon = repoIcon
    }
  }
  // Why: `null` is a valid "not a fork" / "no usable remote" marker; only drop malformed shapes.
  if ('upstream' in sanitized) {
    const upstream = sanitizeRepoUpstream(sanitized.upstream)
    if (upstream === undefined) {
      delete sanitized.upstream
    } else {
      sanitized.upstream = upstream
    }
  }
  if ('gitRemoteIdentity' in sanitized) {
    const gitRemoteIdentity = sanitizeGitRemoteIdentity(sanitized.gitRemoteIdentity)
    if (gitRemoteIdentity === undefined) {
      delete sanitized.gitRemoteIdentity
    } else {
      sanitized.gitRemoteIdentity = gitRemoteIdentity
    }
  }
  if ('worktreeBasePath' in sanitized && sanitized.worktreeBasePath !== undefined) {
    if (typeof sanitized.worktreeBasePath === 'string') {
      sanitized.worktreeBasePath = sanitized.worktreeBasePath.trim() || undefined
    } else {
      delete sanitized.worktreeBasePath
    }
  }
  if ('projectHostSetupMethod' in sanitized) {
    const setupMethod = sanitizeRepoProjectHostSetupMethod(sanitized.projectHostSetupMethod)
    if (setupMethod === undefined) {
      delete sanitized.projectHostSetupMethod
    } else {
      sanitized.projectHostSetupMethod = setupMethod
    }
  }
  if ('forkSyncMode' in sanitized) {
    const forkSyncMode = sanitizeForkSyncMode(sanitized.forkSyncMode)
    if (forkSyncMode === undefined) {
      delete sanitized.forkSyncMode
    } else {
      sanitized.forkSyncMode = forkSyncMode
    }
  }
  return sanitized
}

export function expandFloatingWorkspaceHomePath(input: string, home: string): string {
  if (input === '~') {
    return home
  }
  if (input.startsWith(`~${sep}`) || (process.platform === 'win32' && input.startsWith('~/'))) {
    return join(home, input.slice(2))
  }
  return input
}

export function resolveFloatingWorkspacePath(input: string, home: string): string {
  const expanded = expandFloatingWorkspaceHomePath(input, home)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(home, expanded)
}

export function canonicalizePersistedFloatingWorkspaceDirectory(
  input: string,
  home: string
): string | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    const canonicalPath = resolve(realpathSync(resolveFloatingWorkspacePath(trimmed, home)))
    return statSync(canonicalPath).isDirectory() ? canonicalPath : null
  } catch {
    return null
  }
}

export function normalizeFloatingWorkspaceTrustedCwds(
  input: unknown,
  home: string
): { trustedCwds: string[]; changed: boolean } {
  const rawTrustedCwds = Array.isArray(input) ? input : []
  const trustedCwds: string[] = []
  const seen = new Set<string>()
  let changed = input !== undefined && !Array.isArray(input)

  for (const rawTrustedCwd of rawTrustedCwds) {
    if (typeof rawTrustedCwd !== 'string') {
      changed = true
      continue
    }
    const trimmedTrustedCwd = rawTrustedCwd.trim()
    if (!trimmedTrustedCwd) {
      changed = true
      continue
    }
    const canonicalPath = canonicalizePersistedFloatingWorkspaceDirectory(trimmedTrustedCwd, home)
    const normalizedPath = canonicalPath ?? resolveFloatingWorkspacePath(trimmedTrustedCwd, home)
    if (!normalizedPath) {
      changed = true
      continue
    }
    if (seen.has(normalizedPath)) {
      changed = true
      continue
    }
    seen.add(normalizedPath)
    trustedCwds.push(normalizedPath)
    if (rawTrustedCwd !== normalizedPath) {
      changed = true
    }
  }

  return { trustedCwds, changed }
}

export function normalizeSshRemotePtyLease(value: unknown): SshRemotePtyLease | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Partial<SshRemotePtyLease>
  if (typeof raw.targetId !== 'string' || typeof raw.ptyId !== 'string') {
    return null
  }
  const state = raw.state ?? 'detached'
  if (!['attached', 'detached', 'terminated', 'expired'].includes(state)) {
    return null
  }
  const now = Date.now()
  return {
    targetId: raw.targetId,
    ptyId: raw.ptyId,
    ...(typeof raw.worktreeId === 'string' ? { worktreeId: raw.worktreeId } : {}),
    ...(typeof raw.tabId === 'string' ? { tabId: raw.tabId } : {}),
    ...(typeof raw.leafId === 'string' && raw.leafId.length <= 256 ? { leafId: raw.leafId } : {}),
    state,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    ...(typeof raw.lastAttachedAt === 'number' ? { lastAttachedAt: raw.lastAttachedAt } : {}),
    ...(typeof raw.lastDetachedAt === 'number' ? { lastDetachedAt: raw.lastDetachedAt } : {})
  }
}

export type LayoutLeafNormalization = {
  snapshot: TerminalLayoutSnapshot
  changed: boolean
  leafIdByInputLeafId: Map<string, string>
}

export type PaneIdentityMigrationEntries = {
  migrationUnsupportedEntries: MigrationUnsupportedPtyEntry[]
  legacyPaneKeyAliasEntries: LegacyPaneKeyAliasEntry[]
}
