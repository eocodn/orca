import { useAppStore } from '@/store'
import { joinPath } from '@/lib/path'
import { getRecentSelfWrite } from '@/components/editor/editor-self-write-registry'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { markFileChangedOnDisk } from '@/components/editor/editor-changed-on-disk-mark'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import type { ExternalWatchNotification, WatchedTarget } from './editor-external-watch-targets'
const inFlightEchoVerificationReads = new Map<string, ReturnType<typeof readRuntimeFileContent>>()

// Why: one save echo can arrive as a burst of payloads; share the in-flight full-file read so concurrent payloads for the same file don't stack duplicate reads.
export function readFileForEchoVerification(args: {
  runtimeEnvironmentId: string | null | undefined
  filePath: string
  relativePath: string
  worktreeId: string | null | undefined
  connectionId: string | undefined
  expectedExternalSshTargetId?: string
}): ReturnType<typeof readRuntimeFileContent> {
  const key = [
    args.runtimeEnvironmentId ?? '',
    args.connectionId ?? '',
    args.expectedExternalSshTargetId ?? '',
    args.filePath
  ].join('::')
  let pending = inFlightEchoVerificationReads.get(key)
  if (!pending) {
    pending = readRuntimeFileContent({
      settings: args.runtimeEnvironmentId
        ? { activeRuntimeEnvironmentId: args.runtimeEnvironmentId }
        : null,
      filePath: args.filePath,
      relativePath: args.relativePath,
      worktreeId: args.worktreeId ?? undefined,
      connectionId: args.connectionId,
      expectedExternalSshTargetId: args.expectedExternalSshTargetId
    })
    inFlightEchoVerificationReads.set(key, pending)
    const release = (): void => {
      if (inFlightEchoVerificationReads.get(key) === pending) {
        inFlightEchoVerificationReads.delete(key)
      }
    }
    pending.then(release, release)
  }
  return pending
}

function markTabsChangedOnDisk(fileIds: string[], connectionId: string | undefined): void {
  const state = useAppStore.getState()
  for (const fileId of fileIds) {
    const file = state.openFiles.find((f) => f.id === fileId)
    // Why: echo verification resolves async — the tab may have been closed since, so only mark files still open.
    if (file) {
      markFileChangedOnDisk(state, file, { connectionId, origin: 'live' })
    }
  }
}

export function scheduleChangedOnDiskMark(
  target: WatchedTarget,
  notification: ExternalWatchNotification,
  fileIds: string[]
): void {
  if (fileIds.length === 0) {
    return
  }
  const absolutePath = joinPath(notification.worktreePath, notification.relativePath)
  const recentSelfWrite = getRecentSelfWrite(absolutePath, target.runtimeEnvironmentId)
  // Why: the fs event may be the echo of Orca's own save — verify disk really differs from our last write before showing a "changed on disk" banner.
  if (!recentSelfWrite || recentSelfWrite.content === null) {
    markTabsChangedOnDisk(fileIds, target.connectionId)
    return
  }
  void readFileForEchoVerification({
    runtimeEnvironmentId: target.runtimeEnvironmentId,
    filePath: absolutePath,
    relativePath: notification.relativePath,
    worktreeId: notification.worktreeId,
    connectionId: target.connectionId
  })
    .then((result) => {
      if (result.isBinary || result.content !== recentSelfWrite.content) {
        markTabsChangedOnDisk(fileIds, target.connectionId)
      }
    })
    .catch(() => {
      // Why: unreadable disk state can't disprove an external change — keep the conflict visible rather than risk a silent overwrite.
      markTabsChangedOnDisk(fileIds, target.connectionId)
    })
}

// Per-file generation so a newer echo-verify read supersedes an older one — overlapping reads can't clear each other's autosave gate or apply a stale verdict.
const liveMoveVerifyGeneration = new Map<string, number>()
let liveMoveVerifyCounter = 0

type LiveMoveVerifyCandidate = {
  fileId: string
  baseline: string | undefined
  generation: number
  /** The move that installed the provenance; a newer move re-homing the tab supersedes this verification, even across a rekey. */
  operationId?: string
}

