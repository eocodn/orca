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
import * as foundation from './ssh-connection-lifecycle-foundation'
const { ABORTED_CHANNEL_CLOSE_GRACE_MS, SESSION_LIMIT_OPEN_RETRIES, SESSION_LIMIT_OPEN_RETRY_DELAY_MS, cloneResolvedConfig, isGitHubRestrictedShellProbeSuccess } = foundation
type SshRemoteFileOptions = foundation.SshRemoteFileOptions

export const SshConnectionMethods10 = {
  async disconnect(this: any): Promise<void> {
    this.disposed = true
    this.connectGeneration += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.reconnectTimer = null
    this.cachedPassphrase = null
    this.cachedPassword = null
    this.client?.end()
    this.client = null
    this.proxyProcess?.kill()
    this.proxyProcess = null
    this.systemOperationAbortController.abort()
    this.systemOperationAbortController = new AbortController()
    for (const channel of this.systemCommandChannels) {
      channel.close()
    }
    this.systemCommandChannels.clear()
    this.systemSsh?.kill()
    this.systemSsh = null
    this.systemSshResolvedConfig = null
    this.systemSshControlMasterDisabledForSession = false
    this.systemSshGssapiOnlyForSession = false
    this.useSystemSshTransport = false
    this.setState('disconnected')
  },
  setState(this: any, status: SshConnectionStatus, error?: string): void {
    this.state = {
      ...this.state,
      status,
      error: error ?? null,
      supportsFolderDownload: status === 'connected' && !this.useSystemSshTransport
    }
    this.callbacks.onStateChange(this.target.id, { ...this.state })
  }
}
export type SshConnectionMethods10Surface = typeof SshConnectionMethods10
