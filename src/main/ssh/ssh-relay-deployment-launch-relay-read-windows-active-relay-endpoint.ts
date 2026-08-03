import { app } from 'electron'
import type { SshConnection } from './ssh-connection'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import { waitForSentinel, execCommand, isUnconfirmedSshCommandTermination } from './ssh-relay-deploy-helpers'
import { writeRelayEndpointCredential } from './ssh-relay-endpoint-credential'
import { createSshOperationAbortError, shellEscape } from './ssh-connection-utils'
import { isWindowsRemoteHost, joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellCommand, powerShellLiteral } from './ssh-remote-powershell'
import { relaySocketNameForInstanceId } from './ssh-relay-instance-id'
import { isWindowsRelayPipePath, relayEndpointForHost, relayHookEndpointDirForHost, windowsActivePipeMarkerPath, windowsRelayFallbackSocketName } from './ssh-relay-endpoints'
import { DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS, MAX_SSH_RELAY_GRACE_PERIOD_SECONDS, MIN_SSH_RELAY_GRACE_PERIOD_SECONDS } from '../../shared/ssh-types'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { type WindowsRelayEndpoint, launchWindowsRelay } from './ssh-relay-deployment-remember-windows-active-relay-endpoint-launch-windows-relay'

export async function launchRelay(
  conn: SshConnection,
  remoteDir: string,
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  graceTimeSeconds?: number,
  relayInstanceId?: string,
  signal?: AbortSignal
): Promise<{
  transport: MultiplexerTransport
  nodePath: string
  sockPath: string
  credentialFile: string
}> {
  // Why: graceTimeSeconds comes from user-editable SshTarget config; floor+clamp to an integer prevents shell injection if the type ever loosened.
  const requestedGraceTime = Math.floor(graceTimeSeconds ?? DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS)
  const graceTime =
    requestedGraceTime === 0
      ? 0
      : Math.max(
          MIN_SSH_RELAY_GRACE_PERIOD_SECONDS,
          Math.min(MAX_SSH_RELAY_GRACE_PERIOD_SECONDS, requestedGraceTime)
        )
  const escapedDir = shellEscape(remoteDir)
  const escapedNode = shellEscape(nodePath)
  // Why: remoteRelayDir is shared across Orca targets for one account; hashing the target ID into the socket name stops cross-target attach.
  const sockName = relaySocketNameForInstanceId(relayInstanceId)
  const sockFile = relayEndpointForHost(hostPlatform, remoteDir, sockName)
  const endpointDir = relayHookEndpointDirForHost(hostPlatform, remoteDir, sockFile)
  const credentialFile = joinRemotePath(hostPlatform, remoteDir, `${sockName}.credential`)

  if (isWindowsRemoteHost(hostPlatform)) {
    const activePipeMarkerPath = windowsActivePipeMarkerPath(hostPlatform, remoteDir, sockName)
    const discoveredActiveEndpoint = await readWindowsActiveRelayEndpoint(
      conn,
      hostPlatform,
      remoteDir,
      activePipeMarkerPath,
      signal
    )
    const activeEndpoint = discoveredActiveEndpoint ?? {
      sockPath: sockFile,
      endpointDir
    }
    const fallbackEndpoint = buildWindowsRelayFallbackEndpoint(hostPlatform, remoteDir, sockName)
    const launched = await launchWindowsRelay(
      conn,
      hostPlatform,
      {
        remoteDir,
        nodePath,
        sockPath: activeEndpoint.sockPath,
        endpointDir: activeEndpoint.endpointDir,
        graceTime,
        activePipeMarkerPath,
        reconnectFallback: fallbackEndpoint,
        credentialFile
      },
      signal
    )
    return { ...launched, credentialFile }
  }

  // Why: after a restart the relay may still be alive in its grace period; --connect to its socket preserves PTY state and scrollback.
  try {
    const probeOutput = await execCommand(
      conn,
      `test -S ${shellEscape(sockFile)} && echo ALIVE || echo DEAD`,
      { signal }
    )
    console.warn(`[ssh-relay] Socket probe result: "${probeOutput.trim()}"`)
    if (probeOutput.trim() === 'ALIVE') {
      console.log('[ssh-relay] Existing relay socket found, attempting reconnect...')
      try {
        const channel = await conn.exec(
          `cd ${escapedDir} && ${escapedNode} relay.js --connect --sock-path ${shellEscape(sockFile)} --credential-file ${shellEscape(credentialFile)}`,
          { signal }
        )
        const transport = await waitForSentinel(channel, signal)
        console.log('[ssh-relay] Reconnected to existing relay via socket')
        return { transport, nodePath, sockPath: sockFile, credentialFile }
      } catch (err) {
        signal?.throwIfAborted()
        console.warn(
          '[ssh-relay] Socket reconnect failed, launching fresh relay:',
          err instanceof Error ? err.message : String(err)
        )
        // Why: stale socket from a crashed relay — remove it so the fresh launch can bind at the same path.
        await execCommand(conn, `rm -f ${shellEscape(sockFile)}`, { signal }).catch(
          (cleanupErr) => {
            if (isUnconfirmedSshCommandTermination(cleanupErr)) {
              throw cleanupErr
            }
          }
        )
        signal?.throwIfAborted()
      }
    }
  } catch (err) {
    if (isUnconfirmedSshCommandTermination(err)) {
      throw err
    }
    signal?.throwIfAborted()
    // Probe failed — fall through to fresh launch
  }

  // Why: relay must outlive the SSH connection so PTY sessions survive app restarts — nohup + </dev/null + & detach it from the exec channel.
  // Why: execCommand would block on channel close that backgrounded children never allow; fire-and-forget via conn.exec, the socket poll detects readiness.
  const logFile = `${remoteDir}/relay.log`
  await writeRelayEndpointCredential(conn, hostPlatform, nodePath, credentialFile, {
    signal
  })
  // Why: --log-file lets the relay rotate relay.log in-process; the shell redirect stays to capture pre-JS boot/crash output.
  const launchCmd = `cd ${escapedDir} && chmod 600 ${shellEscape(credentialFile)} && nohup ${escapedNode} relay.js --detached --grace-time ${graceTime} --sock-path ${shellEscape(sockFile)} --credential-file ${shellEscape(credentialFile)} --log-file ${shellEscape(logFile)} > ${shellEscape(logFile)} 2>&1 </dev/null &`
  const launchChannel = await conn.exec(launchCmd, { signal })
  launchChannel.on('data', () => {})
  launchChannel.on('error', () => {})
  launchChannel.stderr.on('data', () => {})
  launchChannel.stderr.on('error', () => {})
  // Why: the SSH channel stays open until all child fds close; close it after the poll or channels accumulate and hit the server's MaxSessions limit.
  launchChannel.on('close', () => {})

  // Why: poll rather than fixed sleep — remote host speed varies widely (CI vs. Raspberry Pi).
  // Why: test -S only proves the inode exists, not that the relay is listening; a connect-and-close confirms it accepts connections.
  const POLL_INTERVAL_MS = 200
  const POLL_TIMEOUT_MS = 10_000
  const pollStart = Date.now()
  let socketReady = false
  try {
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      try {
        // Why: probe via node (guaranteed present) not python3/socat/perl; pass the socket path as argv[1] to dodge -e quoting issues.
        const result = await execCommand(
          conn,
          `${escapedNode} -e 'var s=require("net").connect(process.argv[1]);s.on("connect",function(){s.destroy();process.stdout.write("READY")});s.on("error",function(){process.stdout.write("WAITING")})' ${shellEscape(sockFile)} 2>/dev/null || (test -S ${shellEscape(sockFile)} && echo READY || echo WAITING)`,
          { signal }
        )
        if (result.trim() === 'READY') {
          socketReady = true
          break
        }
      } catch {
        signal?.throwIfAborted()
        /* exec failed, retry */
      }
      await waitForRelayPoll(POLL_INTERVAL_MS, signal)
    }
  } finally {
    launchChannel.close()
  }

  if (!socketReady) {
    const logOutput = await execCommand(
      conn,
      `tail -20 ${shellEscape(logFile)} 2>/dev/null || echo "(no log)"`,
      { signal }
    ).catch(() => '(could not read log)')
    signal?.throwIfAborted()
    throw new Error(`Relay failed to start within ${POLL_TIMEOUT_MS / 1000}s. Log:\n${logOutput}`)
  }

  // Why: backgrounded relay's stdout goes to a log file, not the exec channel; --connect bridges this channel to its Unix socket.
  const channel = await conn.exec(
    `cd ${escapedDir} && ${escapedNode} relay.js --connect --sock-path ${shellEscape(sockFile)} --credential-file ${shellEscape(credentialFile)}`,
    { signal }
  )
  return {
    transport: await waitForSentinel(channel, signal),
    nodePath,
    sockPath: sockFile,
    credentialFile
  }
}


