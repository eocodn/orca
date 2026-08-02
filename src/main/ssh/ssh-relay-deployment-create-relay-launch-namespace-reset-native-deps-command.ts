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
import { installNativeDepsWithoutNodePty, warnIfWatcherUnloadableWithoutNodePty, rebuildNativeDeps, windowsNodePtyPatchCommand } from './ssh-relay-deployment-install-native-deps-without-node-pty-windows-node-pty-patch-command'
import { makeNodePtySpawnHelperExecutable, probeInstalledNativeDeps, getLocalRelayPath, getLocalRelayCandidates } from './ssh-relay-deployment-make-node-pty-spawn-helper-executable-get-local-relay-candidates'
import { launchRelay, waitForRelayPoll, buildWindowsRelayFallbackEndpoint, readWindowsActiveRelayEndpoint } from './ssh-relay-deployment-launch-relay-read-windows-active-relay-endpoint'
import { type WindowsRelayEndpoint, type WindowsRelayLaunchOptions, rememberWindowsActiveRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'
import { connectWindowsRelay, windowsRelayConnectCommand, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayProbeCommand, windowsRelayWaitCommand, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

export async function createRelayLaunchNamespace(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  remoteDir: string,
  homeRelativeRelayDir: string,
  signal?: AbortSignal
): Promise<RelayInstallNamespace | undefined> {
  const namespace = createInstallNamespaceIfSupported(conn, hostPlatform, homeRelativeRelayDir)
  if (!namespace) {
    return undefined
  }
  try {
    await execHostCommand(
      conn,
      hostPlatform,
      createRelayInstallMarkerCommand(namespace, hostPlatform, remoteDir),
      { signal }
    )
    return namespace
  } catch (err) {
    // Why: an unconfirmed termination still owes the caller its lock semantics; only a confirmed failure degrades to shell paths.
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    signal?.throwIfAborted()
    console.warn(
      `[ssh-relay] SFTP namespace marker unavailable at ${remoteDir}; retaining shell paths`
    )
    return undefined
  }
}


export async function acquireRelayLaunchGcFence(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  signal?: AbortSignal
): Promise<string> {
  const token = await tryAcquireRelayGcClaim(conn, remoteDir, hostPlatform, signal)
  if (!token) {
    signal?.throwIfAborted()
    throw new RelayDirectoryGcConflictError(remoteDir, hostPlatform)
  }
  try {
    signal?.throwIfAborted()
    const stillInstalled = await isRelayAlreadyInstalled(conn, remoteDir, hostPlatform, {
      rethrowSessionLimitErrors: true,
      signal
    })
    if (!stillInstalled) {
      throw new RelayDirectoryGcConflictError(remoteDir, hostPlatform)
    }
    // Why: a caller without the install lock still needs its own durable fence; never borrow another connection's lock through launch.
    return token
  } catch (err) {
    await releaseRelayGcClaimWithRetry(conn, remoteDir, token, hostPlatform)
    throw err
  }
}

// Why: node-pty and @parcel/watcher are native addons esbuild can't bundle; install them on the remote against its Node/OS.
// TODO(#1693): ship per-platform tarballs with node-pty prebuilt from CI to skip remote npm install.

export async function installNativeDeps(
  conn: SshConnection,
  remoteDir: string,
  platform: RelayPlatform,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  signal?: AbortSignal,
  resetDeps: RelayNativeDepName[] = [],
  namespace?: RelayInstallNamespace
): Promise<void> {
  const writeRelayPackageJson = async (deps: Record<string, string>): Promise<void> => {
    await writeRelayFile(
      conn,
      hostPlatform,
      joinRemotePath(hostPlatform, remoteDir, 'package.json'),
      `${JSON.stringify({
        name: 'orca-relay',
        version: '1.0.0',
        private: true,
        type: 'commonjs',
        dependencies: deps,
        allowScripts: RELAY_NATIVE_DEP_SCRIPT_ALLOWLIST
      })}\n`,
      {
        signal,
        sftpNamespace: namespace
          ? relaySftpNamespaceMapping(namespace, hostPlatform, remoteDir, 'package.json')
          : undefined
      }
    )
  }

  // Why: node-pty's prebuild spawns `node` as a child, so node must be in PATH (commandWithNodePath) or it fails exit 127.
  // Why: npm init -y rejects '+' in content-hashed dir names, so write a fixed minimal package.json instead.
  // Why: type:commonjs pins module resolution against Node default flips or a remote ~/.npmrc type=module.
  await writeRelayPackageJson(RELAY_NATIVE_DEPS)

  try {
    const installArgs = Object.entries(RELAY_NATIVE_DEPS)
      .map(([dep, version]) => shellEscape(`${dep}@${version}`))
      .join(' ')
    // Why: npm reports a present package as up to date even if a native file was deleted; reset only deps the probe found broken.
    const resetCommand = resetNativeDepsCommand(hostPlatform, resetDeps)
    const resetPrefix = resetCommand ? `${resetCommand}; ` : ''
    const command = isWindowsRemoteHost(hostPlatform)
      ? commandWithNodePath(
          hostPlatform,
          nodePath,
          remoteDir,
          `${resetPrefix}npm install --ignore-scripts=false --omit=dev --no-audit --no-fund ${Object.entries(
            RELAY_NATIVE_DEPS
          )
            .map(([dep, version]) => powerShellLiteral(`${dep}@${version}`))
            .join(
              ' '
            )}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; ${windowsNodePtyPatchCommand(nodePath)}`
        )
      : commandWithNodePath(
          hostPlatform,
          nodePath,
          remoteDir,
          `${resetPrefix}npm install --ignore-scripts=false --omit=dev --no-audit --no-fund ${installArgs} 2>&1`
        )
    await execHostCommand(conn, hostPlatform, command, {
      timeoutMs: NATIVE_DEPS_COMMAND_TIMEOUT_MS,
      signal
    })
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    signal?.throwIfAborted()
    // Don't write .install-complete on hard fail so reconnect retries the partial install; greppable token aids bug reports.
    const msg = (err as Error).message
    console.warn(
      `[ssh-relay][NATIVE-DEPS-INSTALL-FAIL] npm install native deps failed at ${remoteDir} (${platform}): ${msg}`
    )
    // Why: on Linux node-pty compiles, so a missing C/C++ toolchain is the dominant first-connect failure (#1693); probe to give an actionable install hint.
    if (platform.startsWith('linux') && shouldProbeBuildToolchainAfterNativeDepsFailure(msg)) {
      const toolchain = await probeBuildToolchain(conn, hostPlatform, signal)
      if (toolchain?.toolchainMissing) {
        // Why: node-pty is the only dep that needs a compiler, and it only backs terminals. Retry
        // without it so files/git/editor still connect instead of failing the host outright; a
        // missing native dep is already non-fatal below. Rethrow the actionable error if even that
        // fails, so a host broken for some other reason still reports the toolchain gap.
        console.warn(
          `[ssh-relay][NPTY-SKIP-NO-TOOLCHAIN] ${remoteDir} (${platform}): ${formatSkippedNodePtyWarning(toolchain)}`
        )
        try {
          await installNativeDepsWithoutNodePty(
            conn,
            remoteDir,
            hostPlatform,
            nodePath,
            writeRelayPackageJson,
            resetDeps,
            signal
          )
        } catch (retryErr) {
          if (isUnconfirmedSshCommandTermination(retryErr)) {
            throw retryErr
          }
          signal?.throwIfAborted()
          // The thrown toolchain message is built from the original error, so log the retry's own
          // cause (registry, ENOSPC, EACCES) rather than losing it.
          console.warn(
            `[ssh-relay][NPTY-SKIP-RETRY-FAIL] node-pty-less reinstall failed at ${remoteDir} (${platform}): ${(retryErr as Error).message}`
          )
          throw new Error(formatMissingToolchainError(toolchain, msg), { cause: retryErr })
        }
        // Why: this early return skips the probe below, so verify the dep that does have a prebuilt —
        // a @parcel/watcher that installs but can't load would leave file watching silently dead.
        await warnIfWatcherUnloadableWithoutNodePty(
          conn,
          remoteDir,
          platform,
          hostPlatform,
          nodePath,
          signal
        )
        return
      }
    }
    throw err
  }

  await makeNodePtySpawnHelperExecutable(conn, remoteDir, hostPlatform, signal)

  let probe = await probeInstalledNativeDeps(conn, remoteDir, hostPlatform, nodePath, signal)
  if (!probe.available) {
    // Why: npm treats an already-present package as up to date, so re-enabling lifecycle scripts on install can't repair a skipped binding.
    console.warn(`[ssh-relay] Rebuilding unloadable native deps at ${remoteDir}`)
    let rebuilt = false
    try {
      await rebuildNativeDeps(conn, remoteDir, hostPlatform, nodePath, signal)
      rebuilt = true
    } catch (err) {
      if (isUnconfirmedSshCommandTermination(err)) {
        throw err
      }
      signal?.throwIfAborted()
      console.warn(
        `[ssh-relay][NATIVE-DEPS-REBUILD-FAIL] npm rebuild native deps failed at ${remoteDir} (${platform}): ${(err as Error).message}`
      )
    }
    signal?.throwIfAborted()
    if (rebuilt) {
      await makeNodePtySpawnHelperExecutable(conn, remoteDir, hostPlatform, signal)
      probe = await probeInstalledNativeDeps(conn, remoteDir, hostPlatform, nodePath, signal)
    }
  }

  // MISSING is non-fatal by design: the relay still serves fs/git/preflight; only native-backed ops fail on hosts that can't build the addons.
  if (!probe.available) {
    console.warn(
      `[ssh-relay][NPTY-MISSING] native deps installed but require() failed at ${remoteDir} (${platform}). stdout=${probe.output.trim().slice(-200)} stderr=${probe.stderr.trim().slice(-500)}`
    )
  }
}


export function resetNativeDepsCommand(
  hostPlatform: RemoteHostPlatform,
  resetDeps: RelayNativeDepName[]
): string {
  if (resetDeps.length === 0) {
    return ''
  }
  const resetNodePty = resetDeps.includes('node-pty')
  const resetWatcher = resetDeps.includes('@parcel/watcher')
  if (isWindowsRemoteHost(hostPlatform)) {
    const commands: string[] = []
    if (resetNodePty) {
      commands.push(
        `Remove-Item -LiteralPath ${powerShellLiteral('node_modules/node-pty')} -Recurse -Force -ErrorAction SilentlyContinue`
      )
    }
    if (resetWatcher) {
      commands.push(
        `Remove-Item -LiteralPath ${powerShellLiteral('node_modules/@parcel/watcher')} -Recurse -Force -ErrorAction SilentlyContinue`,
        `$parcelScope = ${powerShellLiteral('node_modules/@parcel')}`,
        `Get-ChildItem -LiteralPath $parcelScope -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name.StartsWith('watcher-', [StringComparison]::Ordinal) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`
      )
    }
    return commands.join('; ')
  }
  const commands: string[] = []
  if (resetNodePty) {
    commands.push(`rm -rf ${shellEscape('node_modules/node-pty')}`)
  }
  if (resetWatcher) {
    commands.push(
      `rm -rf ${shellEscape('node_modules/@parcel/watcher')}`,
      `find ${shellEscape('node_modules/@parcel')} -maxdepth 1 -name 'watcher-*' -exec rm -rf {} + 2>/dev/null || true`
    )
  }
  return commands.join('; ')
}

/**
 * Reinstall the relay's native deps with node-pty dropped, for hosts that cannot compile it.
 *
 * Why: npm reconciles every dependency in package.json, not just the ones named on the command
 * line, so node-pty has to leave the manifest too — naming only @parcel/watcher still rebuilds it.
 */
