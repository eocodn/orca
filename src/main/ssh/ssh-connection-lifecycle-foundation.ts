import * as net from 'node:net'
import { createHash } from 'node:crypto'
import { Client as SshClient } from 'ssh2'
import type { ChildProcess } from 'node:child_process'
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2'
import type { SshTarget, SshConnectionState, SshConnectionStatus } from '../../shared/ssh-types'
import {
  getOrcaControlSocketPath,
  spawnSystemSsh,
  spawnSystemSshCommand,
  downloadFileViaSystemSsh,
  uploadDirectoryViaSystemSsh,
  uploadFileViaSystemSsh,
  writeBufferViaSystemSsh,
  writeFileViaSystemSsh,
  type SystemSshBuildArgsOptions,
  type SystemSshProcess
} from './ssh-system-fallback'
import { resolveWithSshG, type SshResolvedConfig } from './ssh-config-parser'
import { removeControlSocketPath } from './ssh-control-socket'
import { isOpenSshConfigBackedTarget } from './system-ssh-args'
import {
  INITIAL_RETRY_ATTEMPTS,
  INITIAL_RETRY_DELAY_MS,
  RECONNECT_BACKOFF_MS,
  CONNECT_TIMEOUT_MS,
  isTransientError,
  isAuthError,
  isAgentFallbackError,
  isSystemSshFallbackError,
  isGssapiSystemSshFallbackCandidate,
  isPassphraseError,
  sleep,
  buildConnectConfig,
  resolveEffectiveProxy,
  spawnProxyCommand,
  wrapRemoteCommandForPosixShell,
  createSshOperationAbortError,
  type SshExecOptions,
  type SshConnectionCallbacks
} from './ssh-connection-utils'
import { getPassphrasePrivateKeyPath } from './ssh-private-key-authentication'
import type { RemoteHostPlatform } from './ssh-remote-platform'
import {
  resolveSftpTransferPathIfMapped,
  type SftpNamespacePathMapping
} from './sftp-namespace-resolution'
import type { FileUploadSession } from '../providers/types'
import { isSshSessionLimitError } from './ssh-session-limit-error'
import {
  createLinkedSshFileTransferSignal,
  raceSftpFileTransferWithAbort
} from './ssh-file-transfer-abort'
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
