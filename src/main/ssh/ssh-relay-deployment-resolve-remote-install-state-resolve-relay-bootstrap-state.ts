import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { SshConnection } from './ssh-connection'
import type { RelayPlatform } from './relay-protocol'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import {
  waitForSentinel,
  execCommand,
  isUnconfirmedSshCommandTermination
} from './ssh-relay-deploy-helpers'
import { uploadRelayDirectory, writeRelayFile } from './ssh-relay-install-transfers'
import { writeRelayEndpointCredential } from './ssh-relay-endpoint-credential'
import {
  createRelayInstallMarkerCommand,
  createRelayInstallNamespace,
  makeRelayInstallDirectoryCommand,
  relayHomeRelativeDir,
  relaySftpNamespaceMapping,
  type RelayInstallNamespace
} from './ssh-relay-install-namespace'
import { resolveRemoteNodePath } from './ssh-remote-node-resolution'
import {
  readLocalFullVersion,
  computeRemoteRelayDir,
  isRelayAlreadyInstalled,
  finalizeInstall,
  abandonInstall,
  gcOldRelayVersions
} from './ssh-relay-versioned-install'
import { acquireInstallLock } from './ssh-relay-install-lock'
import { tryAcquireRelayRepairLock } from './ssh-relay-repair-lock'
import {
  releaseRelayGcClaimWithRetry,
  tryAcquireRelayGcClaim,
  waitForRelayGcClaimRelease
} from './ssh-relay-gc-claim'
import { NATIVE_DEPS_COMMAND_TIMEOUT_MS, RELAY_DEPLOY_TIMEOUT_MS } from './ssh-relay-deploy-timing'
import { createSshOperationAbortError, shellEscape } from './ssh-connection-utils'
import {
  probeBuildToolchain,
  formatMissingToolchainError,
  formatSkippedNodePtyWarning,
  shouldProbeBuildToolchainAfterNativeDepsFailure
} from './ssh-relay-build-toolchain'
import {
  commandWithNodePath,
  makeRemoteExecutableCommand,
  readRemoteHomeCommand,
  removeRemoteFileCommand
} from './ssh-remote-commands'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from './ssh-remote-platform'
import { detectRemoteHostPlatform } from './ssh-remote-platform-detection'
import { powerShellCommand, powerShellLiteral, powerShellNativeArg } from './ssh-remote-powershell'
import { relaySocketNameForInstanceId } from './ssh-relay-instance-id'
import { isSshSessionLimitError } from './ssh-session-limit-error'
import {
  isWindowsRelayPipePath,
  relayEndpointForHost,
  relayHookEndpointDirForHost,
  windowsActivePipeMarkerPath,
  windowsRelayFallbackSocketName
} from './ssh-relay-endpoints'
import {
  DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  MAX_SSH_RELAY_GRACE_PERIOD_SECONDS,
  MIN_SSH_RELAY_GRACE_PERIOD_SECONDS
} from '../../shared/ssh-types'

