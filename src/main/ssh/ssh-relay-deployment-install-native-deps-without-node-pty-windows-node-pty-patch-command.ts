import type { RelayPlatform } from './relay-protocol'
import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { isUnconfirmedSshCommandTermination } from './ssh-relay-deploy-helpers'
import { NATIVE_DEPS_COMMAND_TIMEOUT_MS } from './ssh-relay-deploy-timing'
import { NODE_PTY_CONSOLE_LIST_PATCH_FILENAME,RELAY_NATIVE_DEPS } from './ssh-relay-deployment-create-install-namespace-if-supported-relay-native-deps'
import { resetNativeDepsCommand } from './ssh-relay-deployment-create-relay-launch-namespace-reset-native-deps-command'
import { probeInstalledNativeDeps } from './ssh-relay-deployment-make-node-pty-spawn-helper-executable-get-local-relay-candidates'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { type RelayNativeDepName } from './ssh-relay-deployment-relay-native-dep-name-relay-native-dep-script-allowlist'
import { commandWithNodePath } from './ssh-remote-commands'
import { isWindowsRemoteHost,type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral } from './ssh-remote-powershell'

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
