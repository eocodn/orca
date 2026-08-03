import type { SshTarget } from '../../shared/ssh-types'
import type { SshResolvedConfig } from './ssh-config-parser'
import { isOpenSshConfigBackedTarget } from './system-ssh-args'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import type { SftpNamespacePathMapping } from './sftp-namespace-resolution'
export type { SshConnectionCallbacks } from './ssh-connection-utils'

type SshRemoteFileOptions = {
  hostPlatform?: RemoteHostPlatform
  // Only uploadDirectory and writeFile honor this, and only on the non-Windows ssh2 branch.
  sftpNamespace?: SftpNamespacePathMapping
}

// Upper bound on waiting for an aborted channel's open/close to settle before rejecting anyway.
const ABORTED_CHANNEL_CLOSE_GRACE_MS = 5_000

// Why: MaxSessions servers can transiently refuse a channel open; a refused open never ran the command, so retry is safe.
const SESSION_LIMIT_OPEN_RETRIES = 4
const SESSION_LIMIT_OPEN_RETRY_DELAY_MS = 150

function cloneResolvedConfig(config: SshResolvedConfig | null): SshResolvedConfig | null {
  if (!config) {
    return null
  }
  return { ...config, identityFile: [...config.identityFile] }
}

function isGitHubRestrictedShellProbeSuccess(
  target: SshTarget,
  resolvedConfig: SshResolvedConfig | null,
  code: number | null,
  stderr: string
): boolean {
  if (code !== 1) {
    return false
  }

  const effectiveUser = (
    isOpenSshConfigBackedTarget(target) && resolvedConfig
      ? resolvedConfig.user?.trim() || target.username?.trim()
      : target.username?.trim() || resolvedConfig?.user?.trim()
  )?.toLowerCase()
  if (effectiveUser !== 'git') {
    return false
  }

  // GitHub appends git:// advisory lines after the invalid-command line (issue #6988), so match the first line only.
  const firstLine = stderr.split('\n', 1)[0]?.trim()
  if (firstLine !== 'Invalid command: echo ORCA-SYSTEM-SSH-OK') {
    return false
  }

  const resolvedHost = resolvedConfig?.hostname?.trim()
  const hostCandidates = resolvedHost ? [resolvedHost] : [target.host, target.configHost]

  return hostCandidates.some((host) => {
    const normalizedHost = host?.trim().toLowerCase()
    return normalizedHost === 'github.com' || normalizedHost === 'ssh.github.com'
  })
}


export { ABORTED_CHANNEL_CLOSE_GRACE_MS, SESSION_LIMIT_OPEN_RETRIES, SESSION_LIMIT_OPEN_RETRY_DELAY_MS, cloneResolvedConfig, isGitHubRestrictedShellProbeSuccess, type SshRemoteFileOptions }
