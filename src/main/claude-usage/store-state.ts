import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { UsageCacheSnapshotWriter } from '../usage-cache-snapshot-writer'
import type {
  ClaudeUsageBreakdownKind,
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScanState,
  ClaudeUsageScope,
  ClaudeUsageSessionRow,
  ClaudeUsageSnapshot,
  ClaudeUsageSummary
} from '../../shared/claude-usage-types'
import type { AutomationRunUsage } from '../../shared/automations-types'
import type { Store } from '../persistence'
import { loadKnownUsageWorktreesByRepo, type UsageWorktreeRef } from '../usage-worktree-metadata'
import type { ClaudeUsagePersistedState } from './types'

// Why: v5 widens Claude ownership keys (message-id / uuid fallbacks). Older
// caches either lack ownership or used narrower keys and can under/over-count
// after fork reclaim (#8006).
const SCHEMA_VERSION = 5
export const STALE_MS = 5 * 60_000
export const AUTOMATION_ATTRIBUTION_WINDOW_MS = 5 * 60_000

// Why: capture the path after configureDevUserDataPath() but before app.setName()
// mutates Electron's derived userData location, matching the persistence/store pattern.
let _claudeUsageFile: string | null = null

export function initClaudeUsagePath(): void {
  _claudeUsageFile = join(app.getPath('userData'), 'orca-claude-usage.json')
}

type AutomationUsageLookupInput = {
  worktreeId: string | null
  terminalSessionId: string | null
  startedAt: number | null
  completedAt: number | null
}

export function getRangeCutoff(range: ClaudeUsageRange): string | null {
  if (range === 'all') {
    return null
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  now.setDate(now.getDate() - (days - 1))
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getLocalDay(timestamp: string): string | null {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getWorktreeFingerprint(worktreesByRepo: Map<string, UsageWorktreeRef[]>): string {
  const rows = [...worktreesByRepo.entries()]
    .flatMap(([repoId, worktrees]) =>
      worktrees.map((worktree) =>
        JSON.stringify({
          repoId,
          worktreeId: worktree.worktreeId,
          path: worktree.path,
          displayName: worktree.displayName
        })
      )
    )
    .sort()
  return JSON.stringify(rows)
}

function getDefaultState(): ClaudeUsagePersistedState {
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

function getClaudeUsageFile(): string {
  if (!_claudeUsageFile) {
    _claudeUsageFile = join(app.getPath('userData'), 'orca-claude-usage.json')
  }
  return _claudeUsageFile
}


export abstract class ClaudeUsageStoreBase {
  protected state: ClaudeUsagePersistedState
  protected readonly store: Store
  protected scanPromise: Promise<void> | null = null
  // Why: the 20 MB usage JSON must not block the Electron main thread; the writer serializes writes
  // and vetoes superseded renames.
  protected readonly writer = new UsageCacheSnapshotWriter('[claude-usage]', getClaudeUsageFile)

  constructor(store: Store) {
    this.store = store
    this.state = this.load()
  }

  protected load(): ClaudeUsagePersistedState {
    try {
      const usageFile = getClaudeUsageFile()
      if (!existsSync(usageFile)) {
        return getDefaultState()
      }
      const parsed = JSON.parse(readFileSync(usageFile, 'utf-8')) as ClaudeUsagePersistedState
      if (parsed.schemaVersion !== SCHEMA_VERSION) {
        // Why: scanner semantics affect persisted totals, so old Claude caches
        // must be rebuilt after parser/source changes instead of reused briefly.
        // Preserve scanState.enabled so existing users keep tracking on across
        // schema bumps; the next refresh will repopulate the analytics.
        const defaults = getDefaultState()
        return {
          ...defaults,
          scanState: {
            ...defaults.scanState,
            enabled: parsed.scanState?.enabled ?? defaults.scanState.enabled
          }
        }
      }
      return {
        ...getDefaultState(),
        ...parsed,
        scanState: {
          ...getDefaultState().scanState,
          ...parsed.scanState
        }
      }
    } catch (error) {
      // Why: Claude usage is a local analytics feature, not primary workspace
      // state. A corrupt cache should degrade to a fresh rebuild instead of
      // preventing Orca from booting, but we leave the file on disk for debugging.
      console.error('[claude-usage] Failed to load persisted state, starting fresh:', error)
      return getDefaultState()
    }
  }

  protected writeToDisk(): Promise<void> {
    // Pretty-print preserved: humans inspect this analytics cache on disk.
    return this.writer.write(() => JSON.stringify(this.state, null, 2))
  }

  /** Await queued cache writes so quit does not drop the final snapshot. */
  flush(): Promise<void> {
    return this.writer.flush()
  }

  async setEnabled(enabled: boolean): Promise<ClaudeUsageScanState> {
    this.state.scanState.enabled = enabled
    await this.writeToDisk()
    return this.getScanState()
  }

  getScanState(): ClaudeUsageScanState {
    return {
      ...this.state.scanState,
      isScanning: this.scanPromise !== null,
      hasAnyClaudeData: this.state.sessions.length > 0 || this.state.dailyAggregates.length > 0
    }
  }

  protected abstract getCurrentWorktreeFingerprint(): Promise<string>
}
