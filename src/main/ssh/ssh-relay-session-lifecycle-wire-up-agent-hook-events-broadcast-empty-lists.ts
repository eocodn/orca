// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import {
  AGENT_HOOK_NOTIFICATION_METHOD,
  AGENT_HOOK_REQUEST_REPLAY_METHOD,
  isRemoteAgentHooksEnabled
} from '../../shared/agent-hook-relay'
import { agentHookServer } from '../agent-hooks/server'
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
  wireUpAgentHookEvents(this: any, mux: SshChannelMultiplexer): void {
    if (!isRemoteAgentHooksEnabled()) {
      return
    }
    // Why: capture the disposer so teardownProviders can release this handler and re-wiring can't double-register it.
    this.muxNotificationCleanup?.()
    this.muxNotificationCleanup = mux.onNotification((method, params) => {
      if (method !== AGENT_HOOK_NOTIFICATION_METHOD) {
        return
      }
      const envelope = params as {
        paneKey?: unknown
        launchToken?: unknown
        tabId?: unknown
        worktreeId?: unknown
        env?: unknown
        version?: unknown
        hasExplicitPrompt?: unknown
        promptInteractionKey?: unknown
        hookEventName?: unknown
        toolUseId?: unknown
        toolAgentId?: unknown
        toolAgentType?: unknown
        isReplay?: unknown
        providerSession?: unknown
        providerSessionOnly?: unknown
        payload?: unknown
      }
      if (typeof envelope.paneKey !== 'string') {
        return
      }
      // Why: forward env/version verbatim so cross-build warn-once diagnostics fire on remote events too (agent-status-over-ssh.md §3).
      agentHookServer.ingestRemote(
        {
          paneKey: envelope.paneKey,
          launchToken: typeof envelope.launchToken === 'string' ? envelope.launchToken : undefined,
          tabId: typeof envelope.tabId === 'string' ? envelope.tabId : undefined,
          worktreeId: typeof envelope.worktreeId === 'string' ? envelope.worktreeId : undefined,
          env: typeof envelope.env === 'string' ? envelope.env : undefined,
          version: typeof envelope.version === 'string' ? envelope.version : undefined,
          hasExplicitPrompt: envelope.hasExplicitPrompt === true ? true : undefined,
          promptInteractionKey:
            typeof envelope.promptInteractionKey === 'string'
              ? envelope.promptInteractionKey
              : undefined,
          hookEventName:
            typeof envelope.hookEventName === 'string' ? envelope.hookEventName : undefined,
          toolUseId: typeof envelope.toolUseId === 'string' ? envelope.toolUseId : undefined,
          toolAgentId: typeof envelope.toolAgentId === 'string' ? envelope.toolAgentId : undefined,
          toolAgentType:
            typeof envelope.toolAgentType === 'string' ? envelope.toolAgentType : undefined,
          isReplay: envelope.isReplay === true ? true : undefined,
          providerSession: envelope.providerSession,
          providerSessionOnly: envelope.providerSessionOnly === true ? true : undefined,
          payload: envelope.payload
        },
        this.targetId
      )
    })

    // Why: request replay of cached paneKeys only after the handler is wired, so replayed events can't arrive before we subscribe. Best-effort.
    void mux.request(AGENT_HOOK_REQUEST_REPLAY_METHOD).catch((err) => {
      const code = (err as { code?: unknown })?.code
      if (code === -32601 || code === 'CONNECTION_LOST' || code === 'DISPOSED') {
        return
      }
      if (mux.isDisposed()) {
        return
      }
      // Why: suppress the warn when a normal teardown rejects the in-flight request, so reconnect cycles aren't noisy.
      if (mux.isDisposed()) {
        return
      }
      console.warn(
        `[ssh-relay-session] agent_hook.requestReplay failed for ${this.targetId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    })
  },
  teardownProviders(
    this: any,
    reason: 'shutdown' | 'connection_lost',
    outputGenerationReason: string = reason
  ): void {
    this.muxDisposeCleanup?.()
    this.muxDisposeCleanup = null
    this.muxNotificationCleanup?.()
    this.muxNotificationCleanup = null
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
    } else {
      // Why: handlers detached above, so no late event can re-stamp status between this clear and reconnect replay.
      agentHookServer.clearStatusEntriesForConnection(this.targetId)
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
