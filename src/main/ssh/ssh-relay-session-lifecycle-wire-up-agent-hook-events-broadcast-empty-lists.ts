// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import {
  clearPtyOwnershipForConnection,
  getSshPtyProvider,
  unregisterSshPtyProvider
} from '../ipc/pty'
import { closeSshPtyOutputGeneration } from '../ipc/ssh-pty-output-intake-registry'
import {
  getSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import { unregisterSshGitProvider } from '../providers/ssh-git-dispatch'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'

import * as foundation from './ssh-relay-session-lifecycle-foundation'
const {
  SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE,
  SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS,
  SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS,
  SSH_PTY_REATTACH_MAX_CONCURRENCY,
  SSH_PTY_REATTACH_RETRY_JITTER_MS,
  SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS,
  SSH_SOURCE_RECOVERY_CANCELLATION_FAILED,
  expectedIdentityForLease,
  isSourceRecoveryCancellationError,
  nonNegativeSafeInteger,
  normalizeRelayGracePeriodSeconds,
  parseRecoveryComplete,
  positiveSafeInteger,
  ptyConsumerRecoveryByTarget,
  ptyConsumerRecoveryForTarget,
  sourceRecoveryCancellationError
} = foundation
type ExpectedPtyIdentity = foundation.ExpectedPtyIdentity
type PendingPtyReattach = foundation.PendingPtyReattach
type PtyConsumerRecovery = foundation.PtyConsumerRecovery
type RelaySessionState = foundation.RelaySessionState
type RemoteCliBridgeEnv = foundation.RemoteCliBridgeEnv
type SshPtyDataPayload = foundation.SshPtyDataPayload
type SshPtyExitPayload = foundation.SshPtyExitPayload
type SshPtyLease = foundation.SshPtyLease
type SshRelayAiVaultHostInfo = foundation.SshRelayAiVaultHostInfo

export const SshRelaySessionMethods8 = {
  teardownProviders(
    this: any,
    reason: 'shutdown' | 'connection_lost',
    outputGenerationReason: string = reason
  ): void {
    this.muxDisposeCleanup?.()
    this.muxDisposeCleanup = null
    for (const cleanup of this.ptyRecoveryNotificationCleanups) {
      cleanup()
    }
    this.ptyRecoveryNotificationCleanups = []
    if (this.activePtyProviderGeneration !== null) {
      const providerGeneration = this.activePtyProviderGeneration
      if (reason === 'connection_lost' && this.negotiatedPtyConsumerOwner()?.outputFlowControl) {
        this.beginPtyModelMigration(providerGeneration, outputGenerationReason)
      } else {
        closeSshPtyOutputGeneration(providerGeneration, outputGenerationReason)
      }
      this.activePtyProviderGeneration = null
    }
    this.sourceAckPublisherCleanup?.()
    this.sourceAckPublisherCleanup = null
    this.sourceCancellationPublisherCleanup?.()
    this.sourceCancellationPublisherCleanup = null
    if (this.mux && !this.mux.isDisposed()) {
      this.mux.dispose(reason)
    }
    this.mux = null
    if (reason === 'shutdown') {
      clearPtyOwnershipForConnection(this.targetId)
    }
    const ptyProvider = getSshPtyProvider(this.targetId)
    if (ptyProvider && 'dispose' in ptyProvider) {
      ;(ptyProvider as { dispose: () => void }).dispose()
    }
    const fsProvider = getSshFilesystemProvider(this.targetId)
    if (fsProvider && 'dispose' in fsProvider) {
      ;(fsProvider as { dispose: () => void }).dispose()
    }

    unregisterSshPtyProvider(this.targetId, ptyProvider)
    unregisterSshFilesystemProvider(this.targetId)
    unregisterSshGitProvider(this.targetId)
    this.sourceIdentityByRelayPtyId.clear()
    this.retiredSourceDeliveries.clear()
    this.activePtyExitPromises.clear()
    this.retiredPtyExitIncarnations.clear()
    this.retiredPtyExitOrder.clear()
    for (const pending of this.pendingPtyReattaches.values()) {
      for (const resolve of pending.recoveryWaiters) {
        resolve()
      }
    }
    this.pendingPtyReattaches.clear()
    this.ptyRecoveryRetention.clear()
  },
  async registerRelayRoots(this: any, mux: SshChannelMultiplexer): Promise<void> {
    const remoteRepos = this.store.getRepos().filter((r) => r.connectionId === this.targetId)

    for (const repo of remoteRepos) {
      mux.notify('session.registerRoot', { rootPath: repo.path })
    }

    // Why: git.listWorktrees requires the repo root to be registered first.
    await Promise.all(
      remoteRepos.map(async (repo) => {
        try {
          const worktrees = (await mux.request('git.listWorktrees', {
            repoPath: repo.path
          })) as { path: string }[]
          for (const wt of worktrees) {
            if (wt.path !== repo.path) {
              mux.notify('session.registerRoot', { rootPath: wt.path })
            }
          }
        } catch {
          // git worktree list may fail for folder-mode repos — not fatal
        }
      })
    )
  },
  broadcastEmptyLists(this: any): void {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) {
      return
    }
    win.webContents.send('ssh:port-forwards-changed', {
      targetId: this.targetId,
      forwards: []
    })
    win.webContents.send('ssh:detected-ports-changed', {
      targetId: this.targetId,
      ports: []
    })
  }
}
export type SshRelaySessionMethods8Surface = typeof SshRelaySessionMethods8
