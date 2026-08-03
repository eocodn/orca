import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { rememberPaneKeyForPty } from './pty-ipc-runtime-pane-state'
import { isCurrentPtyExit } from './pty-ipc-runtime-provider-routing'

const { clearProviderPtyStateMock } = vi.hoisted(() => ({
  clearProviderPtyStateMock: vi.fn()
}))
vi.mock('./pty-ipc-runtime-provider-lifecycle-state', () => ({
  clearProviderPtyState: clearProviderPtyStateMock
}))

const PTY_ID = 'pty-publication-restore'
const NEWER_PTY_ID = 'pty-publication-newer-owner'
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
    ptyRuntimeState.clearedPtyLifecycleIds.clear()
  })

  afterEach(() => {
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.pendingPtyIncarnationById.clear()
    ptyRuntimeState.ptySizes.clear()
    ptyRuntimeState.ptyPaneKey.clear()
    ptyRuntimeState.paneKeyPtyId.clear()
    ptyRuntimeState.clearedPtyLifecycleIds.clear()
    clearProviderPtyStateMock.mockClear()
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

  it('does not resurrect a stale PTY over a newer pane owner', async () => {
    const { restorePtyPublication, snapshotPtyPublication } = await import(
      './pty-ipc-runtime-cleanup-reconciliation'
    )

    rememberPaneKeyForPty(PTY_ID, OLD_PANE_KEY)
    const snapshot = snapshotPtyPublication(PTY_ID)
    rememberPaneKeyForPty(NEWER_PTY_ID, OLD_PANE_KEY)

    restorePtyPublication(snapshot)

    expect(ptyRuntimeState.ptyPaneKey.get(PTY_ID)).toBeUndefined()
    expect(ptyRuntimeState.ptyPaneKey.get(NEWER_PTY_ID)).toBe(OLD_PANE_KEY)
    expect(ptyRuntimeState.paneKeyPtyId.get(OLD_PANE_KEY)).toBe(NEWER_PTY_ID)
  })

  it('preserves a newer state token when a failed snapshot shares the replacement incarnation', async () => {
    const { clearSupersededPtyLifecycle } = await import(
      './pty-ipc-runtime-cleanup-reconciliation'
    )
    const failedStateToken = Symbol('failed-state')
    const newerStateToken = Symbol('replacement-state')
    const incarnationId = 'same-id-replacement-incarnation'
    ptyRuntimeState.ptyIncarnationById.set(PTY_ID, incarnationId)
    ptyRuntimeState.ptyStateTokenById.set(PTY_ID, newerStateToken)

    clearSupersededPtyLifecycle(PTY_ID, {
      provider: {} as never,
      providerConnectionId: null,
      providerGeneration: undefined,
      incarnationId,
      failedStateToken,
      publicationSnapshot: {
        id: PTY_ID,
        ownershipPresent: false,
        ownership: undefined,
        incarnation: incarnationId,
        stateToken: failedStateToken,
        size: undefined,
        paneKey: undefined,
        paneKeyReverseOwner: undefined
      }
    })

    expect(clearProviderPtyStateMock).not.toHaveBeenCalled()
    expect(ptyRuntimeState.ptyStateTokenById.get(PTY_ID)).toBe(newerStateToken)
    expect(ptyRuntimeState.ptyIncarnationById.get(PTY_ID)).toBe(incarnationId)
  })

  it('allows a legitimate identity-less exit after restoring a lifecycle fence', async () => {
    const { restorePtyPublication, snapshotPtyPublication } = await import(
      './pty-ipc-runtime-cleanup-reconciliation'
    )
    const snapshot = snapshotPtyPublication(PTY_ID)
    ptyRuntimeState.clearedPtyLifecycleIds.add(PTY_ID)

    restorePtyPublication(snapshot)

    expect(ptyRuntimeState.clearedPtyLifecycleIds.has(PTY_ID)).toBe(false)
    expect(isCurrentPtyExit({ id: PTY_ID })).toBe(true)
  })
})
