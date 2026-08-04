// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import {
  AGENT_HOOK_INSTALL_MANAGED_HOOKS_METHOD,
  isRemoteAgentHooksEnabled
} from '../../shared/agent-hook-relay'
import {
  SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD
} from '../../shared/ssh-types'
import {
  buildManagedHookDetectionCommands,
  detectedManagedHookAgents
} from '../agent-hooks/managed-hook-detection-commands'
import type { SshPtyOutputMigrationResult } from '../ipc/ssh-pty-output-model-migration'
import type { SshPtyAcceptedSourceCheckpoint } from '../ipc/ssh-pty-output-source-obligations'
import type { Store } from '../persistence'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import { execCommand } from './ssh-relay-deploy-helpers'
import { createRemoteCliInstallPlan } from './ssh-remote-cli-launcher'
import { makeRemoteDirectoryCommand } from './ssh-remote-commands'
import { isWindowsRemoteHost } from './ssh-remote-platform'

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

export const SshRelaySessionMethods6 = {
  rememberPtyConsumerRecovery(this: any, serverBuildId: string | undefined): void {
    const owner = this.negotiatedPtyConsumerOwner()
    if (!owner || !serverBuildId) {
      return
    }
    const previous = ptyConsumerRecoveryByTarget.get(this.targetId)
    ptyConsumerRecoveryByTarget.set(this.targetId, {
      clientInstanceId: this.ptyConsumerClientInstanceId,
      detached: false,
      serverBuildId,
      owner,
      checkpointsByAppPtyId:
        previous?.checkpointsByAppPtyId ?? new Map<string, SshPtyAcceptedSourceCheckpoint>(),
      modelMigrationsByAppPtyId:
        previous?.modelMigrationsByAppPtyId ??
        new Map<string, Promise<SshPtyOutputMigrationResult>>()
    })
  },
  configureRelayGraceTime(this: any,
    mux: SshChannelMultiplexer,
    graceTimeSeconds: number | undefined
  ): void {
    mux.notify(SSH_RELAY_CONFIGURE_GRACE_TIME_METHOD, {
      graceTimeSeconds: normalizeRelayGracePeriodSeconds(graceTimeSeconds)
    })
  },
  async installManagedHooksOnRemote(this: any,
    mux: SshChannelMultiplexer,
    shouldContinue?: () => boolean
  ): Promise<void> {
    if (
      !isRemoteAgentHooksEnabled() ||
      !this.areAgentStatusHooksEnabled() ||
      (shouldContinue && !shouldContinue())
    ) {
      return
    }
    if (
      this.remoteCliBridgeEnv?.hostPlatform &&
      isWindowsRemoteHost(this.remoteCliBridgeEnv.hostPlatform)
    ) {
      // Why: managed hook installers emit POSIX-only scripts/paths; Windows remotes rely on relay-injected env + plugin overlays instead.
      return
    }

    try {
      const store = this.store as { getSettings?: Store['getSettings'] }
      const detected = (await mux.request('preflight.detectAgents', {
        commands: buildManagedHookDetectionCommands(store.getSettings?.() ?? null, 'linux')
      })) as { agents?: unknown }
      const agents = detectedManagedHookAgents(detected?.agents)
      if (agents.length === 0 || (shouldContinue && !shouldContinue())) {
        return
      }
      const hostKeyFingerprint = this.requireReadyConnection().getHostKeyFingerprint?.()
      const params = {
        ...(hostKeyFingerprint ? { hostKeyFingerprint } : {}),
        agents
      }
      const result = (await mux.request(AGENT_HOOK_INSTALL_MANAGED_HOOKS_METHOD, params)) as {
        errors?: unknown
      }
      if (typeof result.errors === 'number' && result.errors > 0) {
        console.warn(
          `[ssh-relay-session] ${result.errors} remote managed hook installers failed for ${this.targetId}`
        )
      }
    } catch (error) {
      // Why: teardown routinely cancels this best-effort request; only warn for
      // installer failures that survive the connection lifecycle.
      const code = (error as { code?: unknown })?.code
      if (
        code === -32601 ||
        code === 'CONNECTION_LOST' ||
        code === 'DISPOSED' ||
        mux.isDisposed()
      ) {
        return
      }
      console.warn(
        `[ssh-relay-session] relay managed hook install failed for ${this.targetId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  },
  async installRemoteOrcaCliLauncher(this: any): Promise<void> {
    if (!this.remoteCliBridgeEnv) {
      return
    }
    const { binDir, hostPlatform } = this.remoteCliBridgeEnv
    const plan = createRemoteCliInstallPlan(this.remoteCliBridgeEnv)
    const conn = this.requireReadyConnection()
    await execCommand(conn, makeRemoteDirectoryCommand(hostPlatform, binDir), {
      wrapCommand: !isWindowsRemoteHost(hostPlatform)
    })
    if (typeof conn.writeFile === 'function') {
      for (const file of plan.files) {
        await conn.writeFile(file.path, file.contents, { hostPlatform })
      }
    } else {
      const sftp = await conn.sftp()
      try {
        for (const file of plan.files) {
          await new Promise<void>((resolve, reject) => {
            const ws = sftp.createWriteStream(file.path)
            sftp.once('error', reject)
            ws.once('close', resolve)
            ws.once('error', reject)
            ws.end(file.contents)
          })
        }
      } finally {
        sftp.end()
      }
    }
    for (const command of plan.postWriteCommands) {
      await execCommand(conn, command, { wrapCommand: !isWindowsRemoteHost(hostPlatform) })
    }
  }
}
export type SshRelaySessionMethods6Surface = typeof SshRelaySessionMethods6
