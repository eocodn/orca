import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { UsageCacheSnapshotWriter } from '../usage-cache-snapshot-writer'
import type {
  CodexUsageBreakdownKind,
  CodexUsageBreakdownRow,
  CodexUsageDailyPoint,
  CodexUsageRange,
  CodexUsageScanState,
  CodexUsageScope,
  CodexUsageSessionRow,
  CodexUsageSnapshot,
  CodexUsageSummary
} from '../../shared/codex-usage-types'
import type { Store } from '../persistence'
import type { UsageWorktreeRef } from '../usage-worktree-metadata'
import type { CodexUsagePersistedState } from './types'

// Why: v5 keys Codex ownership on raw token_count identity without session id
// so forks that rewrite session_meta still match. Older caches used session-
// scoped keys and can double-count after fork/resume (#8006).
const SCHEMA_VERSION = 5
export const STALE_MS = 5 * 60_000
export const AUTOMATION_ATTRIBUTION_WINDOW_MS = 5 * 60_000

let _codexUsageFile: string | null = null

export function initCodexUsagePath(): void {
  _codexUsageFile = join(app.getPath('userData'), 'orca-codex-usage.json')
}

export type AutomationUsageLookupInput = {
  worktreeId: string | null
  terminalSessionId: string | null
  startedAt: number | null
  completedAt: number | null
}

export function getRangeCutoff(range: CodexUsageRange): string | null {
  if (range === 'all') {
    return null
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - (days - 1))
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function getLocalDay(timestamp: string): string | null {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

export type ScopedCodexUsageModelRow = {
  modelKey: string
  modelLabel: string
  hasInferredPricing: boolean
  eventCount: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export function getWorktreeFingerprint(worktreesByRepo: Map<string, UsageWorktreeRef[]>): string {
  const rows = [...worktreesByRepo.entries()]
    .flatMap(([repoId, worktrees]) =>
      worktrees.map((worktree) => JSON.stringify({ repoId, ...worktree }))
    )
    .sort()
  return JSON.stringify(rows)
}


function getDefaultState(): CodexUsagePersistedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions: [],
    dailyAggregates: [],
    scanState: {
      enabled: false,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null
    }
  }
}

export function normalizePersistedState(state: CodexUsagePersistedState): CodexUsagePersistedState {
  if (state.schemaVersion !== SCHEMA_VERSION) {
    // Why: location projections change persisted meaning, so old caches must rebuild.
    const defaults = getDefaultState()
    return {
      ...defaults,
      scanState: {
        ...defaults.scanState,
        enabled: state.scanState?.enabled ?? defaults.scanState.enabled
      }
    }
  }
  return {
    ...state,
    sessions: state.sessions.map((session) => ({
      ...session,
      locationModelBreakdown: session.locationModelBreakdown ?? []
    }))
  }
}

function getCodexUsageFile(): string {
  if (!_codexUsageFile) {
    _codexUsageFile = join(app.getPath('userData'), 'orca-codex-usage.json')
  }
  return _codexUsageFile
}


export abstract class CodexUsageStoreBase {
  protected state: CodexUsagePersistedState
  protected readonly store: Store
  protected scanPromise: Promise<void> | null = null
  // Why: the 60 MB usage JSON must not block the Electron main thread; the writer serializes writes
  // and vetoes superseded renames.
  protected readonly writer = new UsageCacheSnapshotWriter('[codex-usage]', getCodexUsageFile)

  constructor(store: Store) {
    this.store = store
    this.state = this.load()
  }

  protected load(): CodexUsagePersistedState {
    try {
      const usageFile = getCodexUsageFile()
      if (!existsSync(usageFile)) {
        return getDefaultState()
      }
      const parsed = JSON.parse(readFileSync(usageFile, 'utf-8')) as CodexUsagePersistedState
      return normalizePersistedState({
        ...getDefaultState(),
        ...parsed,
        scanState: {
          ...getDefaultState().scanState,
          ...parsed.scanState
        }
      })
    } catch (error) {
      console.error('[codex-usage] Failed to load persisted state, starting fresh:', error)
      return getDefaultState()
    }
  }

  protected writeToDisk(): Promise<void> {
    // Compact: this cache reaches 60 MB, and pretty-printing it costs main-thread time per scan.
    return this.writer.write(() => JSON.stringify(this.state))
  }

  /** Await queued cache writes so quit does not drop the final snapshot. */
  flush(): Promise<void> {
    return this.writer.flush()
  }

  async setEnabled(enabled: boolean): Promise<CodexUsageScanState> {
    this.state.scanState.enabled = enabled
    await this.writeToDisk()
    return this.getScanState()
  }

  getScanState(): CodexUsageScanState {
    return {
      ...this.state.scanState,
      isScanning: this.scanPromise !== null,
      hasAnyCodexData: this.state.sessions.length > 0 || this.state.dailyAggregates.length > 0
    }
  }

  protected abstract getCurrentWorktreeFingerprint(): Promise<string>
}
