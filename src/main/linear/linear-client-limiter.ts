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
import { getStatus } from './linear-client-connections'
const MAX_CONCURRENT = 4
let running = 0
const queue: (() => void)[] = []

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++
    return Promise.resolve()
  }
  return new Promise((resolve) =>
    queue.push(() => {
      running++
      resolve()
    })
  )
}

function release(): void {
  running--
  const next = queue.shift()
  if (next) {
    next()
  }
}

// ── Token + workspace storage ────────────────────────────────────────
// Why: tokens remain encrypted via safeStorage, while workspace metadata stays
// plaintext so status checks can render connected accounts without decrypting
// and triggering OS keychain prompts after app updates.
const LEGACY_WORKSPACE_ID = 'legacy'

type LinearWorkspaceFile = {
  version: 1
  activeWorkspaceId: string | null
  selectedWorkspaceId: LinearWorkspaceSelection | null
  workspaces: LinearWorkspace[]
}

type LinearClientForWorkspace = {
  workspace: LinearWorkspace
  client: LinearClient
  apiKey: string
}

const LINEAR_PUBLIC_FILE_URL_EXPIRY_SECONDS = 60 * 60

let cachedTokens = new Map<string, string>()
// Why: decrypt failures are recorded per workspace so getStatus can explain
// failing reads without re-touching the keychain on every status poll.
const credentialErrors = new Map<string, string>()
let cachedLegacyViewer: LinearViewer | null = null
let legacyViewerLoadedFromDisk = false
let cachedWorkspaceFile: LinearWorkspaceFile | null = null
let workspaceFileLoadedFromDisk = false

function resetLinearClientState(): void {
  cachedTokens = new Map()
  credentialErrors.clear()
  cachedLegacyViewer = null
  legacyViewerLoadedFromDisk = false
  cachedWorkspaceFile = null
  workspaceFileLoadedFromDisk = false
}

function setCachedLegacyViewer(value: LinearViewer | null): void {
  cachedLegacyViewer = value
}

function setLegacyViewerLoaded(value: boolean): void {
  legacyViewerLoadedFromDisk = value
}

function setCachedWorkspaceFile(value: LinearWorkspaceFile | null): void {
  cachedWorkspaceFile = value
}

function setWorkspaceFileLoaded(value: boolean): void {
  workspaceFileLoadedFromDisk = value
}

export { MAX_CONCURRENT, running, queue, acquire, release, LEGACY_WORKSPACE_ID, LINEAR_PUBLIC_FILE_URL_EXPIRY_SECONDS, cachedTokens, credentialErrors, cachedLegacyViewer, legacyViewerLoadedFromDisk, cachedWorkspaceFile, workspaceFileLoadedFromDisk, resetLinearClientState, setCachedLegacyViewer, setLegacyViewerLoaded, setCachedWorkspaceFile, setWorkspaceFileLoaded }
export { type LinearWorkspaceFile, type LinearClientForWorkspace }
