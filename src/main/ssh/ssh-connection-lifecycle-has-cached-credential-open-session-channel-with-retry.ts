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

export const SshConnectionMethods3 = {
  hasCachedCredential(this: any): boolean {
    return this.cachedPassphrase != null || this.cachedPassword != null
  },
  async exec(this: any, cmd: string, options?: SshExecOptions): Promise<ClientChannel> {
    if (options?.signal?.aborted) {
      throw createSshOperationAbortError()
    }
    if (this.useSystemSshTransport) {
      if (this.disposed || this.state.status !== 'connected') {
        throw new Error('Not connected')
      }
      return this.spawnTrackedSystemSshCommand(cmd, options)
    }
    if (!this.client) {
      throw new Error('Not connected')
    }
    const client = this.client
    const remoteCommand = options?.wrapCommand === false ? cmd : wrapRemoteCommandForPosixShell(cmd)
    return this.openSessionChannelWithRetry(
      () =>
        this.waitForSshCallback(
          'SSH exec channel timed out',
          (callback) => client.exec(remoteCommand, callback),
          (channel) => channel.close(),
          options?.signal,
          true
        ),
      options?.signal
    )
  },
  async sftp(this: any, options?: AbortSignal | { signal?: AbortSignal }): Promise<SFTPWrapper> {
    // Why: relay transfers pass a signal directly, while filesystem factories use an options object.
    const signal = options && 'aborted' in options ? options : options?.signal
    if (signal?.aborted) {
      throw createSshOperationAbortError()
    }
    if (this.useSystemSshTransport) {
      throw new Error('SFTP is not available when using system SSH transport')
    }
    if (!this.client) {
      throw new Error('Not connected')
    }
    const client = this.client
    return this.openSessionChannelWithRetry(
      () =>
        this.waitForSshCallback(
          'SSH SFTP channel timed out',
          (callback) => client.sftp(callback),
          (sftp) => sftp.end(),
          signal
        ),
      signal
    )
  },
  async openSessionChannelWithRetry<T>(this: any,
    open: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < SESSION_LIMIT_OPEN_RETRIES; attempt++) {
      if (attempt > 0) {
        // Why: an abort must release the backoff immediately, not after it.
        if (!signal?.aborted) {
          await new Promise<void>((resolve) => {
            const onDelayDone = (): void => {
              clearTimeout(delayTimer)
              signal?.removeEventListener('abort', onDelayDone)
              resolve()
            }
            const delayTimer = setTimeout(onDelayDone, SESSION_LIMIT_OPEN_RETRY_DELAY_MS)
            signal?.addEventListener('abort', onDelayDone, { once: true })
          })
        }
        if (signal?.aborted) {
          throw createSshOperationAbortError()
        }
      }
      try {
        return await open()
      } catch (err) {
        if (!isSshSessionLimitError(err)) {
          throw err
        }
        lastError = err
      }
    }
    throw lastError
  }
}
export type SshConnectionMethods3Surface = typeof SshConnectionMethods3
