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
import { makeNodePtySpawnHelperExecutable, probeInstalledNativeDeps, getLocalRelayPath, getLocalRelayCandidates } from './ssh-relay-deployment-make-node-pty-spawn-helper-executable-get-local-relay-candidates'
import { launchRelay, waitForRelayPoll, buildWindowsRelayFallbackEndpoint, readWindowsActiveRelayEndpoint } from './ssh-relay-deployment-launch-relay-read-windows-active-relay-endpoint'
import { type WindowsRelayEndpoint, type WindowsRelayLaunchOptions, rememberWindowsActiveRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'

export async function waitForWindowsRelayPipe(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  opts: {
    remoteDir: string
    nodePath: string
    sockPath: string
  },
  timeoutMs: number,
  intervalMs: number,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const result = await execHostCommand(
      conn,
      hostPlatform,
      windowsRelayWaitCommand(hostPlatform, opts.nodePath, opts.remoteDir, opts.sockPath, {
        timeoutMs,
        intervalMs
      }),
      { signal }
    )
    return result.trim() === 'READY'
  } catch {
    signal?.throwIfAborted()
    return false
  }
}


export function windowsRelayProbeCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  remoteDir: string,
  sockPath: string
): string {
  const js = [
    'const net=require("net");',
    'const s=net.connect(process.argv[1]);',
    's.on("connect",()=>{s.destroy();process.stdout.write("READY")});',
    's.on("error",()=>{process.stdout.write("WAITING")});'
  ].join('')
  return commandWithNodePath(
    hostPlatform,
    nodePath,
    remoteDir,
    `& ${powerShellLiteral(nodePath)} -e ${powerShellNativeArg(js)} ${powerShellNativeArg(sockPath)}`
  )
}


export function windowsRelayWaitCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  remoteDir: string,
  sockPath: string,
  opts: { timeoutMs: number; intervalMs: number }
): string {
  const js = [
    'const net=require("net");',
    'const pipe=process.argv[1];',
    'const timeoutMs=Number(process.argv[2]);',
    'const intervalMs=Number(process.argv[3]);',
    'const deadline=Date.now()+timeoutMs;',
    'function finish(value){process.stdout.write(value);process.exit(0)}',
    'function attempt(){',
    'const s=net.connect(pipe);',
    'let settled=false;',
    'function retry(){if(settled)return;settled=true;s.destroy();',
    'if(Date.now()>=deadline)finish("WAITING");else setTimeout(attempt,intervalMs)}',
    's.setTimeout(Math.min(intervalMs,500));',
    's.on("connect",()=>{if(settled)return;settled=true;s.destroy();finish("READY")});',
    's.on("timeout",retry);',
    's.on("error",retry);',
    '}',
    'attempt();'
  ].join('')
  return commandWithNodePath(
    hostPlatform,
    nodePath,
    remoteDir,
    [
      `& ${powerShellLiteral(nodePath)}`,
      '-e',
      powerShellNativeArg(js),
      powerShellNativeArg(sockPath),
      powerShellLiteral(String(opts.timeoutMs)),
      powerShellLiteral(String(opts.intervalMs))
    ].join(' ')
  )
}


export function windowsRelayTailLogCommand(logFile: string, errFile: string): string {
  const script = [
    `$out = if (Test-Path -LiteralPath ${powerShellLiteral(logFile)}) { Get-Content -LiteralPath ${powerShellLiteral(logFile)} -Tail 20 -ErrorAction SilentlyContinue } else { '(no stdout log)' }`,
    `$err = if (Test-Path -LiteralPath ${powerShellLiteral(errFile)}) { Get-Content -LiteralPath ${powerShellLiteral(errFile)} -Tail 20 -ErrorAction SilentlyContinue } else { '(no stderr log)' }`,
    'Write-Output $out',
    "Write-Output '--- stderr ---'",
    'Write-Output $err'
  ].join('; ')
  return powerShellCommand(script)
}
