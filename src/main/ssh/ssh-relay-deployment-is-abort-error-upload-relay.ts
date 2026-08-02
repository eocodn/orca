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
import { type RelayBootstrapState, resolveRemoteInstallState, resolveRelayBootstrapStateSequentially, resolveRelayBootstrapState } from './ssh-relay-deployment-resolve-remote-install-state-resolve-relay-bootstrap-state'
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

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Detect platform, resolve install state + node path, install if absent, launch, and return the transport.
 * Inner implementation wrapped by `deployAndLaunchRelay` with an overall timeout.
 */

export async function deployAndLaunchRelayInner(
  conn: SshConnection,
  onProgress?: (status: string) => void,
  graceTimeSeconds?: number,
  relayInstanceId?: string,
  deploySignal?: AbortSignal
): Promise<RelayDeployResult> {
  while (true) {
    deploySignal?.throwIfAborted()
    try {
      return await deployAndLaunchRelayAttempt(
        conn,
        onProgress,
        graceTimeSeconds,
        relayInstanceId,
        deploySignal
      )
    } catch (err) {
      if (!(err instanceof RelayDirectoryGcConflictError)) {
        throw err
      }
      // Why: GC atomically moves the old install aside; wait for its sibling claim to clear, then recompute install state.
      await waitForRelayGcClaimRelease(conn, err.remoteRelayDir, err.hostPlatform, deploySignal)
    }
  }
}


export async function deployAndLaunchRelayAttempt(
  conn: SshConnection,
  onProgress?: (status: string) => void,
  graceTimeSeconds?: number,
  relayInstanceId?: string,
  deploySignal?: AbortSignal
): Promise<RelayDeployResult> {
  onProgress?.('Detecting remote platform...')
  console.log('[ssh-relay] Detecting remote platform...')
  const hostPlatform = await detectRemoteHostPlatform(conn, { signal: deploySignal })
  if (!hostPlatform) {
    throw new Error(
      'Unsupported remote platform. Orca relay supports: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64, win32-arm64.'
    )
  }
  const platform = hostPlatform.relayPlatform
  console.log(`[ssh-relay] Platform: ${platform}`)

  const localRelayDir = getLocalRelayPath(platform)
  if (!localRelayDir) {
    throw new Error(
      `Relay package for ${platform} not found locally. ` +
        `This may be a packaging issue — try reinstalling Orca.`
    )
  }
  // Why: content-hashed version doubles as remote dir name and wire-handshake version; throws on missing rather than falling back (see docs/ssh-relay-versioned-install-dirs.md).
  const fullVersion = readLocalFullVersion(localRelayDir)

  onProgress?.('Checking existing relay...')
  // Why: install-check and node resolution are independent; run concurrently to save a round trip, with sequential fallback for restrictive SSH servers.
  const { remoteHome, remoteRelayDir, alreadyInstalled, nodePath } =
    await resolveRelayBootstrapState(conn, hostPlatform, fullVersion, deploySignal)
  console.log(`[ssh-relay] Remote dir: ${remoteRelayDir}`)
  console.log(`[ssh-relay] Already installed at ${fullVersion}: ${alreadyInstalled}`)

  // Why: derive the home-relative suffix once — recomputing it by stripping the shell home breaks on a split namespace.
  const homeRelativeRelayDir = relayHomeRelativeDir(fullVersion)

  let ownsInstallLock = false
  let launchGcClaimToken: string | undefined
  let launchNamespace: RelayInstallNamespace | undefined
  if (alreadyInstalled) {
    const launchFence = await repairInstalledNativeDeps(
      conn,
      remoteRelayDir,
      platform,
      hostPlatform,
      nodePath,
      homeRelativeRelayDir,
      deploySignal
    )
    ownsInstallLock = launchFence.ownsInstallLock
    launchGcClaimToken = launchFence.gcClaimToken
    launchNamespace = launchFence.sftpNamespace
    deploySignal?.throwIfAborted()
  } else {
    // Why: serialize concurrent first-installs via a host-native exclusive lock; the loser polls to re-check installed or steal a stale lock.
    await acquireInstallLock(conn, remoteRelayDir, hostPlatform, { signal: deploySignal })
    ownsInstallLock = true
    try {
      // Re-probe after acquiring the lock — a sibling installer may have finished while we waited.
      if (
        !(await isRelayAlreadyInstalled(conn, remoteRelayDir, hostPlatform, {
          signal: deploySignal
        }))
      ) {
        launchNamespace = createInstallNamespaceIfSupported(
          conn,
          hostPlatform,
          homeRelativeRelayDir
        )

        onProgress?.('Uploading relay...')
        console.log('[ssh-relay] Uploading relay...')
        await uploadRelay(
          conn,
          platform,
          remoteRelayDir,
          fullVersion,
          hostPlatform,
          deploySignal,
          launchNamespace
        )
        console.log('[ssh-relay] Upload complete')

        onProgress?.('Installing native dependencies...')
        console.log('[ssh-relay] Installing native dependencies...')
        await installNativeDeps(
          conn,
          remoteRelayDir,
          platform,
          hostPlatform,
          nodePath,
          deploySignal,
          [],
          launchNamespace
        )
        console.log('[ssh-relay] Native deps installed')

        // Why: mark complete but retain the lock until launch makes daemon liveness observable to cross-version GC.
        await finalizeInstall(conn, remoteRelayDir, hostPlatform, {
          signal: deploySignal,
          releaseLock: false
        })
      }
    } catch (err) {
      // Why: leave a partial install dir (no .install-complete) so the next deploy re-runs upload + install.
      // Why: keep the lock if remote termination was unconfirmed — stale recovery beats overlapping a still-running npm.
      if (!isUnconfirmedSshCommandTermination(err)) {
        await abandonInstall(conn, remoteRelayDir, hostPlatform)
        ownsInstallLock = false
      }
      throw err
    }
  }

  let launched: Awaited<ReturnType<typeof launchRelay>>
  let launchLivenessObserved = false
  try {
    deploySignal?.throwIfAborted()
    onProgress?.('Starting relay...')
    console.log('[ssh-relay] Launching relay...')
    launched = await launchRelay(
      conn,
      remoteRelayDir,
      hostPlatform,
      nodePath,
      graceTimeSeconds,
      relayInstanceId,
      deploySignal
    )
    launchLivenessObserved = true
  } finally {
    // Why: older clients understand only the install lock; if launch never goes live, keep it so their GC can't race a caller waiting behind this owner.
    if (ownsInstallLock && launchLivenessObserved) {
      await abandonInstall(conn, remoteRelayDir, hostPlatform)
    }
    // The detached start may outlive a timed-out SSH command; keep the fence on failed launch until stale recovery proves the handoff ended.
    if (launchGcClaimToken && launchLivenessObserved) {
      await releaseRelayGcClaimWithRetry(conn, remoteRelayDir, launchGcClaimToken, hostPlatform)
    }
  }
  console.log('[ssh-relay] Relay started successfully')

  // Why: best-effort GC of unreferenced sibling version dirs; errors are swallowed so a GC failure never blocks connecting.
  void gcOldRelayVersions(conn, remoteHome, remoteRelayDir, hostPlatform, {
    windowsNodePath: launched.nodePath,
    windowsSockNames: [relaySocketNameForInstanceId(relayInstanceId)]
  }).catch(() => {})

  return {
    transport: launched.transport,
    serverBuildId: fullVersion,
    platform,
    hostPlatform,
    remoteHome,
    remoteRelayDir,
    nodePath: launched.nodePath,
    sockPath: launched.sockPath,
    credentialFile: launched.credentialFile
  }
}


