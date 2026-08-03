import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { rememberPaneKeyForPty } from './pty-ipc-runtime-pane-state'

vi.mock('./pty-ipc-runtime-provider-lifecycle-state', () => ({
  clearProviderPtyState: vi.fn()
}))

const PTY_ID = 'pty-publication-restore'
const OLD_PANE_KEY = makePaneKey('tab-old', '11111111-1111-4111-8111-111111111111')
const NEW_PANE_KEY = makePaneKey('tab-new', '22222222-2222-4222-8222-222222222222')

describe('pty publication cleanup reconciliation', () => {
  beforeEach(() => {
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.pendingPtyIncarnationById.clear()
    ptyRuntimeState.ptySizes.clear()
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
  })

  afterEach(() => {
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.pendingPtyIncarnationById.clear()
    ptyRuntimeState.ptySizes.clear()
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
  })

  it('restores the prior PTY pane publication and removes the failed reverse mapping', async () => {
    const { restorePtyPublication, snapshotPtyPublication } = await import(
      './pty-ipc-runtime-cleanup-reconciliation'
    )

    rememberPaneKeyForPty(PTY_ID, OLD_PANE_KEY)
    const snapshot = snapshotPtyPublication(PTY_ID)
    rememberPaneKeyForPty(PTY_ID, NEW_PANE_KEY)

    restorePtyPublication(snapshot)

    expect(ptyRuntimeState.ptyPaneKey.get(PTY_ID)).toBe(OLD_PANE_KEY)
    expect(ptyRuntimeState.paneKeyPtyId.get(OLD_PANE_KEY)).toBe(PTY_ID)
    expect(ptyRuntimeState.paneKeyPtyId.get(NEW_PANE_KEY)).toBeUndefined()
  })
})
