import type { GitRemoteIdentity } from '../shared/git-remote-identity'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { sanitizeRepoIcon } from '../shared/repo-icon'
import { normalizeRepoBadgeColor } from '../shared/repo-badge-color'
import type { Repo, RepoProjectHostSetupMethod } from '../shared/types'
import type { SshRemotePtyLease } from '../shared/ssh-types'
import { sanitizeRepoUpstream } from './persistence-state-ui-normalization'

export function sanitizeGitRemoteIdentity(value: unknown): GitRemoteIdentity | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<GitRemoteIdentity>
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
    const value = normalizeRepoBadgeColor(sanitized.badgeColor)
    if (value) sanitized.badgeColor = value
    else delete sanitized.badgeColor
  }
  if ('repoIcon' in sanitized) {
    const value = sanitizeRepoIcon(sanitized.repoIcon)
    if (value === undefined) delete sanitized.repoIcon
    else sanitized.repoIcon = value
  }
  if ('upstream' in sanitized) {
    const value = sanitizeRepoUpstream(sanitized.upstream)
    if (value === undefined) delete sanitized.upstream
    else sanitized.upstream = value
  }
  if ('gitRemoteIdentity' in sanitized) {
    const value = sanitizeGitRemoteIdentity(sanitized.gitRemoteIdentity)
    if (value === undefined) delete sanitized.gitRemoteIdentity
    else sanitized.gitRemoteIdentity = value
  }
  if ('worktreeBasePath' in sanitized && sanitized.worktreeBasePath !== undefined) {
    if (typeof sanitized.worktreeBasePath === 'string')
      sanitized.worktreeBasePath = sanitized.worktreeBasePath.trim() || undefined
    else delete sanitized.worktreeBasePath
  }
  if ('projectHostSetupMethod' in sanitized) {
    const value = sanitizeRepoProjectHostSetupMethod(sanitized.projectHostSetupMethod)
    if (value === undefined) delete sanitized.projectHostSetupMethod
    else sanitized.projectHostSetupMethod = value
  }
  if ('forkSyncMode' in sanitized) {
    const value = sanitizeForkSyncMode(sanitized.forkSyncMode)
    if (value === undefined) delete sanitized.forkSyncMode
    else sanitized.forkSyncMode = value
  }
  return sanitized
}

function expandFloatingWorkspaceHomePath(input: string, home: string): string {
  if (input === '~') return home
  if (input.startsWith(`~${sep}`) || (process.platform === 'win32' && input.startsWith('~/')))
    return join(home, input.slice(2))
  return input
}

function resolveFloatingWorkspacePath(input: string, home: string): string {
  const expanded = expandFloatingWorkspaceHomePath(input, home)
  return isAbsolute(expanded) ? resolve(expanded) : resolve(home, expanded)
}

export function canonicalizePersistedFloatingWorkspaceDirectory(
  input: string,
  home: string
): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const path = resolve(realpathSync(resolveFloatingWorkspacePath(trimmed, home)))
    return statSync(path).isDirectory() ? path : null
  } catch {
    return null
  }
}

export function normalizeFloatingWorkspaceTrustedCwds(
  input: unknown,
  home: string
): { trustedCwds: string[]; changed: boolean } {
  const raw = Array.isArray(input) ? input : []
  const trustedCwds: string[] = []
  const seen = new Set<string>()
  let changed = input !== undefined && !Array.isArray(input)
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim()) {
      changed = true
      continue
    }
    const path =
      canonicalizePersistedFloatingWorkspaceDirectory(value.trim(), home) ??
      resolveFloatingWorkspacePath(value.trim(), home)
    if (seen.has(path)) {
      changed = true
      continue
    }
    seen.add(path)
    trustedCwds.push(path)
    if (value !== path) changed = true
  }
  return { trustedCwds, changed }
}

export function normalizeSshRemotePtyLease(value: unknown): SshRemotePtyLease | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SshRemotePtyLease>
  if (typeof raw.targetId !== 'string' || typeof raw.ptyId !== 'string') return null
  const state = raw.state ?? 'detached'
  if (!['attached', 'detached', 'terminated', 'expired'].includes(state)) return null
  const now = Date.now()
  return {
    targetId: raw.targetId,
    ptyId: raw.ptyId,
    state,
    ...(typeof raw.worktreeId === 'string' ? { worktreeId: raw.worktreeId } : {}),
    ...(typeof raw.tabId === 'string' ? { tabId: raw.tabId } : {}),
    ...(typeof raw.leafId === 'string' ? { leafId: raw.leafId } : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    ...(typeof raw.lastAttachedAt === 'number' ? { lastAttachedAt: raw.lastAttachedAt } : {}),
    ...(typeof raw.lastDetachedAt === 'number' ? { lastDetachedAt: raw.lastDetachedAt } : {})
  }
}
