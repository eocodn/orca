import type { SshConnection } from './ssh-connection'
import { resolveRemoteNodePath } from './ssh-remote-node-resolution'
import { computeRemoteRelayDir, isRelayAlreadyInstalled } from './ssh-relay-versioned-install'
import { readRemoteHomeCommand } from './ssh-remote-commands'
import { normalizeRemoteHome, validateRemoteHome, type RemoteHostPlatform } from './ssh-remote-platform'
import { isSshSessionLimitError } from './ssh-session-limit-error'
import { execHostCommand } from './ssh-relay-deployment-relay-deploy-result-deploy-and-launch-relay'
import { isAbortError } from './ssh-relay-deployment-is-abort-error-upload-relay'

export async function resolveRemoteInstallState(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  fullVersion: string,
  options?: { rethrowSessionLimitErrors?: boolean; signal?: AbortSignal }
): Promise<{ remoteHome: string; remoteRelayDir: string; alreadyInstalled: boolean }> {
  // Why: SFTP doesn't expand `~`, so resolve the remote home explicitly via the host's native shell and normalize it.
  const remoteHome = normalizeRemoteHome(
    await execHostCommand(conn, hostPlatform, readRemoteHomeCommand(hostPlatform), {
      signal: options?.signal
    }),
    hostPlatform
  )
  // Why: $HOME is only used inside single-quoted shell strings, so validation only rejects control chars — spaces and non-ASCII stay valid.
  if (!validateRemoteHome(remoteHome, hostPlatform)) {
    throw new Error(`Remote home is not a valid path: ${remoteHome.slice(0, 100)}`)
  }
  const remoteRelayDir = computeRemoteRelayDir(remoteHome, fullVersion, hostPlatform.pathFlavor)
  const probeOptions =
    options?.rethrowSessionLimitErrors || options?.signal
      ? {
          rethrowSessionLimitErrors: options.rethrowSessionLimitErrors,
          signal: options.signal
        }
      : undefined
  const alreadyInstalled = await isRelayAlreadyInstalled(
    conn,
    remoteRelayDir,
    hostPlatform,
    probeOptions
  )
  return { remoteHome, remoteRelayDir, alreadyInstalled }
}


export type RelayBootstrapState = {
  remoteHome: string
  remoteRelayDir: string
  alreadyInstalled: boolean
  nodePath: string
}


export async function resolveRelayBootstrapStateSequentially(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  fullVersion: string,
  signal?: AbortSignal
): Promise<RelayBootstrapState> {
  const installState = await resolveRemoteInstallState(conn, hostPlatform, fullVersion, { signal })
  const nodePath = await resolveRemoteNodePath(conn, hostPlatform, { signal })
  return { ...installState, nodePath }
}


export async function resolveRelayBootstrapState(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  fullVersion: string,
  signal?: AbortSignal
): Promise<RelayBootstrapState> {
  if (!conn.canRunConcurrentExecCommands()) {
    return resolveRelayBootstrapStateSequentially(conn, hostPlatform, fullVersion, signal)
  }
  const abortController = new AbortController()
  const abortForDeploy = (): void => abortController.abort()
  signal?.addEventListener('abort', abortForDeploy, { once: true })
  if (signal?.aborted) {
    abortForDeploy()
  }
  const installStatePromise = resolveRemoteInstallState(conn, hostPlatform, fullVersion, {
    rethrowSessionLimitErrors: true,
    signal: abortController.signal
  })
  const nodePathPromise = resolveRemoteNodePath(conn, hostPlatform, {
    rethrowSessionLimitErrors: true,
    signal: abortController.signal
  })
  try {
    const [installState, nodePath] = await Promise.all([installStatePromise, nodePathPromise])
    signal?.throwIfAborted()
    return { ...installState, nodePath }
  } catch (err) {
    abortController.abort()
    const settled = await Promise.allSettled([installStatePromise, nodePathPromise])
    signal?.throwIfAborted()
    if (!isSshSessionLimitError(err)) {
      throw err
    }
    const nonSessionFailure = settled.find(
      (result) =>
        result.status === 'rejected' &&
        !isSshSessionLimitError(result.reason) &&
        !isAbortError(result.reason)
    )
    if (nonSessionFailure?.status === 'rejected') {
      throw nonSessionFailure.reason
    }
    console.warn(
      '[ssh-relay] Concurrent bootstrap probes hit the remote SSH session limit; retrying sequentially.'
    )
    return resolveRelayBootstrapStateSequentially(conn, hostPlatform, fullVersion, signal)
  } finally {
    signal?.removeEventListener('abort', abortForDeploy)
  }
}
