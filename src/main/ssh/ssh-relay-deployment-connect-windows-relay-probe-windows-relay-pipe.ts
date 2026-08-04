import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import type { SshConnection } from './ssh-connection'
import { waitForSentinel } from './ssh-relay-deploy-helpers'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { windowsRelayProbeCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'
import { commandWithNodePath } from './ssh-remote-commands'
import { joinRemotePath,type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral } from './ssh-remote-powershell'

export async function connectWindowsRelay(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  opts: {
    remoteDir: string
    nodePath: string
    sockPath: string
    credentialFile: string
  },
  signal?: AbortSignal
): Promise<MultiplexerTransport> {
  const channel = await conn.exec(
    windowsRelayConnectCommand(
      hostPlatform,
      opts.nodePath,
      opts.remoteDir,
      opts.sockPath,
      opts.credentialFile
    ),
    { wrapCommand: false, signal }
  )
  return waitForSentinel(channel, signal)
}


export function windowsRelayConnectCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  remoteDir: string,
  sockPath: string,
  credentialFile: string
): string {
  return commandWithNodePath(
    hostPlatform,
    nodePath,
    remoteDir,
    `& ${powerShellLiteral(nodePath)} relay.js --connect --sock-path ${powerShellLiteral(sockPath)} --credential-file ${powerShellLiteral(credentialFile)}`
  )
}


export function windowsRelayLaunchCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  remoteDir: string,
  sockPath: string,
  endpointDir: string,
  graceTime: number,
  logFile: string,
  errFile: string,
  credentialFile: string
): string {
  const relayScript = joinRemotePath(hostPlatform, remoteDir, 'relay.js')
  // Why: Windows sshd kills the exec channel's process tree on close; WMI re-parents the detached relay to survive.
  const quoted = (value: string): string => `"${value.replace(/"/g, '\\"')}"`
  const relayCommandLine = [
    quoted(nodePath),
    quoted(relayScript),
    '--detached',
    '--grace-time',
    String(graceTime),
    '--sock-path',
    quoted(sockPath),
    '--credential-file',
    quoted(credentialFile),
    '--endpoint-dir',
    quoted(endpointDir),
    // Why: --log-file owns rotation; shell redirects still capture pre-JS boot/crash output.
    '--log-file',
    quoted(logFile),
    `1>${quoted(logFile)}`,
    `2>${quoted(errFile)}`
  ].join(' ')
  const wmiCommandLine = `cmd.exe /d /s /c "${relayCommandLine}"`
  return commandWithNodePath(
    hostPlatform,
    nodePath,
    remoteDir,
    [
      `& icacls.exe ${powerShellLiteral(credentialFile)} /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null`,
      `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${powerShellLiteral(wmiCommandLine)}; CurrentDirectory = ${powerShellLiteral(remoteDir)} }`,
      `if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create failed with $($result.ReturnValue)" }`
    ].join('; ')
  )
}


export async function probeWindowsRelayPipe(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  opts: {
    remoteDir: string
    nodePath: string
    sockPath: string
  },
  signal?: AbortSignal
): Promise<'READY' | 'WAITING'> {
  const result = await execHostCommand(
    conn,
    hostPlatform,
    windowsRelayProbeCommand(hostPlatform, opts.nodePath, opts.remoteDir, opts.sockPath),
    { signal }
  )
  return result.trim() === 'READY' ? 'READY' : 'WAITING'
}
