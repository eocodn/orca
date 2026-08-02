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
import { installNativeDepsWithoutNodePty, warnIfWatcherUnloadableWithoutNodePty, rebuildNativeDeps, windowsNodePtyPatchCommand } from './ssh-relay-deployment-install-native-deps-without-node-pty-windows-node-pty-patch-command'
import { launchRelay, waitForRelayPoll, buildWindowsRelayFallbackEndpoint, readWindowsActiveRelayEndpoint } from './ssh-relay-deployment-launch-relay-read-windows-active-relay-endpoint'
import { type WindowsRelayEndpoint, type WindowsRelayLaunchOptions, rememberWindowsActiveRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayProbeCommand, windowsRelayWaitCommand, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

export async function makeNodePtySpawnHelperExecutable(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  signal?: AbortSignal
): Promise<void> {
  if (isWindowsRemoteHost(hostPlatform)) {
    return
  }
  // SFTP doesn't preserve execute bits; node-pty's spawn-helper must be +x for posix_spawnp.
  await execHostCommand(
    conn,
    hostPlatform,
    `find ${shellEscape(joinRemotePath(hostPlatform, remoteDir, 'node_modules/node-pty/prebuilds'))} -name spawn-helper -exec chmod +x {} + 2>/dev/null; true`,
    { signal }
  )
}


export async function probeInstalledNativeDeps(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  signal?: AbortSignal
): Promise<{
  available: boolean
  missing: RelayNativeDepName[]
  output: string
  stderr: string
}> {
  // require() catches unloadable installs (wrong arch, missing prebuild, skipped lifecycle script) that require.resolve() and test -d miss.
  const PROBE_OK = 'ORCA-NPTY-PROBE-OK'
  const stderrFile = joinRemotePath(hostPlatform, remoteDir, '.npty-probe.stderr')
  const escapedStderr = shellEscape(stderrFile)
  const probeJs = nativeDepsProbeJs(PROBE_OK)
  const probeCommand = isWindowsRemoteHost(hostPlatform)
    ? commandWithNodePath(
        hostPlatform,
        nodePath,
        remoteDir,
        `try { & ${powerShellLiteral(nodePath)} -e ${powerShellNativeArg(probeJs)} ${powerShellLiteral(PROBE_OK)}; if ($LASTEXITCODE -ne 0) { 'MISSING' } } catch { 'MISSING' }`
      )
    : commandWithNodePath(
        hostPlatform,
        nodePath,
        remoteDir,
        `(${shellEscape(nodePath)} -e ${shellEscape(probeJs)} ${shellEscape(PROBE_OK)} 2>${escapedStderr} || echo MISSING)`
      )
  const probeOutput = await execHostCommand(conn, hostPlatform, probeCommand, { signal })
  const remoteStderr =
    probeOutput.includes(PROBE_OK) || isWindowsRemoteHost(hostPlatform)
      ? ''
      : await execHostCommand(conn, hostPlatform, `cat ${escapedStderr} 2>/dev/null; true`, {
          signal
        }).catch(() => '')
  signal?.throwIfAborted()
  if (!isWindowsRemoteHost(hostPlatform)) {
    // The POSIX probe redirects stderr to this file; the Windows probe does not.
    await execHostCommand(conn, hostPlatform, removeRemoteFileCommand(hostPlatform, stderrFile), {
      signal
    }).catch(() => {})
    signal?.throwIfAborted()
  }
  return {
    available: probeOutput.includes(PROBE_OK),
    missing: probeOutput.includes(PROBE_OK) ? [] : missingNativeDepsFromProbe(probeOutput),
    output: probeOutput,
    stderr: remoteStderr
  }
}


export function getLocalRelayPath(platform: RelayPlatform): string | null {
  for (const candidate of getLocalRelayCandidates(platform)) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}


export function getLocalRelayCandidates(platform: RelayPlatform): string[] {
  const candidates: string[] = []
  if (process.env.ORCA_RELAY_PATH) {
    candidates.push(join(process.env.ORCA_RELAY_PATH, platform))
  }

  // Why: electron-builder copies extraResources next to the app bundle, but app.getAppPath() points at app.asar in packaged builds.
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'relay', platform))
    candidates.push(join(process.resourcesPath, 'app.asar.unpacked', 'out', 'relay', platform))
  }

  const appPath = app.getAppPath()
  candidates.push(
    join(appPath, 'resources', 'relay', platform),
    join(appPath, 'out', 'relay', platform)
  )

  return [...new Set(candidates)]
}
