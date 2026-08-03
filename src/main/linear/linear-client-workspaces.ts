import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readStoredCredentialToken
} from '../integration-credential-file'
import type { LinearViewer, LinearWorkspace } from '../../shared/types'

// ── Concurrency limiter — max 4 parallel Linear API calls ────────────
import { LEGACY_WORKSPACE_ID, cachedTokens, credentialErrors, resetLinearClientState, setCachedLegacyViewer, setLegacyViewerLoaded } from './linear-client-limiter'
import { getWorkspaceTokenPath, emptyWorkspaceFile, getWorkspaceFile, writeWorkspaceFile, getWorkspaceState, clearLegacyViewerOnDisk, saveWorkspaceToken } from './linear-client-storage'
function saveToken(apiKey: string): void {
  saveWorkspaceToken(LEGACY_WORKSPACE_ID, apiKey)
}

function loadToken(options: { force?: boolean; workspaceId?: string } = {}): string | null {
  const workspaceId = options.workspaceId ?? resolveWorkspaceId()
  if (!workspaceId) {
    return null
  }
  const cached = cachedTokens.get(workspaceId)
  if (cached !== undefined) {
    return cached
  }
  if (!options.force) {
    return null
  }
  const tokenPath = getWorkspaceTokenPath(workspaceId)
  if (!existsSync(tokenPath)) {
    return null
  }
  try {
    const raw = readFileSync(tokenPath)
    const token = readStoredCredentialToken('Linear', raw)
    if (token) {
      cachedTokens.set(workspaceId, token)
    }
    credentialErrors.delete(workspaceId)
    return token
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialErrors.set(workspaceId, error.message)
      throw error
    }
    return null
  }
}

function hasStoredToken(workspaceId?: string): boolean {
  if (!workspaceId) {
    return getWorkspaceState().workspaces.length > 0
  }
  if (cachedTokens.has(workspaceId)) {
    return true
  }
  return credentialFileHasContent(getWorkspaceTokenPath(workspaceId))
}

function clearTokenFile(workspaceId: string): void {
  cachedTokens.delete(workspaceId)
  credentialErrors.delete(workspaceId)
  try {
    unlinkSync(getWorkspaceTokenPath(workspaceId))
  } catch {
    // File may not exist — safe to ignore.
  }
}

function clearToken(workspaceId?: string): void {
  if (!workspaceId) {
    const state = getWorkspaceState()
    for (const workspace of state.workspaces) {
      clearTokenFile(workspace.id)
    }
    resetLinearClientState()
    clearLegacyViewerOnDisk()
    writeWorkspaceFile(emptyWorkspaceFile())
    return
  }

  clearTokenFile(workspaceId)
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    setCachedLegacyViewer(null)
    setLegacyViewerLoaded(false)
    clearLegacyViewerOnDisk()
    return
  }

  const file = getWorkspaceFile()
  const workspaces = file.workspaces.filter((workspace) => workspace.id !== workspaceId)
  const activeWorkspaceId =
    file.activeWorkspaceId === workspaceId ? (workspaces[0]?.id ?? null) : file.activeWorkspaceId
  const selectedWorkspaceId =
    file.selectedWorkspaceId === workspaceId ? activeWorkspaceId : file.selectedWorkspaceId
  writeWorkspaceFile({
    version: 1,
    activeWorkspaceId,
    selectedWorkspaceId,
    workspaces
  })
}

function workspaceFromLinearData(
  me: { displayName: string; email?: string | null },
  org: { id: string; name: string; urlKey?: string | null }
): LinearWorkspace {
  return {
    id: org.id,
    organizationId: org.id,
    organizationName: org.name,
    organizationUrlKey: org.urlKey ?? undefined,
    displayName: me.displayName,
    email: me.email ?? null
  }
}

function upsertWorkspace(workspace: LinearWorkspace, options: { select?: boolean } = {}): void {
  const file = getWorkspaceFile()
  const current = file.workspaces.find((entry) => entry.id === workspace.id)
  const credentialRevision = (current?.credentialRevision ?? 0) + 1
  const workspaceWithRevision = { ...workspace, credentialRevision }
  const withoutCurrent = file.workspaces.filter((entry) => entry.id !== workspace.id)
  const workspaces = [...withoutCurrent, workspaceWithRevision].sort((a, b) =>
    a.organizationName.localeCompare(b.organizationName)
  )
  const selectedWorkspaceId = options.select
    ? workspace.id
    : file.selectedWorkspaceId && file.selectedWorkspaceId !== LEGACY_WORKSPACE_ID
      ? file.selectedWorkspaceId
      : workspace.id
  writeWorkspaceFile({
    version: 1,
    activeWorkspaceId: workspace.id,
    selectedWorkspaceId,
    workspaces
  })
}

function replaceLegacyWorkspace(workspace: LinearWorkspace, token: string): void {
  saveWorkspaceToken(workspace.id, token)
  clearTokenFile(LEGACY_WORKSPACE_ID)
  clearLegacyViewerOnDisk()
  setCachedLegacyViewer(null)
  setLegacyViewerLoaded(true)
  upsertWorkspace(workspace, { select: true })
}

function resolveWorkspaceId(workspaceId?: string | null): string | null {
  if (workspaceId && workspaceId !== 'all') {
    return workspaceId
  }
  const state = getWorkspaceState()
  if (
    state.selectedWorkspaceId &&
    state.selectedWorkspaceId !== 'all' &&
    state.workspaces.some((workspace) => workspace.id === state.selectedWorkspaceId)
  ) {
    return state.selectedWorkspaceId
  }
  if (
    state.activeWorkspaceId &&
    state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)
  ) {
    return state.activeWorkspaceId
  }
  return state.workspaces[0]?.id ?? null
}

// ── Client factory ───────────────────────────────────────────────────
// Why: issues/teams modules call this for real Linear actions — at that point
// decrypting the token and surfacing a keychain prompt is expected.

export { saveToken, loadToken, hasStoredToken, clearTokenFile, clearToken, workspaceFromLinearData, upsertWorkspace, replaceLegacyWorkspace, resolveWorkspaceId }
