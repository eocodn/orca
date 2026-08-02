import { safeStorage } from 'electron'
import type { LinearClient } from '@linear/sdk'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadLinearSdk } from './linear-sdk'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readStoredCredentialToken
} from '../integration-credential-file'
import type {
  LinearConnectionStatus,
  LinearViewer,
  LinearWorkspace,
  LinearWorkspaceSelection
} from '../../shared/types'

// ── Concurrency limiter — max 4 parallel Linear API calls ────────────
import { LEGACY_WORKSPACE_ID, type LinearClientForWorkspace, LINEAR_PUBLIC_FILE_URL_EXPIRY_SECONDS, credentialErrors, cachedLegacyViewer, legacyViewerLoadedFromDisk } from './linear-client-limiter'
import { getLegacyViewer, getWorkspaceFile, writeWorkspaceFile, getLegacyWorkspace, getWorkspaceState, clearLegacyViewerOnDisk, saveWorkspaceToken } from './linear-client-storage'
import { loadToken, clearTokenFile, clearToken, workspaceFromLinearData, upsertWorkspace, replaceLegacyWorkspace, resolveWorkspaceId } from './linear-client-workspaces'
function getClient(workspaceId?: string | null): LinearClient | null {
  const token = loadToken({
    force: true,
    workspaceId: resolveWorkspaceId(workspaceId) ?? undefined
  })
  if (!token) {
    return null
  }
  return new (loadLinearSdk().LinearClient)({ apiKey: token })
}

function getClients(
  workspaceId?: LinearWorkspaceSelection | null
): LinearClientForWorkspace[] {
  const state = getWorkspaceState()
  const isAllSelection = workspaceId === 'all'
  const selectedWorkspaces = isAllSelection
    ? state.workspaces
    : state.workspaces.filter((workspace) => workspace.id === resolveWorkspaceId(workspaceId))

  const clients: LinearClientForWorkspace[] = []
  for (const workspace of selectedWorkspaces) {
    let token: string | null
    try {
      token = loadToken({ force: true, workspaceId: workspace.id })
    } catch (error) {
      // Why: under an 'all' selection one un-decryptable workspace must not
      // collapse reads for the healthy ones. loadToken already recorded the
      // per-workspace credentialError for getStatus to surface, so skip this
      // workspace like a missing token. A specific-workspace selection still
      // rethrows so the renderer can surface the decrypt banner promptly.
      if (isAllSelection && error instanceof CredentialDecryptionError) {
        continue
      }
      throw error
    }
    if (!token) {
      continue
    }
    clients.push({
      workspace,
      client: new (loadLinearSdk().LinearClient)({ apiKey: token }),
      apiKey: token
    })
  }
  return clients
}

function getPublicFileUrlClient(entry: LinearClientForWorkspace): LinearClient {
  return new (loadLinearSdk().LinearClient)({
    apiKey: entry.apiKey,
    headers: {
      'public-file-urls-expire-in': String(LINEAR_PUBLIC_FILE_URL_EXPIRY_SECONDS)
    }
  })
}

// ── Auth error detection ─────────────────────────────────────────────
// Why: 401 errors must trigger token clearing and a re-auth prompt in the
// renderer. All other errors are swallowed with console.warn to match GitHub
// client's graceful degradation.
function isAuthError(error: unknown): boolean {
  return error instanceof loadLinearSdk().AuthenticationLinearError
}

// ── Connect / disconnect / status ────────────────────────────────────
async function connect(
  apiKey: string
): Promise<
  { ok: true; viewer: LinearViewer; workspace: LinearWorkspace } | { ok: false; error: string }
> {
  try {
    const client = new (loadLinearSdk().LinearClient)({ apiKey })
    const me = await client.viewer
    const org = await me.organization
    const workspace = workspaceFromLinearData(me, org)

    saveWorkspaceToken(workspace.id, apiKey)
    const legacyWorkspace = getLegacyWorkspace()
    if (
      legacyWorkspace &&
      legacyWorkspace.organizationName === workspace.organizationName &&
      legacyWorkspace.email === workspace.email
    ) {
      clearTokenFile(LEGACY_WORKSPACE_ID)
      clearLegacyViewerOnDisk()
      cachedLegacyViewer = null
      legacyViewerLoadedFromDisk = true
    }
    upsertWorkspace(workspace, { select: true })
    return { ok: true, viewer: workspace, workspace }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to validate API key'
    return { ok: false, error: message }
  }
}

function disconnect(workspaceId?: string): void {
  clearToken(workspaceId)
}

function selectWorkspace(workspaceId: LinearWorkspaceSelection): LinearConnectionStatus {
  const state = getWorkspaceState()
  if (
    workspaceId !== 'all' &&
    !state.workspaces.some((workspace) => workspace.id === workspaceId)
  ) {
    return getStatus()
  }

  const file = getWorkspaceFile()
  writeWorkspaceFile({
    version: 1,
    activeWorkspaceId: workspaceId === 'all' ? file.activeWorkspaceId : workspaceId,
    selectedWorkspaceId: workspaceId,
    workspaces: file.workspaces
  })
  return getStatus()
}

function getStatus(): LinearConnectionStatus {
  const state = getWorkspaceState()
  const selectedWorkspace =
    state.selectedWorkspaceId && state.selectedWorkspaceId !== 'all'
      ? state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId)
      : null
  const activeWorkspace =
    selectedWorkspace ??
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ??
    state.workspaces[0] ??
    null

  const credentialError = state.workspaces
    .map((workspace) => credentialErrors.get(workspace.id))
    .find((message) => message !== undefined)

  return {
    connected: state.workspaces.length > 0,
    viewer: activeWorkspace,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    selectedWorkspaceId: state.selectedWorkspaceId,
    ...(credentialError ? { credentialError } : {})
  }
}

async function testConnection(
  workspaceId?: string
): Promise<
  { ok: true; viewer: LinearViewer; workspace: LinearWorkspace } | { ok: false; error: string }
> {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId)
  if (!resolvedWorkspaceId) {
    return { ok: false, error: 'No API key stored.' }
  }
  let token: string | null
  try {
    token = loadToken({ force: true, workspaceId: resolvedWorkspaceId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test failed'
    return { ok: false, error: message }
  }
  if (!token) {
    return { ok: false, error: 'No API key stored.' }
  }

  try {
    const client = new (loadLinearSdk().LinearClient)({ apiKey: token })
    const me = await client.viewer
    const org = await me.organization
    const workspace = workspaceFromLinearData(me, org)
    if (resolvedWorkspaceId === LEGACY_WORKSPACE_ID) {
      replaceLegacyWorkspace(workspace, token)
    } else {
      saveWorkspaceToken(workspace.id, token)
      upsertWorkspace(workspace, { select: true })
    }
    return { ok: true, viewer: workspace, workspace }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken(resolvedWorkspaceId)
    }
    const message = error instanceof Error ? error.message : 'Test failed'
    return { ok: false, error: message }
  }
}

// Why: called at main-process startup. We warm plaintext metadata only; tokens
// stay encrypted on disk until a user performs an actual Linear action.
function initLinearToken(): void {
  getWorkspaceFile()
  getLegacyViewer()
}

export { getClient, getClients, getPublicFileUrlClient, isAuthError, connect, disconnect, selectWorkspace, getStatus, testConnection, initLinearToken }

