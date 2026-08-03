import type { SshConnection } from './ssh-connection'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import { writeRelayEndpointCredential } from './ssh-relay-endpoint-credential'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellCommand, powerShellLiteral } from './ssh-remote-powershell'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { connectWindowsRelay, windowsRelayLaunchCommand, probeWindowsRelayPipe } from './ssh-relay-deployment-connect-windows-relay-probe-windows-relay-pipe'
import { waitForWindowsRelayPipe, windowsRelayTailLogCommand } from './ssh-relay-deployment-wait-for-windows-relay-pipe-windows-relay-tail-log-command'

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
