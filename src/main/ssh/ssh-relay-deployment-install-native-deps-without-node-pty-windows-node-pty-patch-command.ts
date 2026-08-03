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
import { isAbortError, deployAndLaunchRelayInner, deployAndLaunchRelayAttempt, uploadRelay } from './ssh-relay-deployment-is-abort-error-upload-relay'
import { createInstallNamespaceIfSupported, NODE_PTY_VERSION, NODE_PTY_CONSOLE_LIST_PATCH_FILENAME, RELAY_NATIVE_DEPS } from './ssh-relay-deployment-create-install-namespace-if-supported-relay-native-deps'
import { type RelayNativeDepName, RELAY_NATIVE_DEP_NAMES, NATIVE_DEPS_MISSING_PREFIX, RELAY_NATIVE_DEP_SCRIPT_ALLOWLIST } from './ssh-relay-deployment-relay-native-dep-name-relay-native-dep-script-allowlist'
import { nativeDepsProbeJs, missingNativeDepsFromProbe, probeRequiredNativeDeps, repairInstalledNativeDeps } from './ssh-relay-deployment-native-deps-probe-js-repair-installed-native-deps'
import { createRelayLaunchNamespace, acquireRelayLaunchGcFence, installNativeDeps, resetNativeDepsCommand } from './ssh-relay-deployment-create-relay-launch-namespace-reset-native-deps-command'
import { makeNodePtySpawnHelperExecutable, probeInstalledNativeDeps, getLocalRelayPath, getLocalRelayCandidates } from './ssh-relay-deployment-make-node-pty-spawn-helper-executable-get-local-relay-candidates'
import { launchRelay, waitForRelayPoll, buildWindowsRelayFallbackEndpoint, readWindowsActiveRelayEndpoint } from './ssh-relay-deployment-launch-relay-read-windows-active-relay-endpoint'
import { type WindowsRelayEndpoint, type WindowsRelayLaunchOptions, rememberWindowsActiveRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayProbeCommand, windowsRelayWaitCommand, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

export async function installNativeDepsWithoutNodePty(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  writeRelayPackageJson: (deps: Record<string, string>) => Promise<void>,
  resetDeps: RelayNativeDepName[],
  signal?: AbortSignal
): Promise<void> {
  const deps = Object.fromEntries(
    Object.entries(RELAY_NATIVE_DEPS).filter(([dep]) => dep !== 'node-pty')
  )
  await writeRelayPackageJson(deps)
  const installArgs = Object.entries(deps)
    .map(([dep, version]) => shellEscape(`${dep}@${version}`))
    .join(' ')
  // Why: the failed attempt leaves an unbuildable node-pty behind; clear it so npm prunes rather
  // than rebuilds it. Keep the caller's resets too — a repair reconnect still needs them.
  const resetCommand = resetNativeDepsCommand(hostPlatform, [
    ...new Set<RelayNativeDepName>([...resetDeps, 'node-pty'])
  ])
  // Why: POSIX-only command shape (`;` chaining, `2>&1`) — safe because the only caller is gated on a
  // linux platform. Widen that gate and this needs the Windows branch installNativeDeps already has.
  await execHostCommand(
    conn,
    hostPlatform,
    commandWithNodePath(
      hostPlatform,
      nodePath,
      remoteDir,
      `${resetCommand}; npm install --ignore-scripts=false --omit=dev --no-audit --no-fund ${installArgs} 2>&1`
    ),
    { timeoutMs: NATIVE_DEPS_COMMAND_TIMEOUT_MS, signal }
  )
}

/**
 * Report an unloadable @parcel/watcher after node-pty was skipped, without failing the connection.
 *
 * Why: node-pty is expected missing here, but a @parcel/watcher prebuilt that installs and still
 * can't require() (glibc below the floor — docs/reference/linux-glibc-compatibility.md) means dead
 * file watching. No rebuild: node-pty provably can't compile on this host, so it would only fail.
 */

export async function warnIfWatcherUnloadableWithoutNodePty(
  conn: SshConnection,
  remoteDir: string,
  platform: RelayPlatform,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    const probe = await probeInstalledNativeDeps(conn, remoteDir, hostPlatform, nodePath, signal)
    if (probe.missing.includes('@parcel/watcher')) {
      console.warn(
        `[ssh-relay][WATCHER-MISSING-NPTY-SKIPPED] @parcel/watcher installed but require() failed at ${remoteDir} (${platform}); remote file watching is unavailable. stdout=${probe.output.trim().slice(-200)} stderr=${probe.stderr.trim().slice(-500)}`
      )
    }
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    signal?.throwIfAborted()
    // Degraded-mode diagnostics must never cost the connection the retry just salvaged.
    console.warn(
      `[ssh-relay][WATCHER-PROBE-FAIL] native deps probe failed after skipping node-pty at ${remoteDir} (${platform}): ${(err as Error).message}`
    )
  }
}


export async function rebuildNativeDeps(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  signal?: AbortSignal
): Promise<void> {
  const depNames = Object.keys(RELAY_NATIVE_DEPS)
  const command = isWindowsRemoteHost(hostPlatform)
    ? commandWithNodePath(
        hostPlatform,
        nodePath,
        remoteDir,
        `npm rebuild --ignore-scripts=false ${depNames.map(powerShellLiteral).join(' ')}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${windowsNodePtyPatchCommand(nodePath)}`
      )
    : commandWithNodePath(
        hostPlatform,
        nodePath,
        remoteDir,
        `npm rebuild --ignore-scripts=false ${depNames.map(shellEscape).join(' ')} 2>&1`
      )
  await execHostCommand(conn, hostPlatform, command, {
    timeoutMs: NATIVE_DEPS_COMMAND_TIMEOUT_MS,
    signal
  })
}


export function windowsNodePtyPatchCommand(nodePath: string): string {
  // Why: pnpm patches do not cross the SSH boundary; apply the version-checked fallback to the remote npm package.
  return `& ${powerShellLiteral(nodePath)} ${powerShellLiteral(NODE_PTY_CONSOLE_LIST_PATCH_FILENAME)}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
}
