import type { SshConnection } from './ssh-connection'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { commandWithNodePath } from './ssh-remote-commands'
import { type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellCommand,powerShellLiteral,powerShellNativeArg } from './ssh-remote-powershell'

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
