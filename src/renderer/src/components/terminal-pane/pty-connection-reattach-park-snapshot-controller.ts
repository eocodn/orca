import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import {
  decideSshReattachPaintSource,
  memoizeSshReattachModelSnapshotProbe,
  resolveSshReattachModelSnapshotWithTimeout,
  shouldFetchSshReattachModelSnapshot
} from './ssh-reattach-model-restore'
import type { PtyBufferSnapshot } from './pty-transport-types'

type ReattachParkSnapshotControllerOptions = {
  consumeParkMountEvidence: () => boolean
  isCurrent: () => boolean
  isRemoteRuntimePtyId: (ptyId: string) => boolean
  isSshParkingEnabled: () => boolean
  getMainBufferSnapshot: (ptyId: string) => Promise<PtyBufferSnapshot | null>
  serializeRendererSnapshot: (ptyId: string) => Promise<PtyBufferSnapshot | null>
}

type ReattachParkSnapshotSelectArgs = {
  ptyId: string
  isReattach: boolean
  hasStructuralReplay: boolean
  hasRelayReplay: boolean
}

type ReattachParkSnapshotSelection =
  | { status: 'selected'; modelSnapshot: PtyBufferSnapshot | null }
  | { status: 'stale' }

export function createPtyConnectionReattachParkSnapshotController(
  options: ReattachParkSnapshotControllerOptions
) {
  return {
    select(
      args: ReattachParkSnapshotSelectArgs
    ): ReattachParkSnapshotSelection | Promise<ReattachParkSnapshotSelection> {
      const remoteRuntime = options.isRemoteRuntimePtyId(args.ptyId)
      const revealFollowsTerminalPark =
        options.consumeParkMountEvidence() && (args.isReattach || remoteRuntime)
      if (!revealFollowsTerminalPark) {
        return { status: 'selected', modelSnapshot: null }
      }

      const selectParked = async (): Promise<ReattachParkSnapshotSelection> => {
        const fetchSshMainModelSnapshot = memoizeSshReattachModelSnapshotProbe(
          async (): Promise<PtyBufferSnapshot | null> => {
            const sshParkingEnabled = options.isSshParkingEnabled()
            if (!shouldFetchSshReattachModelSnapshot({ ptyId: args.ptyId, sshParkingEnabled })) {
              return null
            }
            const snapshot = await resolveSshReattachModelSnapshotWithTimeout(
              options.getMainBufferSnapshot(args.ptyId)
            )
            if (
              !snapshot ||
              decideSshReattachPaintSource({
                ptyId: args.ptyId,
                sshParkingEnabled,
                snapshot
              }) !== 'main-model-snapshot'
            ) {
              return null
            }
            return snapshot
          }
        )

        let modelSnapshot: PtyBufferSnapshot | null = null
        if (!args.hasStructuralReplay || remoteRuntime) {
          if (parseAppSshPtyId(args.ptyId)) {
            modelSnapshot = await fetchSshMainModelSnapshot()
          } else {
            try {
              modelSnapshot = await options.serializeRendererSnapshot(args.ptyId)
            } catch {
              modelSnapshot = null
            }
          }
          if (!options.isCurrent()) {
            return { status: 'stale' }
          }
        }

        // Why: a parked local SSH relay tail is bounded; prefer the authoritative model when available.
        if (args.hasRelayReplay && modelSnapshot === null && !remoteRuntime) {
          modelSnapshot = await fetchSshMainModelSnapshot()
          if (!options.isCurrent()) {
            return { status: 'stale' }
          }
        }
        return { status: 'selected', modelSnapshot }
      }
      return selectParked()
    }
  }
}
