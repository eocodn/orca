// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { isAgentStatusHooksEnabled } from '../agent-hooks/managed-agent-hook-controls'
import { AGENT_HOOK_INSTALL_PLUGINS_METHOD, isRemoteAgentHooksEnabled } from '../../shared/agent-hook-relay'
import { _internals as openCodeInternals } from '../opencode/hook-service'
import { getPiAgentStatusExtensionSource } from '../pi/agent-status-extension-source'
import { notifyRemoteWorkspaceHandlers } from '../ipc/remote-workspace-events'
import type { Store } from '../persistence'
import { runRemoteOrcaCli } from './ssh-remote-orca-cli'
import {
  acknowledgeRemoteOrcaCliPostOutput,
  parseRemoteOrcaCliPostOutput
} from './ssh-remote-orchestration-post-output'

import * as foundation from './ssh-relay-session-lifecycle-foundation'
const { SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE, SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS, SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS, SSH_PTY_REATTACH_MAX_CONCURRENCY, SSH_PTY_REATTACH_RETRY_JITTER_MS, SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS, SSH_SOURCE_RECOVERY_CANCELLATION_FAILED, expectedIdentityForLease, isSourceRecoveryCancellationError, nonNegativeSafeInteger, normalizeRelayGracePeriodSeconds, parseRecoveryComplete, positiveSafeInteger, ptyConsumerRecoveryByTarget, ptyConsumerRecoveryForTarget, sourceRecoveryCancellationError } = foundation
type ExpectedPtyIdentity = foundation.ExpectedPtyIdentity
type PendingPtyReattach = foundation.PendingPtyReattach
type PtyConsumerRecovery = foundation.PtyConsumerRecovery
type RelaySessionState = foundation.RelaySessionState
type RemoteCliBridgeEnv = foundation.RemoteCliBridgeEnv
type SshPtyDataPayload = foundation.SshPtyDataPayload
type SshPtyExitPayload = foundation.SshPtyExitPayload
type SshPtyLease = foundation.SshPtyLease
type SshRelayAiVaultHostInfo = foundation.SshRelayAiVaultHostInfo

export const SshRelaySessionMethods7 = {
  wireUpRemoteOrcaCli(this: any, mux: SshChannelMultiplexer, connectionIncarnation: string): void {
    mux.onRequest('orca.cli', async (params) => {
      if (!this.runtime) {
        throw new Error('Orca runtime is unavailable')
      }
      const argv = Array.isArray(params.argv)
        ? params.argv.filter((item): item is string => typeof item === 'string')
        : []
      const cwd = typeof params.cwd === 'string' && params.cwd.length > 0 ? params.cwd : '/'
      const rawEnv = params.env
      const env =
        rawEnv && typeof rawEnv === 'object' && !Array.isArray(rawEnv)
          ? Object.fromEntries(
              Object.entries(rawEnv).filter(
                (entry): entry is [string, string] =>
                  typeof entry[0] === 'string' && typeof entry[1] === 'string'
              )
            )
          : {}
      const stdin = typeof params.stdin === 'string' ? params.stdin : undefined
      const runtimeAuthority = this.runtime.registerOrchestrationCompatibilitySshAttachment(
        this.targetId,
        connectionIncarnation
      )
      this.activeCompatibilityAttachmentIds.add(runtimeAuthority.attachmentId)
      try {
        return await runRemoteOrcaCli(this.runtime, {
          argv,
          cwd,
          env,
          ...(stdin !== undefined ? { stdin } : {}),
          runtimeAuthority
        })
      } finally {
        this.activeCompatibilityAttachmentIds.delete(runtimeAuthority.attachmentId)
        this.runtime.releaseOrchestrationCompatibilitySshAttachment(runtimeAuthority.attachmentId)
      }
    })
    mux.onRequest('orca.cli.postOutput', async (params) => {
      if (!this.runtime) {
        throw new Error('Orca runtime is unavailable')
      }
      const rawEnv = params.env
      const env =
        rawEnv && typeof rawEnv === 'object' && !Array.isArray(rawEnv)
          ? Object.fromEntries(
              Object.entries(rawEnv).filter(
                (entry): entry is [string, string] =>
                  typeof entry[0] === 'string' && typeof entry[1] === 'string'
              )
            )
          : {}
      const runtimeAuthority = this.runtime.registerOrchestrationCompatibilitySshAttachment(
        this.targetId,
        connectionIncarnation
      )
      this.activeCompatibilityAttachmentIds.add(runtimeAuthority.attachmentId)
      try {
        await acknowledgeRemoteOrcaCliPostOutput(this.runtime, {
          postOutput: parseRemoteOrcaCliPostOutput(params.postOutput),
          env,
          runtimeAuthority
        })
        return { acknowledged: true }
      } finally {
        this.activeCompatibilityAttachmentIds.delete(runtimeAuthority.attachmentId)
        this.runtime.releaseOrchestrationCompatibilitySshAttachment(runtimeAuthority.attachmentId)
      }
    })
  },
  async installPluginsOnRelay(this: any, mux: SshChannelMultiplexer): Promise<void> {
    if (!isRemoteAgentHooksEnabled() || !this.areAgentStatusHooksEnabled()) {
      return
    }
    try {
      await mux.request(AGENT_HOOK_INSTALL_PLUGINS_METHOD, {
        opencodePluginSource: openCodeInternals.getOpenCodePluginSource(),
        piExtensionSource: getPiAgentStatusExtensionSource('pi'),
        ompExtensionSource: getPiAgentStatusExtensionSource('omp')
      })
    } catch (err) {
      // Why: -32601 = older relay without the handler; CONNECTION_LOST/DISPOSED = routine mid-flight teardown — swallow both.
      const code = (err as { code?: unknown })?.code
      if (code === -32601 || code === 'CONNECTION_LOST' || code === 'DISPOSED') {
        return
      }
      if (mux.isDisposed()) {
        return
      }
      console.warn(
        `[ssh-relay-session] agent_hook.installPlugins failed for ${this.targetId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  },
  areAgentStatusHooksEnabled(this: any): boolean {
    const store = this.store as { getSettings?: Store['getSettings'] }
    return isAgentStatusHooksEnabled(store.getSettings?.())
  },
  wireUpRemoteWorkspaceEvents(this: any, mux: SshChannelMultiplexer): void {
    mux.onNotification((method, params) => {
      notifyRemoteWorkspaceHandlers(this.targetId, method, params)
    })
  }
}
export type SshRelaySessionMethods7Surface = typeof SshRelaySessionMethods7
