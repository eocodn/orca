import type { SshConnection } from './ssh-connection'
import type { RelayPlatform } from './relay-protocol'
import type { MultiplexerTransport } from './ssh-channel-multiplexer'
import { execCommand } from './ssh-relay-deploy-helpers'
import { RELAY_DEPLOY_TIMEOUT_MS } from './ssh-relay-deploy-timing'
import { isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'
import { deployAndLaunchRelayInner } from './ssh-relay-deployment-is-abort-error-upload-relay'

export type RelayDeployResult = {
  transport: MultiplexerTransport
  serverBuildId?: string
  platform: RelayPlatform
  hostPlatform?: RemoteHostPlatform
  remoteHome?: string
  remoteRelayDir?: string
  nodePath?: string
  sockPath?: string
  credentialFile?: string
}


export class RelayDirectoryGcConflictError extends Error {
  constructor(
    readonly remoteRelayDir: string,
    readonly hostPlatform: RemoteHostPlatform
  ) {
    super(`Relay directory GC is in progress at ${remoteRelayDir}`)
  }
}


export function execHostCommand(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  command: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  return execCommand(conn, command, {
    wrapCommand: !isWindowsRemoteHost(hostPlatform),
    timeoutMs: options?.timeoutMs,
    signal: options?.signal
  })
}

/**
 * Deploy the relay to the remote host and launch it, returning the transport (relay's stdin/stdout) for multiplexer use.
 */

export async function deployAndLaunchRelay(
  conn: SshConnection,
  onProgress?: (status: string) => void,
  graceTimeSeconds?: number,
  relayInstanceId?: string
): Promise<RelayDeployResult> {
  let timeoutHandle: ReturnType<typeof setTimeout>
  // Why: Promise.race doesn't cancel its loser; abort so a contended install-lock waiter can't mutate the relay after this call times out.
  const deployAbortController = new AbortController()
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      deployAbortController.abort()
      reject(new Error(`Relay deployment timed out after ${RELAY_DEPLOY_TIMEOUT_MS / 1000}s`))
    }, RELAY_DEPLOY_TIMEOUT_MS)
  })

  try {
    return await Promise.race([
      deployAndLaunchRelayInner(
        conn,
        onProgress,
        graceTimeSeconds,
        relayInstanceId,
        deployAbortController.signal
      ),
      timeoutPromise
    ])
  } finally {
    clearTimeout(timeoutHandle!)
  }
}

/**
 * Resolve the remote home, derive the versioned relay dir, and check whether the relay is installed there.
 *
 * Why: extracted to run concurrently with node-path resolution; home and install-check stay sequential because the check needs the resolved dir.
 */
