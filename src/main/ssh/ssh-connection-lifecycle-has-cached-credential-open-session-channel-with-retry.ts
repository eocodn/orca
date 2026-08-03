import type { ClientChannel, SFTPWrapper } from 'ssh2'
import { type SshExecOptions, wrapRemoteCommandForPosixShell, createSshOperationAbortError } from './ssh-connection-utils'
import { isSshSessionLimitError } from './ssh-session-limit-error'
import { SESSION_LIMIT_OPEN_RETRIES, SESSION_LIMIT_OPEN_RETRY_DELAY_MS } from './ssh-connection-lifecycle-foundation'

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
