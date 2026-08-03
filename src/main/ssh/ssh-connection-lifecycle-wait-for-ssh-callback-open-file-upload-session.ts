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

export const SshConnectionMethods4 = {
  waitForSshCallback<T>(this: any,
    timeoutMessage: string,
    register: (callback: (error: Error | undefined, value: T) => void) => void,
    cleanupLateValue?: (value: T) => void,
    signal?: AbortSignal,
    trackRemoteCommandTermination = false
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      type ChannelOpenTerminationError = Error & { sshChannelCloseConfirmed: boolean }
      let settled = false
      let unconfirmedOpenError: ChannelOpenTerminationError | null = null
      const markOpenUnconfirmed = (error: Error): Error => {
        if (!trackRemoteCommandTermination) {
          return error
        }
        unconfirmedOpenError = Object.assign(error, { sshChannelCloseConfirmed: false })
        return unconfirmedOpenError
      }
      // Why: an in-flight open holds a MaxSessions slot; reject the caller now, then settle from the open callback once the late channel closes.
      let abortRequested = false
      let abortDeadlineTimer: NodeJS.Timeout | undefined
      const cleanup = (): void => {
        clearTimeout(timer)
        clearTimeout(abortDeadlineTimer)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        abortRequested = true
        // Why: a hung socket may never invoke the open callback; bound the aborted caller's wait instead of pinning it for CONNECT_TIMEOUT_MS.
        abortDeadlineTimer = setTimeout(() => {
          settled = true
          cleanup()
          reject(markOpenUnconfirmed(createSshOperationAbortError()))
        }, ABORTED_CHANNEL_CLOSE_GRACE_MS)
      }
      const timer = setTimeout(() => {
        settled = true
        cleanup()
        reject(
          markOpenUnconfirmed(
            abortRequested ? createSshOperationAbortError() : new Error(timeoutMessage)
          )
        )
      }, CONNECT_TIMEOUT_MS)
      const discardLateValue = (value: T, onClose?: () => void): void => {
        const emitter = value as Partial<NodeJS.EventEmitter> & {
          resume?: () => void
          stderr?: Partial<NodeJS.EventEmitter> & { resume?: () => void }
        }
        const swallowLateError = (): void => {}
        emitter.on?.('error', swallowLateError)
        emitter.stderr?.on?.('error', swallowLateError)
        if (onClose) {
          emitter.once?.('close', onClose)
        }
        // Why: ssh2 withholds CHANNEL_CLOSE while discarded exec streams remain unread, and teardown errors have no other owner.
        emitter.resume?.()
        emitter.stderr?.resume?.()
        try {
          cleanupLateValue?.(value)
        } catch {
          /* best effort */
        }
      }
      const rejectAfterClose = (value: T): void => {
        const abortError = markOpenUnconfirmed(createSshOperationAbortError())
        const emitter = value as Partial<NodeJS.EventEmitter> & {
          resume?: () => void
          stderr?: { resume?: () => void }
        }
        let finished = false
        const done = (): void => {
          if (finished) {
            return
          }
          finished = true
          clearTimeout(closeGraceTimer)
          emitter.removeListener?.('close', confirmAndDone)
          reject(abortError)
        }
        const confirmAndDone = (): void => {
          if (unconfirmedOpenError === abortError) {
            unconfirmedOpenError.sshChannelCloseConfirmed = true
          }
          done()
        }
        // Why: bounded so a remote that never confirms the close can't hang the aborted operation forever.
        const closeGraceTimer = setTimeout(done, ABORTED_CHANNEL_CLOSE_GRACE_MS)
        if (typeof emitter.once === 'function') {
          emitter.once('close', confirmAndDone)
        }
        // Why: ssh2 withholds 'close' until the channel's streams are drained; nobody else will read this discarded channel.
        discardLateValue(value)
        if (typeof emitter.once !== 'function') {
          done()
        }
      }
      const finish = (error: Error | undefined, value?: T): void => {
        if (settled) {
          // Why: ssh2 can invoke the open callback after our timeout rejected; close that late channel so it isn't left open with no owner.
          if (!error && value !== undefined) {
            discardLateValue(value, () => {
              if (unconfirmedOpenError) {
                unconfirmedOpenError.sshChannelCloseConfirmed = true
              }
            })
          }
          return
        }
        settled = true
        cleanup()
        if (abortRequested) {
          if (!error && value !== undefined) {
            rejectAfterClose(value)
          } else {
            reject(createSshOperationAbortError())
          }
          return
        }
        if (error) {
          reject(error)
          return
        }
        resolve(value as T)
      }
      if (signal?.aborted) {
        // No open is in flight yet, so failing fast leaks nothing.
        cleanup()
        reject(createSshOperationAbortError())
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        // Why: higher-level channel timers start only after ssh2's open callback; a stale SSH socket can otherwise keep exec/sftp stuck.
        register(finish)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  },
  async uploadDirectory(this: any,
    localDir: string,
    remoteDir: string,
    options?: SshRemoteFileOptions & { signal?: AbortSignal }
  ): Promise<void> {
    // Why: relay-deploy timeout and connection teardown are independent owners; either must stop a transfer that could outlive its lock.
    const linkedSignal = createLinkedSshFileTransferSignal(
      [this.systemOperationAbortController.signal, options?.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined
      )
    )
    try {
      if (!this.useSystemSshTransport) {
        const sftp = await this.sftp(linkedSignal.signal)
        const swallowLateSftpError = (): void => {}
        let sftpEndRequested = false
        const endSftp = (): void => {
          if (!sftpEndRequested) {
            sftpEndRequested = true
            sftp.end()
          }
        }
        sftp.on('error', swallowLateSftpError)
        sftp.once('close', () => sftp.removeListener('error', swallowLateSftpError))
        try {
          // Why: resolve on the same session that transfers — a later session is not authoritative for this one's namespace.
          const transfer = (async (): Promise<void> => {
            const targetDir = await resolveSftpTransferPathIfMapped(sftp, remoteDir, options)
            linkedSignal.signal.throwIfAborted()
            const { uploadDirectory } = await import('./ssh-relay-deploy-helpers')
            await uploadDirectory(sftp, localDir, targetDir)
          })()
          await raceSftpFileTransferWithAbort(transfer, linkedSignal.signal, (onClose) => {
            sftp.once('close', onClose)
            endSftp()
          })
        } finally {
          endSftp()
        }
        return
      }
      await uploadDirectoryViaSystemSsh(this.target, localDir, remoteDir, {
        signal: linkedSignal.signal,
        hostPlatform: options?.hostPlatform,
        ...this.getSystemSshBuildArgsOptions()
      })
    } finally {
      linkedSignal.dispose()
    }
  },
  async downloadFile(this: any,
    remotePath: string,
    localPath: string,
    options?: SshRemoteFileOptions
  ): Promise<void> {
    if (!this.useSystemSshTransport) {
      const sftp = await this.sftp()
      try {
        const { fastGetViaSftp } = await import('../providers/ssh-filesystem-provider-sftp')
        await fastGetViaSftp(sftp, remotePath, localPath)
      } finally {
        sftp.end()
      }
      return
    }
    await downloadFileViaSystemSsh(this.target, remotePath, localPath, {
      signal: this.systemOperationAbortController.signal,
      hostPlatform: options?.hostPlatform,
      ...this.getSystemSshBuildArgsOptions()
    })
  },
  async openFileUploadSession(this: any, options?: SshRemoteFileOptions): Promise<FileUploadSession> {
    if (!this.useSystemSshTransport) {
      const sftp = await this.sftp()
      const { uploadFile } = await import('./sftp-upload')
      return {
        uploadFile: (localPath, remotePath, uploadOptions) =>
          uploadFile(sftp, localPath, remotePath, uploadOptions),
        close: () => sftp.end()
      }
    }
    // Why: disconnect replaces the connection controller, so an existing import session must stay bound to the signal and SSH config it opened with.
    const signal = this.systemOperationAbortController.signal
    const buildArgsOptions = this.getSystemSshBuildArgsOptions()
    return {
      uploadFile: (localPath, remotePath, uploadOptions) =>
        uploadFileViaSystemSsh(this.target, localPath, remotePath, {
          signal,
          hostPlatform: options?.hostPlatform,
          exclusive: uploadOptions?.exclusive,
          ...buildArgsOptions
        }),
      close: () => {}
    }
  }
}
export type SshConnectionMethods4Surface = typeof SshConnectionMethods4
