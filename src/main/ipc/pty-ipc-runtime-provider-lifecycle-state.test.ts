import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

vi.mock('./pty-ipc-runtime-cleanup-reconciliation', () => ({
  scheduleOriginalPtyCleanupAuthorities: vi.fn(),
  schedulePendingPtyCleanupReconciliation: vi.fn()
}))
vi.mock('./pty-hidden-delivery-gate', () => ({
  clearHiddenRendererPtyDeliveryState: vi.fn(),
  isHiddenRendererPty: vi.fn(() => false)
}))
vi.mock('../runtime/terminal-model-query-authority', () => ({
  clearNativeWindowsConptyPty: vi.fn()
}))
vi.mock('../opencode/hook-service', () => ({
  openCodeHookService: { clearPty: vi.fn() }
}))
vi.mock('../pi/titlebar-extension-service', () => ({
  piTitlebarExtensionService: { clearPty: vi.fn() }
}))
vi.mock('../claude-accounts/live-pty-gate', () => ({
  markClaudePtyExited: vi.fn()
}))
vi.mock('../agent-hooks/server', () => ({
  agentHookServer: {
    clearPaneKeyAliasesForPty: vi.fn(),
    clearPaneState: vi.fn()
  }
}))
vi.mock('../agent-hooks/migration-unsupported-pty-state', () => ({
  clearMigrationUnsupportedPty: vi.fn()
}))
vi.mock('../ports/advertised-url-watcher', () => ({
  advertisedUrlWatcher: { unbindPty: vi.fn() }
}))
vi.mock('../memory/pty-registry', () => ({
  unregisterPty: vi.fn()
}))
vi.mock('../codex/codex-pane-account-registry', () => ({
  forgetCodexPaneAccount: vi.fn()
}))

const PTY_ID = 'pty-lifecycle-authority'

describe('pty provider lifecycle state', () => {
  beforeEach(() => {
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.pendingPtyIncarnationById.clear()
    ptyRuntimeState.clearedPtyLifecycleIds.clear()
  })

  it('returns the token created at the commit publication boundary', async () => {
    const { commitPtyIncarnation, stagePtyIncarnation } = await import(
      './pty-ipc-runtime-provider-lifecycle-state'
    )
    const oldToken = Symbol('old')
    ptyRuntimeState.ptyIncarnationById.set(PTY_ID, 'old-incarnation')
    ptyRuntimeState.ptyStateTokenById.set(PTY_ID, oldToken)

    stagePtyIncarnation(PTY_ID, 'new-incarnation')
    const committedToken = commitPtyIncarnation(PTY_ID, 'new-incarnation')

    expect(committedToken).toBe(ptyRuntimeState.ptyStateTokenById.get(PTY_ID))
    expect(committedToken).not.toBe(oldToken)
    expect(ptyRuntimeState.ptyIncarnationById.get(PTY_ID)).toBe('new-incarnation')
  })

  it('does not clear a same-id replacement after its token and identity change', async () => {
    const { clearProviderPtyStateIfCurrent } = await import(
      './pty-ipc-runtime-provider-lifecycle-state'
    )
    const failedToken = Symbol('failed')
    const replacementToken = Symbol('replacement')
    ptyRuntimeState.ptyStateTokenById.set(PTY_ID, replacementToken)
    ptyRuntimeState.ptyIncarnationById.set(PTY_ID, 'replacement-incarnation')
    ptyRuntimeState.ptyOwnership.set(PTY_ID, 'replacement-owner')

    expect(
      clearProviderPtyStateIfCurrent(PTY_ID, failedToken, 'failed-incarnation')
    ).toBe(false)
    expect(ptyRuntimeState.ptyStateTokenById.get(PTY_ID)).toBe(replacementToken)
    expect(ptyRuntimeState.ptyIncarnationById.get(PTY_ID)).toBe('replacement-incarnation')
    expect(ptyRuntimeState.ptyOwnership.get(PTY_ID)).toBe('replacement-owner')
  })

  it('does not clear an identity-bearing lifecycle for an identity-less failure', async () => {
    const { clearProviderPtyStateIfCurrent } = await import(
      './pty-ipc-runtime-provider-lifecycle-state'
    )
    const currentToken = Symbol('current')
    ptyRuntimeState.ptyStateTokenById.set(PTY_ID, currentToken)
    ptyRuntimeState.ptyIncarnationById.set(PTY_ID, 'current-incarnation')

    expect(clearProviderPtyStateIfCurrent(PTY_ID, currentToken)).toBe(false)
    expect(ptyRuntimeState.ptyIncarnationById.get(PTY_ID)).toBe('current-incarnation')
  })
})
