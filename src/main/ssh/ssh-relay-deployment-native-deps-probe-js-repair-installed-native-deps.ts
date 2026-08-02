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
import { createRelayLaunchNamespace, acquireRelayLaunchGcFence, installNativeDeps, resetNativeDepsCommand } from './ssh-relay-deployment-create-relay-launch-namespace-reset-native-deps-command'
import { installNativeDepsWithoutNodePty, warnIfWatcherUnloadableWithoutNodePty, rebuildNativeDeps, windowsNodePtyPatchCommand } from './ssh-relay-deployment-install-native-deps-without-node-pty-windows-node-pty-patch-command'
import { makeNodePtySpawnHelperExecutable, probeInstalledNativeDeps, getLocalRelayPath, getLocalRelayCandidates } from './ssh-relay-deployment-make-node-pty-spawn-helper-executable-get-local-relay-candidates'
import { launchRelay, waitForRelayPoll, buildWindowsRelayFallbackEndpoint, readWindowsActiveRelayEndpoint } from './ssh-relay-deployment-launch-relay-read-windows-active-relay-endpoint'
import { type WindowsRelayEndpoint, type WindowsRelayLaunchOptions, rememberWindowsActiveRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayProbeCommand, windowsRelayWaitCommand, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

export function nativeDepsProbeJs(successToken: string): string {
  // Why: node-pty's Windows wrapper defers conpty.node until first spawn, so require("node-pty") alone can't prove the binding is healthy.
  const loadNodePty =
    'require("node-pty"); require("node-pty/lib/utils").loadNativeModule(process.platform==="win32"&&Number(require("os").release().split(".")[2])>=18309?"conpty":"pty");' +
    `if(process.platform==="win32"){require("./${NODE_PTY_CONSOLE_LIST_PATCH_FILENAME}").assertPatchedNodePtyConsoleListAgent(process.cwd())}`
  return `(()=>{const missing=[];try{${loadNodePty}}catch{missing.push("node-pty")}try{require("@parcel/watcher")}catch{missing.push("@parcel/watcher")}if(missing.length){console.log("${NATIVE_DEPS_MISSING_PREFIX}"+missing.join(","));process.exitCode=1}else{console.log(${JSON.stringify(successToken)})}})()`
}


export function missingNativeDepsFromProbe(output: string): RelayNativeDepName[] {
  const marker = output
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith(NATIVE_DEPS_MISSING_PREFIX))
  if (!marker) {
    return [...RELAY_NATIVE_DEP_NAMES]
  }
  const reported = marker.trim().slice(NATIVE_DEPS_MISSING_PREFIX.length).split(',')
  return RELAY_NATIVE_DEP_NAMES.filter((name) => reported.includes(name))
}


export async function probeRequiredNativeDeps(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  signal?: AbortSignal
): Promise<{ available: boolean; missing: RelayNativeDepName[] }> {
  const escapedNode = shellEscape(nodePath)
  const probeJs = nativeDepsProbeJs('ORCA-NATIVE-DEPS-OK')
  try {
    const command = isWindowsRemoteHost(hostPlatform)
      ? commandWithNodePath(
          hostPlatform,
          nodePath,
          remoteDir,
          `try { & ${powerShellLiteral(nodePath)} -e ${powerShellNativeArg(probeJs)} } catch { 'MISSING' }`
        )
      : commandWithNodePath(
          hostPlatform,
          nodePath,
          remoteDir,
          `(${escapedNode} -e ${shellEscape(probeJs)} 2>/dev/null || echo MISSING)`
        )
    const probe = await execHostCommand(conn, hostPlatform, command, { signal })
    const available = probe.includes('ORCA-NATIVE-DEPS-OK')
    return { available, missing: available ? [] : missingNativeDepsFromProbe(probe) }
  } catch {
    signal?.throwIfAborted()
    return { available: false, missing: [...RELAY_NATIVE_DEP_NAMES] }
  }
}