export function waitForRelayPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(createSshOperationAbortError())
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
    }
  })
}


export function buildWindowsRelayFallbackEndpoint(
  hostPlatform: RemoteHostPlatform,
  remoteDir: string,
  sockName: string
): WindowsRelayEndpoint {
  const fallbackSockName = windowsRelayFallbackSocketName(sockName)
  const sockPath = relayEndpointForHost(hostPlatform, remoteDir, fallbackSockName)
  return {
    sockPath,
    endpointDir: relayHookEndpointDirForHost(hostPlatform, remoteDir, sockPath)
  }
}


export async function readWindowsActiveRelayEndpoint(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  remoteDir: string,
  markerPath: string,
  signal?: AbortSignal
): Promise<WindowsRelayEndpoint | null> {
  const output = await execHostCommand(
    conn,
    hostPlatform,
    powerShellCommand(
      `if (Test-Path -LiteralPath ${powerShellLiteral(markerPath)} -PathType Leaf) { Get-Content -LiteralPath ${powerShellLiteral(markerPath)} -Raw -ErrorAction SilentlyContinue }`
    ),
    { signal }
  ).catch(() => {
    signal?.throwIfAborted()
    return ''
  })
  const sockPath = output.trim()
  if (!isWindowsRelayPipePath(sockPath)) {
    return null
  }
  return {
    sockPath,
    endpointDir: relayHookEndpointDirForHost(hostPlatform, remoteDir, sockPath)
  }
}