import { type RelayDeployResult, RelayDirectoryGcConflictError, execHostCommand, deployAndLaunchRelay } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { isAbortError, deployAndLaunchRelayInner, deployAndLaunchRelayAttempt, uploadRelay } from './ssh-relay-deployment-is-abort-error-upload-relay'
import { createInstallNamespaceIfSupported, NODE_PTY_VERSION, NODE_PTY_CONSOLE_LIST_PATCH_FILENAME, RELAY_NATIVE_DEPS } from './ssh-relay-deployment-create-install-namespace-if-supported-relay-native-deps'
import { type RelayNativeDepName, RELAY_NATIVE_DEP_NAMES, NATIVE_DEPS_MISSING_PREFIX, RELAY_NATIVE_DEP_SCRIPT_ALLOWLIST } from './ssh-relay-deployment-relay-native-dep-name-relay-native-dep-script-allowlist'
import { nativeDepsProbeJs, missingNativeDepsFromProbe, probeRequiredNativeDeps, repairInstalledNativeDeps } from './ssh-relay-deployment-native-deps-probe-js-repair-installed-native-deps'
import { createRelayLaunchNamespace, acquireRelayLaunchGcFence, installNativeDeps, resetNativeDepsCommand } from './ssh-relay-deployment-create-relay-launch-namespace-reset-native-deps-command'
import { installNativeDepsWithoutNodePty, warnIfWatcherUnloadableWithoutNodePty, rebuildNativeDeps, windowsNodePtyPatchCommand } from './ssh-relay-deployment-install-native-deps-without-node-pty-windows-node-pty-patch-command'
import { makeNodePtySpawnHelperExecutable, probeInstalledNativeDeps, getLocalRelayPath, getLocalRelayCandidates } from './ssh-relay-deployment-make-node-pty-spawn-helper-executable-get-local-relay-candidates'
import { launchRelay, waitForRelayPoll, buildWindowsRelayFallbackEndpoint, readWindowsActiveRelayEndpoint } from './ssh-relay-deployment-launch-relay-read-windows-active-relay-endpoint'
import { type WindowsRelayEndpoint, type WindowsRelayLaunchOptions, rememberWindowsActiveRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayProbeCommand, windowsRelayWaitCommand, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

export async function resolveRemoteInstallState(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  fullVersion: string,
  options?: { rethrowSessionLimitErrors?: boolean; signal?: AbortSignal }
): Promise<{ remoteHome: string; remoteRelayDir: string; alreadyInstalled: boolean }> {
  // Why: SFTP doesn't expand `~`, so resolve the remote home explicitly via the host's native shell and normalize it.
  const remoteHome = normalizeRemoteHome(
    await execHostCommand(conn, hostPlatform, readRemoteHomeCommand(hostPlatform), {
      signal: options?.signal
    }),
    hostPlatform
  )
  // Why: $HOME is only used inside single-quoted shell strings, so validation only rejects control chars — spaces and non-ASCII stay valid.
  if (!validateRemoteHome(remoteHome, hostPlatform)) {
    throw new Error(`Remote home is not a valid path: ${remoteHome.slice(0, 100)}`)
  }
  const remoteRelayDir = computeRemoteRelayDir(remoteHome, fullVersion, hostPlatform.pathFlavor)
  const probeOptions =
    options?.rethrowSessionLimitErrors || options?.signal
      ? {
          rethrowSessionLimitErrors: options.rethrowSessionLimitErrors,
          signal: options.signal
        }
      : undefined
  const alreadyInstalled = await isRelayAlreadyInstalled(
    conn,
    remoteRelayDir,
    hostPlatform,
    probeOptions
  )
  return { remoteHome, remoteRelayDir, alreadyInstalled }
}


export type RelayBootstrapState = {
  remoteHome: string
  remoteRelayDir: string
  alreadyInstalled: boolean
  nodePath: string
}


export async function resolveRelayBootstrapStateSequentially(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  fullVersion: string,
  signal?: AbortSignal
): Promise<RelayBootstrapState> {
  const installState = await resolveRemoteInstallState(conn, hostPlatform, fullVersion, { signal })
  const nodePath = await resolveRemoteNodePath(conn, hostPlatform, { signal })
  return { ...installState, nodePath }
}


export async function resolveRelayBootstrapState(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  fullVersion: string,
  signal?: AbortSignal
): Promise<RelayBootstrapState> {
  if (!conn.canRunConcurrentExecCommands()) {
    return resolveRelayBootstrapStateSequentially(conn, hostPlatform, fullVersion, signal)
  }
  const abortController = new AbortController()
  const abortForDeploy = (): void => abortController.abort()
  signal?.addEventListener('abort', abortForDeploy, { once: true })
  if (signal?.aborted) {
    abortForDeploy()
  }
  const installStatePromise = resolveRemoteInstallState(conn, hostPlatform, fullVersion, {
    rethrowSessionLimitErrors: true,
    signal: abortController.signal
  })
  const nodePathPromise = resolveRemoteNodePath(conn, hostPlatform, {
    rethrowSessionLimitErrors: true,
    signal: abortController.signal
  })
  try {
    const [installState, nodePath] = await Promise.all([installStatePromise, nodePathPromise])
    signal?.throwIfAborted()
    return { ...installState, nodePath }
  } catch (err) {
    abortController.abort()
    const settled = await Promise.allSettled([installStatePromise, nodePathPromise])
    signal?.throwIfAborted()
    if (!isSshSessionLimitError(err)) {
      throw err
    }
    const nonSessionFailure = settled.find(
      (result) =>
        result.status === 'rejected' &&
        !isSshSessionLimitError(result.reason) &&
        !isAbortError(result.reason)
    )
    if (nonSessionFailure?.status === 'rejected') {
      throw nonSessionFailure.reason
    }
    console.warn(
      '[ssh-relay] Concurrent bootstrap probes hit the remote SSH session limit; retrying sequentially.'
    )
    return resolveRelayBootstrapStateSequentially(conn, hostPlatform, fullVersion, signal)
  } finally {
    signal?.removeEventListener('abort', abortForDeploy)
  }
}
