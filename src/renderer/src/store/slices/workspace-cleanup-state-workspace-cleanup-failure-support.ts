/*    enrichment, dismissals, and destructive preflight/delete orchestration share
   one store state contract. */
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import {
  WORKSPACE_CLEANUP_CLASSIFIER_VERSION,
  applyWorkspaceCleanupPolicy,
  canQueueWorkspaceCleanupCandidate,
  canSelectWorkspaceCleanupCandidate,
  shouldForceWorkspaceCleanupRemoval,
  shouldHideWorkspaceCleanupCandidate,
  type WorkspaceCleanupBlocker,
  type WorkspaceCleanupCandidate,
  type WorkspaceCleanupDismissal,
  type WorkspaceCleanupScanArgs,
  type WorkspaceCleanupScanProgress,
  type WorkspaceCleanupScanResult
} from '../../../../shared/workspace-cleanup'
import { mapWithConcurrency } from '../../../../shared/map-with-concurrency'
import { classifyTitleActivity, isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import { translate } from '@/i18n/i18n'
export type WorkspaceCleanupFailure = {
  worktreeId: string
  displayName: string
  message: string
}
export type WorkspaceCleanupRemoveResult = {
  removedIds: string[]
  failures: WorkspaceCleanupFailure[]
}
export type WorkspaceCleanupRemoveOptions = {
  // Why: rows are removed long after the confirm click; the confirm-time
  // candidate records how much git risk the user actually approved.
  approvedCandidates?: readonly WorkspaceCleanupCandidate[]
}
export type WorkspaceCleanupViewedCandidate = {
  viewedAt: number
  fingerprint: string
  wasSuggested: boolean
}
export type WorkspaceCleanupSlice = {
  workspaceCleanupScan: WorkspaceCleanupScanResult | null
  workspaceCleanupProgress: WorkspaceCleanupScanProgress | null
  workspaceCleanupLoading: boolean
  workspaceCleanupError: string | null
  workspaceCleanupDismissals: Record<string, WorkspaceCleanupDismissal>
  workspaceCleanupViewedCandidates: Record<string, WorkspaceCleanupViewedCandidate>
  scanWorkspaceCleanup: (args?: WorkspaceCleanupScanArgs) => Promise<WorkspaceCleanupScanResult>
  markWorkspaceCleanupCandidateViewed: (candidate: WorkspaceCleanupCandidate) => void
  dismissWorkspaceCleanupCandidates: (
    candidates: readonly WorkspaceCleanupCandidate[]
  ) => Promise<void>
  resetWorkspaceCleanupDismissals: () => Promise<void>
  removeWorkspaceCleanupCandidates: (
    worktreeIds: readonly string[],
    options?: WorkspaceCleanupRemoveOptions
  ) => Promise<WorkspaceCleanupRemoveResult>
}
export type EnrichOptions = {
  applyDismissals?: boolean
}
export type WorkspaceCleanupEnrichmentCacheEntry = {
  inputSignature: string
  localSignature: string
  candidate: WorkspaceCleanupCandidate
}
export const RECENT_VISIBLE_CONTEXT_MS = 24 * 60 * 60 * 1000
export const VIEWED_FROM_CLEANUP_MS = 2 * 60 * 60 * 1000
export const WORKSPACE_CLEANUP_PREFLIGHT_CONCURRENCY = 4
// Why: dirty-files/unpushed-commits are concrete known work at risk; unknown-base
// and git-status-error only mean "couldn't verify". A row approved while
// unverifiable must still fail if real work becomes visible before removal.
export const WORKSPACE_CLEANUP_CONCRETE_RISK_BLOCKERS = ['dirty-files', 'unpushed-commits'] as const

let inFlightWorkspaceCleanupScan: {
  key: string
  promise: Promise<WorkspaceCleanupScanResult>
} | null = null
let latestWorkspaceCleanupScanToken = 0
let finalizedWorkspaceCleanupScanToken = 0
let workspaceCleanupProgressQueue: {
  scanToken: number
  promise: Promise<void>
} | null = null
let workspaceCleanupEnrichmentCache: {
  scanToken: number
  entries: Map<string, WorkspaceCleanupEnrichmentCacheEntry>
} | null = null
// Why: cleanup progress can append thousands of rows; keep one scan-local
// index so each streamed row does not rebuild a map of every previous row.
let workspaceCleanupProgressCandidateIndex: {
  scanToken: number
  scanId: string
  candidates: WorkspaceCleanupCandidate[]
  indexesByWorktreeId: Map<string, number>
} | null = null
export const SHELL_PROCESS_NAMES = new Set([
  'bash',
  'cmd',
  'cmd.exe',
  'fish',
  'nu',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'sh',
  'zsh'
])
export const AGENT_PROCESS_NAMES = new Set([
  'aider',
  'amp',
  'agy',
  'claude',
  'claude-code',
  'codex',
  'crush',
  'droid',
  'gemini',
  'gemini-cli',
  'goose',
  'opencode'
])
