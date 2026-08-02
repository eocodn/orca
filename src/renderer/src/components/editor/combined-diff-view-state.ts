import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import type { GitBranchChangeEntry, GitStatusEntry } from '../../../../shared/types'
import type { DiffSection } from './diff-section-types'
import { ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, type EditorPathMutationTarget } from './editor-autosave'

export type CachedCombinedDiffViewState = {
  entrySignature: string
  gitStatusSignature: string
  sections: DiffSection[]
  sectionHeights: Record<number, number>
  loadedIndices: number[]
  scrollTop: number
  sideBySide: boolean
}
export type CombinedDiffScrollThumb = {
  visible: boolean
  top: number
  height: number
}

export const combinedDiffViewStateCache = new Map<string, CachedCombinedDiffViewState>()
export const combinedDiffScrollTopCache = new Map<string, number>()
export const combinedDiffScrollAnchorCache = new Map<string, VirtualizedScrollAnchor>()

export function buildCombinedGitStatusSignature(
  sections: readonly { path: string }[],
  gitStatusEntries: readonly GitStatusEntry[]
): string {
  const sectionPaths = new Set(sections.map((section) => section.path))
  const matching = gitStatusEntries.filter((entry) => sectionPaths.has(entry.path))
  return JSON.stringify(
    matching.map((entry) => ({
      path: entry.path,
      area: entry.area,
      status: entry.status,
      added: entry.added ?? null,
      removed: entry.removed ?? null
    }))
  )
}

export function invalidateCombinedDiffCachesForRelativePath(relativePath: string): void {
  for (const [key, cached] of combinedDiffViewStateCache.entries()) {
    if (cached.sections.some((section) => section.path === relativePath)) {
      combinedDiffViewStateCache.delete(key)
    }
  }
}

export function getRetainedResolvedSnapshotEntries(sections: readonly DiffSection[]): GitStatusEntry[] {
  return sections.flatMap((section) =>
    section.area === undefined
      ? []
      : [
          {
            path: section.path,
            status: section.status as GitStatusEntry['status'],
            area: section.area,
            oldPath: section.oldPath,
            added: section.added,
            removed: section.removed
          }
        ]
  )
}

if (typeof window !== 'undefined') {
  window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, (event) => {
    const detail = (event as CustomEvent<EditorPathMutationTarget>).detail
    if (detail?.relativePath) {
      // Why: inactive combined-diff tabs are unmounted, so only a module-level cache bust stops a remount replaying stale bodies.
      invalidateCombinedDiffCachesForRelativePath(detail.relativePath)
    }
  })
}
export const COMBINED_DIFF_OVERSCAN = 5
export const COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT = 64
export const EMPTY_GIT_STATUS_ENTRIES: GitStatusEntry[] = []
export const EMPTY_GIT_BRANCH_ENTRIES: GitBranchChangeEntry[] = []
export const combinedDiffPreferences = {
  collapsed: null as boolean | null,
  sideBySide: null as boolean | null,
  fileTreeCollapsed: null as boolean | null
}
// Why: local Electron IPC has no RPC timeout; a hung git diff must become a retryable row error, not permanent "Loading...".
const COMBINED_DIFF_SECTION_LOAD_TIMEOUT_MS = 30_000

export class CombinedDiffSectionLoadTimeoutError extends Error {
  constructor() {
    super('Diff did not finish loading.')
    this.name = 'CombinedDiffSectionLoadTimeoutError'
  }
}

export function withDiffSectionLoadTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: number | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new CombinedDiffSectionLoadTimeoutError())
    }, COMBINED_DIFF_SECTION_LOAD_TIMEOUT_MS)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  })
}

export function getDiffSectionLoadErrorMessage(error: unknown): string {
  if (error instanceof CombinedDiffSectionLoadTimeoutError) {
    return 'Diff did not finish loading.'
  }
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'Unable to load diff.'
}

export function getInitialCombinedDiffSideBySide(diffDefaultView: string | undefined): boolean {
  return combinedDiffPreferences.sideBySide ?? diffDefaultView === 'side-by-side'
}

export function getInitialCombinedDiffFileTreeCollapsed(
  combinedDiffFileTreeVisibleByDefault: boolean | undefined
): boolean {
  // Why: the tree is opt-in; only an explicit saved setting should open it while settings are still loading.
  return combinedDiffPreferences.fileTreeCollapsed ?? combinedDiffFileTreeVisibleByDefault !== true
}
