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
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayProbeCommand, windowsRelayWaitCommand, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

export async function rememberWindowsActiveRelayEndpoint(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  markerPath: string,
  sockPath: string,
  signal?: AbortSignal
): Promise<void> {
  await execHostCommand(
    conn,
    hostPlatform,
    powerShellCommand(
      `Set-Content -LiteralPath ${powerShellLiteral(markerPath)} -Value ${powerShellLiteral(sockPath)} -NoNewline`
    ),
    { signal }
  ).catch((err) => {
    signal?.throwIfAborted()
    // Why: fallback pipe names are deterministic, so losing this marker won't orphan an undiscoverable relay.
    console.warn(
      `[ssh-relay] Failed to persist Windows active relay pipe at ${markerPath}: ${err instanceof Error ? err.message : String(err)}`
    )
  })
}


export type WindowsRelayEndpoint = {
  sockPath: string
  endpointDir: string
}


export type WindowsRelayLaunchOptions = {
  remoteDir: string
  nodePath: string
  graceTime: number
  activePipeMarkerPath: string
  credentialFile: string
} & WindowsRelayEndpoint & {
    reconnectFallback?: WindowsRelayEndpoint
  }


export async function launchWindowsRelay(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  opts: WindowsRelayLaunchOptions,
  signal?: AbortSignal
): Promise<{ transport: MultiplexerTransport; nodePath: string; sockPath: string }> {
  let launchOpts = opts
  if ((await probeWindowsRelayPipe(conn, hostPlatform, opts, signal)) === 'READY') {
    try {
      const transport = await connectWindowsRelay(conn, hostPlatform, opts, signal)
      await rememberWindowsActiveRelayEndpoint(
        conn,
        hostPlatform,
        opts.activePipeMarkerPath,
        opts.sockPath,
        signal
      )
      return {
        transport,
        nodePath: opts.nodePath,
        sockPath: opts.sockPath
      }
    } catch (err) {
      signal?.throwIfAborted()
      console.warn(
        '[ssh-relay] Windows named pipe reconnect failed, launching fresh relay:',
        err instanceof Error ? err.message : String(err)
      )
      if (opts.reconnectFallback) {
        // Why: a Windows named pipe can't be unlinked like a Unix socket; a deterministic fallback pipe keeps the next deploy recoverable.
        // Why: spread keeps activePipeMarkerPath at the original target sock name — the marker records that target's active pipe, fallback or not.
        launchOpts = { ...opts, ...opts.reconnectFallback }
      }
    }
  }

  if (
    launchOpts !== opts &&
    (await probeWindowsRelayPipe(conn, hostPlatform, launchOpts, signal)) === 'READY'
  ) {
    try {
      const transport = await connectWindowsRelay(conn, hostPlatform, launchOpts, signal)
      await rememberWindowsActiveRelayEndpoint(
        conn,
        hostPlatform,
        launchOpts.activePipeMarkerPath,
        launchOpts.sockPath,
        signal
      )
      return {
        transport,
        nodePath: launchOpts.nodePath,
        sockPath: launchOpts.sockPath
      }
    } catch (err) {
      signal?.throwIfAborted()
      console.warn(
        '[ssh-relay] Windows fallback pipe reconnect failed, relaunching relay:',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  const logFile = joinRemotePath(hostPlatform, launchOpts.remoteDir, 'relay.log')
  const errFile = joinRemotePath(hostPlatform, launchOpts.remoteDir, 'relay.err.log')
  await writeRelayEndpointCredential(
    conn,
    hostPlatform,
    launchOpts.nodePath,
    launchOpts.credentialFile,
    { signal }
  )
  await execHostCommand(
    conn,
    hostPlatform,
    windowsRelayLaunchCommand(
      hostPlatform,
      launchOpts.nodePath,
      launchOpts.remoteDir,
      launchOpts.sockPath,
      launchOpts.endpointDir,
      launchOpts.graceTime,
      logFile,
      errFile,
      launchOpts.credentialFile
    ),
    { signal }
  )

  const POLL_INTERVAL_MS = 200
  const POLL_TIMEOUT_MS = 10_000
  if (
    await waitForWindowsRelayPipe(
      conn,
      hostPlatform,
      launchOpts,
      POLL_TIMEOUT_MS,
      POLL_INTERVAL_MS,
      signal
    )
  ) {
    const transport = await connectWindowsRelay(conn, hostPlatform, launchOpts, signal)
    await rememberWindowsActiveRelayEndpoint(
      conn,
      hostPlatform,
      launchOpts.activePipeMarkerPath,
      launchOpts.sockPath,
      signal
    )
    return {
      transport,
      nodePath: launchOpts.nodePath,
      sockPath: launchOpts.sockPath
    }
  }

  const logOutput = await execHostCommand(
    conn,
    hostPlatform,
    windowsRelayTailLogCommand(logFile, errFile),
    { signal }
  ).catch(() => {
    signal?.throwIfAborted()
    return '(could not read log)'
  })
  throw new Error(`Relay failed to start within ${POLL_TIMEOUT_MS / 1000}s. Log:\n${logOutput}`)
}
