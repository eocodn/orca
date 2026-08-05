// Why: one place derives the path-free analytics shape for the changed-on-disk
// conflict flow (issue #7265), so the three marking sites and the banner
// actions cannot drift on enum values. Measures false-banner rates per
// transport and which resolution users actually pick.
import { getConnectionIdForFile } from '@/lib/connection-context'
import type { OpenFile } from '@/store/slices/editor'

type ConflictSurface = 'edit' | 'unstaged-diff'
type ConflictTransport = 'local' | 'ssh' | 'runtime'

export type ExternalChangeConflictAction =
  | 'reload'
  | 'keep'
  | 'compare'
  | 'undo_reload'
  | 'save_overwrite'

function conflictSurface(file: Pick<OpenFile, 'mode'>): ConflictSurface {
  return file.mode === 'edit' ? 'edit' : 'unstaged-diff'
}

export function conflictTransport(
  connectionId: string | undefined,
  runtimeEnvironmentId: string | null | undefined
): ConflictTransport {
  if (connectionId) {
    return 'ssh'
  }
  if (runtimeEnvironmentId?.trim()) {
    return 'runtime'
  }
  return 'local'
}

export function trackExternalChangeConflictShown(
  file: Pick<OpenFile, 'mode' | 'runtimeEnvironmentId'>,
  options: { connectionId: string | undefined; origin: 'live' | 'restore' }
): void {}

export function trackExternalChangeConflictAction(
  file: Pick<OpenFile, 'mode' | 'worktreeId' | 'filePath' | 'runtimeEnvironmentId'>,
  action: ExternalChangeConflictAction
): void {}
