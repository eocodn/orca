import type { SafeFitContinuationHandle } from '@/lib/pane-manager/pane-tree-ops'

export function createPtyConnectionPendingFitController<
  THandle extends Pick<SafeFitContinuationHandle, 'cancel'> = SafeFitContinuationHandle
>() {
  let hidden: THandle | null = null
  let reattach: THandle | null = null

  return {
    setHidden(handle: THandle): void {
      hidden = handle
    },
    setReattach(handle: THandle): void {
      reattach = handle
    },
    clearHiddenIf(handle: THandle): void {
      if (hidden === handle) {
        hidden = null
      }
    },
    clearReattachIf(handle: THandle): void {
      if (reattach === handle) {
        reattach = null
      }
    },
    cancelHidden(): void {
      hidden?.cancel()
      hidden = null
    },
    cancelAll(): void {
      hidden?.cancel()
      hidden = null
      reattach?.cancel()
      reattach = null
    },
    clearAll(): void {
      hidden = null
      reattach = null
    }
  }
}