export async function repairInstalledNativeDeps(
  conn: SshConnection,
  remoteDir: string,
  platform: RelayPlatform,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  homeRelativeRelayDir: string,
  signal?: AbortSignal
): Promise<{
  ownsInstallLock: boolean
  gcClaimToken?: string
  sftpNamespace?: RelayInstallNamespace
}> {
  const initialProbe = await probeRequiredNativeDeps(
    conn,
    remoteDir,
    hostPlatform,
    nodePath,
    signal
  )
  const lockResult = await tryAcquireRelayRepairLock(conn, remoteDir, hostPlatform, { signal })
  if (lockResult === 'gc') {
    throw new RelayDirectoryGcConflictError(remoteDir, hostPlatform)
  }
  if (lockResult === 'acquired') {
    let stillInstalled: boolean
    try {
      stillInstalled = await isRelayAlreadyInstalled(conn, remoteDir, hostPlatform, {
        rethrowSessionLimitErrors: true,
        signal
      })
    } catch (err) {
      await abandonInstall(conn, remoteDir, hostPlatform)
      throw err
    }
    if (!stillInstalled) {
      // Why: GC may finish its rename before our lock recreates the path; never trust probes made before this locked recheck.
      await abandonInstall(conn, remoteDir, hostPlatform)
      throw new RelayDirectoryGcConflictError(remoteDir, hostPlatform)
    }
  }
  const gcClaimToken =
    lockResult === 'busy' || lockResult === 'error'
      ? await acquireRelayLaunchGcFence(conn, remoteDir, hostPlatform, signal)
      : undefined
  if (initialProbe.available) {
    // Why: even a healthy reconnect stays fenced until launch liveness is observable, or cross-version GC can rename after this probe.
    if (lockResult !== 'acquired') {
      return { ownsInstallLock: false, gcClaimToken }
    }
    try {
      return {
        ownsInstallLock: true,
        sftpNamespace: await createRelayLaunchNamespace(
          conn,
          hostPlatform,
          remoteDir,
          homeRelativeRelayDir,
          signal
        )
      }
    } catch (err) {
      signal?.throwIfAborted()
      console.warn(
        `[ssh-relay] Launch namespace marker is unconfirmed at ${remoteDir}; deferring lock ownership to stale recovery`
      )
      return { ownsInstallLock: !isUnconfirmedSshCommandTermination(err) }
    }
  }

  // Why: an already-installed relay can launch degraded, so native-deps repair is best-effort — lock contention and failures must not abort the connection.
  console.warn(`[ssh-relay] Repairing missing native deps at ${remoteDir}`)
  if (lockResult === 'busy' || lockResult === 'error') {
    console.warn(
      `[ssh-relay] Native-deps repair lock is ${lockResult} at ${remoteDir}; launching degraded`
    )
    return { ownsInstallLock: false, gcClaimToken }
  }
  try {
    // Why: older complete relay dirs predate @parcel/watcher; re-probe under the lock so only one reconnect mutates the dir.
    const probe = await probeRequiredNativeDeps(conn, remoteDir, hostPlatform, nodePath, signal)
    let repairNamespace: RelayInstallNamespace | undefined
    if (!probe.available) {
      // Why: only stamp ownership once the locked recheck proves this connection is the one about to write.
      repairNamespace = await createRelayLaunchNamespace(
        conn,
        hostPlatform,
        remoteDir,
        homeRelativeRelayDir,
        signal
      )
      await installNativeDeps(
        conn,
        remoteDir,
        platform,
        hostPlatform,
        nodePath,
        signal,
        probe.missing,
        repairNamespace
      )
      await finalizeInstall(conn, remoteDir, hostPlatform, { signal, releaseLock: false })
    }
    return { ownsInstallLock: true, sftpNamespace: repairNamespace }
  } catch (err) {
    const terminationUnconfirmed = isUnconfirmedSshCommandTermination(err)
    // Why: hold a confirmed-failure lock through degraded launch so GC can't move the relay before liveness is visible.
    // Why: unconfirmed remote mutation keeps its stale-recoverable lock beyond this connection.
    console.warn(
      `[ssh-relay] Native deps repair failed at ${remoteDir}; launching degraded: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return { ownsInstallLock: !terminationUnconfirmed }
  }
}

/**
 * Stamp this connection as the launch writer while it owns the install lock.
 * Confirmed marker failures fall back to shell-path credential generation.
 */
