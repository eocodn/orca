import type { SshConnection } from './ssh-connection'
import { createRelayInstallNamespace, type RelayInstallNamespace } from './ssh-relay-install-namespace'
import { isWindowsRemoteHost, type RemoteHostPlatform } from './ssh-remote-platform'

export function createInstallNamespaceIfSupported(
  conn: SshConnection,
  hostPlatform: RemoteHostPlatform,
  homeRelativeRelayDir: string
): RelayInstallNamespace | undefined {
  if (isWindowsRemoteHost(hostPlatform)) {
    return undefined
  }
  // A connection double without the transport accessor is an ssh2 connection.
  const usesSystemSsh =
    typeof conn.usesSystemSshTransport === 'function' ? conn.usesSystemSshTransport() : false
  return usesSystemSsh ? undefined : createRelayInstallNamespace(homeRelativeRelayDir)
}


export const NODE_PTY_VERSION = '1.1.0'

export const NODE_PTY_CONSOLE_LIST_PATCH_FILENAME = 'node-pty-1.1.0-console-list-agent-patch.cjs'

export const RELAY_NATIVE_DEPS = {
  'node-pty': NODE_PTY_VERSION,
  '@parcel/watcher': '2.5.6'
} as const
