import type { RelayPlatform } from './relay-protocol'
import type { SshConnection } from './ssh-connection'
import { shellEscape } from './ssh-connection-utils'
import { isUnconfirmedSshCommandTermination } from './ssh-relay-deploy-helpers'
import { NODE_PTY_CONSOLE_LIST_PATCH_FILENAME } from './ssh-relay-deployment-create-install-namespace-if-supported-relay-native-deps'
import { acquireRelayLaunchGcFence,createRelayLaunchNamespace,installNativeDeps } from './ssh-relay-deployment-create-relay-launch-namespace-reset-native-deps-command'
import { RelayDirectoryGcConflictError,execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { NATIVE_DEPS_MISSING_PREFIX,RELAY_NATIVE_DEP_NAMES,type RelayNativeDepName } from './ssh-relay-deployment-relay-native-dep-name-relay-native-dep-script-allowlist'
import { type RelayInstallNamespace } from './ssh-relay-install-namespace'
import { tryAcquireRelayRepairLock } from './ssh-relay-repair-lock'
import { abandonInstall,finalizeInstall,isRelayAlreadyInstalled } from './ssh-relay-versioned-install'
import { commandWithNodePath } from './ssh-remote-commands'
import { isWindowsRemoteHost,type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral,powerShellNativeArg } from './ssh-remote-powershell'

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
