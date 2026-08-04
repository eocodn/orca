import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LinearViewer, LinearWorkspace } from '../../shared/types'

// ── Concurrency limiter — max 4 parallel Linear API calls ────────────
import {
  LEGACY_WORKSPACE_ID,
  type LinearWorkspaceFile,
  cachedTokens,
  credentialErrors,
  cachedLegacyViewer,
  legacyViewerLoadedFromDisk,
  cachedWorkspaceFile,
  workspaceFileLoadedFromDisk,
  setCachedLegacyViewer,
  setLegacyViewerLoaded,
  setCachedWorkspaceFile,
  setWorkspaceFileLoaded
} from './linear-client-limiter'
import { hasStoredToken } from './linear-client-workspaces'
function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getLegacyTokenPath(): string {
  return join(getOrcaDir(), 'linear-token.enc')
}

function getLegacyViewerPath(): string {
  return join(getOrcaDir(), 'linear-viewer.json')
}

function getWorkspaceFilePath(): string {
  return join(getOrcaDir(), 'linear-workspaces.json')
}

function getWorkspaceTokenDir(): string {
  return join(getOrcaDir(), 'linear-tokens')
}

function getWorkspaceTokenPath(workspaceId: string): string {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    return getLegacyTokenPath()
  }
  return join(getWorkspaceTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.enc`)
}

function ensureOrcaDir(): void {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureWorkspaceTokenDir(): void {
  const dir = getWorkspaceTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readLegacyViewerFromDisk(): LinearViewer | null {
  const path = getLegacyViewerPath()
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = readFileSync(path, { encoding: 'utf-8' })
    const parsed = JSON.parse(raw) as Partial<LinearViewer>
    if (typeof parsed?.displayName !== 'string' || typeof parsed?.organizationName !== 'string') {
      return null
    }
    return {
      displayName: parsed.displayName,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      organizationId: typeof parsed.organizationId === 'string' ? parsed.organizationId : undefined,
      organizationName: parsed.organizationName,
      organizationUrlKey:
        typeof parsed.organizationUrlKey === 'string' ? parsed.organizationUrlKey : undefined
    }
  } catch {
    return null
  }
}

function getLegacyViewer(): LinearViewer | null {
  if (!legacyViewerLoadedFromDisk) {
    setCachedLegacyViewer(readLegacyViewerFromDisk())
    setLegacyViewerLoaded(true)
  }
  return cachedLegacyViewer
}

function normalizeWorkspace(input: unknown): LinearWorkspace | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.organizationName !== 'string') {
    return null
  }
  if (typeof record.displayName !== 'string') {
    return null
  }

  const organizationId =
    typeof record.organizationId === 'string' && record.organizationId
      ? record.organizationId
      : record.id

  return {
    id: record.id,
    organizationId,
    organizationName: record.organizationName,
    organizationUrlKey:
      typeof record.organizationUrlKey === 'string' ? record.organizationUrlKey : undefined,
    displayName: record.displayName,
    email: typeof record.email === 'string' ? record.email : null,
    credentialRevision:
      typeof record.credentialRevision === 'number' && Number.isFinite(record.credentialRevision)
        ? record.credentialRevision
        : undefined
  }
}

function emptyWorkspaceFile(): LinearWorkspaceFile {
  return {
    version: 1,
    activeWorkspaceId: null,
    selectedWorkspaceId: null,
    workspaces: []
  }
}

function readWorkspaceFileFromDisk(): LinearWorkspaceFile {
  const path = getWorkspaceFilePath()
  if (!existsSync(path)) {
    return emptyWorkspaceFile()
  }
  try {
    const raw = readFileSync(path, { encoding: 'utf-8' })
    const parsed = JSON.parse(raw) as Partial<LinearWorkspaceFile>
    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
          .map((workspace) => normalizeWorkspace(workspace))
          .filter((workspace): workspace is LinearWorkspace => workspace !== null)
          .filter((workspace) => hasStoredToken(workspace.id))
      : []
    const activeWorkspaceId =
      typeof parsed.activeWorkspaceId === 'string' &&
      workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
        ? parsed.activeWorkspaceId
        : (workspaces[0]?.id ?? null)
    const selectedWorkspaceId =
      parsed.selectedWorkspaceId === 'all' ||
      (typeof parsed.selectedWorkspaceId === 'string' &&
        workspaces.some((workspace) => workspace.id === parsed.selectedWorkspaceId))
        ? parsed.selectedWorkspaceId
        : activeWorkspaceId

    return {
      version: 1,
      activeWorkspaceId,
      selectedWorkspaceId,
      workspaces
    }
  } catch {
    return emptyWorkspaceFile()
  }
}

function getWorkspaceFile(): LinearWorkspaceFile {
  if (!workspaceFileLoadedFromDisk || !cachedWorkspaceFile) {
    setCachedWorkspaceFile(readWorkspaceFileFromDisk())
    setWorkspaceFileLoaded(true)
  }
  const file = cachedWorkspaceFile
  if (!file) {
    throw new Error('Linear workspace file cache was not initialized')
  }
  return file
}

function writeWorkspaceFile(file: LinearWorkspaceFile): void {
  ensureOrcaDir()
  const persistedWorkspaces = file.workspaces.filter(
    (workspace) => workspace.id !== LEGACY_WORKSPACE_ID
  )
  const selectableIds = new Set(persistedWorkspaces.map((workspace) => workspace.id))
  if (hasStoredToken(LEGACY_WORKSPACE_ID)) {
    selectableIds.add(LEGACY_WORKSPACE_ID)
  }
  const activeWorkspaceId =
    file.activeWorkspaceId && selectableIds.has(file.activeWorkspaceId)
      ? file.activeWorkspaceId
      : (persistedWorkspaces[0]?.id ??
        (selectableIds.has(LEGACY_WORKSPACE_ID) ? LEGACY_WORKSPACE_ID : null))
  const selectedWorkspaceId =
    file.selectedWorkspaceId === 'all'
      ? 'all'
      : file.selectedWorkspaceId && selectableIds.has(file.selectedWorkspaceId)
        ? file.selectedWorkspaceId
        : activeWorkspaceId

  setCachedWorkspaceFile({
    version: 1,
    activeWorkspaceId,
    selectedWorkspaceId,
    workspaces: persistedWorkspaces
  })
  setWorkspaceFileLoaded(true)
  writeFileSync(getWorkspaceFilePath(), JSON.stringify(cachedWorkspaceFile, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function getLegacyWorkspace(): LinearWorkspace | null {
  if (!hasStoredToken(LEGACY_WORKSPACE_ID)) {
    return null
  }
  const viewer = getLegacyViewer()
  return {
    id: LEGACY_WORKSPACE_ID,
    organizationId: viewer?.organizationId ?? LEGACY_WORKSPACE_ID,
    organizationName: viewer?.organizationName ?? 'Saved Linear workspace',
    organizationUrlKey: viewer?.organizationUrlKey,
    displayName: viewer?.displayName ?? 'Linear API key',
    email: viewer?.email ?? null,
    isLegacy: true
  }
}

function getWorkspaceState(): LinearWorkspaceFile {
  const file = getWorkspaceFile()
  const legacyWorkspace = getLegacyWorkspace()
  const workspaces = [
    ...(legacyWorkspace ? [legacyWorkspace] : []),
    ...file.workspaces.filter((workspace) => hasStoredToken(workspace.id))
  ]
  const activeWorkspaceId =
    file.activeWorkspaceId &&
    workspaces.some((workspace) => workspace.id === file.activeWorkspaceId)
      ? file.activeWorkspaceId
      : (workspaces[0]?.id ?? null)
  const selectedWorkspaceId =
    file.selectedWorkspaceId === 'all'
      ? 'all'
      : file.selectedWorkspaceId &&
          workspaces.some((workspace) => workspace.id === file.selectedWorkspaceId)
        ? file.selectedWorkspaceId
        : activeWorkspaceId

  return {
    version: 1,
    activeWorkspaceId,
    selectedWorkspaceId,
    workspaces
  }
}

function clearLegacyViewerOnDisk(): void {
  try {
    unlinkSync(getLegacyViewerPath())
  } catch {
    // File may not exist — safe to ignore.
  }
}

function writeEncryptedToken(path: string, apiKey: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(apiKey)
    writeFileSync(path, encrypted, { mode: 0o600 })
    return
  }

  console.warn('[linear] safeStorage encryption unavailable — storing token in plaintext')
  writeFileSync(path, apiKey, { encoding: 'utf-8', mode: 0o600 })
}

function saveWorkspaceToken(workspaceId: string, apiKey: string): void {
  ensureOrcaDir()
  if (workspaceId !== LEGACY_WORKSPACE_ID) {
    ensureWorkspaceTokenDir()
  }
  const tokenPath = getWorkspaceTokenPath(workspaceId)
  writeEncryptedToken(tokenPath, apiKey)
  cachedTokens.set(workspaceId, apiKey)
  credentialErrors.delete(workspaceId)
}

// Backward-compatible export for the legacy single-workspace storage path.

export {
  getOrcaDir,
  getLegacyTokenPath,
  getLegacyViewerPath,
  getWorkspaceFilePath,
  getWorkspaceTokenDir,
  getWorkspaceTokenPath,
  ensureOrcaDir,
  ensureWorkspaceTokenDir,
  readLegacyViewerFromDisk,
  getLegacyViewer,
  normalizeWorkspace,
  emptyWorkspaceFile,
  readWorkspaceFileFromDisk,
  getWorkspaceFile,
  writeWorkspaceFile,
  getLegacyWorkspace,
  getWorkspaceState,
  clearLegacyViewerOnDisk,
  writeEncryptedToken,
  saveWorkspaceToken
}