// Resolve one candidate against the disk read (`diskSignature` null = binary/unreadable).
// Fails CLOSED: anything but a proven baseline match surfaces the conflict, so a real external write is never swallowed.
function resolveLiveMoveVerification(
  candidate: LiveMoveVerifyCandidate,
  diskSignature: string | null,
  connectionId: string | undefined,
  consumeProvenance: boolean
): void {
  const { fileId, baseline, generation, operationId } = candidate
  if (liveMoveVerifyGeneration.get(fileId) !== generation) {
    return // a newer verification owns this tab and its autosave gate
  }
  liveMoveVerifyGeneration.delete(fileId)
  const state = useAppStore.getState()
  state.setPendingLiveDiskVerification(fileId, false)
  const file = state.openFiles.find((f) => f.id === fileId)
  // Skip if the interim moved on: tab resolved, baseline advanced, or a different move replaced the provenance we captured.
  if (
    !file ||
    !file.isDirty ||
    file.externalMutation === 'changed' ||
    file.lastKnownDiskSignature !== baseline ||
    (operationId !== undefined && file.pendingSelfMoveEcho?.operationId !== operationId)
  ) {
    return
  }
  // Consume only when a real watcher event drove this check. The proactive post-commit verify must LEAVE the provenance,
  // else the destination fs event (on FSEvents/SSH it lands after the faster local read) would raise a false conflict banner.
  if (consumeProvenance) {
    state.clearSelfMoveEcho(fileId)
  }
  const isMoveEcho = baseline !== undefined && diskSignature === baseline
  if (!isMoveEcho) {
    markFileChangedOnDisk(state, file, { connectionId, origin: 'live' })
  }
}

/**
 * Verify tabs whose destination echo was LATCHED before the rekey installed them: the coordinator calls this
 * after a successful move so a pre-rekey event isn't lost and the autosave gate can't strand.
 */
export function verifyLatchedMoveDestinations(
  worktreePath: string,
  connectionId: string | undefined,
  fileIds: readonly string[]
): void {
  const state = useAppStore.getState()
  const gated = fileIds.filter(
    (id) => state.openFiles.find((f) => f.id === id)?.pendingSelfMoveEcho
  )
  if (gated.length === 0) {
    return
  }
  // consumeProvenance:false — safety net; leave the provenance so a destination watcher event after this read still reads as an echo.
  // (Owner/worktree are resolved per-tab inside the read; worktreePath is unused, each tab reads at its own filePath.)
  scheduleSelfMoveEchoVerification(
    { worktreeId: '', worktreePath, connectionId, runtimeEnvironmentId: null },
    gated,
    false
  )
}

// Settle each dirty tab by content identity: the move's own echo leaves disk == the tab's baseline, a genuine external write does not.
// Autosave is suspended synchronously first so a write landing mid-read can't be overwritten before we decide.
export function scheduleSelfMoveEchoVerification(
  target: WatchedTarget,
  fileIds: string[],
  consumeProvenance: boolean
): void {
  if (fileIds.length === 0) {
    return
  }
  const state = useAppStore.getState()
  for (const fileId of fileIds) {
    const file = state.openFiles.find((f) => f.id === fileId)
    if (!file || !file.isDirty || file.externalMutation === 'changed') {
      continue
    }
    const generation = ++liveMoveVerifyCounter
    liveMoveVerifyGeneration.set(fileId, generation)
    state.setPendingLiveDiskVerification(fileId, true)
    const candidate: LiveMoveVerifyCandidate = {
      fileId,
      baseline: file.lastKnownDiskSignature,
      generation,
      operationId: file.pendingSelfMoveEcho?.operationId
    }
    // Read the tab's OWN absolute path: a cross-worktree/floating tab's relativePath is relative to its own root (can be `../…`),
    // never join it onto another worktree's path. readFileForEchoVerification dedups concurrent same-path reads, so siblings share one.
    void readFileForEchoVerification({
      runtimeEnvironmentId: file.runtimeEnvironmentId?.trim() || target.runtimeEnvironmentId,
      filePath: file.filePath,
      relativePath: file.relativePath,
      worktreeId: file.worktreeId,
      connectionId: target.connectionId,
      expectedExternalSshTargetId: file.externalSshTargetId
    })
      .then((result) => {
        const diskSignature = result.isBinary ? null : getDiskBaselineSignature(result.content)
        resolveLiveMoveVerification(
          candidate,
          diskSignature,
          target.connectionId,
          consumeProvenance
        )
      })
      .catch(() =>
        resolveLiveMoveVerification(candidate, null, target.connectionId, consumeProvenance)
      )
  }
}