export async function uploadRelay(
  conn: SshConnection,
  platform: RelayPlatform,
  remoteDir: string,
  fullVersion: string,
  hostPlatform: RemoteHostPlatform,
  signal?: AbortSignal,
  namespace?: RelayInstallNamespace
): Promise<void> {
  const localRelayDir = getLocalRelayPath(platform)
  if (!localRelayDir || !existsSync(localRelayDir)) {
    throw new Error(
      `Relay package for ${platform} not found. Searched: ${getLocalRelayCandidates(platform).join(', ')}. ` +
        `This may be a packaging issue — try reinstalling Orca.`
    )
  }

  // Why: the install-owner marker rides along with mkdir, so a standard install spends no extra exec channel on it.
  await execHostCommand(
    conn,
    hostPlatform,
    makeRelayInstallDirectoryCommand(hostPlatform, remoteDir, namespace),
    { signal }
  )

  await uploadRelayDirectory(conn, localRelayDir, remoteDir, hostPlatform, {
    signal,
    sftpNamespace: namespace
      ? relaySftpNamespaceMapping(namespace, hostPlatform, remoteDir)
      : undefined
  })

  if (!isWindowsRemoteHost(hostPlatform)) {
    await execHostCommand(
      conn,
      hostPlatform,
      makeRemoteExecutableCommand(hostPlatform, joinRemotePath(hostPlatform, remoteDir, 'node')),
      { signal }
    )
  }

  // Why: write .version via SFTP not shell to avoid quoting content-hashed versions; the daemon reads it to validate the wire handshake.
  await writeRelayFile(
    conn,
    hostPlatform,
    joinRemotePath(hostPlatform, remoteDir, '.version'),
    fullVersion,
    {
      signal,
      sftpNamespace: namespace
        ? relaySftpNamespaceMapping(namespace, hostPlatform, remoteDir, '.version')
        : undefined
    }
  )
}

/**
 * A marker is only meaningful where a split namespace can occur and where Orca
 * owns the SFTP session: POSIX hosts reached over the bundled ssh2 transport.
 */
