import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { SshConnection } from './ssh-connection'
import type { RelayPlatform } from './relay-protocol'
import { shellEscape } from './ssh-connection-utils'
import { commandWithNodePath, removeRemoteFileCommand } from './ssh-remote-commands'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral, powerShellNativeArg } from './ssh-remote-powershell'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { type RelayNativeDepName } from './ssh-relay-deployment-relay-native-dep-name-relay-native-dep-script-allowlist'
import { nativeDepsProbeJs, missingNativeDepsFromProbe } from './ssh-relay-deployment-native-deps-probe-js-repair-installed-native-deps'

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
